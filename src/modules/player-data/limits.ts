// limits.ts — プレイヤーデータの 1 回の書き込みのキーの数の上限（定数の 1 か所）。
//
// 値の正は docs/guides/working/player-data-design.md §3 の「定数」。parse.ts の parseChanges が使い、
// openapi/rpg-online.v1.json の PlayerDataWrite・PlayerDataWritten の maxItems にも書いている（2 か所）。
// batch の文の数（変更ごとに 1 文）を抑える上限。上げるのは互換を壊さないが、下げると壊す。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

/** 1 回の書き込みの changes の行の数の上限。 */
export const MAX_CHANGES_PER_WRITE = 20;
