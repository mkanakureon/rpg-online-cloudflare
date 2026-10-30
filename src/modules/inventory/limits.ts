// limits.ts — 受領の履歴の 1 回に返す行の数（定数の 1 か所）。
//
// 値の正は docs/guides/working/event-reward-design.md §3 の「定数」。src/modules/inventory/shape.ts の parseHistoryQuery が使う。
// 上限を上げるのは互換を壊さないが、下げると壊す。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** limit を付けないときの行の数。 */
export const HISTORY_LIMIT_DEFAULT = 20;
/** limit の上限。 */
export const HISTORY_LIMIT_MAX = 100;
