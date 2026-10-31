// routes.ts — 管理の口（/v1/admin/...）のルートの一覧 adminRoutes と、どの口でも同じ確かめ checkAdmin。
//
// 確かめの順: APP_ENV=local の門（403）→ 管理の鍵の有無（無ければ投げて入口の try/catch で 500）→ 管理の利用制限
// （RATE_LIMITS.admin・IP ごと。正しい鍵でも数え、鍵を確かめる前に 429）→ 管理の鍵（401）→ gameId の形（400）→
// ゲームの登録（404 Unknown game。機能の設定は見ない）→ 口ごとの確かめ。管理はゲームごとの機能にせず、機能のモジュールを
// 読み込まない（表を SQL で読むだけ）。どのプレイヤーのトークンも読まない。読み取りの口は監査に残さない。
// ルートの一覧はルーター（src/core/router.ts）がゲストの発行の後・機能のルートの前に当てる。形の正は openapi/rpg-online-admin.v1.json、
// 挙動の説明の正は docs/api-contract.md の「管理の API」、設計の正は docs/guides/working/admin-design.md §2・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import type { Env } from '../env';
import { loadGame } from '../games';
import { requireLocalWrite } from '../guards';
import { error, json } from '../http';
import { validId } from '../ids';
import type { Route } from '../module';
import { consume, ipSubject } from '../rate-limit';
import { RATE_LIMITS } from '../rate-limit-policy';
import { isoSeconds, listAuditSql, shapeAuditRow, type AuditRow } from './audit';
import { adminSecret, requireAdmin } from './key';
import { parseAuditQuery, PLAYER_HISTORY_ROWS } from './parse';

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

type HistoryRow = { entryId: number; itemId: string; delta: number; sourceType: string; sourceId: string; createdAt: number };
type SaveRow = { slotId: string; revision: number; size: number; deleted: number; updatedAt: string };

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
      const [b, h, s, r] = await Promise.all([
        env.DB.prepare(balances).bind(gameId, playerId).all<{ itemId: string; kind: string; amount: number }>(),
        env.DB.prepare(history).bind(gameId, playerId, PLAYER_HISTORY_ROWS).all<HistoryRow>(),
        env.DB.prepare(saves).bind(gameId, playerId).all<SaveRow>(),
        env.DB.prepare(rankings).bind(gameId, playerId).all<{ boardId: string; score: number; displayName: string }>(),
      ]);
      return json({
        gameId, playerId, createdAt: found.results[0].createdAt,
        balances: b.results,
        history: h.results.map((row) => ({ ...row, createdAt: isoSeconds(row.createdAt) })),
        saves: s.results.map((row) => ({ ...row, deleted: row.deleted === 1 })),
        rankings: r.results,
      });
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
