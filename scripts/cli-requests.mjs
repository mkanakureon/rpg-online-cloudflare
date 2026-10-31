// cli-requests.mjs — CLI モックが送る要求の本文（依存の無い ES モジュール。読み込むだけで HTTP を送らない）。
//
// scripts/cli-mock.mjs と test/failure-server.test.ts の両方がここを読み込む。本文と見出しの形を変えると
// テスト「今のCLIモックと同じ形の要求を受け付ける」で API と合っているかが確かめられる。
// 流れはゲストの発行（guestRequest）→ そのトークンを付けたスコアの投稿（authHeaders・scoreSubmission）→ 同じトークンで
// セーブを書いて読む（SMOKE_SLOT_ID・saveData・sha256Hex・saveWrite。テスト「CLIモックと同じ流れでゲストのセーブを書いて読み直せる」）→
// 一覧に出たスロットを消す（テスト「CLIモックと同じ流れでセーブの一覧に出たスロットを消せる」）。
// 設定はトークンの要らない読み取りで、ゲストの発行より前に読み、ETag を If-None-Match に付けて 304 を受け取る
// （CLI_CLIENT_VERSION・configPath。テスト「CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る」）。
// 設定の masterData に載った最初のキーのマスターデータを読み、data のバイト数が一覧の size と同じことを見る
// （masterDataPath・utf8Bytes。テスト「CLIモックと同じ流れで設定に載ったマスターデータを読める」）。
// セーブを消した後、同じトークンでイベントの一覧を読み、デイリーの報酬を 2 回受け取って所持品と受領の履歴が 1 回分だけ増えたことを見る
// （SMOKE_EVENT_ID・eventsPath・claimPath・inventoryPath・historyPath。テスト「CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない」）。
// イベントの後、同じトークンでプレイヤーデータを読み、新しい Idempotency-Key で統計値を 1 増やし、同じ鍵と本文で送り直して二重にならず、
// 実績が解けたことを読み直して見る（SMOKE_PLAYER_DATA_KEY・SMOKE_ACHIEVEMENT_ID・playerDataPath・playerDataWrite・newIdempotencyKey・
// playerDataHeaders。テスト「CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける」）。
// スコアはローカルの D1 に積み上がっても上位 10 件に入るよう、回すたびに smokeBoardId(now) の別のボードに送る
// （テスト「CLIモックの通しは同点のスコアが上位10件を埋めていても自分の投稿を見つける」）。
// Node.js と Workers のランタイムの両方で読めるよう、Node.js の API を使わない（チェックサムは crypto.subtle）。型は cli-requests.d.mts。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

/** CLI モックのスモークでスコアを送るときの盤の ID。 */
export const SMOKE_BOARD_ID = 'boss-score';

/**
 * CLI モックが 1 回の通しでスコアを送るボードの ID（SMOKE_BOARD_ID の後ろに now〔ミリ秒〕の 36 進を付ける。例: boss-score-mh0abc12）。
 * 同点なら先に記録した行が上に並ぶので、前の回の行と重ならないボードに送る。ボード ID の形 ^[a-zA-Z0-9_-]{1,64}$ に合う。
 */
export function smokeBoardId(now = Date.now()) {
  return `${SMOKE_BOARD_ID}-${Math.floor(now).toString(36)}`;
}

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

/** CLI モックが名乗るクライアントの版（demo-rpg の最低の版と同じ。docs/guides/working/config-design.md §6）。 */
export const CLI_CLIENT_VERSION = '1.0.0';

/** 設定を読むパス（GET /v1/config）。 */
export function configPath(gameId = 'demo-rpg', clientVersion = CLI_CLIENT_VERSION) {
  return `/v1/config?gameId=${encodeURIComponent(gameId)}&clientVersion=${encodeURIComponent(clientVersion)}`;
}

/** マスターデータを 1 キー読むパス（GET /v1/config/master/{key}。key は設定の masterData に載ったもの）。 */
export function masterDataPath(key, gameId = 'demo-rpg') {
  return `/v1/config/master/${encodeURIComponent(key)}?gameId=${encodeURIComponent(gameId)}`;
}

/** text の UTF-8 のバイト数（マスターデータの data を設定の masterData の size と比べる）。 */
export function utf8Bytes(text) {
  return new TextEncoder().encode(text).length;
}

/** CLI モックの通しで報酬を受け取るイベント（demo-rpg の手本のデイリー。migrations/0010_events.sql）。 */
export const SMOKE_EVENT_ID = 'daily-login';

/** 開いているイベントの一覧のパス（GET /v1/events。docs/guides/working/event-reward-design.md §10）。 */
export function eventsPath(gameId = 'demo-rpg') {
  return `/v1/events?gameId=${encodeURIComponent(gameId)}`;
}

/** イベントの報酬を受け取るパス（POST /v1/events/{eventId}/claim。本文は要らない）。 */
export function claimPath(eventId = SMOKE_EVENT_ID, gameId = 'demo-rpg') {
  return `/v1/events/${encodeURIComponent(eventId)}/claim?gameId=${encodeURIComponent(gameId)}`;
}

/** 所持品のパス（GET /v1/inventory）。 */
export function inventoryPath(gameId = 'demo-rpg') {
  return `/v1/inventory?gameId=${encodeURIComponent(gameId)}`;
}

/** 受領の履歴のパス（GET /v1/inventory/history）。 */
export function historyPath(gameId = 'demo-rpg') {
  return `/v1/inventory/history?gameId=${encodeURIComponent(gameId)}`;
}

/** CLI モックの通しで増やす統計値のキー（demo-rpg の手本の add のキー。migrations/0013_player_data.sql）。 */
export const SMOKE_PLAYER_DATA_KEY = 'slimes-defeated';

/** CLI モックの通しで解ける実績（SMOKE_PLAYER_DATA_KEY が 1 以上で解ける demo-rpg の手本。migrations/0014_achievements.sql）。 */
export const SMOKE_ACHIEVEMENT_ID = 'first-slime';

/** プレイヤーデータのパス（GET・POST /v1/player-data。docs/guides/working/player-data-design.md §12）。 */
export function playerDataPath(gameId = 'demo-rpg') {
  return `/v1/player-data?gameId=${encodeURIComponent(gameId)}`;
}

/** プレイヤーデータの書き込みの本文（POST /v1/player-data。キーの書き方は宣言で決まり、add のキーなら value だけ増える）。 */
export function playerDataWrite(key = SMOKE_PLAYER_DATA_KEY, value = 1) {
  return { changes: [{ key, value }] };
}

/** 書き込みごとの新しい Idempotency-Key（^[a-zA-Z0-9_-]{8,64}$ に合う UUID）。送り直しのときだけ同じ鍵を使う。 */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

/** プレイヤーデータの書き込みに付ける見出し（トークンと Idempotency-Key。鍵は必須）。 */
export function playerDataHeaders(token, idempotencyKey) {
  return { ...authHeaders(token), 'Idempotency-Key': idempotencyKey };
}
