/**
 * クエスト Q1: 一度きりのクエストの一覧（GET /v1/quests）と報酬の受け取り（POST /v1/quests/{questId}/claim）と、達成を決める関数の試験。
 * 名前と期待する結果の正は docs/guides/working/quest-design.md §10 の Q1 の行（エラーコードの数・スキーマの操作の数・
 * モジュールの一覧・demo-rpg の設定の 4 本は test/schema-conformance.test.ts・test/modules.test.ts・test/game-modules.test.ts）。
 * L1 は shape.ts の関数と定数を直に見る。L2 は src/worker.ts の default.fetch を直に呼び、APP_ENV=local を渡す。
 * 試験のゲームは専用の quest-game（beforeEach で登録と品目・キーの宣言の行を入れ、クエストは試験ごとにいまの時刻の前後に置く）。
 * 進捗は player_data に行を直に入れるか、プレイヤーデータの口で書く。demo-rpg の手本のクエスト（first-hunt）は CLI の流れの試験だけが使う。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_ITEM_AMOUNT } from '../src/core/inventory';
import { MAX_PLAYER_DATA_VALUE } from '../src/core/player-data';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { questStatus } from '../src/modules/quests/shape';
import specJson from '../openapi/rpg-online.v1.json';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { countRateLimitRows, fillRateLimit, resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';
import {
  SMOKE_PLAYER_DATA_KEY, SMOKE_QUEST_ID, authHeaders, guestRequest, inventoryPath, newIdempotencyKey, playerDataHeaders, playerDataPath,
  playerDataWrite, questClaimPath, questsPath,
} from '../scripts/cli-requests.mjs';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';
const game = 'quest-game';
const listRoute = '/v1/quests';
const claimRoute = '/v1/quests/{questId}/claim';

type Grant = { itemId: string; amount: number };
type QuestItem = { questId: string; kind: string; startsAt: string; endsAt: string; periodKey: string; key: string; threshold: number;
  progress: number; completed: boolean; claimed: boolean; rewards: Grant[] };
type ListBody = { gameId: string; serverTime: string; items: QuestItem[] };
type ClaimBody = { gameId: string; questId: string; periodKey: string; claimId: string; claimedAt: string; grants: Grant[] };
type InventoryBody = { gameId: string; currencies: Grant[]; items: Grant[] };
type HistoryBody = { gameId: string; items: Array<{ itemId: string; delta: number; sourceType: string; sourceId: string }> };
type ErrorBody = { error: { code: string; message: string } };
type Who = { gameId?: string; tokenGame?: string; playerId?: string; authorization?: string | null; e?: unknown;
  headers?: Record<string, string>; body?: string };

type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type Spec = SchemaRoot & { paths: Record<string, Record<string, { operationId: string; responses: Record<string, ResponseSpec> }>> };
const spec = specJson as unknown as Spec;

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function send(method: 'GET' | 'POST', path: string, who: Who = {}): Promise<Response> {
  const gameId = who.gameId ?? game;
  const headers: Record<string, string> = { ...who.headers };
  const authorization = who.authorization === undefined ? await bearer(who.tokenGame ?? gameId, who.playerId ?? 'p1') : who.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}${path}?gameId=${gameId}`, { method, headers, body: who.body }), (who.e ?? localEnv) as never);
}
const list = (who: Who = {}) => send('GET', '/v1/quests', who);
const claim = (questId: string, who: Who = {}) => send('POST', `/v1/quests/${questId}/claim`, who);
const getInventory = (who: Who = {}) => send('GET', '/v1/inventory', who);
const getHistory = (who: Who = {}) => send('GET', '/v1/inventory/history', who);

type QuestDef = { kind?: 'once' | 'daily' | 'weekly'; startsAt?: number; endsAt?: number; key?: string; threshold?: number;
  rewards?: Array<[string, number]> };
/** クエストと報酬の行を入れる（既定はいまの 1 時間前から 1 日後まで開いている一度きり・kills を 3・金貨 50）。 */
async function addQuest(questId: string, def: QuestDef = {}): Promise<void> {
  const now = nowSeconds();
  const { kind = 'once', startsAt = now - 3600, endsAt = now + 86400, key = 'kills', threshold = 3, rewards = [['gold', 50]] } = def;
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, key, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(game, questId, kind, startsAt, endsAt, key, threshold),
    ...rewards.map(([itemId, amount]) => baseEnv.DB.prepare('INSERT INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES (?, ?, ?, ?)')
      .bind(game, questId, itemId, amount)),
  ]);
}
/** プレイヤーデータの値の行を直に入れる（キーの宣言は beforeEach で入れた）。 */
async function setValue(playerId: string, key: string, value: number): Promise<void> {
  await baseEnv.DB.prepare('INSERT OR REPLACE INTO player_data (game_id, player_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(game, playerId, key, value, nowSeconds()).run();
}
/** プレイヤーデータの口で書く（新しい Idempotency-Key）。 */
async function writeValue(key: string, value: number, playerId = 'p1'): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/player-data?gameId=${game}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await bearer(game, playerId), 'Idempotency-Key': newIdempotencyKey() },
    body: JSON.stringify({ changes: [{ key, value }] }),
  }), localEnv as never);
}
async function count(table: 'quest_claims' | 'inventory_ledger' | 'inventory_balances'): Promise<number> {
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
async function expectNothingWritten(): Promise<void> {
  expect(await count('quest_claims')).toBe(0);
  expect(await count('inventory_ledger')).toBe(0);
  expect(await count('inventory_balances')).toBe(0);
}
/** 応答をスキーマの操作の状態の形に当てる（test/schema-conformance.test.ts の expectConforms と同じ見方）。 */
async function expectConforms(res: Response, path: string, method: 'get' | 'post'): Promise<unknown> {
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

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）の宣言・品目・クエストだけ残す。
// 受け取りはクエストを、クエストはキーの宣言と品目を外部キーで指すので、受け取り → クエスト（報酬は CASCADE）→ 宣言・品目の順に消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM quest_claims'),
    baseEnv.DB.prepare('DELETE FROM inventory_ledger'),
    baseEnv.DB.prepare('DELETE FROM inventory_balances'),
    baseEnv.DB.prepare('DELETE FROM player_achievements'),
    baseEnv.DB.prepare('DELETE FROM player_data'),
    baseEnv.DB.prepare('DELETE FROM player_data_writes'),
    baseEnv.DB.prepare('DELETE FROM player_bans'),
    baseEnv.DB.prepare("DELETE FROM quests WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM player_data_keys WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM inventory_items WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
  await registerGame(baseEnv.DB, game, ['inventory', 'player-data', 'quests']);
  const item = baseEnv.DB.prepare('INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, ?, ?)');
  const key = baseEnv.DB.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)');
  await baseEnv.DB.batch([
    item.bind(game, 'gold', 'currency'), item.bind(game, 'potion', 'item'),
    key.bind(game, 'kills', 'add', 1000, 100), key.bind(game, 'level', 'set', 100, null),
  ]);
});

describe('Q1 達成の決め方と定数', () => {
  it('クエストの一覧の行は進捗と閾値から達成と受け取り済みを決める', () => {
    const def = { threshold: 3 };
    expect([0, 2, 3, 4].map((progress) => questStatus(def, progress, false).completed)).toEqual([false, false, true, true]);
    expect(questStatus(def, 0, true)).toEqual({ completed: false, claimed: true });
    expect(questStatus(def, 4, true)).toEqual({ completed: true, claimed: true });
    expect(questStatus(def, 3, false)).toEqual({ completed: true, claimed: false });
  });

  it('クエストの利用制限の回数と窓は定数のモジュールにある', () => {
    expect(RATE_LIMITS.quests).toEqual({ scope: 'quests', limit: 60, period: 60 });
  });
});

describe('Q1 クエストの一覧', () => {
  it('クエストの一覧はトークンのプレイヤーの値で進捗と受け取り済みを返す', async () => {
    await addQuest('q-b', { threshold: 3, rewards: [['gold', 50], ['potion', 2]] });
    await addQuest('q-a', { threshold: 10 });
    await setValue('p1', 'kills', 4);
    await setValue('p2', 'kills', 99);
    // p1 は q-b を受け取り済み。p2 の q-a の受け取りは p1 に数えない
    const insertClaim = baseEnv.DB.prepare(`INSERT INTO quest_claims (game_id, player_id, quest_id, period_key, claim_id, claimed_at)
      VALUES (?, ?, ?, 'once', ?, ?)`);
    await baseEnv.DB.batch([insertClaim.bind(game, 'p1', 'q-b', 'c-1', nowSeconds()), insertClaim.bind(game, 'p2', 'q-a', 'c-2', nowSeconds())]);
    const before = Date.now();
    const res = await list({ playerId: 'p1' });
    expect(res.status).toBe(200);
    const body = await res.json<ListBody>();
    expect(body.gameId).toBe(game);
    expect(Math.abs(Date.parse(body.serverTime) - before)).toBeLessThanOrEqual(5000);
    expect(body.items.map((i) => [i.questId, i.progress, i.completed, i.claimed])).toEqual([['q-a', 4, false, false], ['q-b', 4, true, true]]);
    expect(body.items[1]).toMatchObject({ kind: 'once', periodKey: 'once', key: 'kills', threshold: 3,
      rewards: [{ itemId: 'gold', amount: 50 }, { itemId: 'potion', amount: 2 }] });
    expect('nextResetAt' in body.items[1]).toBe(false);
    // 値の無いプレイヤーは進捗 0
    const p3 = await (await list({ playerId: 'p3' })).json<ListBody>();
    expect(p3.items.map((i) => i.progress)).toEqual([0, 0]);
  });

  it('期間の外のクエストは一覧に出ず受け取りはQUEST_NOT_ACTIVEの409を返す', async () => {
    const now = nowSeconds();
    await addQuest('ended', { startsAt: now - 86400, endsAt: now - 1, threshold: 1 });
    await addQuest('future', { startsAt: now + 3600, endsAt: now + 86400, threshold: 1 });
    await addQuest('open-now', { threshold: 1 });
    await setValue('p1', 'kills', 5);
    const res = await list();
    expect(res.status).toBe(200);
    expect((await res.json<ListBody>()).items.map((i) => i.questId)).toEqual(['open-now']);
    await expectError(await claim('ended'), 409, 'QUEST_NOT_ACTIVE');
    await expectError(await claim('future'), 409, 'QUEST_NOT_ACTIVE');
    await expectNothingWritten();
  });
});

describe('Q1 報酬の受け取り', () => {
  it('達成したクエストの報酬を受け取ると所持品が増え受領の履歴にクエストの受け取りとして残る', async () => {
    await addQuest('hunt', { threshold: 3, rewards: [['gold', 50], ['potion', 2]] });
    await setValue('p1', 'kills', 3);
    const res = await claim('hunt');
    expect(res.status).toBe(200);
    const body = await res.json<ClaimBody>();
    expect(body).toMatchObject({ gameId: game, questId: 'hunt', periodKey: 'once',
      grants: [{ itemId: 'gold', amount: 50 }, { itemId: 'potion', amount: 2 }] });
    expect(body.claimId).not.toBe('');
    const inventory = await (await getInventory()).json<InventoryBody>();
    expect(inventory).toEqual({ gameId: game, currencies: [{ itemId: 'gold', amount: 50 }], items: [{ itemId: 'potion', amount: 2 }] });
    const history = await (await getHistory()).json<HistoryBody>();
    expect(history.items).toHaveLength(2);
    for (const row of history.items) expect(row).toMatchObject({ sourceType: 'quest-claim', sourceId: body.claimId });
    const listed = await (await list()).json<ListBody>();
    expect(listed.items.find((i) => i.questId === 'hunt')).toMatchObject({ completed: true, claimed: true });
  });

  it('達成していないクエストの受け取りはQUEST_NOT_COMPLETEDの409を返し何も書かない', async () => {
    await addQuest('hunt', { threshold: 3 });
    await setValue('p1', 'kills', 2);
    await expectError(await claim('hunt'), 409, 'QUEST_NOT_COMPLETED');
    await expectNothingWritten();
  });

  it('一度きりのクエストを2回受け取っても付与は1回分で同じ本文を返す', async () => {
    await addQuest('hunt', { threshold: 3, rewards: [['gold', 50], ['potion', 2]] });
    await setValue('p1', 'kills', 3);
    const first = await claim('hunt');
    const second = await claim('hunt');
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json<ClaimBody>()).toEqual(await first.json<ClaimBody>());
    expect(await balance('p1', 'gold')).toBe(50);
    expect(await balance('p1', 'potion')).toBe(2);
    expect(await count('inventory_ledger')).toBe(2);
    expect(await count('quest_claims')).toBe(1);
  });

  it('同じクエストの受け取りを並べて送っても付与は1回分', async () => {
    await addQuest('hunt', { threshold: 1 });
    await setValue('p1', 'kills', 1);
    const responses = await Promise.all(Array.from({ length: 10 }, () => claim('hunt')));
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(200));
    const bodies = await Promise.all(responses.map((r) => r.json<ClaimBody>()));
    expect(new Set(bodies.map((b) => b.claimId)).size).toBe(1);
    expect(await count('quest_claims')).toBe(1);
    expect(await count('inventory_ledger')).toBe(1);
    expect(await balance('p1', 'gold')).toBe(50);
  });

  it('報酬を足すと所持の上限を超えるクエストの受け取りはINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない', async () => {
    await addQuest('hunt', { threshold: 1, rewards: [['gold', 50], ['potion', 1]] });
    await setValue('p1', 'kills', 1);
    await baseEnv.DB.prepare("INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, 'p1', 'gold', ?, ?)")
      .bind(game, MAX_ITEM_AMOUNT - 1, nowSeconds()).run();
    await expectError(await claim('hunt'), 409, 'INVENTORY_LIMIT_EXCEEDED');
    expect(await count('quest_claims')).toBe(0);
    expect(await count('inventory_ledger')).toBe(0);
    expect(await balance('p1', 'gold')).toBe(MAX_ITEM_AMOUNT - 1);
    expect(await balance('p1', 'potion')).toBeNull();
  });

  it('知らないクエストの受け取りはNOT_FOUNDの404を返す', async () => {
    const res = await claim('no-such-quest');
    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error).toEqual({ code: 'NOT_FOUND', message: 'Unknown quest' });
    await expectNothingWritten();
  });

  it('ほかのプレイヤーの値ではクエストは達成にならない', async () => {
    await addQuest('hunt', { threshold: 3 });
    await setValue('p2', 'kills', 10);
    await setValue('p1', 'kills', 0);
    await expectError(await claim('hunt', { playerId: 'p1' }), 409, 'QUEST_NOT_COMPLETED');
    await expectNothingWritten();
  });

  it('値で置くキーを閾値より下げると受け取る前のクエストは達成でなくなる', async () => {
    await addQuest('reach', { key: 'level', threshold: 5 });
    expect((await writeValue('level', 5)).status).toBe(200);
    const first = await (await list()).json<ListBody>();
    expect(first.items.find((i) => i.questId === 'reach')).toMatchObject({ progress: 5, completed: true });
    expect((await writeValue('level', 0)).status).toBe(200);
    const second = await (await list()).json<ListBody>();
    expect(second.items.find((i) => i.questId === 'reach')).toMatchObject({ progress: 0, completed: false });
    await expectError(await claim('reach'), 409, 'QUEST_NOT_COMPLETED');
    await expectNothingWritten();
  });

  it('クエストの受け取りは達成の申告と送られた時刻を読まない', async () => {
    await addQuest('hunt', { threshold: 3 });
    const claimed = { body: JSON.stringify({ completed: true, progress: 999, now: '2000-01-01T00:00:00Z' }),
      headers: { 'content-type': 'application/json', Date: 'Sat, 01 Jan 2000 00:00:00 GMT' } };
    await expectError(await claim('hunt', claimed), 409, 'QUEST_NOT_COMPLETED');
    await expectNothingWritten();
    await setValue('p1', 'kills', 3);
    const before = Date.now();
    const res = await claim('hunt', claimed);
    expect(res.status).toBe(200);
    expect(Math.abs(Date.parse((await res.json<ClaimBody>()).claimedAt) - before)).toBeLessThanOrEqual(5000);
  });
});

describe('Q1 認証・守り・利用制限・BAN', () => {
  it('クエストはトークンの無い要求に401を返し利用制限を数えない', async () => {
    await addQuest('hunt', { threshold: 1 });
    await setValue('p1', 'kills', 1);
    await expectError(await list({ authorization: null }), 401, 'UNAUTHENTICATED');
    await expectError(await claim('hunt', { authorization: null }), 401, 'UNAUTHENTICATED');
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
    await expectNothingWritten();
  });

  it('トークンと違うゲームのクエストはPERMISSION_DENIEDの403を返す', async () => {
    await expectError(await list({ gameId: 'demo-rpg', tokenGame: game }), 403, 'PERMISSION_DENIED');
    await expectError(await claim(SMOKE_QUEST_ID, { gameId: 'demo-rpg', tokenGame: game }), 403, 'PERMISSION_DENIED');
  });

  it('questsを使わない設定のゲームのクエストはNOT_FOUNDの404を返す', async () => {
    await registerGame(baseEnv.DB, 'quest-off', ['inventory', 'player-data']);
    for (const res of [await list({ gameId: 'quest-off' }), await claim('hunt', { gameId: 'quest-off' })]) {
      expect(res.status).toBe(404);
      expect((await res.json<ErrorBody>()).error).toEqual({ code: 'NOT_FOUND', message: 'Feature not enabled for this game' });
    }
  });

  it('本番の設定ではクエストの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await addQuest('hunt', { threshold: 1 });
    await setValue('p1', 'kills', 1);
    await expectError(await list({ e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectError(await claim('hunt', { e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectNothingWritten();
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('クエストの操作を上限より多く呼ぶと429とRetry-Afterを返す', async () => {
    await addQuest('hunt', { threshold: 1 });
    await setValue('p1', 'kills', 1);
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.quests, `${game}:p1`);
    const res = await claim('hunt');
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
    expect((await res.json<ErrorBody>()).error.code).toBe('RATE_LIMITED');
    await expectNothingWritten();
  });

  it('BANしたプレイヤーのクエストの一覧と受け取りはPLAYER_BANNEDの403を返し何も書かない', async () => {
    await addQuest('hunt', { threshold: 1 });
    await setValue('p1', 'kills', 1);
    await baseEnv.DB.prepare("INSERT INTO player_bans (game_id, player_id, reason, banned_at) VALUES (?, 'p1', 'test', ?)")
      .bind(game, nowSeconds()).run();
    for (const res of [await list(), await claim('hunt')]) {
      expect(res.status).toBe(403);
      expect((await res.json<ErrorBody>()).error).toEqual({ code: 'PLAYER_BANNED', message: 'Player is banned' });
    }
    await expectNothingWritten();
  });

  it('クエストの閾値は1より小さくも上限より大きくもできない', async () => {
    const now = nowSeconds();
    const insert = 'INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, key, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)';
    await expect(baseEnv.DB.prepare(insert).bind(game, 'zero', 'once', now, now + 60, 'kills', 0).run()).rejects.toThrow();
    await expect(baseEnv.DB.prepare(insert).bind(game, 'over', 'once', now, now + 60, 'kills', MAX_PLAYER_DATA_VALUE + 1).run()).rejects.toThrow();
    // 上限ちょうどは入る（断ったのが閾値の CHECK だと分かる）
    await baseEnv.DB.prepare(insert).bind(game, 'max', 'once', now, now + 60, 'kills', MAX_PLAYER_DATA_VALUE).run();
    const rows = await baseEnv.DB.prepare('SELECT quest_id AS questId FROM quests WHERE game_id = ?').bind(game).all<{ questId: string }>();
    expect(rows.results.map((r) => r.questId)).toEqual(['max']);
  });
});

describe('Q1 スキーマと CLI モック', () => {
  it('クエストの一覧と受け取りの応答はスキーマに合う', async () => {
    const now = nowSeconds();
    await addQuest('hunt', { threshold: 1, rewards: [['gold', 50], ['potion', 2]] });
    await addQuest('far', { threshold: 100 });
    await addQuest('ended', { startsAt: now - 86400, endsAt: now - 1, threshold: 1 });
    await addQuest('big', { threshold: 1, rewards: [['potion', 100]] });
    await setValue('p1', 'kills', 1);
    await baseEnv.DB.prepare("INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, 'p1', 'potion', ?, ?)")
      .bind(game, MAX_ITEM_AMOUNT - 50, now).run();
    const listed = await expectConforms(await list(), listRoute, 'get') as ListBody;
    expect(listed.items.map((i) => i.questId)).toEqual(['big', 'far', 'hunt']);
    await expectConforms(await claim('hunt'), claimRoute, 'post');
    await expectConforms(await claim('hunt'), claimRoute, 'post');
    const cases: Array<[string, 'get' | 'post', Promise<Response>]> = [
      ['NOT_FOUND', 'post', claim('no-such-quest')],
      ['QUEST_NOT_ACTIVE', 'post', claim('ended')],
      ['QUEST_NOT_COMPLETED', 'post', claim('far')],
      ['INVENTORY_LIMIT_EXCEEDED', 'post', claim('big')],
      ['UNAUTHENTICATED', 'get', list({ authorization: null })],
    ];
    for (const [code, method, pending] of cases) {
      const err = await expectConforms(await pending, method === 'get' ? listRoute : claimRoute, method) as ErrorBody;
      expect(err.error.code).toBe(code);
    }
  });

  it('CLIモックと同じ流れでクエストを達成して報酬を受け取り二回目は二重にならない', async () => {
    // scripts/cli-mock.mjs のクエストの流れ（scripts/cli-requests.mjs で共有）: demo-rpg のゲスト → slimes-defeated に 1 → 一覧 →
    // first-hunt の受け取り → もう一度 → 一覧。落ちたら API か CLI モックを直す合図
    const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(base + path, init), localEnv as never);
    const guest = await call('/v1/accounts/guest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(guestRequest()),
    });
    expect(guest.status).toBe(200);
    const { gameId, token } = await guest.json<{ gameId: string; token: string }>();
    const headers = authHeaders(token);
    const written = await call(playerDataPath(gameId), {
      method: 'POST', headers: playerDataHeaders(token, newIdempotencyKey()), body: JSON.stringify(playerDataWrite(SMOKE_PLAYER_DATA_KEY, 1)),
    });
    expect(written.status).toBe(200);
    const quest = async () => {
      const res = await call(questsPath(gameId), { headers });
      expect(res.status).toBe(200);
      return (await res.json<ListBody>()).items.find((i) => i.questId === SMOKE_QUEST_ID);
    };
    expect(await quest()).toMatchObject({ progress: 1, completed: true, claimed: false });
    const gold = async () => {
      const res = await call(inventoryPath(gameId), { headers });
      expect(res.status).toBe(200);
      return (await res.json<InventoryBody>()).currencies.find((c) => c.itemId === 'gold')?.amount ?? 0;
    };
    const before = await gold();
    const first = await call(questClaimPath(SMOKE_QUEST_ID, gameId), { method: 'POST', headers });
    expect(first.status).toBe(200);
    const firstBody = await first.json<ClaimBody>();
    expect(firstBody.grants).toEqual([{ itemId: 'gold', amount: 50 }]);
    const second = await call(questClaimPath(SMOKE_QUEST_ID, gameId), { method: 'POST', headers });
    expect(second.status).toBe(200);
    expect(await second.json<ClaimBody>()).toEqual(firstBody);
    expect(await gold()).toBe(before + 50);
    expect(await quest()).toMatchObject({ completed: true, claimed: true });
  });
});
