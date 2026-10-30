// limits.ts — 1 つのイベントの報酬の行の数の上限（定数の 1 か所）。
//
// 値の正は docs/guides/working/event-reward-design.md §3 の「定数」。src/modules/events/index.ts が、読んだ報酬の行がこれを
// 超えていたら入れ間違い（マイグレーションの誤り）として投げる（入口の try/catch で 500）。openapi/rpg-online.v1.json の
// EventReward の配列の maxItems も同じ数（2 か所。片方だけ変えない）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** 1 イベントの報酬の行（品目）の数の上限。 */
export const MAX_REWARD_LINES = 10;
