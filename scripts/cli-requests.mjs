// cli-requests.mjs — CLI モックが送る要求の本文（依存の無い ES モジュール。読み込むだけで HTTP を送らない）。
//
// scripts/cli-mock.mjs と test/failure-server.test.ts の両方がここを読み込む。本文と見出しの形を変えると
// テスト「今のCLIモックと同じ形の要求を受け付ける」で API と合っているかが確かめられる。
// 流れはゲストの発行（guestRequest）→ そのトークンを付けたスコアの投稿（authHeaders・scoreSubmission）。
// Node.js と Workers のランタイムの両方で読めるよう、Node.js の API を使わない。型は cli-requests.d.mts。
//
// 概要記述: Claude Opus 5.5 — 2026-10-24

/** CLI モックのスモークでスコアを送るときの盤の ID。 */
export const SMOKE_BOARD_ID = 'boss-score';

/** CLI モックのスモークで送るスコア投稿の本文（POST /v1/rankings/:boardId）。 */
export function scoreSubmission(playerId = 'cli-smoke-player') {
  return { gameId: 'demo-rpg', playerId, displayName: 'Mac CLI Tester', score: 1200 };
}

/** CLI モックがゲストを発行するときの本文（POST /v1/accounts/guest）。 */
export function guestRequest() {
  return { gameId: 'demo-rpg' };
}

/** スコアの投稿に付ける見出し（発行されたトークンを Authorization: Bearer で送る）。 */
export function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
}
