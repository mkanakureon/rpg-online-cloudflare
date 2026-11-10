// routes-players.ts — 管理の口のうち、プレイヤーを読む口・BAN と BAN を解く口・所持品と通貨の増減の口・スコアを消す口。
//
// 書き込みの口は監査の行を 1 文目にし、続く文は「この要求の監査の行が入ったとき」だけ書く 1 つの batch で書く（片方だけ残らない）。
// 増減は Idempotency-Key が必須で（形は src/core/idempotency.ts）、鍵と中身のハッシュを監査の行の列に入れて二重を止める
// （同じ中身は 200 で 1 回目と同じ本文・違う中身は 422）。増減の続く文と受領の履歴の種類の名前は src/core/ledger.ts。
// プレイヤーを読む口の playerData は docs/guides/working/player-data-design.md §8、questClaims は quest-design.md §8。
// 正は docs/guides/working/admin-design.md §4〜§6。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import { isBanActive } from '../bans';
import { error, json } from '../http';
import { parseIdempotencyKey } from '../idempotency';
import { MAX_ITEM_AMOUNT } from '../inventory';
import { adjustStatements, LEDGER_SOURCES } from '../ledger';
import type { Route } from '../module';
import type { PlayerDataMode } from '../player-data';
import { isoSeconds, requestHash } from './audit';
import { auditByRef, checkAdmin, checkAdminWrite, playerSql, serverNow } from './common';
import { parseAdjustment, parseExpiresAt, PLAYER_HISTORY_ROWS, PLAYER_QUEST_CLAIM_ROWS } from './parse';

const balances = `SELECT b.item_id AS itemId, i.kind AS kind, b.amount AS amount FROM inventory_balances b
  JOIN inventory_items i ON i.game_id = b.game_id AND i.item_id = b.item_id
  WHERE b.game_id = ? AND b.player_id = ? ORDER BY b.item_id`;
const history = `SELECT entry_id AS entryId, item_id AS itemId, delta, source_type AS sourceType, source_id AS sourceId,
    created_at AS createdAt FROM inventory_ledger WHERE game_id = ? AND player_id = ? ORDER BY entry_id DESC LIMIT ?`;
// セーブの本文（data）とチェックサムは読まない
const saves = `SELECT slot_id AS slotId, revision, size, deleted, updated_at AS updatedAt FROM saves
  WHERE game_id = ? AND player_id = ? ORDER BY slot_id`;
const rankings = `SELECT board_id AS boardId, score, display_name AS displayName FROM ranking_entries
  WHERE game_id = ? AND player_id = ? ORDER BY board_id`;
// プレイヤーデータ（値と解いた実績。機能の設定は見ない）
const playerDataValues = `SELECT d.key AS key, k.mode AS mode, d.value AS value, d.updated_at AS updatedAt FROM player_data d
  JOIN player_data_keys k ON k.game_id = d.game_id AND k.key = d.key
  WHERE d.game_id = ? AND d.player_id = ? ORDER BY d.key`;
const playerAchievements = `SELECT achievement_id AS achievementId, unlocked_at AS unlockedAt, write_ref AS writeId FROM player_achievements
  WHERE game_id = ? AND player_id = ? ORDER BY achievement_id`;
// クエストの受け取り（新しい順。同じ秒の受け取りは入れた順の後ろを先に）
const playerQuestClaims = `SELECT quest_id AS questId, period_key AS periodKey, claim_id AS claimId, claimed_at AS claimedAt FROM quest_claims
  WHERE game_id = ? AND player_id = ? ORDER BY claimed_at DESC, rowid DESC LIMIT ?`;

const ban = 'SELECT reason, banned_at AS bannedAt, expires_at AS expiresAt FROM player_bans WHERE game_id = ? AND player_id = ?';
// 監査の行（1 文目）。前の状態は同じ文の中で止めた印から作る（無ければ NULL）
const insertBanAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  VALUES (?, ?, ?, ?, ?, (SELECT json_object('reason', reason, 'expiresAt',
      CASE WHEN expires_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%SZ', expires_at, 'unixepoch') END)
    FROM player_bans WHERE game_id = ? AND player_id = ?), ?, ?, ?)`;
// 続く文は、この要求の監査の行が入ったときだけ書く
const upsertBan = `INSERT INTO player_bans (game_id, player_id, reason, banned_at, expires_at)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, player_id) DO UPDATE SET
    reason = excluded.reason, banned_at = excluded.banned_at, expires_at = excluded.expires_at`;
const deleteBan = `DELETE FROM player_bans WHERE game_id = ? AND player_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

type BanRow = { reason: string; bannedAt: number; expiresAt: number | null };
type PlayerDataRow = { key: string; mode: PlayerDataMode; value: number; updatedAt: number };
type PlayerAchievementRow = { achievementId: string; unlockedAt: number; writeId: string };
type QuestClaimRow = { questId: string; periodKey: string; claimId: string; claimedAt: number };
type HistoryRow = { entryId: number; itemId: string; delta: number; sourceType: string; sourceId: string; createdAt: number };
type SaveRow = { slotId: string; revision: number; size: number; deleted: number; updatedAt: string };

const banPath = /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/ban$/;

// 増減の 1 文目（監査の行）。品目とプレイヤーがあり、増減の後が 0 以上・上限以下のときだけ。同じゲームの同じ Idempotency-Key があれば何もしない。
// 前と後の残高は同じ文の中で読む（json_object）。続く文は src/core/ledger.ts の adjustStatements
const insertAdjustAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, request_key, request_hash, actor, action, target,
    before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, ?, ?, 'inventory.adjust', 'player:' || ?,
         json_object('itemId', ?, 'amount', cur), json_object('itemId', ?, 'amount', cur + ?), ?, ?
  FROM (SELECT COALESCE((SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?), 0) AS cur)
  WHERE cur + ? BETWEEN 0 AND ?
    AND EXISTS (SELECT 1 FROM inventory_items WHERE game_id = ? AND item_id = ?)
    AND EXISTS (SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?)
  ON CONFLICT (game_id, request_key) DO NOTHING`;
// batch の後に引く: この要求の行か、同じ鍵の前の要求の行
const auditByKey = `SELECT audit_ref AS ref, request_hash AS hash, after_json AS afterJson, audit_id AS auditId FROM admin_audit_log
  WHERE game_id = ? AND request_key = ?`;
// 行が無いときの見分け（品目・プレイヤーの有無といまの残高）
const adjustDiagnosis = `SELECT (SELECT 1 FROM inventory_items WHERE game_id = ? AND item_id = ?) AS item,
    (SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?) AS player,
    COALESCE((SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?), 0) AS cur`;

// スコアを消す 1 文目（監査の行。前は消す行のスコアと表示名。行があるときだけ入る）と 2 文目
const insertRankingAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'ranking.delete', ?, json_object('score', score, 'displayName', display_name), NULL, ?, ?
  FROM ranking_entries WHERE game_id = ? AND board_id = ? AND player_id = ?`;
const deleteRanking = `DELETE FROM ranking_entries WHERE game_id = ? AND board_id = ? AND player_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

type KeyRow = { ref: string; hash: string; afterJson: string; auditId: number };

export const playerRoutes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const playerId = match[1];
      const found = await env.DB.prepare(playerSql).bind(gameId, playerId).all<{ createdAt: string }>();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const [banned, b, h, s, r, dv, da, qc] = await Promise.all([
        env.DB.prepare(ban).bind(gameId, playerId).all<BanRow>(),
        env.DB.prepare(balances).bind(gameId, playerId).all<{ itemId: string; kind: string; amount: number }>(),
        env.DB.prepare(history).bind(gameId, playerId, PLAYER_HISTORY_ROWS).all<HistoryRow>(),
        env.DB.prepare(saves).bind(gameId, playerId).all<SaveRow>(),
        env.DB.prepare(rankings).bind(gameId, playerId).all<{ boardId: string; score: number; displayName: string }>(),
        env.DB.prepare(playerDataValues).bind(gameId, playerId).all<PlayerDataRow>(),
        env.DB.prepare(playerAchievements).bind(gameId, playerId).all<PlayerAchievementRow>(),
        env.DB.prepare(playerQuestClaims).bind(gameId, playerId, PLAYER_QUEST_CLAIM_ROWS).all<QuestClaimRow>(),
      ]);
      // 止めた印は効いているものだけ載せる（止めていなければ欄ごと載せない）
      const active = banned.results.find((row) => isBanActive(row, serverNow()));
      return json({
        gameId, playerId, createdAt: found.results[0].createdAt,
        ...(active ? { ban: { reason: active.reason, bannedAt: isoSeconds(active.bannedAt),
          expiresAt: active.expiresAt === null ? null : isoSeconds(active.expiresAt) } } : {}),
        balances: b.results,
        history: h.results.map((row) => ({ ...row, createdAt: isoSeconds(row.createdAt) })),
        saves: s.results.map((row) => ({ ...row, deleted: row.deleted === 1 })),
        rankings: r.results,
        playerData: {
          values: dv.results.map((row) => ({ key: row.key, mode: row.mode, value: row.value, updatedAt: isoSeconds(row.updatedAt) })),
          achievements: da.results.map((row) => ({ achievementId: row.achievementId, unlockedAt: isoSeconds(row.unlockedAt), writeId: row.writeId })),
        },
        questClaims: qc.results.map((row) => ({ ...row, claimedAt: isoSeconds(row.claimedAt) })),
      });
    },
  },
  {
    method: 'PUT',
    pattern: banPath,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const playerId = match[1];
      const now = serverNow();
      const expires = parseExpiresAt(body.expiresAt, now);
      if (!expires.ok) return error('INVALID_ARGUMENT', expires.message, 400);
      const found = await env.DB.prepare(playerSql).bind(gameId, playerId).all();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const expiresAt = expires.value === null ? null : isoSeconds(expires.value);
      const ref = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(insertBanAudit).bind(ref, gameId, actor, 'player.ban', `player:${playerId}`, gameId, playerId,
          JSON.stringify({ reason, expiresAt }), reason, now),
        env.DB.prepare(upsertBan).bind(gameId, playerId, reason, now, expires.value, ref),
      ]);
      return json({ gameId, playerId, bannedAt: isoSeconds(now), expiresAt });
    },
  },
  {
    method: 'DELETE',
    pattern: banPath,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason } = access;
      const playerId = match[1];
      const found = await env.DB.prepare(playerSql).bind(gameId, playerId).all();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const ref = crypto.randomUUID();
      // 印が無くても監査の行は残し、200 を返す（同じ結果）
      await env.DB.batch([
        env.DB.prepare(insertBanAudit).bind(ref, gameId, actor, 'player.unban', `player:${playerId}`, gameId, playerId,
          null, reason, serverNow()),
        env.DB.prepare(deleteBan).bind(gameId, playerId, ref),
      ]);
      return json({ gameId, playerId, banned: false });
    },
  },
  {
    method: 'POST',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/inventory$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const playerId = match[1];
      const key = parseIdempotencyKey(req.headers.get('Idempotency-Key'));
      if (key === null) return error('INVALID_ARGUMENT', 'Invalid Idempotency-Key', 400);
      const parsed = parseAdjustment(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const { itemId, delta } = parsed.value;
      const hash = await requestHash({ action: 'inventory.adjust', gameId, playerId, itemId, delta, reason });
      const ref = crypto.randomUUID();
      const now = serverNow();
      await env.DB.batch([
        env.DB.prepare(insertAdjustAudit).bind(ref, gameId, key, hash, actor, playerId, itemId, itemId, delta, reason, now,
          gameId, playerId, itemId, delta, MAX_ITEM_AMOUNT, gameId, itemId, gameId, playerId),
        ...adjustStatements(env.DB, { gameId, playerId, itemId, delta, sourceType: LEDGER_SOURCES.admin, sourceId: ref, now }),
      ]);
      const row = (await env.DB.prepare(auditByKey).bind(gameId, key).all<KeyRow>()).results[0];
      if (row) {
        // この要求の行か、同じ中身の前の要求（二重）。どちらも監査の行から同じ本文を作る
        if (row.ref !== ref && row.hash !== hash) {
          return error('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for a different request', 422);
        }
        const after = JSON.parse(row.afterJson) as { amount: number };
        return json({ gameId, playerId, itemId, delta, amount: after.amount, auditId: row.auditId });
      }
      // 何も書いていない。品目・プレイヤー（404）→ 残高の下限（409）→ 上限（409）の順で見分ける
      const found = (await env.DB.prepare(adjustDiagnosis).bind(gameId, itemId, gameId, playerId, gameId, playerId, itemId)
        .all<{ item: number | null; player: number | null; cur: number }>()).results[0];
      if (!found || found.item === null) return error('NOT_FOUND', 'Unknown item', 404);
      if (found.player === null) return error('NOT_FOUND', 'Unknown player', 404);
      const next = found.cur + delta;
      // 0 以上・上限以下なら、batch と読み直しの間に別の修正で残高が動いた。増減の向きで決める（同じ鍵で流し直せる）
      const insufficient = next < 0 || (next <= MAX_ITEM_AMOUNT && delta < 0);
      return insufficient
        ? error('INSUFFICIENT_BALANCE', 'Adjustment would make the balance negative', 409)
        : error('INVENTORY_LIMIT_EXCEEDED', 'Adjustment would exceed the inventory limit', 409);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/admin\/rankings\/([a-zA-Z0-9_-]{1,64})\/entries\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason } = access;
      const [, boardId, playerId] = match;
      const ref = crypto.randomUUID();
      // ランキングの行だけを見る（game_players に無いプレイヤーの行も消せる）
      await env.DB.batch([
        env.DB.prepare(insertRankingAudit).bind(ref, gameId, actor, `ranking:${boardId}:${playerId}`, reason, serverNow(),
          gameId, boardId, playerId),
        env.DB.prepare(deleteRanking).bind(gameId, boardId, playerId, ref),
      ]);
      const written = (await env.DB.prepare(auditByRef).bind(ref).all<{ auditId: number }>()).results[0];
      if (!written) return error('NOT_FOUND', 'Unknown ranking entry', 404);
      return json({ gameId, boardId, playerId, deleted: true, auditId: written.auditId });
    },
  },
];
