// limits.ts — ランキングの上限（定数の 1 か所）。
//
// 値と理由の正は docs/guides/working/hardening-design.md §2.1（G5）。src/modules/rankings/index.ts の POST の書き込みの 1 文が使う。
// 管理のプレイヤーを読む口の rankings（src/core/admin/routes-players.ts）はこの上限で止まる（契約の「最大 20 件」）。
// 上限を上げるのは互換を壊さないが、下げると既に行を持つプレイヤーが新しいボードへ送れなくなる。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10

/** 1 プレイヤー・1 ゲームが行を持てるボードの数。 */
export const MAX_BOARDS_PER_PLAYER = 20;
