// limits.ts — セーブの大きさとスロットの数の上限（定数の 1 か所）。
//
// 値と理由の正は docs/guides/working/save-design.md §2 の「定数」と §10 の決めること 2・5。
// MAX_SLOTS は V2（スロットの数の上限）で使う。上限を上げるのは互換を壊さないが、下げると壊す。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** data の UTF-8 のバイト数の上限（64 KiB）。 */
export const MAX_SAVE_BYTES = 65_536;
/** 本文を JSON として読む前に断る上限。data の逃がしの最悪（1 バイトが \u00XX の 6 バイト）とほかの欄の分を見込む。 */
export const MAX_REQUEST_BYTES = MAX_SAVE_BYTES * 6 + 1024;
/** 1 プレイヤー・1 ゲームあたりのスロットの数（V2）。 */
export const MAX_SLOTS = 10;
