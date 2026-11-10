// inventory/index.ts — 所持品のモジュール（GET /v1/inventory と受領の履歴の GET /v1/inventory/history）。
//
// どちらも APP_ENV=local の門 → トークン → プレイヤーの利用制限（2 つの口と E2 のイベントの口を合わせて RATE_LIMITS.rewards。429）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 口ごとの確かめ（履歴の limit・before）→ 読む の順
// （src/core/access.ts の checkPlayerAccess）。プレイヤーはトークンの p だけで決める。このモジュールは読むだけで、残高と履歴を書くのは
// E2 のイベントの受け取り。順と SQL の正は docs/guides/working/event-reward-design.md §4。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { checkPlayerAccess } from '../../core/access';
import type { Env } from '../../core/env';
import { error, json } from '../../core/http';
import type { GameModule } from '../../core/module';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
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

export const inventory: GameModule = {
  name: 'inventory',
  routes: [
    {
      method: 'GET',
      pattern: inventoryPath,
      async handle(req, env, _match, url, known) {
        const access = await checkPlayerAccess(req, env, url, RATE_LIMITS.rewards, { name: inventory.name, known });
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
        const access = await checkPlayerAccess(req, env, url, RATE_LIMITS.rewards, { name: inventory.name, known });
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
