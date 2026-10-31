// quests.ts — クエストの宣言の数の上限（定数の 1 か所）。
//
// 管理のクエストの定義の口（src/core/admin/routes.ts）が、新しいクエストで 1 ゲームの宣言がこの数を超えるなら 400 で断る
// （一覧の応答の行の数の上限にもなる）。管理の口はモジュールを読み込まないので core に置く。正は docs/guides/working/quest-design.md §3・§8。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

/** 1 ゲームで宣言できるクエストの数（MAX_PLAYER_DATA_KEYS と揃える）。 */
export const MAX_QUESTS = 200;
