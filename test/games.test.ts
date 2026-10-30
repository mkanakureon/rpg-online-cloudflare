/**
 * 共通 API の土台 M2: ゲームの登録と、登録の無いゲームを 404 NOT_FOUND で断ること。
 * 名前と確かめることの正は docs/guides/working/core-foundation-design.md §4 の M2。
 * L2 の試験は src/worker.ts の default.fetch を直に呼ぶ。書き込みだけ APP_ENV=local を渡す。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { resetRateLimits } from './support/rate-limits';
import { bearerForBody } from './support/auth';
import specJson from '../openapi/rpg-online.v1.json';
import { registerGame } from './support/games';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

type ResponseSpec = { 'x-error-codes'?: string[]; content?: Record<string, { schema: Schema }> };
type Spec = SchemaRoot & { paths: Record<string, Record<string, { responses: Record<string, ResponseSpec> }>> };
const spec = specJson as unknown as Spec;

// prepare が D1 のエラーに似た例外を投げる偽の DB（登録を引けば 500 になる）
const brokenDB = {
  prepare(): never { throw new Error('D1_ERROR: SQLITE_ERROR: no such table: games'); },
};

function get(path: string, e: unknown = baseEnv): Promise<Response> {
  return worker.fetch(new Request(base + path), e as never);
}
async function post(boardId: string, body: unknown, e: unknown = localEnv): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await bearerForBody(body) },
    body: JSON.stringify(body),
  }), e as never);
}
function entry(gameId: string, playerId: string, score: number): Record<string, unknown> {
  return { gameId, playerId, displayName: playerId, score };
}
async function countRows(): Promise<number> {
  const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM ranking_entries').first<{ n: number }>();
  return row?.n ?? 0;
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json<{ error: { code: string; message: string } }>();
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）と welcome だけ残す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare("DELETE FROM announcements WHERE id <> 'welcome'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
});

describe('M2: 登録の無いゲームを断る', () => {
  it('登録の無いゲームのランキングはNOT_FOUNDの404を返す', async () => {
    await expectError(await get('/v1/rankings/boss-score?gameId=no-such-game'), 404, 'NOT_FOUND');
  });

  it('登録の無いゲームのお知らせはNOT_FOUNDの404を返す', async () => {
    await expectError(await get('/v1/announcements?gameId=no-such-game'), 404, 'NOT_FOUND');
  });

  it('登録の無いゲームへのスコアの投稿はNOT_FOUNDの404を返し記録しない', async () => {
    await expectError(await post('boss-score', entry('no-such-game', 'p1', 1200)), 404, 'NOT_FOUND');
    expect(await countRows()).toBe(0);
  });

  it('本番の設定では登録の無いゲームへの投稿もNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await expectError(await post('boss-score', entry('no-such-game', 'p1', 1200), baseEnv), 403, 'NOT_READY_FOR_PRODUCTION');
    expect(await countRows()).toBe(0);
  });

  it('形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す', async () => {
    const broken = { ...baseEnv, DB: brokenDB };
    await expectError(await get('/v1/announcements?gameId=demo.rpg', broken), 400, 'INVALID_ARGUMENT');
    await expectError(await get('/v1/rankings/boss-score?gameId=demo.rpg', broken), 400, 'INVALID_ARGUMENT');
    await expectError(await post('boss-score', entry('demo.rpg', 'p1', 1200), { ...localEnv, DB: brokenDB }), 400, 'INVALID_ARGUMENT');
  });

  it('登録の無いゲームのNOT_FOUNDの応答はスキーマに合う', async () => {
    const cases: Array<[string, string, () => Promise<Response>]> = [
      ['/v1/announcements', 'get', () => get('/v1/announcements?gameId=no-such-game')],
      ['/v1/rankings/{boardId}', 'get', () => get('/v1/rankings/boss-score?gameId=no-such-game')],
      ['/v1/rankings/{boardId}', 'post', () => post('boss-score', entry('no-such-game', 'p1', 1200))],
    ];
    for (const [path, method, send] of cases) {
      const res = await send();
      expect(res.status, `${method} ${path}`).toBe(404);
      const r = spec.paths[path][method].responses['404'];
      expect(r, `${method} ${path} の 404 がスキーマにある`).toBeDefined();
      expect(r['x-error-codes'], `${method} ${path} の x-error-codes`).toContain('NOT_FOUND');
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = await res.json<{ error: { code: string } }>();
      expect(validate(body, r.content!['application/json'].schema, spec), `${method} ${path} の本文`).toEqual([]);
      expect(body.error.code).toBe('NOT_FOUND');
    }
  });
});

describe('M2: 登録したゲーム', () => {
  it('登録したゲームならデータが無くてもランキングは200と空の一覧を返す', async () => {
    await registerGame(baseEnv.DB, 'empty-rpg');
    const res = await get('/v1/rankings/boss-score?gameId=empty-rpg');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gameId: 'empty-rpg', boardId: 'boss-score', items: [] });
  });

  it('登録したゲームならデータが無くてもお知らせは200と空の一覧を返す', async () => {
    await registerGame(baseEnv.DB, 'empty-rpg');
    const res = await get('/v1/announcements?gameId=empty-rpg');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gameId: 'empty-rpg', items: [] });
  });

  it('マイグレーションを当てるとdemo-rpgが登録済みになる', async () => {
    const rows = await baseEnv.DB.prepare('SELECT game_id FROM games WHERE game_id = ?').bind('demo-rpg').all<{ game_id: string }>();
    expect(rows.results).toEqual([{ game_id: 'demo-rpg' }]);
  });
});
