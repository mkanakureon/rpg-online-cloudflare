/**
 * 失敗ケースの試験 K1: 入力の検証と他ゲームの分離（ケース 2・3・4 の「いま」）。
 * 名前と期待する結果の正は docs/guides/working/failure-case-test-plan.md §3。
 * src/worker.ts の default.fetch を直に呼ぶ L2 の試験。書き込みだけ APP_ENV=local を渡す。
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { bearer, bearerForBody } from './support/auth';
import { registerGame } from './support/games';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(base + path), baseEnv as never);
}
async function post(boardId: string, body: unknown): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await bearerForBody(body) },
    body: JSON.stringify(body),
  }), localEnv as never);
}
function entry(gameId: string, playerId: string, score: unknown): Record<string, unknown> {
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
async function items(res: Response): Promise<Array<{ playerId: string; score: number }>> {
  expect(res.status).toBe(200);
  return (await res.json<{ items: Array<{ playerId: string; score: number }> }>()).items;
}

// 試験の間で前のデータに頼らない（§2）。マイグレーションの初期データ（welcome）だけ残す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare("DELETE FROM announcements WHERE id <> 'welcome'"),
  ]);
});

describe('ケース 2: 存在しないもの・形の正しくない入力', () => {
  it('存在しないボードのランキングは200と空の一覧を返す', async () => {
    expect((await post('boss-score', entry('demo-rpg', 'p1', 1200))).status).toBe(200);
    const res = await get('/v1/rankings/no-such-board?gameId=demo-rpg');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gameId: 'demo-rpg', boardId: 'no-such-board', items: [] });
  });

  it('ボードIDの形が正しくなければNOT_FOUNDの404を返す', async () => {
    await expectError(await get(`/v1/rankings/${'a'.repeat(65)}?gameId=demo-rpg`), 404, 'NOT_FOUND');
    await expectError(await get('/v1/rankings/boss%20score?gameId=demo-rpg'), 404, 'NOT_FOUND');
  });

  it('gameIdが無いか形が正しくなければINVALID_ARGUMENTの400を返す', async () => {
    for (const query of ['', '?gameId=', '?gameId=demo.rpg']) {
      await expectError(await get(`/v1/rankings/boss-score${query}`), 400, 'INVALID_ARGUMENT');
    }
  });

  it('limitが1から50の外なら400を返す', async () => {
    for (const limit of ['0', '51', '-1', '1.5', 'abc']) {
      await expectError(await get(`/v1/rankings/boss-score?gameId=demo-rpg&limit=${limit}`), 400, 'INVALID_ARGUMENT');
    }
    for (const limit of ['1', '50']) {
      expect((await get(`/v1/rankings/boss-score?gameId=demo-rpg&limit=${limit}`)).status).toBe(200);
    }
  });
});

describe('ケース 3: スコアの範囲と型', () => {
  it('スコアがマイナスなら400を返しランキングに載らない', async () => {
    await expectError(await post('boss-score', entry('demo-rpg', 'minus', -1)), 400, 'INVALID_ARGUMENT');
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list.map((i) => i.playerId)).not.toContain('minus');
  });

  it('スコアが整数でなければ400を返す', async () => {
    const without = { gameId: 'demo-rpg', playerId: 'p1', displayName: 'p1' };
    for (const body of [entry('demo-rpg', 'p1', 1.5), entry('demo-rpg', 'p1', '1200'), entry('demo-rpg', 'p1', null), without]) {
      await expectError(await post('boss-score', body), 400, 'INVALID_ARGUMENT');
    }
    expect(await countRows()).toBe(0);
  });

  it('スコアが10億を超えると400を返す', async () => {
    await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1000000001)), 400, 'INVALID_ARGUMENT');
    // 9007199254740993 は JSON.stringify では表せない（Number で丸まる）ので、本文を文字で書く
    const unsafe = await worker.fetch(new Request(`${base}/v1/rankings/boss-score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: await bearer('demo-rpg', 'p1') },
      body: '{"gameId":"demo-rpg","playerId":"p1","displayName":"p1","score":9007199254740993}',
    }), localEnv as never);
    await expectError(unsafe, 400, 'INVALID_ARGUMENT');
    expect(await countRows()).toBe(0);
  });

  it('スコアが0と10億ちょうどなら受け付ける', async () => {
    for (const [playerId, score] of [['zero', 0], ['max', 1000000000]] as const) {
      const res = await post('boss-score', entry('demo-rpg', playerId, score));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true });
    }
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ playerId: 'zero', score: 0 }),
      expect.objectContaining({ playerId: 'max', score: 1000000000 }),
    ]));
  });
});

describe('ケース 4: 他ゲームの分離', () => {
  // other-rpg へ書き込むので、開始状態として登録しておく（core-foundation-design.md §5）
  beforeEach(async () => {
    await registerGame(baseEnv.DB, 'other-rpg');
  });

  it('他のゲームのランキングは返さない', async () => {
    expect((await post('boss-score', entry('demo-rpg', 'demo-player', 100))).status).toBe(200);
    expect((await post('boss-score', entry('other-rpg', 'other-player', 999))).status).toBe(200);
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list.map((i) => i.playerId)).toEqual(['demo-player']);
  });

  it('他のゲームのお知らせは返さない', async () => {
    await baseEnv.DB.prepare('INSERT INTO announcements (id, game_id, title, body) VALUES (?, ?, ?, ?)')
      .bind('other-news', 'other-rpg', '他のゲーム', '混ざってはいけないお知らせ').run();
    const res = await get('/v1/announcements?gameId=demo-rpg');
    expect(res.status).toBe(200);
    const body = await res.json<{ items: Array<{ id: string }> }>();
    expect(body.items.map((i) => i.id)).toEqual(['welcome']);
  });

  it('SQLを混ぜたgameIdはINVALID_ARGUMENTの400を返す', async () => {
    expect((await post('boss-score', entry('other-rpg', 'other-player', 999))).status).toBe(200);
    const injected = "demo-rpg' OR '1'='1";
    const res = await get(`/v1/rankings/boss-score?gameId=${encodeURIComponent(injected)}`);
    await expectError(res, 400, 'INVALID_ARGUMENT');
    await expectError(await post('boss-score', entry(injected, 'p1', 1200)), 400, 'INVALID_ARGUMENT');
    expect(await countRows()).toBe(1);
  });

  it('同じプレイヤーIDでも他のゲームの記録は書き換えない', async () => {
    expect((await post('boss-score', entry('demo-rpg', 'p1', 1200))).status).toBe(200);
    expect((await post('boss-score', entry('other-rpg', 'p1', 5000))).status).toBe(200);
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual([expect.objectContaining({ playerId: 'p1', score: 1200 })]);
  });
});
