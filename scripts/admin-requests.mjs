// admin-requests.mjs — 管理コマンドが送る要求の形（依存の無い ES モジュール。読み込むだけで HTTP を送らない）。
//
// scripts/admin-cli.mjs（入口）と test/admin.test.ts の両方がここを読み込む（scripts/cli-requests.mjs と同じ考え）。
// 操作ごとの関数（playerOp〜putEventOp）が { method, path, body } を作り、adminRequest が管理の鍵・X-Admin-Actor・Idempotency-Key を付けた
// Request にする。通しの確かめ runSmoke は、送る関数（send）を受け取って docs/guides/working/admin-design.md §7 の smoke の流れを回す
// （CLI は fetch、試験は src/worker.ts の fetch を渡す。テスト「管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る」）。
// ゲストの発行とゲームの口（所持品・イベントの一覧）の形は scripts/cli-requests.mjs の guestRequest などを読むだけ（ゲームのクライアントの
// 要求の形の正はそちら。cli-requests.mjs には管理の鍵も管理の口も入れない）。管理の鍵は引数で受け取るだけで、表示・記録しない。
// Node.js と Workers のランタイムの両方で読めるよう、Node.js の API を使わない（鍵は crypto.randomUUID）。型は admin-requests.d.mts。
// 口の形の正は openapi/rpg-online-admin.v1.json、挙動の説明の正は docs/api-contract.md の「管理の API」。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { authHeaders, eventsPath, guestRequest, inventoryPath } from './cli-requests.mjs';

/** 既定のゲーム（CLI モックと同じ demo-rpg）。 */
export const DEFAULT_GAME_ID = 'demo-rpg';
/** X-Admin-Actor の既定（OS のユーザー名を使わない。個人の名前を勝手に記録しない）。 */
export const DEFAULT_ACTOR = 'local-admin';

const query = (gameId) => `gameId=${encodeURIComponent(gameId)}`;
const segment = (id) => encodeURIComponent(id);

/** 1 人のプレイヤーを読む（GET /v1/admin/players/{playerId}）。 */
export function playerOp(playerId, gameId = DEFAULT_GAME_ID) {
  return { method: 'GET', path: `/v1/admin/players/${segment(playerId)}?${query(gameId)}` };
}

/** 監査のログを新しい順に読む（GET /v1/admin/audit）。limit・before は付けたときだけ送る。 */
export function auditOp(gameId = DEFAULT_GAME_ID, { limit, before } = {}) {
  const extra = [limit === undefined ? '' : `&limit=${limit}`, before === undefined ? '' : `&before=${before}`].join('');
  return { method: 'GET', path: `/v1/admin/audit?${query(gameId)}${extra}` };
}

/** 所持品・通貨の増減（POST /v1/admin/players/{playerId}/inventory。正は付与・負は取り消し）。Idempotency-Key が要る。 */
export function adjustOp(playerId, itemId, delta, reason, gameId = DEFAULT_GAME_ID) {
  return { method: 'POST', path: `/v1/admin/players/${segment(playerId)}/inventory?${query(gameId)}`, body: { itemId, delta, reason },
    idempotent: true };
}

/** プレイヤーを止める（PUT /v1/admin/players/{playerId}/ban）。expiresAt は付けたときだけ送る。 */
export function banOp(playerId, reason, expiresAt, gameId = DEFAULT_GAME_ID) {
  return { method: 'PUT', path: `/v1/admin/players/${segment(playerId)}/ban?${query(gameId)}`,
    body: expiresAt === undefined ? { reason } : { reason, expiresAt } };
}

/** 止めた印を消す（DELETE /v1/admin/players/{playerId}/ban）。 */
export function unbanOp(playerId, reason, gameId = DEFAULT_GAME_ID) {
  return { method: 'DELETE', path: `/v1/admin/players/${segment(playerId)}/ban?${query(gameId)}`, body: { reason } };
}

/** 1 つのボードの 1 人のスコアを消す（DELETE /v1/admin/rankings/{boardId}/entries/{playerId}）。 */
export function deleteScoreOp(boardId, playerId, reason, gameId = DEFAULT_GAME_ID) {
  return { method: 'DELETE', path: `/v1/admin/rankings/${segment(boardId)}/entries/${segment(playerId)}?${query(gameId)}`,
    body: { reason } };
}

/** 品目を入れる（PUT /v1/admin/items/{itemId}。kind は currency か item）。 */
export function putItemOp(itemId, kind, reason, gameId = DEFAULT_GAME_ID) {
  return { method: 'PUT', path: `/v1/admin/items/${segment(itemId)}?${query(gameId)}`, body: { kind, reason } };
}

/** イベントの定義を入れる・置き換える（PUT /v1/admin/events/{eventId}）。definition は kind・startsAt・endsAt・resetOffsetMinutes・rewards・reason。 */
export function putEventOp(eventId, definition, gameId = DEFAULT_GAME_ID) {
  return { method: 'PUT', path: `/v1/admin/events/${segment(eventId)}?${query(gameId)}`, body: definition };
}

/** 増減の Idempotency-Key を新しく作る（修正ごとに新しく。流し直すときだけ前の鍵を使う）。 */
export function newIdempotencyKey() {
  return crypto.randomUUID();
}

/**
 * 操作を Request にする。管理の鍵は Authorization: Bearer で付ける。本文のある操作は X-Admin-Actor を付ける（既定は local-admin）。
 * Idempotency-Key は増減の操作だけに付ける（渡さなければ新しく作る）。
 */
export function adminRequest(baseUrl, adminKey, op, { actor = DEFAULT_ACTOR, idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${adminKey}` };
  if (op.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-Admin-Actor'] = actor;
  }
  if (op.idempotent) headers['Idempotency-Key'] = idempotencyKey ?? newIdempotencyKey();
  return new Request(`${baseUrl}${op.path}`, {
    method: op.method, headers, ...(op.body === undefined ? {} : { body: JSON.stringify(op.body) }),
  });
}

/** smoke で入れる品目とイベントの ID（回すたびに新しく。now〔ミリ秒〕の 36 進を付ける）。 */
export function smokeIds(now = Date.now()) {
  const stamp = Math.floor(now).toString(36);
  return { itemId: `admin-smoke-gem-${stamp}`, eventId: `admin-smoke-${stamp}` };
}

const isoSeconds = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** smoke で入れるイベントの定義（いま開いているデイリー。1 分前から 1 日後まで。報酬は smoke の品目 5 個）。 */
export function smokeEventDefinition(itemId, now = Date.now()) {
  return {
    kind: 'daily', startsAt: isoSeconds(now - 60_000), endsAt: isoSeconds(now + 86_400_000), resetOffsetMinutes: 0,
    rewards: [{ itemId, amount: 5 }], reason: '管理コマンドの通しの確かめ',
  };
}

/** smoke の後に監査のログの先頭に並ぶ操作（新しい順。足りない取り消しと同じ鍵の 2 回目は行を残さない）。 */
export const SMOKE_AUDIT_ACTIONS = ['event.put', 'item.put', 'player.unban', 'player.ban', 'inventory.adjust', 'inventory.adjust'];

/**
 * admin-design.md §7 の smoke の流れを回す。send(request) は Response を返す関数（CLI は fetch、試験は worker の fetch）。
 * ゲストを発行 → プレイヤーを読む → gold を 50 付与 → 同じ鍵でもう一度（50 のまま）→ 20 取り消し（30）→ 31 取り消し（409 INSUFFICIENT_BALANCE）→
 * BAN → ゲストのトークンで所持品が 403 PLAYER_BANNED → 解く → 所持品が 200 で gold 30 → 品目とイベントを入れる → ゲストのトークンで
 * イベントの一覧に載る → 監査のログにこの回の操作が新しい順に並ぶ。期待と違えば投げる。log(手順, 状態, 本文) は手順ごとに呼ぶ（トークンは伏せる）。
 */
export async function runSmoke({ send, baseUrl, adminKey, actor = DEFAULT_ACTOR, now = Date.now(), log = () => {} }) {
  const gameId = guestRequest().gameId;
  const step = async (name, request, expected) => {
    const res = await send(request);
    const body = await res.json();
    const shown = body && typeof body === 'object' && 'token' in body ? { ...body, token: '[redacted]' } : body;
    log(name, res.status, shown);
    if (res.status !== expected.status) throw new Error(`${name}: expected ${expected.status}, got ${res.status}`);
    if (expected.code && body?.error?.code !== expected.code) throw new Error(`${name}: expected ${expected.code}, got ${body?.error?.code}`);
    return body;
  };
  const admin = (op, options) => adminRequest(baseUrl, adminKey, op, { actor, ...options });
  const expectAmount = (name, body, amount) => {
    if (body.amount !== amount) throw new Error(`${name}: expected amount ${amount}, got ${body.amount}`);
  };

  const guest = await step('guest', new Request(`${baseUrl}/v1/accounts/guest`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(guestRequest()),
  }), { status: 200 });
  const { playerId, token } = guest;
  await step('player', admin(playerOp(playerId, gameId)), { status: 200 });
  const key = newIdempotencyKey();
  expectAmount('grant', await step('grant', admin(adjustOp(playerId, 'gold', 50, 'smoke: 付与', gameId), { idempotencyKey: key }),
    { status: 200 }), 50);
  expectAmount('grant (same key)', await step('grant (same key)',
    admin(adjustOp(playerId, 'gold', 50, 'smoke: 付与', gameId), { idempotencyKey: key }), { status: 200 }), 50);
  expectAmount('revoke', await step('revoke', admin(adjustOp(playerId, 'gold', -20, 'smoke: 取り消し', gameId)), { status: 200 }), 30);
  await step('revoke (too much)', admin(adjustOp(playerId, 'gold', -31, 'smoke: 足りない取り消し', gameId)),
    { status: 409, code: 'INSUFFICIENT_BALANCE' });
  await step('ban', admin(banOp(playerId, 'smoke: 止める', undefined, gameId)), { status: 200 });
  const inventory = () => new Request(`${baseUrl}${inventoryPath(gameId)}`, { headers: authHeaders(token) });
  await step('inventory (banned)', inventory(), { status: 403, code: 'PLAYER_BANNED' });
  await step('unban', admin(unbanOp(playerId, 'smoke: 解く', gameId)), { status: 200 });
  const owned = await step('inventory', inventory(), { status: 200 });
  const gold = owned.currencies?.find((i) => i.itemId === 'gold');
  if (gold?.amount !== 30) throw new Error(`inventory: expected gold 30, got ${gold?.amount}`);
  const { itemId, eventId } = smokeIds(now);
  await step('put-item', admin(putItemOp(itemId, 'currency', 'smoke: 品目を入れる', gameId)), { status: 200 });
  await step('put-event', admin(putEventOp(eventId, smokeEventDefinition(itemId, now), gameId)), { status: 200 });
  const listed = await step('events', new Request(`${baseUrl}${eventsPath(gameId)}`, { headers: authHeaders(token) }), { status: 200 });
  if (!listed.items?.some((e) => e.eventId === eventId)) throw new Error(`events: ${eventId} is not listed`);
  const audit = await step('audit', admin(auditOp(gameId, { limit: SMOKE_AUDIT_ACTIONS.length })), { status: 200 });
  const actions = audit.items.map((a) => a.action);
  if (JSON.stringify(actions) !== JSON.stringify(SMOKE_AUDIT_ACTIONS)) throw new Error(`audit: unexpected actions ${actions.join(',')}`);
  const targets = audit.items.map((a) => a.target);
  const expectedTargets = [`event:${eventId}`, `item:${itemId}`, ...Array(4).fill(`player:${playerId}`)];
  if (JSON.stringify(targets) !== JSON.stringify(expectedTargets)) throw new Error(`audit: unexpected targets ${targets.join(',')}`);
  return { gameId, playerId, itemId, eventId, audit: audit.items };
}
