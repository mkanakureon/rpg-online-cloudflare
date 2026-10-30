// inventory.ts — 所持品の残高の上限と品目の種類の名前（定数の 1 か所）。
//
// 所持品（src/modules/inventory/）とイベント（E2 の src/modules/events/）の両方のモジュールが読む。モジュールどうしは
// 読み込まないので core に置く。MAX_ITEM_AMOUNT は migrations/0009_inventory.sql の inventory_balances.amount の CHECK にも
// 書いている（2 か所。片方だけ変えない）。決まりの正は docs/guides/working/event-reward-design.md §2・§3。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** 1 品目の残高の上限（スコアの上限と同じ。桁あふれの止め）。 */
export const MAX_ITEM_AMOUNT = 1_000_000_000;

/** 品目の種類（表 inventory_items の kind）。通貨か所持品か。 */
export const ITEM_KINDS = ['currency', 'item'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
