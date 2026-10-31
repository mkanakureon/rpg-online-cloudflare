/**
 * 失敗ケースの試験 K2: サーバー側の失敗と互換（ケース 1・5・6・7 の「いま」）。
 * 名前と期待する結果の正は docs/guides/working/failure-case-test-plan.md §3。ただし `CLIモックと同じ流れでゲストのセーブを書いて読み直せる`・
 * `CLIモックと同じ流れでセーブの一覧に出たスロットを消せる` は
 * docs/guides/working/save-design.md §7 が正、`CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る`・
 * `CLIモックと同じ流れで設定に載ったマスターデータを読める` は docs/guides/working/config-design.md §7 が正（互換の試験の隣に置く）。
 * `CLIモックの通しは同点のスコアが上位10件を埋めていても自分の投稿を見つける` は Issue #28（CLI モックは回すたびに別のボードに投稿する）。
 * src/worker.ts の default.fetch を直に呼ぶ L2 の試験。DB の失敗は prepare が投げる偽の DB で起こす。
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { resetRateLimits } from './support/rate-limits';
import { bearerForBody } from './support/auth';
import { registerGame } from './support/games';
import {
  CLI_CLIENT_VERSION, SMOKE_BOARD_ID, SMOKE_EVENT_ID, SMOKE_SLOT_ID, authHeaders, claimPath, configPath, eventsPath, guestRequest, historyPath,
  inventoryPath, masterDataPath, newIdempotencyKey, playerDataHeaders, playerDataPath, playerDataWrite, questClaimPath, questsPath, saveData,
  saveWrite, scoreSubmission, sha256Hex, smokeBoardId, utf8Bytes,
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
  await resetRateLimits(baseEnv.DB);
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

  it('CLIモックと同じ流れで設定に載ったマスターデータを読める', async () => {
    // scripts/cli-mock.mjs の C2 の流れ: 設定の masterData の最初のキーを読み、data のバイト数が一覧の size と同じ。
    // demo-rpg はマスターデータを持たないので、専用のゲームに入れて同じ関数で読む。落ちたら API か CLI モックを直す合図
    await registerGame(baseEnv.DB, 'cli-master', ['config']);
    await baseEnv.DB.batch([
      baseEnv.DB.prepare('INSERT OR REPLACE INTO config_master_data (game_id, key, data) VALUES (?, ?, ?)')
        .bind('cli-master', 'items', '{"potion":{"price":50},"name":"ポーション"}'),
      baseEnv.DB.prepare('INSERT OR REPLACE INTO config_master_data (game_id, key, data) VALUES (?, ?, ?)')
        .bind('cli-master', 'weapons', '{"sword":{"price":300}}'),
    ]);
    try {
      const settings = await worker.fetch(new Request(base + configPath('cli-master')), baseEnv as never);
      expect(settings.status).toBe(200);
      const { masterData } = await settings.json<{ masterData?: Array<{ key: string; size: number }> }>();
      expect(masterData?.map((m) => m.key)).toEqual(['items', 'weapons']);
      const [first] = masterData!;
      const path = masterDataPath(first.key, 'cli-master');
      expect(path).toContain('/v1/config/master/items');
      const res = await worker.fetch(new Request(base + path), baseEnv as never);
      expect(res.status).toBe(200);
      const master = await res.json<{ key: string; data: string }>();
      expect(master.key).toBe(first.key);
      expect(utf8Bytes(master.data)).toBe(first.size);
    } finally {
      await baseEnv.DB.batch([
        baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id = 'cli-master'"),
        baseEnv.DB.prepare("DELETE FROM games WHERE game_id = 'cli-master'"),
      ]);
    }
  });

  it('CLIモックの通しの流れを続けて2回回しても利用制限に掛からない', async () => {
    // scripts/cli-mock.mjs の書き込みの流れ（ゲストの発行 → スコア → セーブの書く・読む・一覧・消す → イベントの報酬 → プレイヤーデータ → クエスト）を、
    // 同じ IP から 2 回続けて回す。
    // 1 つでも 429 になったら利用制限の数（src/core/rate-limit-policy.ts）が CLI モックの使い方より小さい合図
    // （docs/guides/working/abuse-protection-design.md §7）
    const ip = { 'CF-Connecting-IP': '198.51.100.7' };
    const statuses: number[] = [];
    const send = async (path: string, init: RequestInit = {}): Promise<Response> => {
      const res = await worker.fetch(new Request(base + path, init), localEnv as never);
      statuses.push(res.status);
      return res;
    };
    for (let run = 0; run < 2; run++) {
      const guest = await send('/v1/accounts/guest', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...ip }, body: JSON.stringify(guestRequest()),
      });
      const { playerId, token } = await guest.json<{ playerId: string; token: string }>();
      const headers = { ...authHeaders(token), ...ip };
      const submission = scoreSubmission(playerId);
      await send(`/v1/rankings/${SMOKE_BOARD_ID}`, { method: 'POST', headers, body: JSON.stringify(submission) });
      const data = saveData();
      const savePath = `/v1/saves/${SMOKE_SLOT_ID}?gameId=${submission.gameId}`;
      await send(savePath, { method: 'PUT', headers, body: JSON.stringify(saveWrite(data, await sha256Hex(data), 0)) });
      await send(savePath, { headers });
      await send(`/v1/saves?gameId=${submission.gameId}`, { headers });
      await send(`${savePath}&baseRevision=1`, { method: 'DELETE', headers });
      // セーブを消した後のイベントの 6 手順（一覧 → 受け取り → 所持品 → もう一度受け取り → 所持品 → 履歴。報酬の利用制限を 6 回）
      await send(eventsPath(submission.gameId), { headers });
      await send(claimPath(SMOKE_EVENT_ID, submission.gameId), { method: 'POST', headers });
      await send(inventoryPath(submission.gameId), { headers });
      await send(claimPath(SMOKE_EVENT_ID, submission.gameId), { method: 'POST', headers });
      await send(inventoryPath(submission.gameId), { headers });
      await send(historyPath(submission.gameId), { headers });
      // イベントの後のプレイヤーデータの 4 手順（読む → 増やす → 同じ鍵で送り直す → 読み直す。プレイヤーデータの利用制限を 4 回）
      const playerDataUrl = playerDataPath(submission.gameId);
      const writeInit = { method: 'POST', headers: { ...playerDataHeaders(token, newIdempotencyKey()), ...ip }, body: JSON.stringify(playerDataWrite()) };
      await send(playerDataUrl, { headers });
      await send(playerDataUrl, writeInit);
      await send(playerDataUrl, writeInit);
      await send(playerDataUrl, { headers });
      // プレイヤーデータの後のクエストの 4 手順（一覧 → 受け取り → もう一度受け取り → 一覧。クエストの利用制限を 4 回。quest-design.md §12）
      await send(questsPath(submission.gameId), { headers });
      await send(questClaimPath(undefined, submission.gameId), { method: 'POST', headers });
      await send(questClaimPath(undefined, submission.gameId), { method: 'POST', headers });
      await send(questsPath(submission.gameId), { headers });
    }
    expect(statuses).toEqual(Array(40).fill(200));
  });

  it('CLIモックの通しは同点のスコアが上位10件を埋めていても自分の投稿を見つける', async () => {
    // ローカルの D1 に前の回の CLI モックの同点の行がたまった状態を作る（同点は先に記録した行が上。2026-10-30 の観測）。
    // SMOKE_BOARD_ID と、前の回の smokeBoardId のボードの両方を、ほかのプレイヤーの 1200 点の古い行 12 行で埋める
    const now = Date.parse('2026-10-30T12:00:00Z');
    const earlier = smokeBoardId(now - 60_000);
    const boardId = smokeBoardId(now);
    expect(boardId).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    expect(boardId).not.toBe(SMOKE_BOARD_ID);
    expect(boardId).not.toBe(earlier);
    expect(smokeBoardId(now)).toBe(boardId);
    const fill = [SMOKE_BOARD_ID, earlier].flatMap((board) => Array.from({ length: 12 }, (_, i) =>
      baseEnv.DB.prepare(
        "INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score, updated_at) VALUES ('demo-rpg', ?, ?, 'old', 1200, '2000-01-01 00:00:00')",
      ).bind(board, `old-${i}`)));
    await baseEnv.DB.batch(fill);
    // CLI モックと同じ関数で、ゲストを発行して smokeBoardId(now) のボードに送り、limit=10 で読む
    const guest = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestRequest()),
    }), localEnv as never);
    expect(guest.status).toBe(200);
    const { playerId, token } = await guest.json<{ playerId: string; token: string }>();
    const submission = scoreSubmission(playerId);
    const res = await worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(submission),
    }), localEnv as never);
    expect(res.status).toBe(200);
    const list = await items(await get(`/v1/rankings/${boardId}?gameId=${submission.gameId}&limit=10`));
    expect(list.some((e) => e.playerId === submission.playerId && e.score >= submission.score)).toBe(true);
    // 決まったボードに送っていたら見つからない（直す前の落ち方）
    const fixed = await items(await get(`/v1/rankings/${SMOKE_BOARD_ID}?gameId=${submission.gameId}&limit=10`));
    expect(fixed).toHaveLength(10);
    expect(fixed.every((e) => e.playerId.startsWith('old-'))).toBe(true);
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
