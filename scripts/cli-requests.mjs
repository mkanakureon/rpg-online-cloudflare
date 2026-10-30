// cli-requests.mjs — CLI モックが送る要求の本文（依存の無い ES モジュール。読み込むだけで HTTP を送らない）。
//
// scripts/cli-mock.mjs と test/failure-server.test.ts の両方がここを読み込む。本文と見出しの形を変えると
// テスト「今のCLIモックと同じ形の要求を受け付ける」で API と合っているかが確かめられる。
// 流れはゲストの発行（guestRequest）→ そのトークンを付けたスコアの投稿（authHeaders・scoreSubmission）→ 同じトークンで
// セーブを書いて読む（SMOKE_SLOT_ID・saveData・sha256Hex・saveWrite。テスト「CLIモックと同じ流れでゲストのセーブを書いて読み直せる」）。
// Node.js と Workers のランタイムの両方で読めるよう、Node.js の API を使わない（チェックサムは crypto.subtle）。型は cli-requests.d.mts。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

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

/** CLI モックのスモークでセーブを書くスロットの名前。 */
export const SMOKE_SLOT_ID = 'cli-smoke';

/** CLI モックのスモークで書くセーブの本体（文字列。サーバーは解釈しない）。 */
export function saveData() {
  return JSON.stringify({ hp: 30, map: 'town' });
}

/** text の UTF-8 のバイト列の SHA-256 を小文字の 16 進で返す（セーブの checksum。docs/guides/working/save-design.md §5）。 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** セーブの書き込みの本文（PUT /v1/saves/:slotId）。初めて書くときの baseRevision は 0。 */
export function saveWrite(data, checksum, baseRevision = 0) {
  return { formatVersion: 1, data, checksum, baseRevision };
}
