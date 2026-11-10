/**
 * クライアント統合の試験 B2: ブラウザの SDK（clients/browser/rpg-online-client.mjs）と、SDK で送る CLI モックの流れ（scripts/cli-flow.mjs）。
 * 名前と期待する結果の正は docs/guides/working/client-integration-design.md §9 の B2 の 13 本と、
 * docs/guides/working/failure-case-test-plan.md の K4 の `CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する`（設計書 §7）と、
 * B3 の SDK の 2 本（期限まで 7 日を切ったトークンの更新・TOKEN_EXPIRED で session を返す。§9）。
 * L1 の試験は偽の fetch と差し替えた sleep で、実時間を待たずにタイムアウト・再試行・Retry-After を見る（AbortSignal.timeout に依らない）。
 * L2 の試験は src/worker.ts の default.fetch を SDK の fetch に差し替えて回す（ほかの L2 の試験と同じ）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import specJson from '../openapi/rpg-online.v1.json';
import sdkTypesText from '../clients/browser/rpg-online-client.d.mts?raw';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';
import { resetRateLimits } from './support/rate-limits';
import {
  CLIENT_POLICY, OPERATION_RETRY, SCENARIO_STEPS, backoffCapSeconds, categorize, createClient, runScenario,
  type FetchLike, type RequestInitLike, type RequestLogEvent, type ResponseLike, type StorageLike,
} from '../clients/browser/rpg-online-client.mjs';
import { requestLogLine, runCli } from '../scripts/cli-flow.mjs';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const baseUrl = 'http://example.com';

type ResponseSpec = { content?: Record<string, { schema: Schema }> };
type Operation = { operationId: string; 'x-retry'?: string; responses: Record<string, ResponseSpec> };
type Spec = SchemaRoot & {
  'x-client-policy': Record<string, unknown>;
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};
const spec = specJson as unknown as Spec;
const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];
const operations = (): Operation[] =>
  Object.values(spec.paths).flatMap((item) => httpMethods.filter((m) => m in item).map((m) => item[m]));

beforeEach(async () => {
  await resetRateLimits(baseEnv.DB);
});

// ---- 偽の fetch と差し替えた sleep（L1） ----

type Reply = Response | 'hang';
type Call = { url: string; init: RequestInitLike };

/**
 * 偽のサーバー。reply(n, call) が n 回目（1 から）の応答を返す。'hang' は応答しない（signal が止まるまで待つ）。
 * sleep はタイムアウトの待ち（signal 付き）と再試行の待ち（signal 無し）を分けて記録し、実時間を待たない。
 * タイムアウトの待ちは、その回の fetch が応答しないと決まったときだけ切れる（応答する回は fetch が先に終わる）。
 */
function fake(reply: (n: number, call: Call) => Reply) {
  const calls: Call[] = [];
  const timeouts: number[] = [];
  const waits: number[] = [];
  const pendingTimers: Array<() => void> = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    await Promise.resolve();
    const r = reply(calls.length, call);
    if (r === 'hang') {
      const signal = init.signal as AbortSignal;
      const hung = new Promise<ResponseLike>((_, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      pendingTimers.splice(0).forEach((fire) => fire());
      return hung;
    }
    return r;
  };
  const sleep = (ms: number, signal?: unknown): Promise<void> => {
    if (signal === undefined) {
      waits.push(ms);
      return Promise.resolve();
    }
    timeouts.push(ms);
    return new Promise<void>((resolve) => {
      pendingTimers.push(resolve);
      (signal as AbortSignal).addEventListener('abort', () => resolve(), { once: true });
    });
  };
  return { calls, timeouts, waits, fetch, sleep };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
const errorBody = (code: string) => ({ error: { code, message: 'x' } });
const guestBody = { gameId: 'demo-rpg', playerId: 'p-fake', token: 'v1.fake-token-body.fake-signature', expiresAt: '2026-12-01T00:00:00.000Z' };

/** ゲストの発行に答えてから reply に任せる偽のサーバー（書き込みの口の試験用）。calls は発行を除く。 */
function fakeSignedIn(reply: (n: number, call: Call) => Reply) {
  let n = 0;
  const f = fake((_, call) => (call.url.endsWith('/v1/accounts/guest') ? json(200, guestBody) : reply(++n, call)));
  return { ...f, sent: () => f.calls.filter((c) => !c.url.endsWith('/v1/accounts/guest')) };
}

const headerOf = (call: Call, name: string): string | undefined => call.init.headers[name];

// ---- 本物の Worker（L2） ----

/** worker.fetch を SDK の fetch にする。応答の本文の写しを raw に残す（スキーマに当てるため）。 */
function workerFetch(raw: Array<{ status: number; text: string }> = []): FetchLike {
  return async (url, init) => {
    const res = await worker.fetch(new Request(url, { method: init.method, headers: init.headers, body: init.body }), localEnv as never);
    const text = res.status === 304 ? '' : await res.clone().text();
    raw.push({ status: res.status, text });
    return res;
  };
}

describe('B2 ブラウザの SDK の決まり（L1）', () => {
  it('SDKの決まりの値はスキーマのクライアントの決まりと一致する', () => {
    const { description, ...policy } = spec['x-client-policy'];
    expect(typeof description).toBe('string');
    expect(JSON.parse(JSON.stringify(CLIENT_POLICY))).toEqual(policy);
    const retry = Object.fromEntries(operations().map((op) => [op.operationId, op['x-retry']]));
    expect({ ...OPERATION_RETRY }).toEqual(retry);
  });

  it('SDKはタイムアウトした安全な読み取りを決めた回数まで再試行する', async () => {
    const f = fake(() => 'hang');
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, random: () => 1 });
    const res = await client.getRanking('boss-score', { limit: 10 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(f.calls).toHaveLength(3);
    expect(f.calls.every((c) => c.url === `${baseUrl}/v1/rankings/boss-score?gameId=demo-rpg&limit=10`)).toBe(true);
    expect(f.timeouts).toEqual([10_000, 10_000, 10_000]);
    expect(f.waits).toEqual([1000, 2000]);
    expect(res.attempts).toBe(3);
    expect(res.error).toMatchObject({ code: null, category: 'network', status: null, retryable: true, outcomeUnknown: false });
    expect(res.error.reason).toMatch(/timeout/);
    // タイムアウトした要求は signal で止めた
    expect(f.calls.every((c) => (c.init.signal as AbortSignal).aborted)).toBe(true);
  });

  it('SDKは再試行の待ちを指数で伸ばし上限で止める', async () => {
    const f = fake(() => json(500, errorBody('INTERNAL_ERROR')));
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, random: () => 1 });
    const res = await client.getRanking('boss-score');
    expect(f.calls).toHaveLength(3); // 4 回目は送らない
    expect(f.waits).toEqual([1000, 2000]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ code: 'INTERNAL_ERROR', category: 'network', status: 500, retryable: true });
    // 回数を増やしたときの頭打ち（1・2・4・8・8 秒）
    expect([1, 2, 3, 4, 5].map(backoffCapSeconds)).toEqual([1, 2, 4, 8, 8]);
    // 全幅の揺らぎ: 実際の待ちは 0〜その秒の一様乱数
    const half = fake(() => json(503, { oops: true }));
    await createClient({ baseUrl, fetch: half.fetch, sleep: half.sleep, random: () => 0.5 }).getHealth();
    expect(half.waits).toEqual([500, 1000]);
  });

  it('SDKは429を受けたらRetry-Afterの秒だけ待って1回だけ送り直す', async () => {
    const f = fake((n) => (n === 1 ? json(429, errorBody('RATE_LIMITED'), { 'Retry-After': '7' }) : json(200, { gameId: 'demo-rpg', boardId: 'b', items: [] })));
    const res = await createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, random: () => 1 }).getRanking('b');
    expect(res.ok).toBe(true);
    expect(f.calls).toHaveLength(2);
    expect(f.waits).toEqual([7000]);
    // 429 が続けば 2 回で止まる（maxAttempts の 3 回まで送らない）
    const again = fake(() => json(429, errorBody('RATE_LIMITED'), { 'Retry-After': '7' }));
    const busy = await createClient({ baseUrl, fetch: again.fetch, sleep: again.sleep, random: () => 1 }).getRanking('b');
    expect(again.calls).toHaveLength(2);
    expect(again.waits).toEqual([7000]);
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.error).toMatchObject({ code: 'RATE_LIMITED', category: 'busy', status: 429 });
  });

  it('SDKはRetry-Afterが無いか上限を超えたら待たずにRATE_LIMITEDを返す', async () => {
    for (const headers of [{}, { 'Retry-After': '61' }, { 'Retry-After': 'abc' }, { 'Retry-After': '0' }] as Array<Record<string, string>>) {
      const f = fake(() => json(429, errorBody('RATE_LIMITED'), headers));
      const res = await createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep }).getRanking('b');
      expect(f.calls, JSON.stringify(headers)).toHaveLength(1);
      expect(f.waits, JSON.stringify(headers)).toEqual([]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatchObject({ code: 'RATE_LIMITED', category: 'busy', status: 429 });
    }
  });

  it('SDKはセーブの書き込みを500でも自動で送り直さない', async () => {
    const f = fakeSignedIn(() => json(500, errorBody('INTERNAL_ERROR')));
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep });
    expect((await client.issueGuest()).ok).toBe(true);
    const res = await client.putSave('slot-1', { formatVersion: 1, data: '{}', checksum: 'c', baseRevision: 0 });
    expect(f.sent()).toHaveLength(1);
    expect(f.waits).toEqual([]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ code: 'INTERNAL_ERROR', category: 'network', status: 500, retryable: false, outcomeUnknown: true });
    // 削除も同じ（revision の種類）。タイムアウトでも送り直さない
    const h = fakeSignedIn(() => 'hang');
    const c2 = createClient({ baseUrl, fetch: h.fetch, sleep: h.sleep });
    await c2.issueGuest();
    const del = await c2.deleteSave('slot-1', 1);
    expect(h.sent()).toHaveLength(1);
    if (!del.ok) expect(del.error).toMatchObject({ category: 'network', retryable: false, outcomeUnknown: true });
    else expect.unreachable('deleteSave はタイムアウトで失敗する');
  });

  it('SDKはプレイヤーデータの書き込みの送り直しに同じIdempotency-Keyを使う', async () => {
    const written = { gameId: 'demo-rpg', writeId: 'w1', values: [{ key: 'slimes-defeated', value: 1 }], unlocked: [] };
    const f = fakeSignedIn((n) => (n === 1 ? 'hang' : json(200, written)));
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, random: () => 0 });
    await client.issueGuest();
    const res = await client.writePlayerData([{ key: 'slimes-defeated', value: 1 }]);
    expect(res.ok).toBe(true);
    const [first, second] = f.sent();
    expect(f.sent()).toHaveLength(2);
    const key = headerOf(first, 'Idempotency-Key');
    expect(key).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
    expect(headerOf(second, 'Idempotency-Key')).toBe(key);
    expect(second.init.body).toBe(first.init.body);
    // 次の呼び出しは別の鍵
    await client.writePlayerData([{ key: 'slimes-defeated', value: 1 }]);
    const third = f.sent()[2];
    expect(headerOf(third, 'Idempotency-Key')).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
    expect(headerOf(third, 'Idempotency-Key')).not.toBe(key);
    // ほかの口には付けない（設計書 §2.2）
    await client.getPlayerData();
    expect(headerOf(f.sent()[3], 'Idempotency-Key')).toBeUndefined();
  });

  it('SDKは400と401と403と404と409と413と422を再試行しない', async () => {
    const cases: Array<[number, string | null]> = [
      [400, 'INVALID_ARGUMENT'], [401, 'UNAUTHENTICATED'], [403, 'PERMISSION_DENIED'], [404, 'NOT_FOUND'],
      [409, 'SAVE_CONFLICT'], [413, 'PAYLOAD_TOO_LARGE'], [422, 'IDEMPOTENCY_KEY_REUSED'],
      [400, null], [404, null], [409, null],
    ];
    for (const [status, code] of cases) {
      const f = fake(() => (code ? json(status, errorBody(code)) : new Response('not json', { status })));
      const res = await createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep }).getRanking('b');
      expect(f.calls, `${status} ${code}`).toHaveLength(1);
      expect(f.waits, `${status} ${code}`).toEqual([]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error, `${status} ${code}`).toMatchObject({ status, code, retryable: false });
    }
  });

  it('SDKはエラーのcodeを画面の文の種類に分け知らないコードはunknownにする', async () => {
    const catalog = (spec['x-client-policy'] as { errorCatalog: Record<string, { category: string }> }).errorCatalog;
    expect(Object.keys(catalog)).toHaveLength(20);
    const statusOf = (code: string) => (code === 'INTERNAL_ERROR' ? 500 : code === 'RATE_LIMITED' ? 429 : 400);
    for (const [code, { category }] of Object.entries(catalog)) {
      const f = fake(() => json(statusOf(code), errorBody(code)));
      const res = await createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep }).getRanking('b');
      if (res.ok) expect.unreachable(code);
      else expect(res.error.category, code).toBe(category);
    }
    const unknownCode = fake(() => json(400, errorBody('NEW_CODE')));
    const u = await createClient({ baseUrl, fetch: unknownCode.fetch, sleep: unknownCode.sleep }).getRanking('b');
    if (u.ok) expect.unreachable('NEW_CODE');
    else expect(u.error).toMatchObject({ code: 'NEW_CODE', category: 'unknown', retryable: false });
    expect(unknownCode.calls).toHaveLength(1);
    const badGateway = fake(() => new Response('<html>Bad Gateway</html>', { status: 502 }));
    const g = await createClient({ baseUrl, fetch: badGateway.fetch, sleep: badGateway.sleep }).getRanking('b');
    if (g.ok) expect.unreachable('502');
    else expect(g.error).toMatchObject({ code: null, category: 'network', status: 502, retryable: true });
    expect(categorize(418, null)).toBe('unknown');
    expect(categorize(null, null)).toBe('network');
  });

  it('SDKはトークンを結果とログに出さない', async () => {
    // 本物の Worker でゲストを発行し、成功と失敗の結果・差し替えたログ・CLI の行のどこにもトークンの文字列が無いことを見る
    const raw: Array<{ status: number; text: string }> = [];
    const events: RequestLogEvent[] = [];
    const lines: string[] = [];
    const store = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } };
    const client = createClient({ baseUrl, fetch: workerFetch(raw), storage, log: (e) => { events.push(e); lines.push(requestLogLine(e)); } });
    const issued = await client.issueGuest();
    expect(issued.ok).toBe(true);
    const token = (JSON.parse(raw[0].text) as { token: string }).token;
    expect(token.length).toBeGreaterThan(20);
    const failed = await client.getSave('no-such-slot'); // 404 の失敗の結果
    expect(failed.ok).toBe(false);
    const results = [issued, failed, await client.getInventory(), client.session()];
    // 失敗の結果（回線断）と、その記録
    const broken = createClient({ baseUrl, storage, fetch: async () => { throw new Error(`boom ${token}`); }, sleep: async () => {}, log: (e) => events.push(e) });
    results.push(await broken.getInventory());
    const shown = JSON.stringify(results) + JSON.stringify(events) + lines.join('\n');
    expect(shown).not.toContain(token);
    expect(shown).not.toContain(token.split('.')[2]);
    expect(issued.ok && Object.keys(issued.data).sort()).toEqual(['expiresAt', 'gameId', 'playerId']);
    // トークンは storage にだけある（次の要求の Authorization に使う）
    expect([...store.values()].join('')).toContain(token);
  });
});

describe('B2 ブラウザの SDK を Worker に当てる（L2）', () => {
  it('SDKは受領の履歴をnextBeforeが無くなるまで読む', async () => {
    const events: RequestLogEvent[] = [];
    const client = createClient({ baseUrl, fetch: workerFetch(), log: (e) => events.push(e) });
    const issued = await client.issueGuest();
    if (!issued.ok) return expect.unreachable('ゲストの発行');
    const { playerId } = issued.data;
    await baseEnv.DB.batch(Array.from({ length: 45 }, (_, i) => baseEnv.DB.prepare(
      "INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at) VALUES ('demo-rpg', ?, 'gold', 1, 'event-claim', ?, ?)",
    ).bind(playerId, `seed-${i}`, 1_700_000_000 + i)));
    const res = await client.readAllInventoryHistory({ limit: 20 });
    if (!res.ok) return expect.unreachable(res.error.reason);
    expect(res.pages).toBe(3);
    expect(res.complete).toBe(true);
    const ids = res.data.items.map((i) => i.entryId);
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
    expect(ids).toEqual([...ids].sort((a, b) => b - a)); // 新しい順
    expect(res.data.items.map((i) => i.sourceId)).toEqual(Array.from({ length: 45 }, (_, i) => `seed-${44 - i}`));
    const historyCalls = events.filter((e) => e.operationId === 'listInventoryHistory');
    expect(historyCalls).toHaveLength(3);
    expect(historyCalls[0].path).toBe('/v1/inventory/history?gameId=demo-rpg&limit=20');
    expect(historyCalls[1].path).toMatch(/&limit=20&before=\d+$/);
    // 読むページの上限で止まり、続きの鍵を返す
    const capped = await client.readAllInventoryHistory({ limit: 20, maxPages: 2 });
    if (!capped.ok) return expect.unreachable(capped.error.reason);
    expect(capped).toMatchObject({ pages: 2, complete: false });
    expect(capped.data.items).toHaveLength(40);
    expect(capped.data.nextBefore).toBe(capped.data.items[39].entryId);
  });

  it('SDKの応答の型はスキーマの応答と同じ欄を持つ', async () => {
    await baseEnv.DB.prepare("INSERT OR REPLACE INTO config_master_data (game_id, key, data) VALUES ('demo-rpg', 'sdk-items', '[1,2,3]')").run();
    try {
      const raw: Array<{ status: number; text: string }> = [];
      const events: RequestLogEvent[] = [];
      const client = createClient({ baseUrl, fetch: workerFetch(raw), log: (e) => events.push(e) });
      const ok = <T extends { ok: boolean }>(r: T, what: string): T => { if (!r.ok) expect.unreachable(`${what}: ${JSON.stringify(r)}`); return r; };
      ok(await client.getHealth(), 'getHealth');
      ok(await client.issueGuest(), 'issueGuest');
      ok(await client.refreshToken(), 'refreshToken');
      ok(await client.listAnnouncements(), 'listAnnouncements');
      ok(await client.submitScore('sdk-board', { score: 10, displayName: 'SDK' }), 'submitScore');
      ok(await client.getRanking('sdk-board', { limit: 5 }), 'getRanking');
      const saved = ok(await client.putSave('sdk-slot', { formatVersion: 1, data: 'abc', checksum: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', baseRevision: 0 }), 'putSave');
      ok(await client.getSave('sdk-slot'), 'getSave');
      ok(await client.listSaves(), 'listSaves');
      ok(await client.deleteSave('sdk-slot', saved.ok ? saved.data.revision : 1), 'deleteSave');
      ok(await client.getConfig({ clientVersion: '1.0.0' }), 'getConfig');
      ok(await client.getMasterData('sdk-items'), 'getMasterData');
      ok(await client.listEvents(), 'listEvents');
      ok(await client.claimEventReward('daily-login'), 'claimEventReward');
      ok(await client.getInventory(), 'getInventory');
      ok(await client.listInventoryHistory({ limit: 1 }), 'listInventoryHistory');
      ok(await client.getPlayerData(), 'getPlayerData');
      ok(await client.writePlayerData([{ key: 'slimes-defeated', value: 1 }]), 'writePlayerData');
      ok(await client.listQuests(), 'listQuests');
      ok(await client.claimQuest('first-hunt'), 'claimQuest');

      // 応答の本文がスキーマに合う（20 の操作を全部通した）
      const sent = events.filter((e) => e.reason !== 'retry-wait');
      expect(sent).toHaveLength(raw.length);
      const byId = new Map(operations().map((op) => [op.operationId, op]));
      expect(new Set(sent.map((e) => e.operationId))).toEqual(new Set(byId.keys()));
      const usedSchemas = new Set<string>();
      sent.forEach((e, i) => {
        const r = raw[i];
        const schema = byId.get(e.operationId)?.responses[String(r.status)]?.content?.['application/json']?.schema;
        expect(schema, `${e.operationId} ${r.status}`).toBeDefined();
        expect(validate(JSON.parse(r.text), schema as Schema, spec), e.operationId).toEqual([]);
        usedSchemas.add(String(schema?.$ref).split('/').pop() ?? '');
      });

      // .d.mts の欄の名前がスキーマと同じ（応答に出る全部の object の形。GuestIssued は token を除いた GuestSession）
      const reachable = new Set<string>();
      const walk = (name: string) => {
        if (reachable.has(name)) return;
        reachable.add(name);
        JSON.stringify(spec.components.schemas[name]).replace(/#\/components\/schemas\/(\w+)/g, (_, n: string) => { walk(n); return ''; });
      };
      usedSchemas.forEach(walk);
      const interfaceFields = (name: string): string[] | null => {
        const m = new RegExp(`export interface ${name} \\{\\n([\\s\\S]*?)\\n\\}`).exec(sdkTypesText);
        return m ? [...m[1].matchAll(/^ {2}(\w+)\??:/gm)].map((f) => f[1]).sort() : null;
      };
      let compared = 0;
      for (const name of reachable) {
        const props = spec.components.schemas[name].properties as Record<string, unknown> | undefined;
        if (!props) continue;
        const expected = Object.keys(props).filter((k) => !(name === 'GuestIssued' && k === 'token')).sort();
        expect(interfaceFields(name === 'GuestIssued' ? 'GuestSession' : name), name).toEqual(expected);
        compared++;
      }
      expect(compared).toBeGreaterThanOrEqual(30);
    } finally {
      await baseEnv.DB.prepare("DELETE FROM config_master_data WHERE game_id = 'demo-rpg' AND key = 'sdk-items'").run();
    }
  });

  it('SDKでCLIモックと同じシナリオを通せる', async () => {
    await baseEnv.DB.prepare("INSERT OR REPLACE INTO config_master_data (game_id, key, data) VALUES ('demo-rpg', 'sdk-items', '[1,2,3]')").run();
    try {
      const client = createClient({ baseUrl, fetch: workerFetch() });
      const result = await runScenario(client, { now: Date.parse('2026-11-01T00:00:00Z') });
      expect(result.failed).toBeUndefined();
      expect(result.ok).toBe(true);
      expect(result.steps.map((s) => s.name)).toEqual([...SCENARIO_STEPS]);
      expect(result.steps.every((s) => s.ok)).toBe(true);
      // 飛ばした手順が無い（マスターデータとイベントも通した）
      expect(result.steps.filter((s) => /skipped/.test(s.detail))).toEqual([]);
      // CLI モックの流れ（runCli）でも同じシナリオが通り、終了コード 0
      const lines: string[] = [];
      const code = await runCli({ client: createClient({ baseUrl, fetch: workerFetch() }), log: (l) => lines.push(l), scenario: { now: Date.parse('2026-11-01T00:00:01Z') } });
      expect(code, lines.join('\n')).toBe(0);
      expect(lines.at(-1)).toMatch(/PASS/);
    } finally {
      await baseEnv.DB.prepare("DELETE FROM config_master_data WHERE game_id = 'demo-rpg' AND key = 'sdk-items'").run();
    }
  });
});

describe('B3 SDK のトークンの更新（L1）', () => {
  const day = 24 * 60 * 60 * 1000;
  const clock = Date.parse('2026-11-01T00:00:00Z');
  /** 期限が clock から daysLeft 日後のセッションを置いた storage。 */
  function storedSession(daysLeft: number, token = 'v1.old-token-body.old-signature') {
    const store = new Map<string, string>();
    const storage: StorageLike = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); } };
    storage.setItem('rpg-online:demo-rpg:session', JSON.stringify({
      gameId: 'demo-rpg', playerId: 'p-fake', expiresAt: new Date(clock + daysLeft * day).toISOString(), token,
    }));
    return storage;
  }
  const inventoryBody = { gameId: 'demo-rpg', currencies: [], items: [] };

  it('SDKは期限まで7日を切ったトークンを更新してから送る', async () => {
    const renewed = { gameId: 'demo-rpg', playerId: 'p-fake', token: 'v1.new-token-body.new-signature', expiresAt: new Date(clock + 30 * day).toISOString() };
    const f = fake((_, call) => (call.url.endsWith('/v1/accounts/token') ? json(200, renewed) : json(200, inventoryBody)));
    const storage = storedSession(6);
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, now: () => clock, storage });
    const res = await client.getInventory();
    expect(res.ok).toBe(true);
    // 更新 → 読む、の順に 2 回送る。更新は古いトークン、読むのは新しいトークン
    expect(f.calls.map((c) => `${c.init.method} ${c.url.replace(baseUrl, '').split('?')[0]}`)).toEqual(['POST /v1/accounts/token', 'GET /v1/inventory']);
    expect(headerOf(f.calls[0], 'Authorization')).toBe('Bearer v1.old-token-body.old-signature');
    expect(headerOf(f.calls[1], 'Authorization')).toBe(`Bearer ${renewed.token}`);
    expect(client.session()).toEqual({ gameId: 'demo-rpg', playerId: 'p-fake', expiresAt: renewed.expiresAt });
    // 更新した後は期限まで 30 日あるので、次の要求の前には更新しない
    expect((await client.getInventory()).ok).toBe(true);
    expect(f.calls).toHaveLength(3);
    // 期限まで 8 日あるトークンは更新しない
    const g = fake(() => json(200, inventoryBody));
    const fresh = createClient({ baseUrl, fetch: g.fetch, sleep: g.sleep, now: () => clock, storage: storedSession(8) });
    expect((await fresh.getInventory()).ok).toBe(true);
    expect(g.calls.map((c) => c.url.replace(baseUrl, '').split('?')[0])).toEqual(['/v1/inventory']);
  });

  it('SDKはTOKEN_EXPIREDを受けたらゲストを発行し直さずsessionを返す', async () => {
    // 要求が 401 TOKEN_EXPIRED（端末の時計では期限の前）
    const f = fake(() => json(401, errorBody('TOKEN_EXPIRED')));
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, now: () => clock, storage: storedSession(20) });
    const res = await client.getInventory();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.category).toBe('session');
    expect(res.error.code).toBe('TOKEN_EXPIRED');
    expect(f.calls).toHaveLength(1);
    expect(f.calls.some((c) => c.url.endsWith('/v1/accounts/guest'))).toBe(false);
    // 更新の口が TOKEN_EXPIRED を返したら、本来の要求も発行も送らずに session を返す
    const g = fake(() => json(401, errorBody('TOKEN_EXPIRED')));
    const late = createClient({ baseUrl, fetch: g.fetch, sleep: g.sleep, now: () => clock, storage: storedSession(1) });
    const again = await late.getInventory();
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.category).toBe('session');
    expect(g.calls.map((c) => c.url.replace(baseUrl, '').split('?')[0])).toEqual(['/v1/accounts/token']);
    // 保存したセッションは消さない（「新しく始める」はゲームが選んで clearSession と issueGuest を呼ぶ）
    expect(late.session()?.playerId).toBe('p-fake');
  });
});

describe('K4 ケース 1: CLI のタイムアウト（L2）', () => {
  it('CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する', async () => {
    // 応答しない偽の fetch と差し替えた sleep の SDK で runCli を呼ぶ。決めた回数（§2.1 の 3 回）・時間（10 秒）で打ち切って、
    // 画面の文の種類 network と理由の行を出し、終了コード 1
    const f = fake(() => 'hang');
    const lines: string[] = [];
    const client = createClient({ baseUrl, fetch: f.fetch, sleep: f.sleep, log: (e) => lines.push(requestLogLine(e)) });
    const code = await runCli({ client, log: (l) => lines.push(l) });
    expect(code).toBe(1);
    expect(f.calls).toHaveLength(CLIENT_POLICY.maxAttempts);
    expect(f.calls.every((c) => c.url === `${baseUrl}/health`)).toBe(true);
    expect(f.timeouts).toEqual([10_000, 10_000, 10_000]);
    expect(lines).toContain('category: network');
    expect(lines.find((l) => l.startsWith('reason: '))).toMatch(/timeout.*3 attempts/);
    expect(lines.filter((l) => /no response \(timeout\)/.test(l))).toHaveLength(3);
    expect(lines.some((l) => /FAIL: local CLI smoke test at step "health"/.test(l))).toBe(true);
  });
});
