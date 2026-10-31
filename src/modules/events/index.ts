// events/index.ts — イベントのモジュール（GET /v1/events の一覧と POST /v1/events/{eventId}/claim の報酬の受け取り）。
//
// どちらも APP_ENV=local の門 → トークン → プレイヤーの利用制限（所持品・受領の履歴と合わせて RATE_LIMITS.rewards。429）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 口ごとの確かめ の順（所持品の checkAccess と同じ形）。
// 期間と区切りはサーバーの時刻だけで決める（period.ts。本文・問い合わせ・Date の見出しの時刻は読まない）。受け取りは、受け取りの行・
// 受領の履歴・残高の 3 文を 1 つの batch で書き、一意の鍵（プレイヤー・イベント・区切り）で二重を止める。2 回目は 200 で 1 回目と同じ本文。
// 所持品の表にも書くが、inventory のモジュールは読み込まない（モジュールどうしは読み込まない）。受領の履歴の種類の名前は
// src/core/ledger.ts の LEDGER_SOURCES から読む（定数を文に埋める。3 文の中身は変えない。admin-design.md §6）。順と SQL の正は
// docs/guides/working/event-reward-design.md §4・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { requireAuth } from '../../core/auth';
import { requireNotBanned } from '../../core/bans';
import type { Env } from '../../core/env';
import { requireGame } from '../../core/games';
import { requireLocalWrite } from '../../core/guards';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import { MAX_ITEM_AMOUNT, MAX_REWARD_LINES } from '../../core/inventory';
import { LEDGER_SOURCES } from '../../core/ledger';
import type { GameModule } from '../../core/module';
import { consume } from '../../core/rate-limit';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import type { TokenClaims } from '../../core/token';
import { isOpen, isoSeconds, nextResetAt, periodKey, type EventKind } from './period';

type EventRow = { eventId: string; kind: EventKind; startsAt: number; endsAt: number; offsetMinutes: number };
type RewardRow = { eventId: string; itemId: string; amount: number };
type ClaimRow = { claimId: string; claimedAt: number };
type Grant = { itemId: string; amount: number };

const listPath = /^\/v1\/events$/;
const claimPath = /^\/v1\/events\/([a-zA-Z0-9_-]{1,64})\/claim$/;

const eventColumns = `event_id AS eventId, kind, starts_at AS startsAt, ends_at AS endsAt, reset_offset_minutes AS offsetMinutes`;
const openEvents = `SELECT ${eventColumns} FROM events WHERE game_id = ? AND starts_at <= ? AND ? < ends_at ORDER BY event_id`;
const oneEvent = `SELECT ${eventColumns} FROM events WHERE game_id = ? AND event_id = ?`;
const rewardsOf = `SELECT event_id AS eventId, item_id AS itemId, amount FROM event_rewards WHERE game_id = ? ORDER BY event_id, item_id`;
const claimOf = `SELECT claim_id AS claimId, claimed_at AS claimedAt FROM event_claims
  WHERE game_id = ? AND player_id = ? AND event_id = ? AND period_key = ?`;
const grantsOf = `SELECT item_id AS itemId, delta AS amount FROM inventory_ledger
  WHERE game_id = ? AND player_id = ? AND source_type = '${LEDGER_SOURCES.eventClaim}' AND source_id = ? ORDER BY item_id`;

// §5 の batch の 3 文。D1 の ?NNN（番号つきの引数）は要確認なので、? を順に bind する（中身は §5 と同じ）
// 1. 受け取りの行。期間の内で、付与しても上限を超えないときだけ。同じ区切りの行があれば何もしない
const insertClaim = `INSERT INTO event_claims (game_id, player_id, event_id, period_key, claim_id, claimed_at)
  SELECT ?, ?, ?, ?, ?, ? FROM events e
  WHERE e.game_id = ? AND e.event_id = ? AND e.starts_at <= ? AND ? < e.ends_at
    AND NOT EXISTS (
      SELECT 1 FROM event_rewards r
      LEFT JOIN inventory_balances b ON b.game_id = r.game_id AND b.player_id = ? AND b.item_id = r.item_id
      WHERE r.game_id = ? AND r.event_id = ? AND COALESCE(b.amount, 0) + r.amount > ?)
  ON CONFLICT (game_id, player_id, event_id, period_key) DO NOTHING`;
// 2. 受領の履歴（この要求の claim_id が入ったときだけ）
const insertLedger = `INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
  SELECT r.game_id, ?, r.item_id, r.amount, '${LEDGER_SOURCES.eventClaim}', ?, ? FROM event_rewards r
  WHERE r.game_id = ? AND r.event_id = ? AND EXISTS (SELECT 1 FROM event_claims c WHERE c.claim_id = ?)`;
// 3. 残高（同じ条件）
const upsertBalance = `INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at)
  SELECT r.game_id, ?, r.item_id, r.amount, ? FROM event_rewards r
  WHERE r.game_id = ? AND r.event_id = ? AND EXISTS (SELECT 1 FROM event_claims c WHERE c.claim_id = ?)
  ON CONFLICT (game_id, player_id, item_id) DO UPDATE SET
    amount = inventory_balances.amount + excluded.amount, updated_at = excluded.updated_at`;

type Checked = { ok: true; claims: TokenClaims; gameId: string } | { ok: false; response: Response };

/** 2 つの口で同じ確かめ（門 → トークン → プレイヤーの利用制限 → gameId → トークンのゲーム → ゲームの登録と機能の設定）。 */
async function checkAccess(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const auth = await requireAuth(req, env);
  if (!auth.ok) return auth;
  // 報酬の操作（所持品・受領の履歴・イベントの一覧・受け取り）を合わせて、トークンのプレイヤーで数える（偽れない鍵）
  const limited = await consume(env.DB, RATE_LIMITS.rewards, `${auth.claims.gameId}:${auth.claims.playerId}`);
  if (limited) return { ok: false, response: limited };
  // 止めたプレイヤーは利用制限で数えた後に断る（トークンの g・p で引く。理由・期限は返さない）
  const banned = await requireNotBanned(env, auth.claims);
  if (banned) return { ok: false, response: banned };
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (auth.claims.gameId !== gameId) {
    return { ok: false, response: error('PERMISSION_DENIED', 'Token does not match game', 403) };
  }
  const unknown = await requireGame(env, gameId, events.name, known);
  if (unknown) return { ok: false, response: unknown };
  return { ok: true, claims: auth.claims, gameId };
}

/** サーバーの時刻（UNIX 秒）。期間の判定はこれだけを使う。 */
function serverNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** 報酬の行を品目と数に直す。MAX_REWARD_LINES を超えるのは入れ間違いなので投げる（500）。 */
function grantsFrom(rows: readonly RewardRow[], eventId: string): Grant[] {
  const lines = rows.filter((r) => r.eventId === eventId).map((r) => ({ itemId: r.itemId, amount: r.amount }));
  if (lines.length > MAX_REWARD_LINES) throw new Error(`Event ${eventId} has more than ${MAX_REWARD_LINES} reward lines`);
  return lines;
}

export const events: GameModule = {
  name: 'events',
  routes: [
    {
      method: 'GET',
      pattern: listPath,
      async handle(req, env, _match, url, known) {
        const access = await checkAccess(req, env, url, known);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const now = serverNow();
        const open = (await env.DB.prepare(openEvents).bind(gameId, now, now).all<EventRow>()).results;
        const keys = open.map((e) => periodKey(e.kind, now, e.offsetMinutes));
        const rewards = open.length ? (await env.DB.prepare(rewardsOf).bind(gameId).all<RewardRow>()).results : [];
        // いまの区切りの受け取りだけを引く（開いているイベントの数だけの条件。値はどれも bind する）
        const claimed = new Set<string>();
        if (open.length) {
          const where = open.map(() => '(event_id = ? AND period_key = ?)').join(' OR ');
          const rows = await env.DB.prepare(`SELECT event_id AS eventId, period_key AS periodKey FROM event_claims
            WHERE game_id = ? AND player_id = ? AND (${where})`)
            .bind(gameId, claims.playerId, ...open.flatMap((e, i) => [e.eventId, keys[i]]))
            .all<{ eventId: string; periodKey: string }>();
          for (const r of rows.results) claimed.add(`${r.eventId} ${r.periodKey}`);
        }
        const items = open.map((e, i) => {
          const next = nextResetAt(e.kind, now, e.offsetMinutes, e.endsAt);
          return {
            eventId: e.eventId, kind: e.kind, startsAt: isoSeconds(e.startsAt), endsAt: isoSeconds(e.endsAt), periodKey: keys[i],
            ...(next === null ? {} : { nextResetAt: isoSeconds(next) }),
            rewards: grantsFrom(rewards, e.eventId), claimed: claimed.has(`${e.eventId} ${keys[i]}`),
          };
        });
        return json({ gameId, serverTime: isoSeconds(now), items });
      },
    },
    {
      method: 'POST',
      pattern: claimPath,
      async handle(req, env, match, url, known) {
        // 本文は読まない（送られても無視。時刻の欄も Idempotency-Key も見ない）
        const access = await checkAccess(req, env, url, known);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const playerId = claims.playerId;
        const eventId = match[1];
        const event = (await env.DB.prepare(oneEvent).bind(gameId, eventId).all<EventRow>()).results[0];
        if (!event) return error('NOT_FOUND', 'Unknown event', 404);
        const now = serverNow();
        if (!isOpen(event.startsAt, event.endsAt, now)) return error('EVENT_NOT_ACTIVE', 'Event is not active', 409);
        const key = periodKey(event.kind, now, event.offsetMinutes);
        const claimId = crypto.randomUUID();
        await env.DB.batch([
          env.DB.prepare(insertClaim)
            .bind(gameId, playerId, eventId, key, claimId, now, gameId, eventId, now, now, playerId, gameId, eventId, MAX_ITEM_AMOUNT),
          env.DB.prepare(insertLedger).bind(playerId, claimId, now, gameId, eventId, claimId),
          env.DB.prepare(upsertBalance).bind(playerId, now, gameId, eventId, claimId),
        ]);
        // この要求の行か、前の要求の行（二重）を読み直す。どちらも同じ形の 200
        const claim = (await env.DB.prepare(claimOf).bind(gameId, playerId, eventId, key).all<ClaimRow>()).results[0];
        if (!claim) {
          // 行が無い: 書く前に期間が終わった（読み直して判定）か、付与すると残高が上限を超える
          const current = (await env.DB.prepare(oneEvent).bind(gameId, eventId).all<EventRow>()).results[0];
          if (!current || !isOpen(current.startsAt, current.endsAt, now)) return error('EVENT_NOT_ACTIVE', 'Event is not active', 409);
          return error('INVENTORY_LIMIT_EXCEEDED', 'Reward would exceed the inventory limit', 409);
        }
        const grants = (await env.DB.prepare(grantsOf).bind(gameId, playerId, claim.claimId).all<Grant>()).results;
        return json({ gameId, eventId, periodKey: key, claimId: claim.claimId, claimedAt: isoSeconds(claim.claimedAt), grants });
      },
    },
  ],
};
