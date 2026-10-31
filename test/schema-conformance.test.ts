/**
 * API スキーマの試験 S1: スキーマのファイル（openapi/rpg-online.v1.json）の形と、実際の応答がスキーマに合うこと。
 * 名前と確かめることの正は docs/guides/working/api-schema-design.md §4（`セーブの読み書きの応答はスキーマに合う`・`セーブの一覧と削除の応答はスキーマに合う` とエラーコードの数の試験は docs/guides/working/save-design.md §7、
 * `設定の応答はスキーマに合う`・`マスターデータの応答はスキーマに合う` は設定配信の C1・C2 で足したもので docs/guides/working/config-design.md §7、
 * 操作の数の試験はイベントの E2 で置き換えたもので docs/guides/working/event-reward-design.md §8（エラーコードの数の試験も E2 で置き換え、
 * `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` に E2 の 2 つの 409 の行を足した）、
 * `429の応答はスキーマに合う` とエラーコードの数の試験は利用制限の R1 で足し・置き換えたもので docs/guides/working/abuse-protection-design.md §7。
 * エラーコードの数の試験は管理の O2 でも置き換え、`エラーの応答はスキーマに書いた状態とエラーコードの組で返る` に BAN したプレイヤーの行を足した。
 * docs/guides/working/admin-design.md §9）。挙動（状態コード・データ）は
 * test/failure-*.test.ts が見る。ここはスキーマの側から見る。
 * L2 の試験は src/worker.ts の default.fetch を直に呼ぶ（docs/guides/working/failure-case-test-plan.md §2）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-24
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { bearer, bearerForBody } from './support/auth';
import { sha256Hex } from '../src/modules/saves/checksum';
import { MAX_SAVE_BYTES, MAX_SLOTS } from '../src/modules/saves/limits';
import specJson from '../openapi/rpg-online.v1.json';
import { resolveRef, validate, type Schema, type SchemaRoot } from './support/schema-check';
import { registerGame } from './support/games';
import { fillRateLimit, resetRateLimits } from './support/rate-limits';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { MAX_ITEM_AMOUNT } from '../src/core/inventory';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

type ResponseSpec = {
  headers?: Record<string, { required?: boolean; schema: Schema }>;
  content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[];
};
type Operation = { operationId: string; responses: Record<string, ResponseSpec> };
type Spec = SchemaRoot & {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, Schema> };
};
const spec = specJson as unknown as Spec;
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const errorCodes = ['INVALID_ARGUMENT', 'NOT_FOUND', 'NOT_READY_FOR_PRODUCTION', 'INVALID_JSON', 'INTERNAL_ERROR',
  'UNAUTHENTICATED', 'TOKEN_EXPIRED', 'PERMISSION_DENIED', 'SAVE_CONFLICT', 'PAYLOAD_TOO_LARGE', 'SLOT_LIMIT_EXCEEDED', 'RATE_LIMITED',
  'EVENT_NOT_ACTIVE', 'INVENTORY_LIMIT_EXCEEDED', 'PLAYER_BANNED'];

// prepare が D1 のエラーに似た例外を投げる偽の DB（本物の D1 を壊さない）
const brokenDB = {
  prepare(): never { throw new Error('D1_ERROR: SQLITE_ERROR: no such table: ranking_entries'); },
};

function operations(): Operation[] {
  return Object.values(spec.paths).flatMap((item) =>
    methods.filter((m) => m in item).map((m) => item[m] as Operation));
}
function operation(operationId: string): Operation {
  const op = operations().find((o) => o.operationId === operationId);
  if (!op) throw new Error(`スキーマに操作 ${operationId} が無い`);
  return op;
}
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') out.push(v);
      else collectRefs(v, out);
    }
  }
  return out;
}

function get(path: string, e: unknown = baseEnv): Promise<Response> {
  return worker.fetch(new Request(base + path), e as never);
}
async function postRaw(boardId: string, body: string, e: unknown = localEnv): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await bearerForBody(body) },
    body,
  }), e as never);
}
function post(boardId: string, body: unknown, e: unknown = localEnv): Promise<Response> {
  return postRaw(boardId, JSON.stringify(body), e);
}
/** Authorization を指定して（null なら付けずに）スコアを送る。認証のエラーを起こすため。 */
function postWith(boardId: string, body: unknown, authorization: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }), localEnv as never);
}
function postGuestRaw(body: string, e: unknown = localEnv): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/accounts/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }), e as never);
}

/** セーブを書く（PUT /v1/saves/{slotId}）。authorization が null なら付けない。既定は demo-rpg・p1 のトークン。 */
async function putSave(slotId: string, body: unknown, options: { authorization?: string | null; e?: unknown; gameId?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const authorization = options.authorization === undefined ? await bearer('demo-rpg', 'p1') : options.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}/v1/saves/${slotId}?gameId=${options.gameId ?? 'demo-rpg'}`, {
    method: 'PUT',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), (options.e ?? localEnv) as never);
}
/** セーブを読む（GET /v1/saves/{slotId}）。既定は demo-rpg・p1 のトークン。 */
async function getSave(slotId: string, options: { authorization?: string | null; e?: unknown; gameId?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const authorization = options.authorization === undefined ? await bearer('demo-rpg', 'p1') : options.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}/v1/saves/${slotId}?gameId=${options.gameId ?? 'demo-rpg'}`, { headers }), (options.e ?? localEnv) as never);
}
/** セーブの一覧（GET /v1/saves）か削除（DELETE /v1/saves/{slotId}）。既定は demo-rpg・p1 のトークン。query は gameId の後に付ける。 */
async function manageSave(method: 'GET' | 'DELETE', path: string, query = '', options: { authorization?: string | null; e?: unknown; gameId?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const authorization = options.authorization === undefined ? await bearer('demo-rpg', 'p1') : options.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}${path}?gameId=${options.gameId ?? 'demo-rpg'}${query}`, { method, headers }), (options.e ?? localEnv) as never);
}
/** player のスロットを MAX_SLOTS 個まで埋める（SLOT_LIMIT_EXCEEDED を起こすため）。 */
async function fillSlots(player: string): Promise<string> {
  const authorization = await bearer('demo-rpg', player);
  await baseEnv.DB.prepare('DELETE FROM saves WHERE player_id = ?').bind(player).run();
  for (let i = 0; i < MAX_SLOTS; i++) {
    const res = await putSave(`slot-${i}`, await saveBody('x', 0), { authorization });
    expect(res.status).toBe(200);
  }
  return authorization;
}
/** data の正しいチェックサムを付けたセーブの書き込みの本文。 */
async function saveBody(data: string, baseRevision: number): Promise<Record<string, unknown>> {
  return { formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision };
}

/** イベントの報酬を受け取る（POST /v1/events/{eventId}/claim）。demo-rpg・p1 のトークン。 */
async function claimEvent(eventId: string): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/events/${eventId}/claim?gameId=demo-rpg`, {
    method: 'POST', headers: { authorization: await bearer('demo-rpg', 'p1') },
  }), localEnv as never);
}
/** E2 の 2 つの 409 を起こすイベント（demo-rpg に、終わったイベントと、p1 の残高が上限に近い品目の報酬のイベント）を入れる。 */
async function addSchemaEvents(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const event = 'INSERT OR REPLACE INTO events (game_id, event_id, kind, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)';
  await baseEnv.DB.batch([
    baseEnv.DB.prepare("DELETE FROM event_claims WHERE game_id = 'demo-rpg' AND player_id = 'p1'"),
    baseEnv.DB.prepare(event).bind('demo-rpg', 'schema-ended', 'daily', now - 86400, now - 1),
    baseEnv.DB.prepare(event).bind('demo-rpg', 'schema-big', 'daily', now - 3600, now + 86400),
    baseEnv.DB.prepare("INSERT OR REPLACE INTO event_rewards (game_id, event_id, item_id, amount) VALUES ('demo-rpg', 'schema-big', 'gold', 100)"),
    baseEnv.DB.prepare("INSERT OR REPLACE INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES ('demo-rpg', 'p1', 'gold', ?, ?)")
      .bind(MAX_ITEM_AMOUNT - 50, now),
  ]);
}

/** 応答の状態・ヘッダー・本文が、スキーマの操作のその状態の応答に合うことを確かめ、その応答の定義を返す。 */
async function expectConforms(res: Response, operationId: string): Promise<{ spec: ResponseSpec; body: unknown }> {
  const responses = operation(operationId).responses;
  const status = String(res.status);
  expect(Object.keys(responses), `${operationId} の応答に状態 ${status} がある`).toContain(status);
  const r = responses[status];
  for (const [name, h] of Object.entries(r.headers ?? {})) {
    const value = res.headers.get(name);
    if (h.required) expect(value, `ヘッダー ${name} がある`).not.toBeNull();
    if (value !== null) expect(validate(value, h.schema, spec), `ヘッダー ${name}`).toEqual([]);
  }
  const [mediaType, media] = Object.entries(r.content ?? {})[0] ?? [];
  expect(mediaType, `${operationId} ${status} の content`).toBe('application/json');
  // charset=utf-8 は info.description に書いた決まり（OpenAPI 3.1 は Content-Type を headers に書かない）
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body = await res.json();
  expect(validate(body, media!.schema, spec), `${operationId} ${status} の本文`).toEqual([]);
  return { spec: r, body };
}

beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare("DELETE FROM announcements WHERE id <> 'welcome'"),
  ]);
  await resetRateLimits(baseEnv.DB);
});

describe('S1: スキーマのファイル', () => {
  it('スキーマのファイルはOpenAPI 3.1で15個の操作を持つ', () => {
    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
    expect(operations().map((o) => o.operationId).sort())
      .toEqual(['claimEventReward', 'deleteSave', 'getConfig', 'getHealth', 'getInventory', 'getMasterData', 'getRanking', 'getSave',
        'issueGuest', 'listAnnouncements', 'listEvents', 'listInventoryHistory', 'listSaves', 'putSave', 'submitScore']);
    const refs = collectRefs(spec);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(() => resolveRef(ref, spec), ref).not.toThrow();
  });

  it('スキーマの検証関数は型と必須と範囲と形の外れを見つける', () => {
    const root: SchemaRoot = { components: { schemas: { Small: { type: 'integer', maximum: 3 } } } };
    // 語ごとに [スキーマ, 合う値, 外れる値]
    const cases: Array<[string, Schema, unknown, unknown]> = [
      ['type string', { type: 'string' }, 'a', 1],
      ['type integer', { type: 'integer' }, 2, 2.5],
      ['type object', { type: 'object' }, {}, []],
      ['type array', { type: 'array' }, [], {}],
      ['type boolean', { type: 'boolean' }, true, 'true'],
      ['properties', { type: 'object', properties: { a: { type: 'string' } } }, { a: 'x' }, { a: 1 }],
      ['required', { type: 'object', required: ['a'] }, { a: 1 }, { b: 1 }],
      ['additionalProperties', { type: 'object', additionalProperties: false, properties: { a: {} } }, { a: 1 }, { a: 1, b: 2 }],
      ['items', { type: 'array', items: { type: 'integer' } }, [1, 2], [1, 'x']],
      ['maxItems', { type: 'array', maxItems: 2 }, [1, 2], [1, 2, 3]],
      ['pattern', { type: 'string', pattern: '^[a-z]{1,3}$' }, 'abc', 'abcd'],
      ['minLength', { type: 'string', minLength: 2 }, 'ab', 'a'],
      ['maxLength', { type: 'string', maxLength: 2 }, 'ab', 'abc'],
      ['minimum', { type: 'integer', minimum: 0 }, 0, -1],
      ['maximum', { type: 'integer', maximum: 10 }, 10, 11],
      ['const', { const: 'ok' }, 'ok', 'ng'],
      ['enum', { enum: ['A', 'B'] }, 'B', 'C'],
      ['$ref', { $ref: '#/components/schemas/Small' }, 3, 4],
    ];
    for (const [label, schema, good, bad] of cases) {
      expect(validate(good, schema, root), `${label} の合う値`).toEqual([]);
      expect(validate(bad, schema, root).length, `${label} の外れる値`).toBeGreaterThan(0);
    }
    // additionalProperties: true は知らない欄を通す
    expect(validate({ a: 1, b: 2 }, { type: 'object', additionalProperties: true, properties: { a: {} } }, root)).toEqual([]);
    // 長さは src/worker.ts に合わせて .length（UTF-16 の単位）で数える
    expect(validate('😀', { type: 'string', maxLength: 1 }, root).length).toBeGreaterThan(0);
    // 見ない語・外を指す $ref は黙って通さない
    expect(() => validate('a', { type: 'string', format: 'email' }, root)).toThrow();
    expect(() => validate(1, { $ref: '#/components/schemas/Missing' }, root)).toThrow();
    expect(() => validate(1, { $ref: 'other.json#/X' }, root)).toThrow();
  });

  it('スキーマのErrorCodeの列挙は15個のエラーコードと一致する', () => {
    const codes = spec.components.schemas.ErrorCode.enum as string[];
    expect([...codes].sort()).toEqual([...errorCodes].sort());
  });
});

describe('S1: 応答がスキーマに合う', () => {
  it('GET /healthの応答はスキーマに合う', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    await expectConforms(res, 'getHealth');
  });

  it('GET /v1/announcementsの応答はスキーマに合う', async () => {
    const res = await get('/v1/announcements?gameId=demo-rpg');
    expect(res.status).toBe(200);
    const { body } = await expectConforms(res, 'listAnnouncements');
    expect((body as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain('welcome');
  });

  it('GET /v1/rankings/{boardId}の応答はスキーマに合う', async () => {
    const insert = 'INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score) VALUES (?, ?, ?, ?, ?)';
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(insert).bind('demo-rpg', 'boss-score', 'p1', 'Player One', 1200),
      baseEnv.DB.prepare(insert).bind('demo-rpg', 'boss-score', 'p2', 'Player Two', 800),
    ]);
    const res = await get('/v1/rankings/boss-score?gameId=demo-rpg');
    expect(res.status).toBe(200);
    const { body } = await expectConforms(res, 'getRanking');
    expect((body as { items: unknown[] }).items).toHaveLength(2);
  });

  it('POST /v1/rankings/{boardId}の応答はスキーマに合う', async () => {
    const submission = { gameId: 'demo-rpg', playerId: 'p1', displayName: 'Player One', score: 1200 };
    expect(validate(submission, spec.components.schemas.ScoreSubmission, spec)).toEqual([]);
    const res = await post('boss-score', submission);
    expect(res.status).toBe(200);
    await expectConforms(res, 'submitScore');
  });

  it('ゲストの発行の応答はスキーマに合う', async () => {
    const request = { gameId: 'demo-rpg' };
    expect(validate(request, spec.components.schemas.GuestRequest, spec)).toEqual([]);
    const ok = await postGuestRaw(JSON.stringify(request));
    expect(ok.status).toBe(200);
    await expectConforms(ok, 'issueGuest');
    const cases: Array<[number, string, () => Promise<Response>]> = [
      [400, 'INVALID_JSON', () => postGuestRaw('{"gameId":')],
      [400, 'INVALID_ARGUMENT', () => postGuestRaw(JSON.stringify({ gameId: 'demo.rpg' }))],
      [403, 'NOT_READY_FOR_PRODUCTION', () => postGuestRaw(JSON.stringify(request), baseEnv)],
      [404, 'NOT_FOUND', () => postGuestRaw(JSON.stringify({ gameId: 'no-such-game' }))],
    ];
    for (const [status, code, send] of cases) {
      const res = await send();
      expect(res.status, code).toBe(status);
      const { spec: r, body } = await expectConforms(res, 'issueGuest');
      const actual = (body as { error: { code: string } }).error.code;
      expect(actual).toBe(code);
      expect(r['x-error-codes'], `issueGuest の ${status} の x-error-codes`).toContain(actual);
    }
  });

  it('認証のエラーの応答はスキーマに合う', async () => {
    const valid = { gameId: 'demo-rpg', playerId: 'p1', displayName: 'Player One', score: 1200 };
    const cases: Array<[number, string, () => Promise<Response>]> = [
      [401, 'UNAUTHENTICATED', () => postWith('boss-score', valid, null)],
      [401, 'UNAUTHENTICATED', () => postWith('boss-score', valid, 'Basic abc')],
      [401, 'TOKEN_EXPIRED', async () => postWith('boss-score', valid, await bearer('demo-rpg', 'p1', { exp: 1 }))],
      [403, 'PERMISSION_DENIED', async () => postWith('boss-score', valid, await bearer('demo-rpg', 'p2'))],
    ];
    for (const [status, code, send] of cases) {
      const res = await send();
      expect(res.status, code).toBe(status);
      const { spec: r, body } = await expectConforms(res, 'submitScore');
      const actual = (body as { error: { code: string } }).error.code;
      expect(actual).toBe(code);
      expect(r['x-error-codes'], `submitScore の ${status} の x-error-codes`).toContain(actual);
    }
  });

  it('エラーの応答はスキーマに書いた状態とエラーコードの組で返る', async () => {
    const valid = { gameId: 'demo-rpg', playerId: 'p1', displayName: 'Player One', score: 1200 };
    const cases: Array<[string, string, () => Promise<Response>]> = [
      ['INVALID_ARGUMENT', 'listAnnouncements', () => get('/v1/announcements')],
      ['INVALID_ARGUMENT', 'getRanking', () => get('/v1/rankings/boss-score?gameId=demo-rpg&limit=0')],
      ['INVALID_ARGUMENT', 'submitScore', () => post('boss-score', { ...valid, score: -1 })],
      ['INVALID_JSON', 'submitScore', () => postRaw('boss-score', '{"gameId":')],
      ['NOT_READY_FOR_PRODUCTION', 'submitScore', () => post('boss-score', valid, baseEnv)],
      ['NOT_FOUND', 'getRanking', () => get('/v1/rankings/bad.board?gameId=demo-rpg')],
      ['NOT_FOUND', 'submitScore', () => post('bad.board', valid)],
      ['INTERNAL_ERROR', 'listAnnouncements', () => get('/v1/announcements?gameId=demo-rpg', { ...baseEnv, DB: brokenDB })],
      ['INTERNAL_ERROR', 'getRanking', () => get('/v1/rankings/boss-score?gameId=demo-rpg', { ...baseEnv, DB: brokenDB })],
      ['INTERNAL_ERROR', 'submitScore', () => post('boss-score', valid, { ...localEnv, DB: brokenDB })],
      ['UNAUTHENTICATED', 'submitScore', () => postWith('boss-score', valid, null)],
      ['TOKEN_EXPIRED', 'submitScore', async () => postWith('boss-score', valid, await bearer('demo-rpg', 'p1', { exp: 1 }))],
      ['PERMISSION_DENIED', 'submitScore', async () => postWith('boss-score', valid, await bearer('demo-rpg', 'p2'))],
      ['SAVE_CONFLICT', 'putSave', async () => putSave('schema-conflict', await saveBody('x', 999))],
      ['PAYLOAD_TOO_LARGE', 'putSave', async () => putSave('schema-large', await saveBody('a'.repeat(MAX_SAVE_BYTES + 1), 0))],
      ['SLOT_LIMIT_EXCEEDED', 'putSave', async () => putSave('one-more', await saveBody('x', 0), { authorization: await fillSlots('schema-slots') })],
      ['EVENT_NOT_ACTIVE', 'claimEventReward', async () => claimEvent('schema-ended')],
      ['INVENTORY_LIMIT_EXCEEDED', 'claimEventReward', async () => claimEvent('schema-big')],
      ['PLAYER_BANNED', 'getInventory', async () => {
        await baseEnv.DB.prepare("INSERT OR REPLACE INTO player_bans (game_id, player_id, reason, banned_at) VALUES ('demo-rpg', 'schema-banned', 'test', 1)").run();
        const res = await worker.fetch(new Request(`${base}/v1/inventory?gameId=demo-rpg`, {
          headers: { authorization: await bearer('demo-rpg', 'schema-banned') },
        }), localEnv as never);
        await baseEnv.DB.prepare("DELETE FROM player_bans WHERE game_id = 'demo-rpg' AND player_id = 'schema-banned'").run();
        return res;
      }],
      // p1 のスコアの数を上限まで埋めるので最後に置く（前の行の p1 の投稿を断らせない）
      ['RATE_LIMITED', 'submitScore', async () => { await fillRateLimit(baseEnv.DB, RATE_LIMITS.score, 'demo-rpg:p1'); return post('boss-score', valid); }],
    ];
    const seen = new Set<string>();
    await addSchemaEvents();
    for (const [code, operationId, send] of cases) {
      const res = await send();
      const { spec: r, body } = await expectConforms(res, operationId);
      const actual = (body as { error: { code: string } }).error.code;
      expect(actual, `${operationId} の ${code}`).toBe(code);
      expect(r['x-error-codes'], `${operationId} の ${res.status} の x-error-codes`).toContain(actual);
      seen.add(actual);
    }
    expect([...seen].sort()).toEqual([...errorCodes].sort());
  });

  it('429の応答はスキーマに合う', async () => {
    const valid = { gameId: 'demo-rpg', playerId: 'p1', displayName: 'Player One', score: 1200 };
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.score, 'demo-rpg:p1');
    const res = await post('boss-score', valid);
    expect(res.status).toBe(429);
    const { spec: r, body } = await expectConforms(res, 'submitScore');
    expect(r.headers?.['Retry-After']?.required, '429 のスキーマに Retry-After の見出しがある').toBe(true);
    expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
    const actual = (body as { error: { code: string } }).error.code;
    expect(actual).toBe('RATE_LIMITED');
    expect(r['x-error-codes']).toContain(actual);
    expect(operation('issueGuest').responses['429']?.headers?.['Retry-After']?.required, 'ゲストの発行の 429 にも Retry-After がある').toBe(true);
  });

  it('セーブの読み書きの応答はスキーマに合う', async () => {
    await baseEnv.DB.prepare("DELETE FROM saves WHERE player_id = 'p1'").run();
    const body = await saveBody(JSON.stringify({ hp: 30, map: 'town' }), 0);
    expect(validate(body, spec.components.schemas.SaveWrite, spec)).toEqual([]);
    const put = await putSave('auto', body);
    expect(put.status).toBe(200);
    await expectConforms(put, 'putSave');
    const got = await getSave('auto');
    expect(got.status).toBe(200);
    await expectConforms(got, 'getSave');
    const cases: Array<[number, string, string, () => Promise<Response>]> = [
      [400, 'INVALID_JSON', 'putSave', () => putSave('auto', '{"data":')],
      [400, 'INVALID_ARGUMENT', 'putSave', async () => putSave('auto', { ...(await saveBody('x', 1)), checksum: await sha256Hex('y') })],
      [400, 'INVALID_ARGUMENT', 'getSave', () => getSave('auto', { gameId: 'demo.rpg' })],
      [401, 'UNAUTHENTICATED', 'putSave', async () => putSave('auto', await saveBody('x', 1), { authorization: null })],
      [401, 'TOKEN_EXPIRED', 'getSave', async () => getSave('auto', { authorization: await bearer('demo-rpg', 'p1', { exp: 1 }) })],
      [403, 'NOT_READY_FOR_PRODUCTION', 'putSave', async () => putSave('auto', await saveBody('x', 1), { e: baseEnv })],
      [403, 'NOT_READY_FOR_PRODUCTION', 'getSave', () => getSave('auto', { e: baseEnv })],
      [403, 'PERMISSION_DENIED', 'getSave', () => getSave('auto', { gameId: 'other-rpg' })],
      [404, 'NOT_FOUND', 'getSave', () => getSave('never-written')],
      [404, 'NOT_FOUND', 'putSave', async () => putSave('auto', await saveBody('x', 1), { gameId: 'no-such-game', authorization: await bearer('no-such-game', 'p1') })],
      [409, 'SAVE_CONFLICT', 'putSave', async () => putSave('auto', await saveBody('x', 0))],
      [413, 'PAYLOAD_TOO_LARGE', 'putSave', async () => putSave('auto', await saveBody('a'.repeat(MAX_SAVE_BYTES + 1), 1))],
    ];
    for (const [status, code, operationId, send] of cases) {
      const res = await send();
      expect(res.status, `${operationId} の ${code}`).toBe(status);
      const { spec: r, body: errBody } = await expectConforms(res, operationId);
      const actual = (errBody as { error: { code: string } }).error.code;
      expect(actual).toBe(code);
      expect(r['x-error-codes'], `${operationId} の ${status} の x-error-codes`).toContain(actual);
    }
  });

  it('セーブの一覧と削除の応答はスキーマに合う', async () => {
    await baseEnv.DB.prepare("DELETE FROM saves WHERE player_id = 'p1'").run();
    expect((await putSave('auto', await saveBody('x', 0))).status).toBe(200);
    const listed = await manageSave('GET', '/v1/saves');
    expect(listed.status).toBe(200);
    const { body: listBody } = await expectConforms(listed, 'listSaves');
    expect((listBody as { items: Array<{ slotId: string }> }).items.map((i) => i.slotId)).toEqual(['auto']);
    const deleted = await manageSave('DELETE', '/v1/saves/auto', '&baseRevision=1');
    expect(deleted.status).toBe(200);
    await expectConforms(deleted, 'deleteSave');
    const empty = await manageSave('GET', '/v1/saves');
    expect(empty.status).toBe(200);
    await expectConforms(empty, 'listSaves');
    expect((await putSave('auto', await saveBody('y', 0))).status).toBe(200);
    const cases: Array<[number, string, string, () => Promise<Response>]> = [
      [400, 'INVALID_ARGUMENT', 'listSaves', () => manageSave('GET', '/v1/saves', '', { gameId: 'demo.rpg' })],
      [400, 'INVALID_ARGUMENT', 'deleteSave', () => manageSave('DELETE', '/v1/saves/auto', '&baseRevision=0')],
      [401, 'UNAUTHENTICATED', 'listSaves', () => manageSave('GET', '/v1/saves', '', { authorization: null })],
      [401, 'TOKEN_EXPIRED', 'deleteSave', async () => manageSave('DELETE', '/v1/saves/auto', '&baseRevision=3', { authorization: await bearer('demo-rpg', 'p1', { exp: 1 }) })],
      [403, 'NOT_READY_FOR_PRODUCTION', 'listSaves', () => manageSave('GET', '/v1/saves', '', { e: baseEnv })],
      [403, 'NOT_READY_FOR_PRODUCTION', 'deleteSave', () => manageSave('DELETE', '/v1/saves/auto', '&baseRevision=3', { e: baseEnv })],
      [403, 'PERMISSION_DENIED', 'deleteSave', () => manageSave('DELETE', '/v1/saves/auto', '&baseRevision=3', { gameId: 'other-rpg' })],
      [404, 'NOT_FOUND', 'listSaves', async () => manageSave('GET', '/v1/saves', '', { gameId: 'no-such-game', authorization: await bearer('no-such-game', 'p1') })],
      [404, 'NOT_FOUND', 'deleteSave', () => manageSave('DELETE', '/v1/saves/never-written', '&baseRevision=1')],
      [409, 'SAVE_CONFLICT', 'deleteSave', () => manageSave('DELETE', '/v1/saves/auto', '&baseRevision=1')],
      [409, 'SAVE_CONFLICT', 'putSave', async () => putSave('auto', await saveBody('z', 1))],
      [409, 'SLOT_LIMIT_EXCEEDED', 'putSave', async () => putSave('one-more', await saveBody('x', 0), { authorization: await fillSlots('schema-slots') })],
    ];
    for (const [status, code, operationId, send] of cases) {
      const res = await send();
      expect(res.status, `${operationId} の ${code}`).toBe(status);
      const { spec: r, body: errBody } = await expectConforms(res, operationId);
      const actual = (errBody as { error: { code: string } }).error.code;
      expect(actual).toBe(code);
      expect(r['x-error-codes'], `${operationId} の ${status} の x-error-codes`).toContain(actual);
    }
  });

  it('設定の応答はスキーマに合う', async () => {
    const ok = await get('/v1/config?gameId=demo-rpg&clientVersion=1.0.0');
    expect(ok.status).toBe(200);
    const { spec: r200 } = await expectConforms(ok, 'getConfig');
    expect(r200.headers?.ETag?.required, '200 のスキーマに ETag の見出しがある').toBe(true);
    const etag = ok.headers.get('etag');
    expect(etag).not.toBeNull();
    const cases: Array<[number, string, () => Promise<Response>]> = [
      [400, 'INVALID_ARGUMENT', () => get('/v1/config?gameId=demo.rpg')],
      [400, 'INVALID_ARGUMENT', () => get('/v1/config?gameId=demo-rpg&clientVersion=1.2.3-beta')],
      [404, 'NOT_FOUND', () => get('/v1/config?gameId=no-such-game')],
      [500, 'INTERNAL_ERROR', () => get('/v1/config?gameId=demo-rpg', { ...baseEnv, DB: brokenDB })],
    ];
    for (const [status, code, send] of cases) {
      const res = await send();
      expect(res.status, code).toBe(status);
      const { spec: r, body } = await expectConforms(res, 'getConfig');
      const actual = (body as { error: { code: string } }).error.code;
      expect(actual).toBe(code);
      expect(r['x-error-codes'], `getConfig の ${status} の x-error-codes`).toContain(actual);
    }
    // 304 は本文が無いので expectConforms に通さず、ここで直に見る
    const notModified = await worker.fetch(new Request(`${base}/v1/config?gameId=demo-rpg&clientVersion=1.0.0`, {
      headers: { 'if-none-match': etag! },
    }), baseEnv as never);
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe('');
    const r304 = operation('getConfig').responses['304'];
    expect(r304, 'スキーマに getConfig の 304 がある').toBeDefined();
    expect(r304.content, '304 は本文を持たない').toBeUndefined();
    for (const [name, h] of Object.entries(r304.headers ?? {})) {
      const value = notModified.headers.get(name);
      if (h.required) expect(value, `304 の見出し ${name} がある`).not.toBeNull();
      if (value !== null) expect(validate(value, h.schema, spec), `304 の見出し ${name}`).toEqual([]);
    }
    expect(notModified.headers.get('etag')).toBe(etag);
  });

  it('マスターデータの応答はスキーマに合う', async () => {
    // 専用のゲームにマスターデータを入れる（demo-rpg の設定の応答は変えない）。終わったらゲームの行ごと消す
    await registerGame(baseEnv.DB, 'schema-master', ['config']);
    await baseEnv.DB.prepare('INSERT OR REPLACE INTO config_master_data (game_id, key, data) VALUES (?, ?, ?)')
      .bind('schema-master', 'items', '{"potion":{"price":50}}').run();
    try {
      const config = await get('/v1/config?gameId=schema-master&clientVersion=1.0.0');
      expect(config.status).toBe(200);
      const { body: configBody } = await expectConforms(config, 'getConfig');
      expect((configBody as { masterData?: unknown }).masterData).toEqual([{ key: 'items', size: 23 }]);

      const ok = await get('/v1/config/master/items?gameId=schema-master');
      expect(ok.status).toBe(200);
      const { spec: r200 } = await expectConforms(ok, 'getMasterData');
      expect(r200.headers?.ETag?.required, '200 のスキーマに ETag の見出しがある').toBe(true);
      const etag = ok.headers.get('etag');
      expect(etag).not.toBeNull();

      const cases: Array<[number, string, () => Promise<Response>]> = [
        [400, 'INVALID_ARGUMENT', () => get('/v1/config/master/items?gameId=demo.rpg')],
        [404, 'NOT_FOUND', () => get('/v1/config/master/no-such-key?gameId=schema-master')],
        [404, 'NOT_FOUND', () => get('/v1/config/master/items?gameId=no-such-game')],
        [500, 'INTERNAL_ERROR', () => get('/v1/config/master/items?gameId=schema-master', { ...baseEnv, DB: brokenDB })],
      ];
      for (const [status, code, send] of cases) {
        const res = await send();
        expect(res.status, code).toBe(status);
        const { spec: r, body } = await expectConforms(res, 'getMasterData');
        const actual = (body as { error: { code: string } }).error.code;
        expect(actual).toBe(code);
        expect(r['x-error-codes'], `getMasterData の ${status} の x-error-codes`).toContain(actual);
      }

      // 304 は本文が無いので expectConforms に通さず、ここで直に見る
      const notModified = await worker.fetch(new Request(`${base}/v1/config/master/items?gameId=schema-master`, {
        headers: { 'if-none-match': etag! },
      }), baseEnv as never);
      expect(notModified.status).toBe(304);
      expect(await notModified.text()).toBe('');
      const r304 = operation('getMasterData').responses['304'];
      expect(r304, 'スキーマに getMasterData の 304 がある').toBeDefined();
      expect(r304.content, '304 は本文を持たない').toBeUndefined();
      for (const [name, h] of Object.entries(r304.headers ?? {})) {
        const value = notModified.headers.get(name);
        if (h.required) expect(value, `304 の見出し ${name} がある`).not.toBeNull();
        if (value !== null) expect(validate(value, h.schema, spec), `304 の見出し ${name}`).toEqual([]);
      }
      expect(notModified.headers.get('etag')).toBe(etag);
    } finally {
      await baseEnv.DB.batch([
        baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id = 'schema-master'"),
        baseEnv.DB.prepare("DELETE FROM games WHERE game_id = 'schema-master'"),
      ]);
    }
  });
});
