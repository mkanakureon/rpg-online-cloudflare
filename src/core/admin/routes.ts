// routes.ts — 管理の口（/v1/admin/...）のルートの一覧 adminRoutes と、どの口でも同じ確かめ checkAdmin。
//
// 確かめの順: APP_ENV=local の門（403）→ 管理の鍵の有無（無ければ投げて入口の try/catch で 500）→ 管理の利用制限
// （RATE_LIMITS.admin・IP ごと。正しい鍵でも数え、鍵を確かめる前に 429）→ 管理の鍵（401）→ gameId の形（400）→
// ゲームの登録（404 Unknown game。機能の設定は見ない）→ 書き込みの口は X-Admin-Actor・本文の JSON・reason（400）→ 口ごとの確かめ。管理はゲームごとの機能にせず、機能のモジュールを
// 読み込まない（表を SQL で読み書きするだけ）。どのプレイヤーのトークンも読まない。読み取りの口は監査に残さない。
// 書き込みの口（BAN・BAN を解く）は、監査の行を 1 文目・書き込みを 2 文目にした 1 つの batch で書く（片方だけ残らない）。
// ルートの一覧はルーター（src/core/router.ts）がゲストの発行の後・機能のルートの前に当てる。形の正は openapi/rpg-online-admin.v1.json、
// 挙動の説明の正は docs/api-contract.md の「管理の API」、設計の正は docs/guides/working/admin-design.md §2・§4・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { isBanActive } from '../bans';
import type { Env } from '../env';
import { loadGame } from '../games';
import { requireLocalWrite } from '../guards';
import { error, json } from '../http';
import { validId } from '../ids';
import type { Route } from '../module';
import { consume, ipSubject } from '../rate-limit';
import { RATE_LIMITS } from '../rate-limit-policy';
import { isoSeconds, listAuditSql, parseActor, parseReason, shapeAuditRow, type AuditRow } from './audit';
import { adminSecret, requireAdmin } from './key';
import { parseAuditQuery, parseExpiresAt, PLAYER_HISTORY_ROWS } from './parse';

type Checked = { ok: true; gameId: string } | { ok: false; response: Response };

/** どの管理の口でも同じ確かめ。通ればゲームの ID。 */
export async function checkAdmin(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const secret = adminSecret(env);
  // 鍵の名前・値はメッセージに入れない。入口の try/catch が 500 INTERNAL_ERROR にする
  if (!secret) throw new Error('Admin key is not configured');
  // 鍵の当て推量を IP ごとの回数で抑える（鍵の確かめの前。正しい鍵でも数える）
  const limited = await consume(env.DB, RATE_LIMITS.admin, await ipSubject(req));
  if (limited) return { ok: false, response: limited };
  const denied = await requireAdmin(req, secret);
  if (denied) return { ok: false, response: denied };
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (!await loadGame(env.DB, gameId, known)) return { ok: false, response: error('NOT_FOUND', 'Unknown game', 404) };
  return { ok: true, gameId };
}

type Written = { ok: true; gameId: string; actor: string; reason: string; body: Record<string, unknown> } | { ok: false; response: Response };

/** 書き込みの口の確かめ（checkAdmin → X-Admin-Actor → 本文の JSON → reason）。通ればゲームの ID・actor・reason・本文。 */
async function checkAdminWrite(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Written> {
  const access = await checkAdmin(req, env, url, known);
  if (!access.ok) return access;
  const actor = parseActor(req.headers.get('X-Admin-Actor'));
  if (actor === null) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid X-Admin-Actor', 400) };
  let value: unknown;
  try { value = await req.json(); }
  catch { return { ok: false, response: error('INVALID_JSON', 'Request body must be JSON', 400) }; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, response: error('INVALID_ARGUMENT', 'Object required', 400) };
  }
  const body = value as Record<string, unknown>;
  const reason = parseReason(body.reason);
  if (reason === null) return { ok: false, response: error('INVALID_ARGUMENT', 'reason must be 1..200 characters', 400) };
  return { ok: true, gameId: access.gameId, actor, reason, body };
}

/** サーバーの時刻（UNIX 秒）。 */
function serverNow(): number {
  return Math.floor(Date.now() / 1000);
}

const player = `SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS createdAt FROM game_players WHERE game_id = ? AND player_id = ?`;
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
type HistoryRow = { entryId: number; itemId: string; delta: number; sourceType: string; sourceId: string; createdAt: number };
type SaveRow = { slotId: string; revision: number; size: number; deleted: number; updatedAt: string };

const banPath = /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/ban$/;

export const adminRoutes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const playerId = match[1];
      const found = await env.DB.prepare(player).bind(gameId, playerId).all<{ createdAt: string }>();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const [banned, b, h, s, r] = await Promise.all([
        env.DB.prepare(ban).bind(gameId, playerId).all<BanRow>(),
        env.DB.prepare(balances).bind(gameId, playerId).all<{ itemId: string; kind: string; amount: number }>(),
        env.DB.prepare(history).bind(gameId, playerId, PLAYER_HISTORY_ROWS).all<HistoryRow>(),
        env.DB.prepare(saves).bind(gameId, playerId).all<SaveRow>(),
        env.DB.prepare(rankings).bind(gameId, playerId).all<{ boardId: string; score: number; displayName: string }>(),
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
      const found = await env.DB.prepare(player).bind(gameId, playerId).all();
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
      const found = await env.DB.prepare(player).bind(gameId, playerId).all();
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
    method: 'GET',
    pattern: /^\/v1\/admin\/audit$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const query = parseAuditQuery(url);
      if (!query.ok) return error('INVALID_ARGUMENT', query.message, 400);
      const { limit, before } = query.value;
      const rows = await env.DB.prepare(listAuditSql).bind(gameId, before, before, limit + 1).all<AuditRow>();
      const page = rows.results.slice(0, limit);
      const items = page.map(shapeAuditRow);
      const more = rows.results.length > limit;
      return json(more ? { gameId, items, nextBefore: page[page.length - 1].auditId } : { gameId, items });
    },
  },
];
