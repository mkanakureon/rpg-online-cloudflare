/**
 * 所持品 E1: 所持品と受領の履歴を読む 2 つの口（GET /v1/inventory・GET /v1/inventory/history）と、応答の形・問い合わせの検証の関数の試験。
 * 名前と期待する結果の正は docs/guides/working/event-reward-design.md §8 の E1 の行（スキーマの操作の数・モジュールの一覧・
 * demo-rpg の設定の 3 本は test/schema-conformance.test.ts・test/modules.test.ts・test/game-modules.test.ts）。
 * L1 は関数を直に呼ぶ。L2 は src/worker.ts の default.fetch を直に呼び、読むのにも APP_ENV=local を渡す（読むのにも門を掛ける。§7）。
 * 試験のゲームは専用の inv-game（beforeEach で登録と品目の行を入れる）。残高・履歴は表に直に入れる（書く口は E2 の受け取り）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_ITEM_AMOUNT } from '../src/core/inventory';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { HISTORY_LIMIT_DEFAULT, HISTORY_LIMIT_MAX } from '../src/modules/inventory/limits';
import { parseHistoryQuery, shapeInventory } from '../src/modules/inventory/shape';
import specJson from '../openapi/rpg-online.v1.json';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { countRateLimitRows, fillRateLimit, resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';
const game = 'inv-game';

type Entry = { itemId: string; amount: number };
type InventoryBody = { gameId: string; currencies: Entry[]; items: Entry[] };
type HistoryItem = { entryId: number; itemId: string; delta: number; sourceType: string; sourceId: string; createdAt: string };
type HistoryBody = { gameId: string; items: HistoryItem[]; nextBefore?: number };
type ErrorBody = { error: { code: string; message: string } };
type Who = { gameId?: string; playerId?: string; authorization?: string | null; e?: unknown };

type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type Spec = SchemaRoot & { paths: Record<string, Record<string, { operationId: string; responses: Record<string, ResponseSpec> }>> };
const spec = specJson as unknown as Spec;

async function send(path: string, who: Who = {}): Promise<Response> {
  const gameId = who.gameId ?? game;
  const headers: Record<string, string> = {};
  const authorization = who.authorization === undefined ? await bearer(gameId, who.playerId ?? 'p1') : who.authorization;
  if (authorization !== null) headers.authorization = authorization;
  const sep = path.includes('?') ? '&' : '?';
  return worker.fetch(new Request(`${base}${path}${sep}gameId=${gameId}`, { headers }), (who.e ?? localEnv) as never);
}
const getInventory = (who: Who = {}) => send('/v1/inventory', who);
const getHistory = (query = '', who: Who = {}) => send(`/v1/inventory/history${query ? `?${query}` : ''}`, who);

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
async function addBalance(playerId: string, itemId: string, amount: number, gameId = game): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(gameId, playerId, itemId, amount, Math.floor(Date.now() / 1000)).run();
}
async function addLedger(playerId: string, itemId: string, delta: number, sourceId: string): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at) '
    + "VALUES (?, ?, ?, ?, 'event-claim', ?, ?)").bind(game, playerId, itemId, delta, sourceId, Math.floor(Date.now() / 1000)).run();
}
/** 応答をスキーマの操作の状態の形に当てる（test/schema-conformance.test.ts の expectConforms と同じ見方）。 */
async function expectConforms(res: Response, path: string): Promise<{ spec: ResponseSpec; body: unknown }> {
  const r = spec.paths[path].get.responses[String(res.status)];
  expect(r, `${path} の応答に状態 ${res.status} がある`).toBeDefined();
  for (const [name, h] of Object.entries(r.headers ?? {})) {
    const value = res.headers.get(name);
    if (h.required) expect(value, `ヘッダー ${name} がある`).not.toBeNull();
    if (value !== null) expect(validate(value, h.schema, spec), `ヘッダー ${name}`).toEqual([]);
  }
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body = await res.json();
  expect(validate(body, r.content!['application/json'].schema, spec), `${path} ${res.status} の本文`).toEqual([]);
  return { spec: r, body };
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）の品目だけ残す。
// 残高・履歴が品目を外部キーで指すので、残高・履歴 → 品目 → 機能の設定 → ゲームの順に消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM inventory_ledger'),
    baseEnv.DB.prepare('DELETE FROM inventory_balances'),
    baseEnv.DB.prepare("DELETE FROM inventory_items WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
  await registerGame(baseEnv.DB, game, ['inventory']);
  const item = baseEnv.DB.prepare('INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, ?, ?)');
  await baseEnv.DB.batch([item.bind(game, 'gold', 'currency'), item.bind(game, 'potion', 'item'), item.bind(game, 'elixir', 'item')]);
});

describe('E1 所持品の関数', () => {
  it('所持品の応答は通貨と所持品に分けて品目のIDの順に並べる', () => {
    expect(shapeInventory([
      { itemId: 'potion', kind: 'item', amount: 3 },
      { itemId: 'gold', kind: 'currency', amount: 100 },
      { itemId: 'elixir', kind: 'item', amount: 1 },
    ])).toEqual({
      currencies: [{ itemId: 'gold', amount: 100 }],
      items: [{ itemId: 'elixir', amount: 1 }, { itemId: 'potion', amount: 3 }],
    });
  });

  it('受領の履歴のlimitは1から100で既定は20', () => {
    const limitOf = (q: string) => parseHistoryQuery(new URL(`${base}/v1/inventory/history?gameId=g${q}`));
    expect(HISTORY_LIMIT_DEFAULT).toBe(20);
    expect(HISTORY_LIMIT_MAX).toBe(100);
    expect(limitOf('')).toEqual({ ok: true, value: { limit: 20, before: null } });
    expect(limitOf('&limit=1')).toEqual({ ok: true, value: { limit: 1, before: null } });
    expect(limitOf('&limit=100')).toEqual({ ok: true, value: { limit: 100, before: null } });
    for (const raw of ['0', '101', 'abc']) expect(limitOf(`&limit=${raw}`).ok, raw).toBe(false);
  });

  it('受領の履歴のbeforeは1以上の整数だけ受け付ける', () => {
    const beforeOf = (q: string) => parseHistoryQuery(new URL(`${base}/v1/inventory/history?gameId=g${q}`));
    expect(beforeOf('')).toEqual({ ok: true, value: { limit: 20, before: null } });
    expect(beforeOf('&before=42')).toEqual({ ok: true, value: { limit: 20, before: 42 } });
    for (const raw of ['0', '-1', '1.5', 'abc']) expect(beforeOf(`&before=${raw}`).ok, raw).toBe(false);
  });

  it('報酬の利用制限の回数と窓は定数のモジュールにある', () => {
    expect(RATE_LIMITS.rewards).toEqual({ scope: 'rewards', limit: 60, period: 60 });
  });
});

describe('E1 所持品と受領の履歴を読む', () => {
  it('所持品を読むとトークンのプレイヤーの通貨と所持品だけが返る', async () => {
    await addBalance('p1', 'gold', 100);
    await addBalance('p1', 'potion', 3);
    await addBalance('p2', 'gold', 999);
    await addBalance('p2', 'elixir', 7);
    const res = await getInventory({ playerId: 'p1' });
    expect(res.status).toBe(200);
    expect(await res.json<InventoryBody>()).toEqual({
      gameId: game, currencies: [{ itemId: 'gold', amount: 100 }], items: [{ itemId: 'potion', amount: 3 }],
    });
  });

  it('何も受け取っていないプレイヤーの所持品は空の一覧で返る', async () => {
    await addBalance('p2', 'gold', 50);
    const res = await getInventory({ playerId: 'p1' });
    expect(res.status).toBe(200);
    expect(await res.json<InventoryBody>()).toEqual({ gameId: game, currencies: [], items: [] });
  });

  it('受領の履歴は新しい順に返りlimitで区切って続きを読める', async () => {
    await addLedger('p1', 'gold', 100, 'claim-a');
    await addLedger('p1', 'potion', 2, 'claim-b');
    await addLedger('p2', 'gold', 5, 'claim-other');
    await addLedger('p1', 'gold', 100, 'claim-c');
    const first = await getHistory('limit=2', { playerId: 'p1' });
    expect(first.status).toBe(200);
    const page1 = await first.json<HistoryBody>();
    expect(page1.items.map((i) => i.sourceId)).toEqual(['claim-c', 'claim-b']);
    expect(page1.items[0]).toMatchObject({ itemId: 'gold', delta: 100, sourceType: 'event-claim' });
    expect(page1.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(page1.items[0].entryId).toBeGreaterThan(page1.items[1].entryId);
    expect(page1.nextBefore).toBe(page1.items[1].entryId);
    const second = await getHistory(`limit=2&before=${page1.nextBefore}`, { playerId: 'p1' });
    expect(second.status).toBe(200);
    const page2 = await second.json<HistoryBody>();
    expect(page2.items.map((i) => i.sourceId)).toEqual(['claim-a']);
    expect('nextBefore' in page2).toBe(false);
  });

  it('所持品はトークンの無い要求に401を返す', async () => {
    await expectError(await getInventory({ authorization: null }), 401, 'UNAUTHENTICATED');
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('トークンと違うゲームの所持品はPERMISSION_DENIEDの403を返す', async () => {
    const res = await send('/v1/inventory', { gameId: 'demo-rpg', authorization: await bearer(game, 'p1') });
    await expectError(res, 403, 'PERMISSION_DENIED');
  });

  it('inventoryを使わない設定のゲームの所持品はNOT_FOUNDの404を返す', async () => {
    await registerGame(baseEnv.DB, 'no-inventory', ['saves']);
    const res = await getInventory({ gameId: 'no-inventory' });
    expect(res.status).toBe(404);
    expect((await res.json<ErrorBody>()).error).toEqual({ code: 'NOT_FOUND', message: 'Feature not enabled for this game' });
    await expectError(await getHistory('', { gameId: 'no-inventory' }), 404, 'NOT_FOUND');
  });

  it('本番の設定では所持品の読み取りにNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await expectError(await getInventory({ e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectError(await getHistory('', { e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('報酬の操作を上限より多く呼ぶと429とRetry-Afterを返す', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.rewards, `${game}:p1`);
    const res = await getInventory({ playerId: 'p1' });
    await expectError(res, 429, 'RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
    expect(Number(res.headers.get('Retry-After'))).toBeLessThanOrEqual(RATE_LIMITS.rewards.period);
    await expectError(await getHistory('', { playerId: 'p1' }), 429, 'RATE_LIMITED');
    expect((await getInventory({ playerId: 'p2' })).status).toBe(200);
  });

  it('所持品の残高はマイナスにも上限より大きくもできない', async () => {
    await expect(addBalance('p1', 'gold', -1)).rejects.toThrow(/CHECK/);
    await expect(addBalance('p1', 'gold', MAX_ITEM_AMOUNT + 1)).rejects.toThrow(/CHECK/);
    await addBalance('p1', 'gold', MAX_ITEM_AMOUNT);
    const row = await baseEnv.DB.prepare("SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = 'p1'")
      .bind(game).first<{ amount: number }>();
    expect(row?.amount).toBe(MAX_ITEM_AMOUNT);
  });

  it('所持品と受領の履歴の応答はスキーマに合う', async () => {
    await addBalance('p1', 'gold', 100);
    await addBalance('p1', 'potion', 3);
    await addLedger('p1', 'gold', 100, 'claim-a');
    await addLedger('p1', 'potion', 3, 'claim-a');
    await expectConforms(await getInventory(), '/v1/inventory');
    const { body } = await expectConforms(await getHistory('limit=1'), '/v1/inventory/history');
    expect((body as HistoryBody).nextBefore).toBeDefined();
    await expectConforms(await getHistory(), '/v1/inventory/history');
    for (const path of ['/v1/inventory', '/v1/inventory/history']) {
      const res = await send(path, { authorization: null });
      expect(res.status).toBe(401);
      const { spec: r, body: err } = await expectConforms(res, path);
      expect(r['x-error-codes']).toContain((err as ErrorBody).error.code);
    }
  });
});
