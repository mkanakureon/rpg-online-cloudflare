/**
 * 設定配信 C2: マスターデータを読む API（GET /v1/config/master/{key}）と、設定の応答のマスターデータの一覧（masterData）の試験。
 * 名前と確かめることの正は docs/guides/working/config-design.md §7 の C2 の行（スキーマ・操作の数・CLI モックの流れの
 * 試験は、同じ表のとおり test/schema-conformance.test.ts と test/failure-server.test.ts に置く）。
 * L2 の試験で、src/worker.ts の default.fetch を直に呼ぶ。マスターデータは専用のゲームに prepare().bind() で入れる
 * （0007 は demo-rpg に手本を入れない。demo-rpg の設定の応答の全体を比べる C1 の試験を変えないため）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_MASTER_DATA_BYTES } from '../src/modules/config/limits';
import { registerGame } from './support/games';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const base = 'http://example.com';

type MasterBody = { gameId: string; key: string; data: string };
type ConfigBody = { gameId: string; masterData?: Array<{ key: string; size: number }> };

const bytes = (text: string) => new TextEncoder().encode(text);

function get(path: string, headers?: Record<string, string>): Promise<Response> {
  return worker.fetch(new Request(base + path, { headers }), baseEnv as never);
}
async function expectError(res: Response, status: number, code: string, message?: string): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = await res.json<{ error: { code: string; message: string } }>();
  expect(body.error.code).toBe(code);
  if (message) expect(body.error.message).toBe(message);
}
/** 専用のゲームを登録し（既定は config つき）、マスターデータを入れる。 */
async function setupMaster(gameId: string, rows: Record<string, string>, modules: string[] = ['config']): Promise<void> {
  await registerGame(baseEnv.DB, gameId, modules);
  const entries = Object.entries(rows);
  if (entries.length === 0) return;
  await baseEnv.DB.batch(entries.map(([key, data]) =>
    baseEnv.DB.prepare('INSERT INTO config_master_data (game_id, key, data) VALUES (?, ?, ?)').bind(gameId, key, data)));
}
function setMaster(gameId: string, key: string, data: string): Promise<D1Result> {
  return baseEnv.DB.prepare('UPDATE config_master_data SET data = ? WHERE game_id = ? AND key = ?').bind(data, gameId, key).run();
}
async function countMaster(gameId: string): Promise<number> {
  const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM config_master_data WHERE game_id = ?').bind(gameId).first<{ n: number }>();
  return row?.n ?? 0;
}

// 試験のゲーム（demo-rpg 以外）を消す。config_master_data は games を ON DELETE CASCADE で指すので一緒に消える
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
});

describe('C2 GET /v1/config/master/{key}', () => {
  it('マスターデータを読むと入れた文字列がそのまま返る', async () => {
    const items = '{"potion":{"price":50}}';
    const odd = "line1\nline2\r\n'quoted' \"double\" 😀 あ \\u0041 {not json";
    await setupMaster('cfg-master', { items, odd });
    for (const [key, data] of [['items', items], ['odd', odd]]) {
      const res = await get(`/v1/config/master/${key}?gameId=cfg-master`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
      const body = await res.json<MasterBody>();
      expect(body).toEqual({ gameId: 'cfg-master', key, data });
      // 送った物と返る物のバイト列が同じ（サーバーは JSON として読み直さない）
      expect([...bytes(body.data)]).toEqual([...bytes(data)]);
    }
  });

  it('マスターデータの応答にはETagが付き同じETagなら304を返す', async () => {
    await setupMaster('cfg-etag', { items: '{"potion":{"price":50}}' });
    const path = '/v1/config/master/items?gameId=cfg-etag';
    const first = await get(path);
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-cache');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);

    const again = await get(path, { 'If-None-Match': etag! });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('etag')).toBe(etag);
    expect(again.headers.get('cache-control')).toBe('no-cache');

    await setMaster('cfg-etag', 'items', '{"potion":{"price":60}}');
    const changed = await get(path, { 'If-None-Match': etag! });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('cache-control')).toBe('no-cache');
    expect((await changed.json<MasterBody>()).data).toBe('{"potion":{"price":60}}');
    expect(changed.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(changed.headers.get('etag')).not.toBe(etag);
  });

  it('無いキーのマスターデータはNOT_FOUNDの404を返す', async () => {
    await expectError(await get('/v1/config/master/no-such-key?gameId=demo-rpg'), 404, 'NOT_FOUND', 'Master data not found');
    await expectError(await get('/v1/config/master/bad.key?gameId=demo-rpg'), 404, 'NOT_FOUND', 'Endpoint not found');
  });

  it('他のゲームのマスターデータは読めない', async () => {
    await setupMaster('other-rpg', { 'secret-table': '{"only":"other"}' });
    expect((await get('/v1/config/master/secret-table?gameId=other-rpg')).status).toBe(200);
    await expectError(await get('/v1/config/master/secret-table?gameId=demo-rpg'), 404, 'NOT_FOUND', 'Master data not found');
  });

  it('configを使わない設定のゲームのマスターデータはNOT_FOUNDの404を返す', async () => {
    await setupMaster('no-config', { items: '{}' }, ['rankings']);
    await expectError(await get('/v1/config/master/items?gameId=no-config'), 404, 'NOT_FOUND', 'Feature not enabled for this game');
  });

  it('上限を超えるマスターデータは表に入らず上限ちょうどは入る', async () => {
    await registerGame(baseEnv.DB, 'cfg-limit', ['config']);
    const insert = (key: string, data: string) =>
      baseEnv.DB.prepare('INSERT INTO config_master_data (game_id, key, data) VALUES (?, ?, ?)').bind('cfg-limit', key, data).run();
    const exactAscii = 'a'.repeat(MAX_MASTER_DATA_BYTES);
    const exactKana = 'あ'.repeat(Math.floor(MAX_MASTER_DATA_BYTES / 3)) + 'a'.repeat(MAX_MASTER_DATA_BYTES % 3);
    expect(bytes(exactKana).length).toBe(MAX_MASTER_DATA_BYTES);
    await insert('exact-ascii', exactAscii);
    await insert('exact-kana', exactKana);
    expect(await countMaster('cfg-limit')).toBe(2);

    // 1 バイト多いもの・文字の数は上限より少なくても UTF-8 で超えるもの（あ は 3 バイト）
    const overKana = 'あ'.repeat(Math.floor(MAX_MASTER_DATA_BYTES / 3) + 1);
    expect(overKana.length).toBeLessThan(MAX_MASTER_DATA_BYTES);
    expect(bytes(overKana).length).toBeGreaterThan(MAX_MASTER_DATA_BYTES);
    for (const [key, data] of [['over-ascii', 'a'.repeat(MAX_MASTER_DATA_BYTES + 1)], ['over-kana-1', exactKana + 'a'], ['over-kana', overKana]]) {
      await expect(insert(key, data), key).rejects.toThrow(/CHECK/);
    }
    expect(await countMaster('cfg-limit')).toBe(2);

    // 上限ちょうどは API で読めて、size も上限ちょうど
    const listed = await (await get('/v1/config?gameId=cfg-limit')).json<ConfigBody>();
    expect(listed.masterData).toEqual([
      { key: 'exact-ascii', size: MAX_MASTER_DATA_BYTES },
      { key: 'exact-kana', size: MAX_MASTER_DATA_BYTES },
    ]);
    expect((await (await get('/v1/config/master/exact-kana?gameId=cfg-limit')).json<MasterBody>()).data).toBe(exactKana);
  });
});

describe('C2 GET /v1/config の masterData', () => {
  it('設定の応答にマスターデータのキーと大きさの一覧が載る', async () => {
    await setupMaster('cfg-list', { weapons: '{"sword":"剣"}', items: '{"potion":{"price":50}}' });
    const res = await get('/v1/config?gameId=cfg-list&clientVersion=1.0.0');
    expect(res.status).toBe(200);
    const body = await res.json<ConfigBody & Record<string, unknown>>();
    expect(body.masterData).toEqual([
      { key: 'items', size: bytes('{"potion":{"price":50}}').length },
      { key: 'weapons', size: bytes('{"sword":"剣"}').length },
    ]);
    // 中身は入らない（一覧はキーと大きさだけ）
    expect(JSON.stringify(body)).not.toContain('potion');
    for (const entry of body.masterData!) expect(Object.keys(entry).sort()).toEqual(['key', 'size']);
  });

  it('マスターデータが変わると設定のETagも変わる', async () => {
    await setupMaster('cfg-size', { items: '{"potion":{"price":50}}' });
    const first = await get('/v1/config?gameId=cfg-size');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect((await get('/v1/config?gameId=cfg-size', { 'If-None-Match': etag! })).status).toBe(304);

    await setMaster('cfg-size', 'items', '{"potion":{"price":500},"ether":{"price":120}}');
    const changed = await get('/v1/config?gameId=cfg-size', { 'If-None-Match': etag! });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect((await changed.json<ConfigBody>()).masterData).toEqual([
      { key: 'items', size: bytes('{"potion":{"price":500},"ether":{"price":120}}').length },
    ]);
  });
});
