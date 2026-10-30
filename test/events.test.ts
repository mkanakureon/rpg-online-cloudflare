/**
 * イベント E2: イベントの一覧（GET /v1/events）と報酬の受け取り（POST /v1/events/{eventId}/claim）と、期間と区切りの関数の試験。
 * 名前と期待する結果の正は docs/guides/working/event-reward-design.md §8 の E2 の行（エラーコードの数・スキーマの操作の数・
 * モジュールの一覧・demo-rpg の設定の 4 本は test/schema-conformance.test.ts・test/modules.test.ts・test/game-modules.test.ts）。
 * L1 は period.ts の関数に固定の now を渡して確かめる。L2 は src/worker.ts の default.fetch を直に呼び、APP_ENV=local を渡す。
 * 試験のゲームは専用の evt-game（beforeEach で登録と品目の行を入れ、イベントは試験ごとにいまの時刻の前後に置く）。
 * demo-rpg の手本のイベント（daily-login）は CLI の流れの試験だけが使う。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_ITEM_AMOUNT } from '../src/core/inventory';
import { isOpen, nextResetAt, periodKey } from '../src/modules/events/period';
import specJson from '../openapi/rpg-online.v1.json';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { countRateLimitRows, resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';
import {
  SMOKE_EVENT_ID, authHeaders, claimPath, eventsPath, guestRequest, historyPath, inventoryPath,
} from '../scripts/cli-requests.mjs';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';
const game = 'evt-game';

type Grant = { itemId: string; amount: number };
type EventItem = { eventId: string; kind: string; startsAt: string; endsAt: string; periodKey: string; nextResetAt?: string;
  rewards: Grant[]; claimed: boolean };
type ListBody = { gameId: string; serverTime: string; items: EventItem[] };
type ClaimBody = { gameId: string; eventId: string; periodKey: string; claimId: string; claimedAt: string; grants: Grant[] };
type InventoryBody = { gameId: string; currencies: Grant[]; items: Grant[] };
type HistoryBody = { gameId: string; items: Array<{ itemId: string; delta: number; sourceType: string; sourceId: string }> };
type ErrorBody = { error: { code: string; message: string } };
type Who = { gameId?: string; playerId?: string; authorization?: string | null; e?: unknown; headers?: Record<string, string>;
  body?: string; query?: string };

type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type Spec = SchemaRoot & { paths: Record<string, Record<string, { operationId: string; responses: Record<string, ResponseSpec> }>> };
const spec = specJson as unknown as Spec;

const nowSeconds = () => Math.floor(Date.now() / 1000);
const utc = (iso: string) => Date.parse(iso) / 1000;

async function send(method: 'GET' | 'POST', path: string, who: Who = {}): Promise<Response> {
  const gameId = who.gameId ?? game;
  const headers: Record<string, string> = { ...who.headers };
  const authorization = who.authorization === undefined ? await bearer(gameId, who.playerId ?? 'p1') : who.authorization;
  if (authorization !== null) headers.authorization = authorization;
  const url = `${base}${path}?gameId=${gameId}${who.query ?? ''}`;
  return worker.fetch(new Request(url, { method, headers, body: who.body }), (who.e ?? localEnv) as never);
}
const list = (who: Who = {}) => send('GET', '/v1/events', who);
const claim = (eventId: string, who: Who = {}) => send('POST', `/v1/events/${eventId}/claim`, who);
const getInventory = (who: Who = {}) => send('GET', '/v1/inventory', who);
const getHistory = (who: Who = {}) => send('GET', '/v1/inventory/history', who);

/** イベントと報酬の行を入れる（品目は beforeEach で入れた gold・potion）。 */
async function addEvent(eventId: string, kind: 'once' | 'daily' | 'weekly', startsAt: number, endsAt: number,
  rewards: Array<[string, number]> = [['gold', 100]], offsetMinutes = 0): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('INSERT INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(game, eventId, kind, startsAt, endsAt, offsetMinutes),
    ...rewards.map(([itemId, amount]) => baseEnv.DB.prepare('INSERT INTO event_rewards (game_id, event_id, item_id, amount) VALUES (?, ?, ?, ?)')
      .bind(game, eventId, itemId, amount)),
  ]);
}
/** 開いている（いまの 1 時間前から 1 日後まで）イベント。 */
const addOpen = (eventId: string, kind: 'once' | 'daily' | 'weekly' = 'daily', rewards?: Array<[string, number]>) =>
  addEvent(eventId, kind, nowSeconds() - 3600, nowSeconds() + 86400, rewards);
async function count(table: 'event_claims' | 'inventory_ledger' | 'inventory_balances'): Promise<number> {
  const row = await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`).bind(game).first<{ n: number }>();
  return row?.n ?? 0;
}
async function balance(playerId: string, itemId: string): Promise<number | null> {
  const row = await baseEnv.DB.prepare('SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?')
    .bind(game, playerId, itemId).first<{ amount: number }>();
  return row?.amount ?? null;
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
/** 応答をスキーマの操作の状態の形に当てる（test/schema-conformance.test.ts の expectConforms と同じ見方）。 */
async function expectConforms(res: Response, path: string, method: 'get' | 'post'): Promise<{ spec: ResponseSpec; body: unknown }> {
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
  return { spec: r, body };
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）の品目とイベントだけ残す。
// 報酬が品目を外部キーで指すので、受け取り・残高・履歴 → イベント（報酬は CASCADE）→ 品目 → 機能の設定 → ゲームの順に消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM event_claims'),
    baseEnv.DB.prepare('DELETE FROM inventory_ledger'),
    baseEnv.DB.prepare('DELETE FROM inventory_balances'),
    baseEnv.DB.prepare("DELETE FROM events WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM inventory_items WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
  await registerGame(baseEnv.DB, game, ['inventory', 'events']);
  const item = baseEnv.DB.prepare('INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, ?, ?)');
  await baseEnv.DB.batch([item.bind(game, 'gold', 'currency'), item.bind(game, 'potion', 'item')]);
});

describe('E2 期間と区切りの関数', () => {
  // §4 の例の now（2026-10-30T15:30:00Z。金曜）
  const friday = utc('2026-10-30T15:30:00Z');
  const far = utc('2100-01-01T00:00:00Z');

  it('イベントの期間は始まりを含み終わりを含まない', () => {
    expect([99, 100, 199, 200].map((now) => isOpen(100, 200, now))).toEqual([false, true, true, false]);
  });

  it('デイリーの区切りはイベントの時差の0時で変わる', () => {
    expect(periodKey('daily', friday, 0)).toBe('2026-10-30');
    expect(periodKey('daily', friday, 540)).toBe('2026-10-31');
  });

  it('週間の区切りは月曜の0時で変わる', () => {
    expect(periodKey('weekly', friday, 0)).toBe('2026-10-26');
    expect(periodKey('weekly', utc('2026-11-01T23:59:59Z'), 0)).toBe('2026-10-26');
    expect(periodKey('weekly', utc('2026-11-01T15:00:00Z'), 540)).toBe('2026-11-02');
  });

  it('一度きりのイベントの区切りはイベントの期間の全体', () => {
    expect(periodKey('once', friday, 0)).toBe('once');
    expect(periodKey('once', friday + 30 * 86400, 540)).toBe('once');
  });

  it('次の区切りの時刻はイベントの終わりを越えない', () => {
    expect(nextResetAt('daily', friday, 0, far)).toBe(utc('2026-10-31T00:00:00Z'));
    expect(nextResetAt('daily', friday, 540, far)).toBe(utc('2026-10-31T15:00:00Z'));
    expect(nextResetAt('weekly', friday, 0, far)).toBe(utc('2026-11-02T00:00:00Z'));
    expect(nextResetAt('weekly', utc('2026-11-01T23:59:59Z'), 0, far)).toBe(utc('2026-11-02T00:00:00Z'));
    expect(nextResetAt('weekly', utc('2026-11-01T15:00:00Z'), 540, far)).toBe(utc('2026-11-08T15:00:00Z'));
    // 終わりが次の 0 時より前なら終わりの時刻
    const endsAt = utc('2026-10-30T20:00:00Z');
    expect(nextResetAt('daily', friday, 0, endsAt)).toBe(endsAt);
    expect(nextResetAt('weekly', friday, 0, endsAt)).toBe(endsAt);
    expect(nextResetAt('once', friday, 0, far)).toBeNull();
  });
});

describe('E2 イベントの一覧', () => {
  it('開いているイベントの一覧はサーバーの時刻とそのプレイヤーの受け取り済みかを返す', async () => {
    await addOpen('e-a', 'once', [['gold', 100], ['potion', 2]]);
    await addOpen('e-b', 'daily');
    // p1 は e-a を受け取り済み（一度きりなので区切りは 'once'）。p2 の e-b の受け取りは p1 に数えない
    await baseEnv.DB.batch([
      baseEnv.DB.prepare("INSERT INTO event_claims (game_id, player_id, event_id, period_key, claim_id, claimed_at) VALUES (?, 'p1', 'e-a', 'once', 'c-1', ?)")
        .bind(game, nowSeconds()),
      baseEnv.DB.prepare("INSERT INTO event_claims (game_id, player_id, event_id, period_key, claim_id, claimed_at) VALUES (?, 'p2', 'e-b', ?, 'c-2', ?)")
        .bind(game, periodKey('daily', nowSeconds(), 0), nowSeconds()),
    ]);
    const before = Date.now();
    const res = await list({ playerId: 'p1' });
    expect(res.status).toBe(200);
    const body = await res.json<ListBody>();
    expect(body.gameId).toBe(game);
    expect(Math.abs(Date.parse(body.serverTime) - before)).toBeLessThanOrEqual(5000);
    expect(body.items.map((i) => [i.eventId, i.claimed])).toEqual([['e-a', true], ['e-b', false]]);
    expect(body.items[0]).toMatchObject({ kind: 'once', periodKey: 'once', rewards: [{ itemId: 'gold', amount: 100 }, { itemId: 'potion', amount: 2 }] });
    expect('nextResetAt' in body.items[0]).toBe(false);
    expect(body.items[1].periodKey).toBe(body.serverTime.slice(0, 10));
    expect(body.items[1].nextResetAt).toBe(`${new Date(Date.parse(body.serverTime) + 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
  });

  it('期間の外のイベントは一覧に出ない', async () => {
    const now = nowSeconds();
    await addEvent('ended', 'daily', now - 86400, now - 1);
    await addEvent('future', 'daily', now + 3600, now + 86400);
    await addOpen('open-now');
    const res = await list();
    expect(res.status).toBe(200);
    expect((await res.json<ListBody>()).items.map((i) => i.eventId)).toEqual(['open-now']);
  });
});

describe('E2 報酬の受け取り', () => {
  it('報酬を受け取ると所持品が増え受領の履歴に残る', async () => {
    await addOpen('login', 'daily', [['gold', 100], ['potion', 2]]);
    const res = await claim('login');
    expect(res.status).toBe(200);
    const body = await res.json<ClaimBody>();
    expect(body).toMatchObject({ gameId: game, eventId: 'login', grants: [{ itemId: 'gold', amount: 100 }, { itemId: 'potion', amount: 2 }] });
    expect(body.claimId).not.toBe('');
    const inventory = await (await getInventory()).json<InventoryBody>();
    expect(inventory).toEqual({ gameId: game, currencies: [{ itemId: 'gold', amount: 100 }], items: [{ itemId: 'potion', amount: 2 }] });
    const history = await (await getHistory()).json<HistoryBody>();
    expect(history.items).toHaveLength(2);
    for (const row of history.items) expect(row).toMatchObject({ sourceType: 'event-claim', sourceId: body.claimId });
    // 残高と履歴の合計が同じ（どちらも 1 つの batch で書く）
    const sums = await baseEnv.DB.prepare(`SELECT l.item_id AS itemId, SUM(l.delta) AS total, b.amount AS amount FROM inventory_ledger l
      JOIN inventory_balances b ON b.game_id = l.game_id AND b.player_id = l.player_id AND b.item_id = l.item_id
      WHERE l.game_id = ? AND l.player_id = 'p1' GROUP BY l.item_id, b.amount`).bind(game).all<{ itemId: string; total: number; amount: number }>();
    expect(sums.results).toHaveLength(2);
    for (const s of sums.results) expect(s.total, s.itemId).toBe(s.amount);
  });

  it('同じ期間の報酬を二重に受け取っても所持品は1回分で同じ本文を返す', async () => {
    await addOpen('login', 'daily', [['gold', 100], ['potion', 2]]);
    const first = await claim('login');
    const second = await claim('login');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = await first.json<ClaimBody>();
    expect(await second.json<ClaimBody>()).toEqual(a);
    expect(await balance('p1', 'gold')).toBe(100);
    expect(await balance('p1', 'potion')).toBe(2);
    expect(await count('inventory_ledger')).toBe(2);
    expect(await count('event_claims')).toBe(1);
  });

  it('同じ期間の受け取りを並べて送っても付与は1回分', async () => {
    await addOpen('login');
    const responses = await Promise.all(Array.from({ length: 10 }, () => claim('login')));
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    const bodies = await Promise.all(responses.map((r) => r.json<ClaimBody>()));
    expect(new Set(bodies.map((b) => b.claimId)).size).toBe(1);
    expect(await count('event_claims')).toBe(1);
    expect(await count('inventory_ledger')).toBe(1);
    expect(await balance('p1', 'gold')).toBe(100);
  });

  it('デイリーの報酬は次の区切りの後にもう一度受け取れる', async () => {
    await addOpen('login');
    // 前の日の区切りで受け取った行
    const yesterday = periodKey('daily', nowSeconds() - 86400, 0);
    await baseEnv.DB.prepare("INSERT INTO event_claims (game_id, player_id, event_id, period_key, claim_id, claimed_at) VALUES (?, 'p1', 'login', ?, 'old-claim', ?)")
      .bind(game, yesterday, nowSeconds() - 86400).run();
    const res = await claim('login');
    expect(res.status).toBe(200);
    const body = await res.json<ClaimBody>();
    expect(body.claimId).not.toBe('old-claim');
    expect(body.periodKey).not.toBe(yesterday);
    expect(await count('event_claims')).toBe(2);
    expect(await balance('p1', 'gold')).toBe(100);
  });

  it('期間の外のイベントの報酬はEVENT_NOT_ACTIVEの409を返し付与しない', async () => {
    const now = nowSeconds();
    await addEvent('ended', 'daily', now - 86400, now - 1);
    await addEvent('future', 'once', now + 3600, now + 86400);
    await expectError(await claim('ended'), 409, 'EVENT_NOT_ACTIVE');
    await expectError(await claim('future'), 409, 'EVENT_NOT_ACTIVE');
    expect(await count('event_claims')).toBe(0);
    expect(await count('inventory_ledger')).toBe(0);
    expect(await count('inventory_balances')).toBe(0);
  });

  it('クライアントが送った時刻は期間の判定に使わない', async () => {
    const now = nowSeconds();
    await addEvent('ended', 'daily', now - 86400, now - 1);
    await addOpen('open-now');
    // 終わったイベントに、期間の内に当たる昔の時刻を本文・問い合わせ・Date の見出しで付ける
    const old = { body: JSON.stringify({ now: '2000-01-01T00:00:00Z' }), query: '&now=946684800',
      headers: { 'content-type': 'application/json', Date: 'Sat, 01 Jan 2000 00:00:00 GMT' } };
    await expectError(await claim('ended', old), 409, 'EVENT_NOT_ACTIVE');
    expect(await count('event_claims')).toBe(0);
    // 開いているイベントに 2099 年の時刻を付けても、区切りはサーバーのいまの日付
    const future = { body: JSON.stringify({ now: '2099-12-31T00:00:00Z' }), query: '&now=4102358400',
      headers: { 'content-type': 'application/json', Date: 'Thu, 31 Dec 2099 00:00:00 GMT' } };
    const res = await claim('open-now', future);
    expect(res.status).toBe(200);
    expect((await res.json<ClaimBody>()).periodKey).toBe(new Date().toISOString().slice(0, 10));
  });

  it('所持品の上限を超える報酬はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない', async () => {
    await addOpen('big', 'daily', [['gold', 100], ['potion', 1]]);
    await baseEnv.DB.prepare("INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, 'p1', 'gold', ?, ?)")
      .bind(game, MAX_ITEM_AMOUNT - 50, nowSeconds()).run();
    await expectError(await claim('big'), 409, 'INVENTORY_LIMIT_EXCEEDED');
    expect(await count('event_claims')).toBe(0);
    expect(await count('inventory_ledger')).toBe(0);
    expect(await balance('p1', 'gold')).toBe(MAX_ITEM_AMOUNT - 50);
    expect(await balance('p1', 'potion')).toBeNull();
  });

  it('知らないイベントの報酬はNOT_FOUNDの404を返す', async () => {
    const res = await claim('no-such-event');
    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error).toEqual({ code: 'NOT_FOUND', message: 'Unknown event' });
    expect(await count('event_claims')).toBe(0);
  });

  it('ほかのプレイヤーの受け取りは自分の受け取り済みに数えない', async () => {
    await addOpen('login');
    const p2 = await claim('login', { playerId: 'p2' });
    expect(p2.status).toBe(200);
    const p1 = await claim('login', { playerId: 'p1' });
    expect(p1.status).toBe(200);
    expect((await p1.json<ClaimBody>()).claimId).not.toBe((await p2.json<ClaimBody>()).claimId);
    expect(await balance('p1', 'gold')).toBe(100);
    expect(await balance('p2', 'gold')).toBe(100);
  });

  it('トークンの無い受け取りは401を返し利用制限を数えない', async () => {
    await addOpen('login');
    await expectError(await claim('login', { authorization: null }), 401, 'UNAUTHENTICATED');
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
    expect(await count('event_claims')).toBe(0);
  });

  it('本番の設定ではイベントの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await addOpen('login');
    await expectError(await list({ e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectError(await claim('login', { e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    expect(await count('event_claims')).toBe(0);
    expect(await count('inventory_ledger')).toBe(0);
    expect(await count('inventory_balances')).toBe(0);
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('eventsを使わない設定のゲームのイベントはNOT_FOUNDの404を返す', async () => {
    await registerGame(baseEnv.DB, 'no-events', ['inventory']);
    const res = await list({ gameId: 'no-events' });
    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error).toEqual({ code: 'NOT_FOUND', message: 'Feature not enabled for this game' });
    const claimed = await claim('login', { gameId: 'no-events' });
    expect(claimed.status).toBe(404);
    expect((await claimed.json<ErrorBody>()).error).toEqual({ code: 'NOT_FOUND', message: 'Feature not enabled for this game' });
  });

  it('イベントの一覧と受け取りの応答はスキーマに合う', async () => {
    const now = nowSeconds();
    await addOpen('login', 'daily', [['gold', 100], ['potion', 2]]);
    await addOpen('once-only', 'once');
    await addEvent('ended', 'daily', now - 86400, now - 1);
    await addOpen('big', 'weekly', [['potion', 100]]);
    await baseEnv.DB.prepare("INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, 'p1', 'potion', ?, ?)")
      .bind(game, MAX_ITEM_AMOUNT - 50, now).run();
    const { body } = await expectConforms(await list(), '/v1/events', 'get');
    expect((body as ListBody).items.map((i) => i.eventId)).toEqual(['big', 'login', 'once-only']);
    await expectConforms(await claim('login'), '/v1/events/{eventId}/claim', 'post');
    await expectConforms(await claim('login'), '/v1/events/{eventId}/claim', 'post');
    const cases: Array<[string, string, Promise<Response>]> = [
      ['EVENT_NOT_ACTIVE', 'post', claim('ended')],
      ['INVENTORY_LIMIT_EXCEEDED', 'post', claim('big')],
      ['UNAUTHENTICATED', 'post', claim('login', { authorization: null })],
      ['UNAUTHENTICATED', 'get', list({ authorization: null })],
    ];
    for (const [code, method, pending] of cases) {
      const res = await pending;
      const path = method === 'get' ? '/v1/events' : '/v1/events/{eventId}/claim';
      const { spec: r, body: err } = await expectConforms(res, path, method as 'get' | 'post');
      expect((err as ErrorBody).error.code).toBe(code);
      expect(r['x-error-codes']).toContain(code);
    }
  });

  it('CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない', async () => {
    // scripts/cli-mock.mjs のイベントの流れ（scripts/cli-requests.mjs で共有）: demo-rpg のゲスト → 一覧 → daily-login の受け取り →
    // 所持品 → もう一度受け取り → 所持品 → 履歴。落ちたら API か CLI モックを直す合図
    const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(base + path, init), localEnv as never);
    const guest = await call('/v1/accounts/guest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(guestRequest()),
    });
    expect(guest.status).toBe(200);
    const { gameId, token } = await guest.json<{ gameId: string; token: string }>();
    const headers = authHeaders(token);
    const listed = await call(eventsPath(gameId), { headers });
    expect(listed.status).toBe(200);
    const events = await listed.json<ListBody>();
    expect(events.items.find((i) => i.eventId === SMOKE_EVENT_ID)).toMatchObject({ claimed: false, rewards: [{ itemId: 'gold', amount: 100 }] });
    const gold = async () => {
      const res = await call(inventoryPath(gameId), { headers });
      expect(res.status).toBe(200);
      return (await res.json<InventoryBody>()).currencies.find((c) => c.itemId === 'gold')?.amount;
    };
    const first = await call(claimPath(SMOKE_EVENT_ID, gameId), { method: 'POST', headers });
    expect(first.status).toBe(200);
    const firstBody = await first.json<ClaimBody>();
    expect(firstBody.grants).toEqual([{ itemId: 'gold', amount: 100 }]);
    expect(await gold()).toBe(100);
    const second = await call(claimPath(SMOKE_EVENT_ID, gameId), { method: 'POST', headers });
    expect(second.status).toBe(200);
    expect((await second.json<ClaimBody>()).claimId).toBe(firstBody.claimId);
    expect(await gold()).toBe(100);
    const history = await call(historyPath(gameId), { headers });
    expect(history.status).toBe(200);
    const rows = (await history.json<HistoryBody>()).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ itemId: 'gold', delta: 100, sourceId: firstBody.claimId });
  });
});
