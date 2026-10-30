/**
 * 失敗ケースの試験 K2: サーバー側の失敗と互換（ケース 1・5・6・7 の「いま」）。
 * 名前と期待する結果の正は docs/guides/working/failure-case-test-plan.md §3。ただし `CLIモックと同じ流れでゲストのセーブを書いて読み直せる`・
 * `CLIモックと同じ流れでセーブの一覧に出たスロットを消せる` は
 * docs/guides/working/save-design.md §7 が正、`CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る` は
 * docs/guides/working/config-design.md §7 が正（互換の試験の隣に置く）。
 * src/worker.ts の default.fetch を直に呼ぶ L2 の試験。DB の失敗は prepare が投げる偽の DB で起こす。
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { bearerForBody } from './support/auth';
import {
  CLI_CLIENT_VERSION, SMOKE_BOARD_ID, SMOKE_SLOT_ID, authHeaders, configPath, guestRequest, saveData, saveWrite, scoreSubmission, sha256Hex,
} from '../scripts/cli-requests.mjs';

type Migration = { name: string; queries: string[] };
type TestEnv = { DB: D1Database; APP_ENV: string; TEST_MIGRATIONS: Migration[] };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

// prepare が D1 のエラーに似た例外を投げる偽の DB（本物の D1 を壊さない。§2）
const brokenDB = {
  prepare(): never { throw new Error('D1_ERROR: SQLITE_ERROR: no such table: ranking_entries'); },
};

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
function entry(gameId: string, playerId: string, score: unknown): Record<string, unknown> {
  return { gameId, playerId, displayName: playerId, score };
}
async function countRows(): Promise<number> {
  const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM ranking_entries').first<{ n: number }>();
  return row?.n ?? 0;
}
async function items(res: Response): Promise<Array<{ playerId: string; displayName: string; score: number }>> {
  expect(res.status).toBe(200);
  return (await res.json<{ items: Array<{ playerId: string; displayName: string; score: number }> }>()).items;
}
async function expectInternalError(res: Response): Promise<void> {
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  expect(text).not.toMatch(/SQLITE|D1_ERROR|ranking_entries|no such table/);
}

// 試験の間で前のデータに頼らない（§2）。マイグレーションの初期データ（welcome）だけ残す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare("DELETE FROM announcements WHERE id <> 'welcome'"),
  ]);
});

describe('ケース 1: サーバー側の失敗', () => {
  it('DBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない', async () => {
    await expectInternalError(await get('/v1/rankings/boss-score?gameId=demo-rpg', { ...baseEnv, DB: brokenDB }));
  });

  it('書き込みでDBが失敗してもINTERNAL_ERRORの500を返す', async () => {
    await expectInternalError(await post('boss-score', entry('demo-rpg', 'p1', 1200), { ...localEnv, DB: brokenDB }));
  });

  it('途中で切れたJSONの本文はINVALID_JSONの400を返す', async () => {
    const res = await postRaw('boss-score', '{"gameId":"demo-rpg","sco');
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('INVALID_JSON');
    expect(await countRows()).toBe(0);
  });
});

describe('ケース 5: 二重送信と連投', () => {
  it('同じスコアを二重送信しても行は1つで結果は同じ', async () => {
    const first = await post('boss-score', entry('demo-rpg', 'p1', 1200));
    const second = await post('boss-score', entry('demo-rpg', 'p1', 1200));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual([expect.objectContaining({ playerId: 'p1', score: 1200 })]);
  });

  it('低いスコアを後から送っても最高スコアが残る', async () => {
    expect((await post('boss-score', entry('demo-rpg', 'p1', 1200))).status).toBe(200);
    expect((await post('boss-score', entry('demo-rpg', 'p1', 800))).status).toBe(200);
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual([expect.objectContaining({ playerId: 'p1', score: 1200 })]);
  });

  it('同じプレイヤーが並べて連投しても最高スコアだけが残る', async () => {
    const scores = Array.from({ length: 20 }, (_, i) => i + 1);
    const responses = await Promise.all(scores.map((score) => post('boss-score', entry('demo-rpg', 'p1', score))));
    expect(responses.map((r) => r.status)).toEqual(scores.map(() => 200));
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual([expect.objectContaining({ playerId: 'p1', score: 20 })]);
  });
});

describe('ケース 6: 時刻', () => {
  it('クライアントが送った時刻の欄は無視しサーバーの時刻で記録する', async () => {
    const before = Date.now();
    const res = await post('boss-score', { ...entry('demo-rpg', 'p1', 1200), submittedAt: '2099-01-01T00:00:00Z' });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(['boardId', 'gameId', 'ok', 'playerId']);
    const row = await baseEnv.DB.prepare('SELECT updated_at FROM ranking_entries WHERE player_id = ?')
      .bind('p1').first<{ updated_at: string }>();
    // datetime('now') は UTC の 'YYYY-MM-DD HH:MM:SS'（秒まで）
    expect(row?.updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row?.updated_at.startsWith('2099')).toBe(false);
    const recorded = Date.parse(`${row?.updated_at.replace(' ', 'T')}Z`);
    expect(Math.abs(recorded - before)).toBeLessThan(5 * 60 * 1000);
  });

  it('同点なら先に記録した人が上に並ぶ', async () => {
    const insert = 'INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score, updated_at) VALUES (?, ?, ?, ?, ?, ?)';
    // ID の順（p1 が先）と時刻の順（p2 が先）を逆にする
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(insert).bind('demo-rpg', 'boss-score', 'p1', 'p1', 1000, '2026-01-02 00:00:00'),
      baseEnv.DB.prepare(insert).bind('demo-rpg', 'boss-score', 'p2', 'p2', 1000, '2026-01-01 00:00:00'),
    ]);
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list.map((i) => i.playerId)).toEqual(['p2', 'p1']);
  });
});

describe('ケース 7: マイグレーションと互換', () => {
  it('マイグレーションを2回当ててもデータは壊れない', async () => {
    expect((await post('boss-score', entry('demo-rpg', 'p1', 1200))).status).toBe(200);
    // applyD1Migrations の 2 回目は当てた記録を見て飛ばすので、SQL を直にもう一度流す
    expect(baseEnv.TEST_MIGRATIONS.length).toBeGreaterThan(0);
    for (const migration of baseEnv.TEST_MIGRATIONS) {
      await baseEnv.DB.batch(migration.queries.map((q) => baseEnv.DB.prepare(q)));
    }
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual([expect.objectContaining({ playerId: 'p1', score: 1200 })]);
    const news = await get('/v1/announcements?gameId=demo-rpg');
    expect(news.status).toBe(200);
    expect((await news.json<{ items: Array<{ id: string }> }>()).items.map((i) => i.id)).toEqual(['welcome']);
  });

  it('今のCLIモックと同じ形の要求を受け付ける', async () => {
    // scripts/cli-mock.mjs と同じ流れ（scripts/cli-requests.mjs で共有）: ゲストを発行し、そのトークンを付けて送る。
    // 落ちたら API か CLI モックを直す合図
    const guest = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestRequest()),
    }), localEnv as never);
    expect(guest.status).toBe(200);
    const { playerId, token } = await guest.json<{ playerId: string; token: string }>();
    const body = scoreSubmission(playerId);
    const res = await worker.fetch(new Request(`${base}/v1/rankings/${SMOKE_BOARD_ID}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body),
    }), localEnv as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const list = await items(await get(`/v1/rankings/${SMOKE_BOARD_ID}?gameId=${body.gameId}&limit=10`));
    expect(list).toEqual([{ playerId: body.playerId, displayName: body.displayName, score: body.score }]);
  });

  it('CLIモックと同じ流れでゲストのセーブを書いて読み直せる', async () => {
    // scripts/cli-mock.mjs のセーブの流れ（scripts/cli-requests.mjs で共有）: ゲストを発行し、そのトークンで PUT → GET。
    // 落ちたら API か CLI モックを直す合図
    const guest = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestRequest()),
    }), localEnv as never);
    expect(guest.status).toBe(200);
    const { gameId, token } = await guest.json<{ gameId: string; token: string }>();
    const data = saveData();
    const checksum = await sha256Hex(data);
    const path = `${base}/v1/saves/${SMOKE_SLOT_ID}?gameId=${gameId}`;
    const put = await worker.fetch(new Request(path, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(saveWrite(data, checksum, 0)),
    }), localEnv as never);
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ gameId, slotId: SMOKE_SLOT_ID, revision: 1, checksum });
    const got = await worker.fetch(new Request(path, { headers: authHeaders(token) }), localEnv as never);
    expect(got.status).toBe(200);
    expect(await got.json()).toMatchObject({ data, checksum, revision: 1 });
  });

  it('CLIモックと同じ流れでセーブの一覧に出たスロットを消せる', async () => {
    // scripts/cli-mock.mjs の V2 の流れ: ゲストを発行して PUT した後、一覧 → 読んだリビジョンで DELETE → GET が 404。
    // 落ちたら API か CLI モックを直す合図
    const guest = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestRequest()),
    }), localEnv as never);
    expect(guest.status).toBe(200);
    const { gameId, token } = await guest.json<{ gameId: string; token: string }>();
    const data = saveData();
    const path = `${base}/v1/saves/${SMOKE_SLOT_ID}?gameId=${gameId}`;
    const put = await worker.fetch(new Request(path, {
      method: 'PUT',
      headers: authHeaders(token),
      body: JSON.stringify(saveWrite(data, await sha256Hex(data), 0)),
    }), localEnv as never);
    expect(put.status).toBe(200);
    const listed = await worker.fetch(new Request(`${base}/v1/saves?gameId=${gameId}`, { headers: authHeaders(token) }), localEnv as never);
    expect(listed.status).toBe(200);
    const { items } = await listed.json<{ items: Array<{ slotId: string; revision: number }> }>();
    const slot = items.find((item) => item.slotId === SMOKE_SLOT_ID);
    expect(slot).toBeDefined();
    const deleted = await worker.fetch(new Request(`${path}&baseRevision=${slot!.revision}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    }), localEnv as never);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true, gameId, slotId: SMOKE_SLOT_ID });
    const got = await worker.fetch(new Request(path, { headers: authHeaders(token) }), localEnv as never);
    expect(got.status).toBe(404);
  });

  it('CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る', async () => {
    // scripts/cli-mock.mjs の C1 の流れ: トークン無しで設定を読み、etag を If-None-Match に付けてもう一度読むと 304。
    // 落ちたら API か CLI モックを直す合図
    const path = configPath();
    expect(path).toContain(`clientVersion=${CLI_CLIENT_VERSION}`);
    const first = await worker.fetch(new Request(base + path), baseEnv as never);
    expect(first.status).toBe(200);
    const body = await first.json<{ clientVersion: { update: string } }>();
    expect(body.clientVersion.update).not.toBe('required');
    const etag = first.headers.get('etag');
    expect(etag).not.toBeNull();
    const again = await worker.fetch(new Request(base + path, { headers: { 'If-None-Match': etag! } }), baseEnv as never);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
  });

  it('知らない欄が付いた要求も受け付ける', async () => {
    const res = await post('boss-score', { ...entry('demo-rpg', 'p1', 1200), clientVersion: '0.0.1', extra: {} });
    expect(res.status).toBe(200);
    const row = await baseEnv.DB.prepare('SELECT * FROM ranking_entries WHERE player_id = ?')
      .bind('p1').first<Record<string, unknown>>();
    expect(Object.keys(row ?? {}).sort()).toEqual(['board_id', 'display_name', 'game_id', 'player_id', 'score', 'updated_at']);
    expect(JSON.stringify(row)).not.toMatch(/0\.0\.1|clientVersion|extra/);
    const list = await items(await get('/v1/rankings/boss-score?gameId=demo-rpg'));
    expect(list).toEqual([{ playerId: 'p1', displayName: 'p1', score: 1200 }]);
  });
});
