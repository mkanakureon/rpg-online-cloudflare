// inventory/index.ts — 所持品のモジュール（GET /v1/inventory と受領の履歴の GET /v1/inventory/history）。
//
// どちらも APP_ENV=local の門 → トークン → プレイヤーの利用制限（2 つの口と E2 のイベントの口を合わせて RATE_LIMITS.rewards。429）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 口ごとの確かめ（履歴の limit・before）→ 読む の順
// （セーブの checkAccess と同じ形）。プレイヤーはトークンの p だけで決める。このモジュールは読むだけで、残高と履歴を書くのは
// E2 のイベントの受け取り。順と SQL の正は docs/guides/working/event-reward-design.md §4。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { consumeForPlayer } from '../../core/activity';
import { requireAuth } from '../../core/auth';
import { requireNotBanned } from '../../core/bans';
import type { Env } from '../../core/env';
import { requireGame } from '../../core/games';
import { requireLocalWrite } from '../../core/guards';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import type { TokenClaims } from '../../core/token';
import { isoSeconds, parseHistoryQuery, shapeInventory, type BalanceRow } from './shape';

type LedgerRow = { entryId: number; itemId: string; delta: number; sourceType: string; sourceId: string; createdAt: number };

const inventoryPath = /^\/v1\/inventory$/;
const historyPath = /^\/v1\/inventory\/history$/;

const balances = `SELECT b.item_id AS itemId, i.kind AS kind, b.amount AS amount FROM inventory_balances b
  JOIN inventory_items i ON i.game_id = b.game_id AND i.item_id = b.item_id
  WHERE b.game_id = ? AND b.player_id = ?`;
// before が無ければ（NULL）全部から。続きがあるかを知るために limit + 1 行を引く
const history = `SELECT entry_id AS entryId, item_id AS itemId, delta, source_type AS sourceType, source_id AS sourceId,
    created_at AS createdAt FROM inventory_ledger
  WHERE game_id = ? AND player_id = ? AND (? IS NULL OR entry_id < ?)
  ORDER BY entry_id DESC LIMIT ?`;

type Checked = { ok: true; claims: TokenClaims; gameId: string } | { ok: false; response: Response };

/** 2 つの口で同じ確かめ（門 → トークン → プレイヤーの利用制限 → gameId → トークンのゲーム → ゲームの登録と機能の設定）。 */
async function checkAccess(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const auth = await requireAuth(req, env);
  if (!auth.ok) return auth;
  // 報酬の操作を合わせて、トークンのプレイヤーで数える（偽れない鍵）
  const limited = await consumeForPlayer(env.DB, RATE_LIMITS.rewards, auth.claims);
  if (limited) return { ok: false, response: limited };
  // 止めたプレイヤーは利用制限で数えた後に断る（トークンの g・p で引く。理由・期限は返さない）
  const banned = await requireNotBanned(env, auth.claims);
  if (banned) return { ok: false, response: banned };
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (auth.claims.gameId !== gameId) {
    return { ok: false, response: error('PERMISSION_DENIED', 'Token does not match game', 403) };
  }
  const unknown = await requireGame(env, gameId, inventory.name, known);
  if (unknown) return { ok: false, response: unknown };
  return { ok: true, claims: auth.claims, gameId };
}

export const inventory: GameModule = {
  name: 'inventory',
  routes: [
    {
      method: 'GET',
      pattern: inventoryPath,
      async handle(req, env, _match, url, known) {
        const access = await checkAccess(req, env, url, known);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const rows = await env.DB.prepare(balances).bind(gameId, claims.playerId).all<BalanceRow>();
        return json({ gameId, ...shapeInventory(rows.results) });
      },
    },
    {
      method: 'GET',
      pattern: historyPath,
      async handle(req, env, _match, url, known) {
        const access = await checkAccess(req, env, url, known);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const query = parseHistoryQuery(url);
        if (!query.ok) return error('INVALID_ARGUMENT', query.message, 400);
        const { limit, before } = query.value;
        const rows = await env.DB.prepare(history).bind(gameId, claims.playerId, before, before, limit + 1).all<LedgerRow>();
        const page = rows.results.slice(0, limit);
        const items = page.map((r) => ({ ...r, createdAt: isoSeconds(r.createdAt) }));
        const more = rows.results.length > limit;
        return json(more ? { gameId, items, nextBefore: page[page.length - 1].entryId } : { gameId, items });
      },
    },
  ],
};
