// rate-limit-policy.ts — 利用制限の回数と窓の長さ（秒）と単位の名前の定数。ここ 1 か所に置く。
//
// 数を変えるときは、ここと docs/guides/working/abuse-protection-design.md §2 の表と docs/api-contract.md の「利用制限」を
// 同じコミットで直す。上げるのは互換を壊さない（通っていた要求は通る）。下げると壊す。
// scope は表 rate_limit_counters の scope の列に入る名前。saves は R2 でセーブのモジュールが、rewards は E1 で所持品のモジュールが使う。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** 1 つの利用制限の決まり: 単位の名前・窓の中で通す回数・窓の長さ（秒）。 */
export type RateLimitRule = { readonly scope: string; readonly limit: number; readonly period: number };

export const RATE_LIMITS = {
  /** ゲストの発行・IP（CF-Connecting-IP のハッシュ）ごと。 */
  guestIp: { scope: 'guest-ip', limit: 10, period: 60 },
  /** ゲストの発行・ゲーム（gameId）ごと。 */
  guestGame: { scope: 'guest-game', limit: 300, period: 60 },
  /** スコアの投稿・プレイヤー（トークンの gameId と playerId）ごと。 */
  score: { scope: 'score', limit: 30, period: 60 },
  /** セーブの 4 つの操作を合わせて・プレイヤーごと（R2）。 */
  saves: { scope: 'saves', limit: 60, period: 60 },
  /** 報酬の操作（所持品・受領の履歴と E2 のイベントの一覧・受け取り）を合わせて・プレイヤーごと（E1）。 */
  rewards: { scope: 'rewards', limit: 60, period: 60 },
} as const satisfies Record<string, RateLimitRule>;
