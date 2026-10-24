// cli-requests.d.mts — scripts/cli-requests.mjs の型の宣言（TypeScript のテストから読み込むため）。
//
// 中身の正は cli-requests.mjs。欄を変えたらここも合わせる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-24

export declare const SMOKE_BOARD_ID: string;

export declare function scoreSubmission(playerId?: string): {
  gameId: string;
  playerId: string;
  displayName: string;
  score: number;
};
