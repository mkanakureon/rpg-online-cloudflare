// quests/index.ts — クエストのモジュール（GET /v1/quests の一覧と POST /v1/quests/{questId}/claim の報酬の受け取り）。
//
// どちらも APP_ENV=local の門 → トークン → プレイヤーの利用制限（2 つの口を合わせて RATE_LIMITS.quests。429）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 口ごとの確かめ の順
// （src/core/access.ts の checkPlayerAccess）。進捗はプレイヤーデータの値を読むだけで（一度きりはキーのいまの値 player_data、デイリー・週間は
// いまの区切りの値 player_data_period_values。区切りは src/core/period.ts にサーバーの時刻を渡して決める）、達成は受け取りの時に
// batch の文 1 の条件で判定する（「達成した」の申告・送られた時刻は読まない）。受け取りは、受け取りの行・受領の履歴・残高の 3 文を
// 1 つの batch で書き、一意の鍵（プレイヤー・クエスト・区切り）で二重を止める。2 回目は 200 で 1 回目と同じ本文。受け取りには
// 自然な鍵があるので、送り直しの見出しは読まない。プレイヤーデータ・所持品の表を読み書きするが、ほかのモジュールは読み込まない。
// 受領の履歴の種類の名前は src/core/ledger.ts の LEDGER_SOURCES から読む（3 文はここに置き、ledger.ts へ移さない）。
// 順と SQL の正は docs/guides/working/quest-design.md §4〜§7。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { checkPlayerAccess } from '../../core/access';
import type { Env } from '../../core/env';
import { error, json } from '../../core/http';
import { MAX_ITEM_AMOUNT, MAX_REWARD_LINES } from '../../core/inventory';
import { LEDGER_SOURCES } from '../../core/ledger';
import type { GameModule } from '../../core/module';
import { isoSeconds, nextResetAt, periodKey, type QuestKind } from '../../core/period';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import { questItem, questStatus, type Grant } from './shape';
import { serverNow } from '../../core/clock';

type OpenRow = { questId: string; kind: QuestKind; startsAt: number; endsAt: number; offsetMinutes: number; key: string; threshold: number;
  total: number };
type PeriodValueRow = { key: string; kind: string; periodKey: string; value: number };
type ClaimedRow = { questId: string; periodKey: string };
type RewardRow = { questId: string; itemId: string; amount: number };
type ClaimRow = { claimId: string; claimedAt: number };
type CurrentRow = { startsAt: number; endsAt: number; threshold: number; progress: number };

const listPath = /^\/v1\/quests$/;
const claimPath = /^\/v1\/quests\/([a-zA-Z0-9_-]{1,64})\/claim$/;

// 開いているクエストと、トークンのプレイヤーのキーのいまの値（一度きりの進捗。行が無ければ 0）
const openQuests = `SELECT x.quest_id AS questId, x.kind, x.starts_at AS startsAt, x.ends_at AS endsAt,
    x.reset_offset_minutes AS offsetMinutes, x.key, x.threshold,
    COALESCE((SELECT d.value FROM player_data d WHERE d.game_id = x.game_id AND d.player_id = ? AND d.key = x.key), 0) AS total
  FROM quests x WHERE x.game_id = ? AND x.starts_at <= ? AND ? < x.ends_at ORDER BY x.quest_id`;
// いまの区切りの値と受け取り（区切りの鍵で絞る。どの時差でも、いまの日付・月曜の日付はそれぞれ数個しかないので引数は少ない）
const periodValuesOf = (n: number) => `SELECT key, kind, period_key AS periodKey, value FROM player_data_period_values
  WHERE game_id = ? AND player_id = ? AND period_key IN (${Array(n).fill('?').join(', ')})`;
const claimedOf = (n: number) => `SELECT quest_id AS questId, period_key AS periodKey FROM quest_claims
  WHERE game_id = ? AND player_id = ? AND period_key IN (${Array(n).fill('?').join(', ')})`;
const rewardsOf = `SELECT quest_id AS questId, item_id AS itemId, amount FROM quest_rewards WHERE game_id = ? ORDER BY quest_id, item_id`;
const oneQuest = `SELECT kind, reset_offset_minutes AS offsetMinutes FROM quests WHERE game_id = ? AND quest_id = ?`;
// 進捗（一度きりはキーのいまの値、デイリー・週間は区切り ? の値。行が無ければ 0）。x はクエストの行。? は game_id・player_id・
// game_id・player_id・period_key の順
const progressOf = `COALESCE(CASE x.kind
          WHEN 'once' THEN (SELECT value FROM player_data WHERE game_id = ? AND player_id = ? AND key = x.key)
          ELSE (SELECT value FROM player_data_period_values
                WHERE game_id = ? AND player_id = ? AND key = x.key AND kind = x.kind AND period_key = ?)
        END, 0)`;
// 受け取りの行が無いときの見分け（クエストの期間・閾値と進捗を 1 文で読み直す）
const currentOf = `SELECT x.starts_at AS startsAt, x.ends_at AS endsAt, x.threshold, ${progressOf} AS progress
  FROM quests x WHERE x.game_id = ? AND x.quest_id = ?`;
const claimOf = `SELECT claim_id AS claimId, claimed_at AS claimedAt FROM quest_claims
  WHERE game_id = ? AND player_id = ? AND quest_id = ? AND period_key = ?`;
const grantsOf = `SELECT item_id AS itemId, delta AS amount FROM inventory_ledger
  WHERE game_id = ? AND player_id = ? AND source_type = '${LEDGER_SOURCES.questClaim}' AND source_id = ? ORDER BY item_id`;

// §6 の batch の 3 文。? を順に bind する（中身は §6 と同じ）
// 1. 受け取りの行。期間の内で、進捗が閾値以上で、付与しても上限を超えないときだけ。同じ区切りの行があれば何もしない（バインドは 19）
const insertClaim = `INSERT INTO quest_claims (game_id, player_id, quest_id, period_key, claim_id, claimed_at)
  SELECT ?, ?, ?, ?, ?, ? FROM quests x
  WHERE x.game_id = ? AND x.quest_id = ? AND x.starts_at <= ? AND ? < x.ends_at
    AND ${progressOf} >= x.threshold
    AND NOT EXISTS (
      SELECT 1 FROM quest_rewards r
      LEFT JOIN inventory_balances b ON b.game_id = r.game_id AND b.player_id = ? AND b.item_id = r.item_id
      WHERE r.game_id = ? AND r.quest_id = ? AND COALESCE(b.amount, 0) + r.amount > ?)
  ON CONFLICT (game_id, player_id, quest_id, period_key) DO NOTHING`;
// 2. 受領の履歴（この要求の claim_id が入ったときだけ。バインドは 6）
const insertLedger = `INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
  SELECT r.game_id, ?, r.item_id, r.amount, '${LEDGER_SOURCES.questClaim}', ?, ? FROM quest_rewards r
  WHERE r.game_id = ? AND r.quest_id = ? AND EXISTS (SELECT 1 FROM quest_claims c WHERE c.claim_id = ?)`;
// 3. 残高（同じ条件。バインドは 5）
const upsertBalance = `INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at)
  SELECT r.game_id, ?, r.item_id, r.amount, ? FROM quest_rewards r
  WHERE r.game_id = ? AND r.quest_id = ? AND EXISTS (SELECT 1 FROM quest_claims c WHERE c.claim_id = ?)
  ON CONFLICT (game_id, player_id, item_id) DO UPDATE SET
    amount = inventory_balances.amount + excluded.amount, updated_at = excluded.updated_at`;

/** 報酬の行を品目と数に直す。MAX_REWARD_LINES を超えるのは入れ間違いなので投げる（500）。 */
function grantsFrom(rows: readonly RewardRow[], questId: string): Grant[] {
  const lines = rows.filter((r) => r.questId === questId).map((r) => ({ itemId: r.itemId, amount: r.amount }));
  if (lines.length > MAX_REWARD_LINES) throw new Error(`Quest ${questId} has more than ${MAX_REWARD_LINES} reward lines`);
  return lines;
}

export const quests: GameModule = {
  name: 'quests',
  routes: [
    {
      method: 'GET',
      pattern: listPath,
      async handle(req, env, _match, url, known) {
        const access = await checkPlayerAccess(req, env, url, RATE_LIMITS.quests, { name: quests.name, known });
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const playerId = claims.playerId;
        const now = serverNow();
        const open = (await env.DB.prepare(openQuests).bind(playerId, gameId, now, now).all<OpenRow>()).results;
        const keys = open.map((q) => periodKey(q.kind, now, q.offsetMinutes));
        const periodic = [...new Set(keys.filter((k, i) => open[i].kind !== 'once'))];
        const values = new Map<string, number>();
        if (periodic.length) {
          const rows = (await env.DB.prepare(periodValuesOf(periodic.length)).bind(gameId, playerId, ...periodic).all<PeriodValueRow>()).results;
          for (const r of rows) values.set(`${r.key} ${r.kind} ${r.periodKey}`, r.value);
        }
        const claimed = new Set<string>();
        const claimKeys = [...new Set(keys)];
        if (claimKeys.length) {
          const rows = (await env.DB.prepare(claimedOf(claimKeys.length)).bind(gameId, playerId, ...claimKeys).all<ClaimedRow>()).results;
          for (const r of rows) claimed.add(`${r.questId} ${r.periodKey}`);
        }
        const rewards = open.length ? (await env.DB.prepare(rewardsOf).bind(gameId).all<RewardRow>()).results : [];
        const items = open.map((q, i) => {
          const progress = q.kind === 'once' ? q.total : values.get(`${q.key} ${q.kind} ${keys[i]}`) ?? 0;
          const row = { ...q, progress, claimed: claimed.has(`${q.questId} ${keys[i]}`) };
          return questItem(row, keys[i], nextResetAt(q.kind, now, q.offsetMinutes, q.endsAt), grantsFrom(rewards, q.questId));
        });
        return json({ gameId, serverTime: isoSeconds(now), items });
      },
    },
    {
      method: 'POST',
      pattern: claimPath,
      async handle(req, env, match, url, known) {
        // 本文は読まない（送られても無視。達成の申告・時刻の欄・送り直しの見出しも見ない）
        const access = await checkPlayerAccess(req, env, url, RATE_LIMITS.quests, { name: quests.name, known });
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const playerId = claims.playerId;
        const questId = match[1];
        const quest = (await env.DB.prepare(oneQuest).bind(gameId, questId).all<{ kind: QuestKind; offsetMinutes: number }>()).results[0];
        if (!quest) return error('NOT_FOUND', 'Unknown quest', 404);
        const now = serverNow();
        // いまの区切り（一度きりは 'once'。デイリー・週間はサーバーの時刻とクエストの時差で決める）
        const key = periodKey(quest.kind, now, quest.offsetMinutes);
        const claimId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare(insertClaim).bind(gameId, playerId, questId, key, claimId, now, gameId, questId, now, now,
            gameId, playerId, gameId, playerId, key, playerId, gameId, questId, MAX_ITEM_AMOUNT),
          env.DB.prepare(insertLedger).bind(playerId, claimId, now, gameId, questId, claimId),
          env.DB.prepare(upsertBalance).bind(playerId, now, gameId, questId, claimId),
        ]);
        // この要求の行か、前の要求の行（二重）を読み直す。どちらも同じ形の 200
        const claim = (await env.DB.prepare(claimOf).bind(gameId, playerId, questId, key).all<ClaimRow>()).results[0];
        if (!claim) {
          // 行が無い: 期間の外か、進捗が閾値に届かないか、付与すると残高が上限を超える（読み直した値で見分ける）
          const current = (await env.DB.prepare(currentOf).bind(gameId, playerId, gameId, playerId, key, gameId, questId)
            .all<CurrentRow>()).results[0];
          if (!current || !(current.startsAt <= now && now < current.endsAt)) {
            return error('QUEST_NOT_ACTIVE', 'Quest is not active', 409);
          }
          if (!questStatus(current, current.progress, false).completed) {
            return error('QUEST_NOT_COMPLETED', 'Quest is not completed', 409);
          }
          return error('INVENTORY_LIMIT_EXCEEDED', 'Reward would exceed the inventory limit', 409);
        }
        const grants = (await env.DB.prepare(grantsOf).bind(gameId, playerId, claim.claimId).all<Grant>()).results;
        return json({ gameId, questId, periodKey: key, claimId: claim.claimId, claimedAt: isoSeconds(claim.claimedAt), grants });
      },
    },
  ],
};
