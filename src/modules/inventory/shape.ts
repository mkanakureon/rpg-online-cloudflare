// shape.ts — 所持品の応答の形と、受領の履歴の問い合わせ（limit・before）の検証。入出力を持たない。
//
// src/modules/inventory/index.ts が D1 から読んだ残高の行を shapeInventory に渡し、問い合わせを parseHistoryQuery に渡す
// （外れは 400 INVALID_ARGUMENT）。形の正は docs/guides/working/event-reward-design.md §4 と docs/api-contract.md。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { ItemKind } from '../../core/inventory';
import { HISTORY_LIMIT_DEFAULT, HISTORY_LIMIT_MAX } from './limits';

export type BalanceRow = { itemId: string; kind: ItemKind; amount: number };
export type InventoryEntry = { itemId: string; amount: number };
export type HistoryQuery = { limit: number; before: number | null };
export type HistoryQueryResult = { ok: true; value: HistoryQuery } | { ok: false; message: string };

const byItemId = (a: InventoryEntry, b: InventoryEntry): number => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);

/** 残高の行を通貨（currency）と所持品（item）に分け、どちらも品目の ID の昇順に並べる。 */
export function shapeInventory(rows: readonly BalanceRow[]): { currencies: InventoryEntry[]; items: InventoryEntry[] } {
  const currencies: InventoryEntry[] = [];
  const items: InventoryEntry[] = [];
  for (const row of rows) (row.kind === 'currency' ? currencies : items).push({ itemId: row.itemId, amount: row.amount });
  return { currencies: currencies.sort(byItemId), items: items.sort(byItemId) };
}

/** 数字だけの文字列を 1 以上の安全な整数に直す。外れは null。 */
function positiveInteger(raw: string): number | null {
  if (!/^[0-9]{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** 受領の履歴の問い合わせを読む。limit は 1〜HISTORY_LIMIT_MAX（無ければ HISTORY_LIMIT_DEFAULT）、before は 1 以上の整数か無し。 */
export function parseHistoryQuery(url: URL): HistoryQueryResult {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? HISTORY_LIMIT_DEFAULT : positiveInteger(rawLimit);
  if (limit === null || limit > HISTORY_LIMIT_MAX) {
    return { ok: false, message: `limit must be an integer 1..${HISTORY_LIMIT_MAX}` };
  }
  const rawBefore = url.searchParams.get('before');
  const before = rawBefore === null ? null : positiveInteger(rawBefore);
  if (rawBefore !== null && before === null) return { ok: false, message: 'before must be a positive integer' };
  return { ok: true, value: { limit, before } };
}

/** UNIX 秒を ISO 8601 の UTC（秒まで。`2026-10-30T15:30:00Z`）に直す。 */
export function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
