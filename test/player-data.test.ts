/**
 * プレイヤーデータ U1: 値の読み取り（GET /v1/player-data）と書き込み（POST /v1/player-data。Idempotency-Key 必須）と、
 * 本文の形・書き方の範囲・中身のハッシュの関数の試験。
 * 名前と期待する結果の正は docs/guides/working/player-data-design.md §10 の U1 の行（エラーコードの数・スキーマの操作の数・
 * モジュールの一覧・demo-rpg の設定の 4 本は test/schema-conformance.test.ts・test/modules.test.ts・test/game-modules.test.ts）。
 * L1 は関数を直に呼ぶ。L2 は src/worker.ts の default.fetch を直に呼び、APP_ENV=local を渡す。
 * 試験のゲームは専用の pd-game（4 つの書き方のキーを宣言する）と pd-off（player-data を使わない設定）。
 * 値の行を直に入れる試験は、先に宣言の行がある（beforeEach で入れる。外部キー）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { checkChange, MAX_PLAYER_DATA_VALUE } from '../src/core/player-data';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { MAX_CHANGES_PER_WRITE } from '../src/modules/player-data/limits';
import { parseChanges, writeRequestHash } from '../src/modules/player-data/parse';
import specJson from '../openapi/rpg-online.v1.json';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { countRateLimitRows, fillRateLimit, resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';
const game = 'pd-game';
const offGame = 'pd-off';
const path = '/v1/player-data';

// 試験のキーの宣言（kills は add・上限 1000・1 回 10 まで）
const keys: Array<[string, 'add' | 'max' | 'set' | 'flag', number, number | null]> = [
  ['kills', 'add', 1000, 10], ['floor', 'max', 999, null], ['chapter', 'set', 100, null], ['boss', 'flag', 1, null],
];

type Value = { key: string; mode: string; value: number; updatedAt: string };
type ReadBody = { gameId: string; values: Value[] };
type WriteBody = { gameId: string; writeId: string; values: Array<{ key: string; value: number }> };
type ErrorBody = { error: { code: string; message: string } };
type Who = { gameId?: string; playerId?: string; authorization?: string | null; e?: unknown; headers?: Record<string, string>;
  idempotencyKey?: string | null; body?: string };

type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type Spec = SchemaRoot & { paths: Record<string, Record<string, { operationId: string; responses: Record<string, ResponseSpec> }>> };
const spec = specJson as unknown as Spec;

const nowSeconds = () => Math.floor(Date.now() / 1000);
let keySeq = 0;
/** 書き込みごとの新しい Idempotency-Key。 */
const newKey = () => `pd-key-${Date.now()}-${++keySeq}`;

async function send(method: 'GET' | 'POST', who: Who = {}): Promise<Response> {
  const gameId = who.gameId ?? game;
  const headers: Record<string, string> = { ...who.headers };
  const authorization = who.authorization === undefined ? await bearer(gameId, who.playerId ?? 'p1') : who.authorization;
  if (authorization !== null) headers.authorization = authorization;
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    const key = who.idempotencyKey === undefined ? newKey() : who.idempotencyKey;
    if (key !== null) headers['Idempotency-Key'] = key;
  }
  return worker.fetch(new Request(`${base}${path}?gameId=${gameId}`, { method, headers, body: who.body }), (who.e ?? localEnv) as never);
}
const read = (who: Who = {}) => send('GET', who);
const write = (changes: unknown, who: Who = {}) => send('POST', { body: JSON.stringify({ changes }), ...who });

async function valueOf(key: string, playerId = 'p1'): Promise<number | null> {
  const row = await baseEnv.DB.prepare('SELECT value FROM player_data WHERE game_id = ? AND player_id = ? AND key = ?')
    .bind(game, playerId, key).first<{ value: number }>();
  return row?.value ?? null;
}
async function count(table: 'player_data' | 'player_data_writes'): Promise<number> {
  const row = await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`).bind(game).first<{ n: number }>();
  return row?.n ?? 0;
}
async function setValue(playerId: string, key: string, value: number, updatedAt = nowSeconds()): Promise<void> {
  await baseEnv.DB.prepare('INSERT OR REPLACE INTO player_data (game_id, player_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(game, playerId, key, value, updatedAt).run();
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
async function expectNothingWritten(): Promise<void> {
  expect(await count('player_data')).toBe(0);
  expect(await count('player_data_writes')).toBe(0);
}
/** 応答をスキーマの操作の状態の形に当てる（test/schema-conformance.test.ts の expectConforms と同じ見方）。 */
async function expectConforms(res: Response, method: 'get' | 'post'): Promise<unknown> {
  const r = spec.paths[path][method].responses[String(res.status)];
  expect(r, `${method} ${path} の応答に状態 ${res.status} がある`).toBeDefined();
  for (const [name, h] of Object.entries(r.headers ?? {})) {
    const value = res.headers.get(name);
    if (h.required) expect(value, `ヘッダー ${name} がある`).not.toBeNull();
    if (value !== null) expect(validate(value, h.schema, spec), `ヘッダー ${name}`).toEqual([]);
  }
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body = await res.json();
  expect(validate(body, r.content!['application/json'].schema, spec), `${method} ${path} ${res.status} の本文`).toEqual([]);
  if (res.status >= 400) expect(r['x-error-codes']).toContain((body as ErrorBody).error.code);
  return body;
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）の宣言だけ残す。値は宣言を外部キーで指すので先に消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM player_data'),
    baseEnv.DB.prepare('DELETE FROM player_data_writes'),
    baseEnv.DB.prepare('DELETE FROM player_bans'),
    baseEnv.DB.prepare("DELETE FROM player_data_keys WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
  await registerGame(baseEnv.DB, game, ['player-data']);
  await registerGame(baseEnv.DB, offGame, ['rankings']);
  const insert = baseEnv.DB.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)');
  await baseEnv.DB.batch(keys.map(([k, mode, max, delta]) => insert.bind(game, k, mode, max, delta)));
});

describe('U1: プレイヤーデータの関数', () => {
  it('プレイヤーデータの変更の本文はキーが重ならず行の数と整数を確かめる', () => {
    const many = Array.from({ length: MAX_CHANGES_PER_WRITE + 1 }, (_, i) => ({ key: `k${i}`, value: 1 }));
    for (const bad of [
      {}, { changes: [] }, { changes: many }, { changes: [{ key: 'a', value: 1 }, { key: 'a', value: 2 }] },
      { changes: [{ key: 'bad key', value: 1 }] }, { changes: [{ key: 'a', value: 1.5 }] }, { changes: [{ key: 'a', value: '1' }] },
      { changes: [{ key: 'a' }] }, { changes: ['a'] }, { changes: 'a' }, null, [], 'x',
    ]) {
      expect(parseChanges(bad).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parseChanges({ changes: [{ key: 'kills', value: 3 }, { key: 'floor', value: 0 }], updatedAt: 'x' }))
      .toEqual({ ok: true, value: [{ key: 'kills', value: 3 }, { key: 'floor', value: 0 }] });
    expect(parseChanges({ changes: many.slice(0, MAX_CHANGES_PER_WRITE) }).ok).toBe(true);
  });

  it('プレイヤーデータの書き方ごとに受け付ける値の範囲が決まる', () => {
    const add = { mode: 'add' as const, maxValue: 1000, maxDelta: 10 };
    expect([0, 1, 10, 11, -1].map((v) => checkChange(add, v))).toEqual([false, true, true, false, false]);
    for (const mode of ['max', 'set'] as const) {
      const def = { mode, maxValue: 999, maxDelta: null };
      expect([-1, 0, 999, 1000].map((v) => checkChange(def, v)), mode).toEqual([false, true, true, false]);
    }
    const flag = { mode: 'flag' as const, maxValue: 1, maxDelta: null };
    expect([0, 1, 2].map((v) => checkChange(flag, v))).toEqual([false, true, false]);
    expect(checkChange(add, 1.5)).toBe(false);
  });

  it('プレイヤーデータの書き込みの本文のハッシュは変更の並びに左右されない', async () => {
    const a = await writeRequestHash(game, [{ key: 'kills', value: 3 }, { key: 'floor', value: 12 }]);
    const b = await writeRequestHash(game, [{ key: 'floor', value: 12 }, { key: 'kills', value: 3 }]);
    const c = await writeRequestHash(game, [{ key: 'kills', value: 4 }, { key: 'floor', value: 12 }]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(await writeRequestHash('other-game', [{ key: 'kills', value: 3 }, { key: 'floor', value: 12 }])).not.toBe(a);
  });

  it('プレイヤーデータの利用制限の回数と窓は定数のモジュールにある', () => {
    expect(RATE_LIMITS.playerData).toEqual({ scope: 'player-data', limit: 60, period: 60 });
  });
});

describe('U1: プレイヤーデータの読み書き', () => {
  it('プレイヤーデータを増やすと書いた後の値が返り読み直しても同じ', async () => {
    const first = await write([{ key: 'kills', value: 3 }]);
    expect(first.status).toBe(200);
    const one = await first.json<WriteBody>();
    expect(one.gameId).toBe(game);
    expect(one.values).toEqual([{ key: 'kills', value: 3 }]);
    const second = await write([{ key: 'kills', value: 2 }]);
    expect(second.status).toBe(200);
    const two = await second.json<WriteBody>();
    expect(two.values).toEqual([{ key: 'kills', value: 5 }]);
    expect(two.writeId).not.toBe(one.writeId);
    const got = await (await read()).json<ReadBody>();
    expect(got.values.map((v) => [v.key, v.value])).toEqual([['kills', 5]]);
  });

  it('最大値で置くキーは小さい値を送っても下がらない', async () => {
    expect((await (await write([{ key: 'floor', value: 12 }])).json<WriteBody>()).values).toEqual([{ key: 'floor', value: 12 }]);
    const res = await write([{ key: 'floor', value: 5 }]);
    expect(res.status).toBe(200);
    expect((await res.json<WriteBody>()).values).toEqual([{ key: 'floor', value: 12 }]);
    expect((await (await read()).json<ReadBody>()).values.map((v) => v.value)).toEqual([12]);
  });

  it('値で置くキーは送った値に置き換わり下げられる', async () => {
    expect((await (await write([{ key: 'chapter', value: 3 }])).json<WriteBody>()).values).toEqual([{ key: 'chapter', value: 3 }]);
    const res = await write([{ key: 'chapter', value: 1 }]);
    expect(res.status).toBe(200);
    expect((await res.json<WriteBody>()).values).toEqual([{ key: 'chapter', value: 1 }]);
    expect(await valueOf('chapter')).toBe(1);
  });

  it('真偽のキーは1だけを受け付け一度立てたら下がらない', async () => {
    const first = await write([{ key: 'boss', value: 1 }]);
    expect(first.status).toBe(200);
    expect((await first.json<WriteBody>()).values).toEqual([{ key: 'boss', value: 1 }]);
    await expectError(await write([{ key: 'boss', value: 0 }]), 400, 'INVALID_ARGUMENT');
    expect(await valueOf('boss')).toBe(1);
    expect(await count('player_data_writes')).toBe(1);
  });

  it('宣言の無いキーへの書き込みはNOT_FOUNDの404を返し何も書かない', async () => {
    const res = await write([{ key: 'kills', value: 1 }, { key: 'undeclared', value: 1 }]);
    expect(res.status).toBe(404);
    expect(await res.json<ErrorBody>()).toEqual({ error: { code: 'NOT_FOUND', message: 'Unknown key' } });
    await expectNothingWritten();
  });

  it('1回の増加の上限を超える値は400を返し何も書かない', async () => {
    await expectError(await write([{ key: 'kills', value: 11 }]), 400, 'INVALID_ARGUMENT');
    await expectNothingWritten();
  });

  it('増やした結果が上限を超えるとPLAYER_DATA_LIMIT_EXCEEDEDの409を返し何も書かない', async () => {
    const past = nowSeconds() - 100;
    await setValue('p1', 'kills', 999, past);
    await setValue('p1', 'chapter', 4, past);
    await expectError(await write([{ key: 'kills', value: 2 }, { key: 'chapter', value: 9 }]), 409, 'PLAYER_DATA_LIMIT_EXCEEDED');
    expect(await valueOf('kills')).toBe(999);
    expect(await valueOf('chapter')).toBe(4);
    expect(await count('player_data_writes')).toBe(0);
    // 上限ちょうどまでは書ける
    expect((await write([{ key: 'kills', value: 1 }])).status).toBe(200);
    expect(await valueOf('kills')).toBe(1000);
  });

  it('同じIdempotency-Keyの書き込みを2回送っても1回分で同じ本文を返す', async () => {
    const key = newKey();
    const first = await write([{ key: 'kills', value: 3 }, { key: 'floor', value: 7 }], { idempotencyKey: key });
    const second = await write([{ key: 'kills', value: 3 }, { key: 'floor', value: 7 }], { idempotencyKey: key });
    expect([first.status, second.status]).toEqual([200, 200]);
    const one = await first.json<WriteBody>();
    expect(await second.json<WriteBody>()).toEqual(one);
    expect(one.values).toEqual([{ key: 'floor', value: 7 }, { key: 'kills', value: 3 }]);
    // 並びだけ違う同じ中身も同じ書き込み
    const reordered = await write([{ key: 'floor', value: 7 }, { key: 'kills', value: 3 }], { idempotencyKey: key });
    expect(await reordered.json<WriteBody>()).toEqual(one);
    expect(await valueOf('kills')).toBe(3);
    expect(await count('player_data_writes')).toBe(1);
  });

  it('同じIdempotency-Keyの書き込みを並べて送っても1回分', async () => {
    const key = newKey();
    const results = await Promise.all(Array.from({ length: 10 }, () => write([{ key: 'kills', value: 5 }], { idempotencyKey: key })));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    const bodies = await Promise.all(results.map((r) => r.json<WriteBody>()));
    expect(new Set(bodies.map((b) => b.writeId)).size).toBe(1);
    expect(bodies.every((b) => b.values[0].value === 5)).toBe(true);
    expect(await valueOf('kills')).toBe(5);
    expect(await count('player_data_writes')).toBe(1);
  });

  it('同じIdempotency-Keyで違う中身の書き込みはIDEMPOTENCY_KEY_REUSEDの422を返す', async () => {
    const key = newKey();
    expect((await write([{ key: 'kills', value: 3 }], { idempotencyKey: key })).status).toBe(200);
    await expectError(await write([{ key: 'kills', value: 4 }], { idempotencyKey: key }), 422, 'IDEMPOTENCY_KEY_REUSED');
    expect(await valueOf('kills')).toBe(3);
    expect(await count('player_data_writes')).toBe(1);
  });

  it('Idempotency-Keyの無いプレイヤーデータの書き込みはINVALID_ARGUMENTの400を返す', async () => {
    for (const idempotencyKey of [null, 'abcdefg', 'bad key!!', 'a'.repeat(65)]) {
      await expectError(await write([{ key: 'kills', value: 1 }], { idempotencyKey }), 400, 'INVALID_ARGUMENT');
    }
    await expectNothingWritten();
  });

  it('ほかのプレイヤーが同じIdempotency-Keyを使っても別の書き込みになる', async () => {
    const key = newKey();
    const a = await write([{ key: 'kills', value: 2 }], { idempotencyKey: key, playerId: 'p1' });
    const b = await write([{ key: 'kills', value: 2 }], { idempotencyKey: key, playerId: 'p2' });
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await a.json<WriteBody>()).writeId).not.toBe((await b.json<WriteBody>()).writeId);
    expect(await valueOf('kills', 'p1')).toBe(2);
    expect(await valueOf('kills', 'p2')).toBe(2);
  });

  it('プレイヤーデータを読むとトークンのプレイヤーの値だけがキーの順に返る', async () => {
    const at = nowSeconds() - 60;
    await setValue('p1', 'kills', 7, at);
    await setValue('p1', 'chapter', 2, at);
    await setValue('p1', 'boss', 1, at);
    await setValue('p2', 'floor', 30, at);
    const res = await read({ playerId: 'p1' });
    expect(res.status).toBe(200);
    const iso = new Date(at * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(await res.json<ReadBody>()).toEqual({
      gameId: game,
      values: [
        { key: 'boss', mode: 'flag', value: 1, updatedAt: iso },
        { key: 'chapter', mode: 'set', value: 2, updatedAt: iso },
        { key: 'kills', mode: 'add', value: 7, updatedAt: iso },
      ],
    });
  });

  it('何も書いていないプレイヤーのプレイヤーデータは空の一覧で返る', async () => {
    const res = await read({ playerId: 'nobody' });
    expect(res.status).toBe(200);
    expect(await res.json<ReadBody>()).toEqual({ gameId: game, values: [] });
  });

  it('クライアントが送った時刻はプレイヤーデータの時刻に使わない', async () => {
    const before = nowSeconds();
    const res = await write([{ key: 'kills', value: 1 }], {
      body: JSON.stringify({ changes: [{ key: 'kills', value: 1 }], updatedAt: '2000-01-01T00:00:00Z' }),
      headers: { Date: 'Sat, 01 Jan 2000 00:00:00 GMT' },
    });
    expect(res.status).toBe(200);
    const [value] = (await (await read()).json<ReadBody>()).values;
    const at = Date.parse(value.updatedAt) / 1000;
    expect(at).toBeGreaterThanOrEqual(before - 5);
    expect(at).toBeLessThanOrEqual(nowSeconds() + 5);
  });

  it('プレイヤーデータはトークンの無い要求に401を返し利用制限を数えない', async () => {
    await expectError(await read({ authorization: null }), 401, 'UNAUTHENTICATED');
    await expectError(await write([{ key: 'kills', value: 1 }], { authorization: null }), 401, 'UNAUTHENTICATED');
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
    await expectNothingWritten();
  });

  it('トークンと違うゲームのプレイヤーデータはPERMISSION_DENIEDの403を返す', async () => {
    const authorization = await bearer(game, 'p1');
    await expectError(await read({ gameId: 'demo-rpg', authorization }), 403, 'PERMISSION_DENIED');
    await expectError(await write([{ key: 'slimes-defeated', value: 1 }], { gameId: 'demo-rpg', authorization }), 403, 'PERMISSION_DENIED');
  });

  it('player-dataを使わない設定のゲームのプレイヤーデータはNOT_FOUNDの404を返す', async () => {
    for (const res of [await read({ gameId: offGame }), await write([{ key: 'kills', value: 1 }], { gameId: offGame })]) {
      expect(res.status).toBe(404);
      expect(await res.json<ErrorBody>()).toEqual({ error: { code: 'NOT_FOUND', message: 'Feature not enabled for this game' } });
    }
  });

  it('本番の設定ではプレイヤーデータの読み書きにNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    const e = { ...baseEnv, APP_ENV: 'disabled' };
    await expectError(await read({ e }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectError(await write([{ key: 'kills', value: 1 }], { e }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectNothingWritten();
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('プレイヤーデータの操作を上限より多く呼ぶと429とRetry-Afterを返す', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.playerData, `${game}:p1`);
    const res = await write([{ key: 'kills', value: 1 }]);
    expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
    await expectError(res, 429, 'RATE_LIMITED');
    await expectError(await read(), 429, 'RATE_LIMITED');
    await expectNothingWritten();
    // ほかのプレイヤーは数えが別
    expect((await read({ playerId: 'p2' })).status).toBe(200);
  });

  it('BANしたプレイヤーのプレイヤーデータの読み書きはPLAYER_BANNEDの403を返し何も書かない', async () => {
    await baseEnv.DB.prepare('INSERT INTO player_bans (game_id, player_id, reason, banned_at) VALUES (?, ?, ?, ?)')
      .bind(game, 'p1', 'test', nowSeconds()).run();
    for (const res of [await read(), await write([{ key: 'kills', value: 1 }])]) {
      expect(res.status).toBe(403);
      expect(await res.json<ErrorBody>()).toEqual({ error: { code: 'PLAYER_BANNED', message: 'Player is banned' } });
    }
    await expectNothingWritten();
  });

  it('プレイヤーデータの値はマイナスにも上限より大きくもできない', async () => {
    await baseEnv.DB.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)')
      .bind(game, 'big', 'set', MAX_PLAYER_DATA_VALUE, null).run();
    await expect(setValue('p1', 'big', -1)).rejects.toThrow();
    await expect(setValue('p1', 'big', MAX_PLAYER_DATA_VALUE + 1)).rejects.toThrow();
    await setValue('p1', 'big', MAX_PLAYER_DATA_VALUE);
    expect(await valueOf('big')).toBe(MAX_PLAYER_DATA_VALUE);
  });

  it('プレイヤーデータの読み書きの応答はスキーマに合う', async () => {
    expect((await write([{ key: 'kills', value: 3 }, { key: 'boss', value: 1 }])).status).toBe(200);
    await expectConforms(await read(), 'get');
    await expectConforms(await read({ playerId: 'nobody' }), 'get');
    await expectConforms(await write([{ key: 'floor', value: 4 }]), 'post');
    await expectConforms(await write([{ key: 'kills', value: 0 }]), 'post');
    await expectConforms(await write([], { body: '{"changes":' }), 'post');
    await expectConforms(await write([{ key: 'undeclared', value: 1 }]), 'post');
    await setValue('p1', 'kills', 999);
    await expectConforms(await write([{ key: 'kills', value: 5 }]), 'post');
    const key = newKey();
    expect((await write([{ key: 'chapter', value: 1 }], { idempotencyKey: key })).status).toBe(200);
    await expectConforms(await write([{ key: 'chapter', value: 2 }], { idempotencyKey: key }), 'post');
  });
});
