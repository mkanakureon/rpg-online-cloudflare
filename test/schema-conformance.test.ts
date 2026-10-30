/**
 * API スキーマの試験 S1: スキーマのファイル（openapi/rpg-online.v1.json）の形と、実際の応答がスキーマに合うこと。
 * 名前と確かめることの正は docs/guides/working/api-schema-design.md §4。挙動（状態コード・データ）は
 * test/failure-*.test.ts が見る。ここはスキーマの側から見る。
 * L2 の試験は src/worker.ts の default.fetch を直に呼ぶ（docs/guides/working/failure-case-test-plan.md §2）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-24
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import specJson from '../openapi/rpg-online.v1.json';
import { resolveRef, validate, type Schema, type SchemaRoot } from './support/schema-check';

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
const errorCodes = ['INVALID_ARGUMENT', 'NOT_FOUND', 'NOT_READY_FOR_PRODUCTION', 'INVALID_JSON', 'INTERNAL_ERROR'];

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
function postRaw(boardId: string, body: string, e: unknown = localEnv): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }), e as never);
}
function post(boardId: string, body: unknown, e: unknown = localEnv): Promise<Response> {
  return postRaw(boardId, JSON.stringify(body), e);
}
function postGuestRaw(body: string, e: unknown = localEnv): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/accounts/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }), e as never);
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
});

describe('S1: スキーマのファイル', () => {
  it('スキーマのファイルはOpenAPI 3.1で5つの操作を持つ', () => {
    expect(spec.openapi).toMatch(/^3\.1\.\d+$/);
    expect(operations().map((o) => o.operationId).sort())
      .toEqual(['getHealth', 'getRanking', 'issueGuest', 'listAnnouncements', 'submitScore']);
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

  it('スキーマのErrorCodeの列挙は5つのエラーコードと一致する', () => {
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
    ];
    const seen = new Set<string>();
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
});
