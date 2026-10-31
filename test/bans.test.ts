/**
 * 管理 O2: BAN（止めた印の表 player_bans・src/core/bans.ts の isBanActive と requireNotBanned・4 つのモジュールでの確かめ・
 * 管理の口の PUT・DELETE /v1/admin/players/{playerId}/ban・403 PLAYER_BANNED）の試験。
 * 名前と期待する結果の正は docs/guides/working/admin-design.md §8 の O2 の行（エラーコードの数の置き換えは test/schema-conformance.test.ts）。
 * L1 は関数を直に呼ぶ。L2 は src/worker.ts の default.fetch を直に呼ぶ。管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）。
 * 試験のゲームは専用の ban-game と ban-other（4 つの機能を使う設定）で、プレイヤーは game_players・accounts に行を直に入れ、
 * トークンは test/support/auth.ts で作る。手伝いは test/admin.test.ts を変えずにこのファイルの中に書く。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { isBanActive } from '../src/core/bans';
import { sha256Hex } from '../src/modules/saves/checksum';
import specJson from '../openapi/rpg-online.v1.json';
import adminSpecJson from '../openapi/rpg-online-admin.v1.json';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const adminEnv: TestEnv = { ...localEnv, ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'ban-game';
const otherGame = 'ban-other';
const eventId = 'ban-login';
const modules = ['rankings', 'saves', 'inventory', 'events'];

type ErrorBody = { error: { code: string; message: string } };
type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type Operation = { operationId: string; responses: Record<string, ResponseSpec> };
type Spec = SchemaRoot & { paths: Record<string, Record<string, Operation>> };
const spec = specJson as unknown as Spec;
const adminSpec = adminSpecJson as unknown as Spec;
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const nowSeconds = () => Math.floor(Date.now() / 1000);

type Who = { playerId?: string; gameId?: string; authorization?: string | null; e?: TestEnv };
/** トークンの要る口に送る（既定は ban-game の p1 のトークン）。 */
async function send(method: string, path: string, who: Who = {}, body?: unknown, query = ''): Promise<Response> {
  const gameId = who.gameId ?? game;
  const headers: Record<string, string> = {};
  const authorization = who.authorization === undefined ? await bearer(gameId, who.playerId ?? 'p1') : who.authorization;
  if (authorization !== null) headers.authorization = authorization;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const init: RequestInit = { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) };
  return worker.fetch(new Request(`${base}${path}?gameId=${gameId}${query}`, init), (who.e ?? localEnv) as never);
}
const getInventory = (who: Who = {}) => send('GET', '/v1/inventory', who);
const submitScore = (who: Who = {}, score: unknown = 100) => send('POST', '/v1/rankings/boss', who,
  { gameId: who.gameId ?? game, playerId: who.playerId ?? 'p1', displayName: 'Banned?', score });
async function putSave(who: Who = {}): Promise<Response> {
  const data = '{"hp":1}';
  return send('PUT', '/v1/saves/auto', who, { formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision: 0 });
}
const claim = (who: Who = {}) => send('POST', `/v1/events/${eventId}/claim`, who);

type AdminOptions = { actor?: string | null; gameId?: string; e?: TestEnv };
/** 管理の BAN の口に送る（PUT は止める・DELETE は解く）。body が文字列ならそのまま送る。 */
function adminBan(method: 'PUT' | 'DELETE', playerId: string, body: unknown, options: AdminOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' };
  const actor = options.actor === undefined ? 'local-admin' : options.actor;
  if (actor !== null) headers['X-Admin-Actor'] = actor;
  return worker.fetch(new Request(`${base}/v1/admin/players/${playerId}/ban?gameId=${options.gameId ?? game}`, {
    method, headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }), (options.e ?? adminEnv) as never);
}
const ban = (playerId: string, body: unknown = { reason: 'spam' }, options: AdminOptions = {}) => adminBan('PUT', playerId, body, options);
const unban = (playerId: string, body: unknown = { reason: 'mistake' }, options: AdminOptions = {}) => adminBan('DELETE', playerId, body, options);
function adminGet(path: string): Promise<Response> {
  return worker.fetch(new Request(`${base}${path}`, { headers: { authorization: `Bearer ${adminKey}` } }), adminEnv as never);
}

async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  expect(res.status, code).toBe(status);
  const body = await res.json<ErrorBody>();
  expect(body.error.code).toBe(code);
  return body;
}
async function addPlayer(playerId: string, gameId = game): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare("INSERT INTO accounts (account_id, kind) VALUES (?, 'guest')").bind(`acc-${gameId}-${playerId}`),
    baseEnv.DB.prepare('INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, ?, ?)')
      .bind(gameId, playerId, `acc-${gameId}-${playerId}`),
  ]);
}
async function count(table: string, where = ''): Promise<number> {
  const row = await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}${where ? ` WHERE ${where}` : ''}`).first<{ n: number }>();
  return row?.n ?? 0;
}
/** スキーマの操作（operationId で探す）のその状態の形に応答を当て、本文を返す。 */
async function expectConforms(res: Response, root: Spec, operationId: string): Promise<unknown> {
  const op = Object.values(root.paths).flatMap((item) => methods.filter((m) => m in item).map((m) => item[m]))
    .find((o) => o.operationId === operationId);
  expect(op, `スキーマに操作 ${operationId} がある`).toBeDefined();
  const r = op!.responses[String(res.status)];
  expect(r, `${operationId} の応答に状態 ${res.status} がある`).toBeDefined();
  for (const [name, h] of Object.entries(r.headers ?? {})) {
    const value = res.headers.get(name);
    if (h.required) expect(value, `ヘッダー ${name} がある`).not.toBeNull();
    if (value !== null) expect(validate(value, h.schema, root), `ヘッダー ${name}`).toEqual([]);
  }
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body = await res.json();
  expect(validate(body, r.content!['application/json'].schema, root), `${operationId} ${res.status} の本文`).toEqual([]);
  const codes = r['x-error-codes'];
  if (codes) expect(codes).toContain((body as ErrorBody).error.code);
  return body;
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）だけ残す
async function clean(): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM player_bans'),
    baseEnv.DB.prepare('DELETE FROM admin_audit_log'),
    baseEnv.DB.prepare("DELETE FROM event_claims WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM inventory_ledger WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM inventory_balances WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM saves WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM ranking_entries WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM game_players WHERE game_id IN ('ban-game', 'ban-other')"),
    baseEnv.DB.prepare("DELETE FROM accounts WHERE account_id LIKE 'acc-ban-%'"),
    baseEnv.DB.prepare("DELETE FROM events WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM inventory_items WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id IN ('ban-game', 'ban-other')"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id IN ('ban-game', 'ban-other')"),
  ]);
  await resetRateLimits(baseEnv.DB);
}
beforeEach(async () => {
  await clean();
  const db = baseEnv.DB;
  for (const g of [game, otherGame]) {
    await registerGame(db, g, modules);
    await db.prepare("INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, 'gold', 'currency')").bind(g).run();
    await db.batch([
      db.prepare("INSERT INTO events (game_id, event_id, kind, starts_at, ends_at) VALUES (?, ?, 'once', ?, ?)")
        .bind(g, eventId, nowSeconds() - 3600, nowSeconds() + 86400),
      db.prepare("INSERT INTO event_rewards (game_id, event_id, item_id, amount) VALUES (?, ?, 'gold', 10)").bind(g, eventId),
    ]);
  }
  await addPlayer('p1');
  await addPlayer('p2');
  await addPlayer('p1', otherGame);
});
// ほかの試験のファイルに止めた印を残さない
afterEach(clean);

describe('O2 止めた印の関数', () => {
  it('止めた印は期限の時刻から効かなくなり期限の無い印はずっと効く', () => {
    const now = 1_800_000_000;
    expect(isBanActive({ expiresAt: now + 1 }, now)).toBe(true);
    expect(isBanActive({ expiresAt: null }, now)).toBe(true);
    expect(isBanActive({ expiresAt: now }, now)).toBe(false);
    expect(isBanActive({ expiresAt: now - 1 }, now)).toBe(false);
  });
});

describe('O2 BAN したプレイヤーの要求', () => {
  it('BANしたプレイヤーのトークンの要求はPLAYER_BANNEDの403を返す', async () => {
    expect((await getInventory()).status).toBe(200);
    expect((await ban('p1', { reason: 'secret-memo-123' })).status).toBe(200);
    const res = await getInventory();
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'PLAYER_BANNED', message: 'Player is banned' } });
    // 理由・期限は返さない
    expect(text).not.toContain('secret-memo-123');
    expect(text).not.toContain('expires');
  });

  it('BANしたプレイヤーのスコアの投稿とセーブと報酬の受け取りはどれも断られ何も書かない', async () => {
    expect((await ban('p1')).status).toBe(200);
    const tables = ['ranking_entries', 'saves', 'event_claims', 'inventory_ledger', 'inventory_balances'];
    const before = await Promise.all(tables.map((t) => count(t)));
    await expectError(await submitScore(), 403, 'PLAYER_BANNED');
    await expectError(await putSave(), 403, 'PLAYER_BANNED');
    await expectError(await claim(), 403, 'PLAYER_BANNED');
    expect(await Promise.all(tables.map((t) => count(t)))).toEqual(before);
    // 止めていない人は同じ要求が書ける（断ったのは止めた印のため）
    expect((await submitScore({ playerId: 'p2' })).status).toBe(200);
    expect((await putSave({ playerId: 'p2' })).status).toBe(200);
    expect((await claim({ playerId: 'p2' })).status).toBe(200);
  });

  it('BANを解くと同じトークンでまた通る', async () => {
    const authorization = await bearer(game, 'p1');
    expect((await ban('p1')).status).toBe(200);
    await expectError(await getInventory({ authorization }), 403, 'PLAYER_BANNED');
    const banned = await (await adminGet(`/v1/admin/players/p1?gameId=${game}`)).json<{ ban?: unknown }>();
    expect(banned.ban).toMatchObject({ reason: 'spam', expiresAt: null });
    const res = await unban('p1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gameId: game, playerId: 'p1', banned: false });
    expect((await getInventory({ authorization })).status).toBe(200);
    expect(await count('player_bans')).toBe(0);
    // 止めていなければプレイヤーを読む口に ban の欄は無い
    const read = await (await adminGet(`/v1/admin/players/p1?gameId=${game}`)).json<Record<string, unknown>>();
    expect('ban' in read).toBe(false);
    // 印が無くても解く口は 200
    expect((await unban('p1')).status).toBe(200);
  });

  it('期限の過ぎたBANは要求を止めない', async () => {
    await baseEnv.DB.prepare('INSERT INTO player_bans (game_id, player_id, reason, banned_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(game, 'p1', 'old', nowSeconds() - 3600, nowSeconds() - 1).run();
    expect((await getInventory()).status).toBe(200);
    expect((await submitScore()).status).toBe(200);
    // 期限の過ぎた印はプレイヤーを読む口にも載らない
    const read = await (await adminGet(`/v1/admin/players/p1?gameId=${game}`)).json<Record<string, unknown>>();
    expect('ban' in read).toBe(false);
    // 期限の前の印は止める
    await baseEnv.DB.prepare('UPDATE player_bans SET expires_at = ? WHERE game_id = ? AND player_id = ?')
      .bind(nowSeconds() + 3600, game, 'p1').run();
    await expectError(await getInventory(), 403, 'PLAYER_BANNED');
  });

  it('BANは同じゲームのほかのプレイヤーとほかのゲームの同じIDを止めない', async () => {
    expect((await ban('p1')).status).toBe(200);
    await expectError(await getInventory(), 403, 'PLAYER_BANNED');
    expect((await getInventory({ playerId: 'p2' })).status).toBe(200);
    expect((await getInventory({ gameId: otherGame })).status).toBe(200);
    expect((await claim({ gameId: otherGame })).status).toBe(200);
  });

  it('トークンの無い要求と形の誤った本文は止めた印の表を引く前に断る', async () => {
    // prepare が投げる偽の DB（止めた印の表を引けば 500 になる）
    const brokenDB = { prepare(): never { throw new Error('D1_ERROR: SQLITE_ERROR: no such table: player_bans'); } };
    const broken: TestEnv = { ...localEnv, DB: brokenDB as unknown as D1Database };
    await expectError(await getInventory({ authorization: null, e: broken }), 401, 'UNAUTHENTICATED');
    await expectError(await submitScore({ e: broken }, -1), 400, 'INVALID_ARGUMENT');
    await expectError(await send('POST', '/v1/rankings/boss', { e: broken }, '{"gameId":'), 400, 'INVALID_JSON');
  });
});

describe('O2 BAN の管理の口', () => {
  it('知らないプレイヤーのBANはNOT_FOUNDの404を返し印を作らない', async () => {
    for (const res of [await ban('nobody'), await ban('p1', { reason: 'x' }, { gameId: 'demo-rpg' }), await unban('nobody')]) {
      const body = await expectError(res, 404, 'NOT_FOUND');
      expect(body.error.message).toBe('Unknown player');
    }
    expect(await count('player_bans')).toBe(0);
    expect(await count('admin_audit_log')).toBe(0);
  });

  it('同じBANを2回送っても止めた印は1つ', async () => {
    const first = await ban('p1');
    expect(first.status).toBe(200);
    const body = await first.json<{ gameId: string; playerId: string; bannedAt: string; expiresAt: string | null }>();
    expect(body).toMatchObject({ gameId: game, playerId: 'p1', expiresAt: null });
    expect(body.bannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect((await ban('p1')).status).toBe(200);
    expect(await count('player_bans')).toBe(1);
    // 印があれば理由と期限を置き換える（それでも 1 つ）
    const expiresAt = new Date((nowSeconds() + 7200) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const replaced = await ban('p1', { reason: 'longer', expiresAt });
    expect(replaced.status).toBe(200);
    expect((await replaced.json<{ expiresAt: string }>()).expiresAt).toBe(expiresAt);
    expect(await count('player_bans')).toBe(1);
    const row = await baseEnv.DB.prepare('SELECT reason, expires_at AS expiresAt FROM player_bans').first<{ reason: string; expiresAt: number }>();
    expect(row).toEqual({ reason: 'longer', expiresAt: Date.parse(expiresAt) / 1000 });
  });

  it('BANとBANを解くことは監査のログに前と後が残る', async () => {
    expect((await ban('p1', { reason: 'spam' }, { actor: 'ops@example.com' })).status).toBe(200);
    expect((await unban('p1', { reason: 'mistake' })).status).toBe(200);
    const res = await adminGet(`/v1/admin/audit?gameId=${game}`);
    expect(res.status).toBe(200);
    const { items } = await res.json<{ items: Array<Record<string, unknown>> }>();
    expect(items.map((i) => i.action)).toEqual(['player.unban', 'player.ban']);
    expect(items[1]).toMatchObject({ actor: 'ops@example.com', target: 'player:p1', reason: 'spam',
      before: null, after: { reason: 'spam', expiresAt: null } });
    expect(items[0]).toMatchObject({ actor: 'local-admin', target: 'player:p1', reason: 'mistake',
      before: { reason: 'spam', expiresAt: null }, after: null });
    // 印を置き換えると前の印が前に残る
    const expiresAt = new Date((nowSeconds() + 600) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect((await ban('p1', { reason: 'first' })).status).toBe(200);
    expect((await ban('p1', { reason: 'second', expiresAt })).status).toBe(200);
    const latest = (await (await adminGet(`/v1/admin/audit?gameId=${game}&limit=1`)).json<{ items: Array<Record<string, unknown>> }>()).items[0];
    expect(latest).toMatchObject({ action: 'player.ban', before: { reason: 'first', expiresAt: null }, after: { reason: 'second', expiresAt } });
  });

  it('BANの見出しと本文の誤りはINVALID_ARGUMENTの400を返し印を作らない', async () => {
    const past = new Date((nowSeconds() - 60) * 1000).toISOString();
    const cases: Array<[string, () => Promise<Response>, string]> = [
      ['X-Admin-Actor が無い', () => ban('p1', { reason: 'x' }, { actor: null }), 'INVALID_ARGUMENT'],
      ['X-Admin-Actor の形の誤り', () => ban('p1', { reason: 'x' }, { actor: 'has space' }), 'INVALID_ARGUMENT'],
      ['本文が JSON でない', () => ban('p1', '{"reason":'), 'INVALID_JSON'],
      ['本文がオブジェクトでない', () => ban('p1', ['x']), 'INVALID_ARGUMENT'],
      ['reason が無い', () => ban('p1', {}), 'INVALID_ARGUMENT'],
      ['reason が空白だけ', () => ban('p1', { reason: '   ' }), 'INVALID_ARGUMENT'],
      ['reason が 201 文字', () => ban('p1', { reason: 'r'.repeat(201) }), 'INVALID_ARGUMENT'],
      ['expiresAt が過去', () => ban('p1', { reason: 'x', expiresAt: past }), 'INVALID_ARGUMENT'],
      ['expiresAt の形の誤り', () => ban('p1', { reason: 'x', expiresAt: '2100-01-01' }), 'INVALID_ARGUMENT'],
      ['expiresAt が無い日付', () => ban('p1', { reason: 'x', expiresAt: '2100-02-30T00:00:00Z' }), 'INVALID_ARGUMENT'],
      ['expiresAt が数', () => ban('p1', { reason: 'x', expiresAt: 4102444800 }), 'INVALID_ARGUMENT'],
      ['解く口の reason が無い', () => unban('p1', {}), 'INVALID_ARGUMENT'],
    ];
    for (const [label, sendCase, code] of cases) {
      const res = await sendCase();
      expect(res.status, label).toBe(400);
      expect((await res.json<ErrorBody>()).error.code, label).toBe(code);
    }
    expect(await count('player_bans')).toBe(0);
    expect(await count('admin_audit_log')).toBe(0);
    // 200 文字ちょうどと、ミリ秒の付いた未来の期限は通る
    expect((await ban('p1', { reason: 'r'.repeat(200), expiresAt: new Date((nowSeconds() + 60) * 1000).toISOString() })).status).toBe(200);
  });
});

describe('O2 スキーマ', () => {
  it('PLAYER_BANNEDの応答はスキーマに合う', async () => {
    expect((await ban('p1')).status).toBe(200);
    const data = '{"hp":1}';
    const saveBody = { formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision: 0 };
    const requests: Record<string, () => Promise<Response>> = {
      submitScore: () => submitScore(),
      listSaves: () => send('GET', '/v1/saves'),
      getSave: () => send('GET', '/v1/saves/auto'),
      putSave: () => send('PUT', '/v1/saves/auto', {}, saveBody),
      deleteSave: () => send('DELETE', '/v1/saves/auto', {}, undefined, '&baseRevision=1'),
      getInventory: () => getInventory(),
      listInventoryHistory: () => send('GET', '/v1/inventory/history'),
      listEvents: () => send('GET', '/v1/events'),
      claimEventReward: () => claim(),
      getPlayerData: () => send('GET', '/v1/player-data'),
      // 止めた印は Idempotency-Key と本文の確かめより先なので、見出しが無くても 403 PLAYER_BANNED
      writePlayerData: () => send('POST', '/v1/player-data', {}, { changes: [{ key: 'kills', value: 1 }] }),
    };
    // スキーマのトークンの要る操作（401 を持つ操作）を全部送る
    const tokenOps = Object.values(spec.paths).flatMap((item) => methods.filter((m) => m in item).map((m) => item[m]))
      .filter((o) => o.responses['401']).map((o) => o.operationId);
    expect([...tokenOps].sort()).toEqual(Object.keys(requests).sort());
    for (const operationId of tokenOps) {
      const res = await requests[operationId]();
      expect(res.status, operationId).toBe(403);
      const body = await expectConforms(res, spec, operationId);
      expect(body, operationId).toEqual({ error: { code: 'PLAYER_BANNED', message: 'Player is banned' } });
    }
  });

  it('BANの口の応答は管理のスキーマに合う', async () => {
    const expiresAt = new Date((nowSeconds() + 600) * 1000).toISOString();
    await expectConforms(await ban('p1'), adminSpec, 'adminBanPlayer');
    await expectConforms(await ban('p1', { reason: 'x', expiresAt }), adminSpec, 'adminBanPlayer');
    await expectConforms(await adminGet(`/v1/admin/players/p1?gameId=${game}`), adminSpec, 'adminGetPlayer');
    await expectConforms(await unban('p1'), adminSpec, 'adminUnbanPlayer');
    for (const [operationId, res] of [
      ['adminBanPlayer', await ban('p1', {})], ['adminBanPlayer', await ban('p1', 'x')], ['adminBanPlayer', await ban('nobody')],
      ['adminUnbanPlayer', await unban('p1', {}, { actor: null })], ['adminUnbanPlayer', await unban('nobody')],
      ['adminBanPlayer', await ban('p1', { reason: 'x' }, { e: { ...baseEnv, APP_ENV: 'disabled', ADMIN_API_KEY: adminKey } })],
      ['adminUnbanPlayer', await unban('p1', { reason: 'x' }, { e: { ...localEnv, ADMIN_API_KEY: undefined } })],
    ] as Array<[string, Response]>) {
      await expectConforms(res, adminSpec, operationId);
    }
  });
});
