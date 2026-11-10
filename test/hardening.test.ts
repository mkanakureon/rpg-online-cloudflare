/**
 * 堅めの G2（挙動を変えない束）: 未採用の改善の仕分けで残った試験と、D1 の batch の文の数のいちばん多い書き込みの試験。
 * 名前と見ることの正は docs/guides/working/hardening-design.md §11 の G2 の行（§7 の #12・#18・#19・#29・#36・#47・#53 と §8）。
 * G2 の残りの 2 本（`スキーマの突き合わせの試験は前の試験の行に左右されない`・`試験のスキーマの確かめはtypeの配列とminItemsを見る`）は
 * test/schema-conformance.test.ts の中にある。いまの挙動を確かめるだけで、src/ は変えない。
 * GET /health は DB を引かない（src/core/router.ts）。2026-11-10 にユーザーがいまの挙動を正にすると決め（§7 の #12。Issue #72）、
 * `ヘルスチェックはDBが壊れていても読まずに200を返す` でそれを確かめる。
 * L2 は src/worker.ts の default.fetch を直に呼ぶ。管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）。試験のゲームは専用の hard-game で、
 * プレイヤーは game_players・accounts に行を直に入れ、トークンは test/support/auth.ts で作る。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-10
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { activityDay } from '../src/core/activity';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { MAX_CHANGES_PER_WRITE } from '../src/modules/player-data/limits';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { fillRateLimit, resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string; AUTH_TOKEN_SECRET?: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const adminEnv: TestEnv = { ...localEnv, ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'hard-game';
const modules = ['rankings', 'saves', 'inventory', 'player-data'];

// prepare を呼ぶと D1 のエラーに似た例外を投げる偽の DB（DB を読む口なら 500 になる）
let brokenReads = 0;
const brokenDB = {
  prepare(): never { brokenReads += 1; throw new Error('D1_ERROR: SQLITE_ERROR: no such table: games'); },
};

type ErrorBody = { error: { code: string; message: string } };

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** トークンの要る口に送る（既定は hard-game の p1 のトークン・ローカルの環境）。 */
async function send(method: string, path: string, options: { playerId?: string; e?: TestEnv; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  const headers: Record<string, string> = { authorization: await bearer(game, options.playerId ?? 'p1'), ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const sep = path.includes('?') ? '&' : '?';
  return worker.fetch(new Request(`${base}${path}${sep}gameId=${game}`, { method, headers, body }), (options.e ?? localEnv) as never);
}
/** 管理の増減の口に送る。key を null にすると Idempotency-Key を付けない。 */
function adjust(playerId: string, body: unknown, key: string | null = crypto.randomUUID()): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json', 'X-Admin-Actor': 'local-admin' };
  if (key !== null) headers['Idempotency-Key'] = key;
  return worker.fetch(new Request(`${base}/v1/admin/players/${playerId}/inventory?gameId=${game}`, {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }), adminEnv as never);
}
async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  expect(res.status, code).toBe(status);
  const body = await res.json<ErrorBody>();
  expect(body.error.code).toBe(code);
  return body;
}
async function expectInternalError(res: Response): Promise<string> {
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  return text;
}
async function countRows(table: string, where = 'game_id = ?', ...binds: unknown[]): Promise<number> {
  const values = binds.length > 0 ? binds : [game];
  return (await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).bind(...values).first<{ n: number }>())?.n ?? 0;
}
async function addPlayer(playerId: string): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare("INSERT INTO accounts (account_id, kind) VALUES (?, 'guest')").bind(`acc-${game}-${playerId}`),
    baseEnv.DB.prepare('INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, ?, ?)').bind(game, playerId, `acc-${game}-${playerId}`),
  ]);
}
async function banPlayer(playerId: string): Promise<void> {
  await baseEnv.DB.prepare("INSERT INTO player_bans (game_id, player_id, reason, banned_at) VALUES (?, ?, 'test', ?)")
    .bind(game, playerId, nowSeconds()).run();
}

// 試験のゲームの行を消してから登録し直す（ほかの試験のファイルの行には触れない）
beforeEach(async () => {
  const byGame = (table: string) => baseEnv.DB.prepare(`DELETE FROM ${table} WHERE game_id = ?`).bind(game);
  const players = baseEnv.DB.prepare('SELECT account_id FROM game_players WHERE game_id = ?').bind(game);
  const accounts = (await players.all<{ account_id: string }>()).results.map((r) => r.account_id);
  await baseEnv.DB.batch([
    byGame('admin_audit_log'), byGame('inventory_ledger'), byGame('inventory_balances'), byGame('saves'), byGame('player_bans'),
    byGame('player_activity_days'), byGame('player_achievements'), byGame('player_data_period_values'), byGame('player_data'),
    byGame('player_data_writes'), byGame('player_data_key_periods'), byGame('player_data_keys'), byGame('game_players'),
    byGame('inventory_items'),
    ...accounts.map((a) => baseEnv.DB.prepare('DELETE FROM accounts WHERE account_id = ?').bind(a)),
  ]);
  await resetRateLimits(baseEnv.DB);
  await registerGame(baseEnv.DB, game, modules);
  const item = baseEnv.DB.prepare('INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, ?, ?)');
  await baseEnv.DB.batch([item.bind(game, 'gold', 'currency'), item.bind(game, 'potion', 'item')]);
});

describe('G2 入口の 500 と 400（§7 の #12・#18・#19）', () => {
  it('ヘルスチェックはDBが壊れていても読まずに200を返す', async () => {
    brokenReads = 0;
    for (const e of [{ ...baseEnv, DB: brokenDB }, { ...localEnv, DB: brokenDB }]) {
      const res = await worker.fetch(new Request(`${base}/health`), e as never);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ status: 'ok', service: 'rpg-online-backend' });
    }
    // DB を一度も読まない
    expect(brokenReads).toBe(0);
  });

  it('管理の書き込みの本文が配列ならObject requiredの400を返す', async () => {
    await addPlayer('p1');
    for (const body of ['[]', '[{"itemId":"gold","delta":5,"reason":"x"}]', 'null', '7']) {
      const res = await adjust('p1', body);
      const error = await expectError(res, 400, 'INVALID_ARGUMENT');
      expect(error.error.message, body).toBe('Object required');
    }
    expect(await countRows('admin_audit_log')).toBe(0);
    expect(await countRows('inventory_balances')).toBe(0);
  });

  it('トークンの鍵が短い環境ではゲストの発行と書き込みがINTERNAL_ERRORの500を返す', async () => {
    const shortSecret = 'x'.repeat(31);
    const e: TestEnv = { ...localEnv, AUTH_TOKEN_SECRET: shortSecret };
    const guest = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: game }),
    }), e as never);
    for (const text of [
      await expectInternalError(guest),
      await expectInternalError(await send('PUT', '/v1/saves/auto', { e, body: { formatVersion: 1, data: 'x', checksum: '0'.repeat(64), baseRevision: 0 } })),
      await expectInternalError(await send('POST', '/v1/rankings/boss', { e, body: { gameId: game, playerId: 'p1', displayName: 'Hero', score: 1 } })),
      await expectInternalError(await send('POST', '/v1/player-data', { e, body: { changes: [] }, headers: { 'Idempotency-Key': crypto.randomUUID() } })),
      await expectInternalError(await send('POST', '/v1/accounts/token', { e })),
    ]) {
      // 鍵の名前・値は応答に出さない
      expect(text).not.toContain('AUTH_TOKEN_SECRET');
      expect(text).not.toContain(shortSecret);
    }
    // 発行も書き込みも何も残さない
    expect(await countRows('game_players')).toBe(0);
    expect(await countRows('saves')).toBe(0);
    expect(await countRows('ranking_entries')).toBe(0);
    expect(await countRows('player_activity_days')).toBe(0);
  });
});

describe('G2 利用制限と止めた印（§7 の #29・#47・#53）', () => {
  it('セーブの1つの読み取りと削除も利用制限で429を返す', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.saves, `${game}:p1`);
    for (const [method, path] of [['GET', '/v1/saves/auto'], ['DELETE', '/v1/saves/auto?baseRevision=1']]) {
      const res = await send(method, path);
      const body = await expectError(res, 429, 'RATE_LIMITED');
      expect(body.error.message).toBe('Too many requests');
      expect(res.headers.get('Retry-After'), method).toMatch(/^[1-9][0-9]*$/);
    }
  });

  it('BANで断ったトークンの要求も遊んだ日に数える', async () => {
    await banPlayer('p1');
    const day = activityDay(nowSeconds());
    await expectError(await send('GET', '/v1/inventory'), 403, 'PLAYER_BANNED');
    const rows = (await baseEnv.DB.prepare('SELECT day, player_id AS playerId, is_new AS isNew FROM player_activity_days WHERE game_id = ?')
      .bind(game).all<{ day: string; playerId: string; isNew: number }>()).results;
    expect(rows).toEqual([{ day, playerId: 'p1', isNew: 0 }]);
  });

  it('BANされたプレイヤーも上限を超えれば403でなく429を返す', async () => {
    await banPlayer('p1');
    // 上限の内では止めた印で 403
    await expectError(await send('GET', '/v1/inventory'), 403, 'PLAYER_BANNED');
    // 上限を超えると、止めた印を見る前に 429（利用制限 → 止めた印 の順。src/core/access.ts）
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.rewards, `${game}:p1`);
    const res = await send('GET', '/v1/inventory');
    await expectError(res, 429, 'RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
  });
});

describe('G2 管理の増減（§7 の #36）', () => {
  it('管理の増減で無い品目への負の増減はNOT_FOUNDの404を返す', async () => {
    await addPlayer('p1');
    for (const delta of [-1, -50]) {
      const body = await expectError(await adjust('p1', { itemId: 'no-item', delta, reason: '試験の修正' }), 404, 'NOT_FOUND');
      expect(body.error.message).toBe('Unknown item');
    }
    expect(await countRows('admin_audit_log')).toBe(0);
    expect(await countRows('inventory_ledger')).toBe(0);
    expect(await countRows('inventory_balances')).toBe(0);
  });

  it('管理の増減の監査のrequest_keyは送ったIdempotency-Keyと同じ', async () => {
    await addPlayer('p1');
    const keys = ['hard-key-0001', crypto.randomUUID()];
    for (const key of keys) {
      const res = await adjust('p1', { itemId: 'gold', delta: 10, reason: '試験の修正' }, key);
      expect(res.status).toBe(200);
      const { auditId } = await res.json<{ auditId: number }>();
      const row = await baseEnv.DB.prepare('SELECT request_key AS requestKey FROM admin_audit_log WHERE audit_id = ?')
        .bind(auditId).first<{ requestKey: string }>();
      expect(row?.requestKey).toBe(key);
    }
    // 同じ鍵の送り直しは行を増やさない
    expect((await adjust('p1', { itemId: 'gold', delta: 10, reason: '試験の修正' }, keys[0])).status).toBe(200);
    const rows = (await baseEnv.DB.prepare('SELECT request_key AS requestKey FROM admin_audit_log WHERE game_id = ? ORDER BY audit_id')
      .bind(game).all<{ requestKey: string }>()).results;
    expect(rows.map((r) => r.requestKey)).toEqual(keys);
  });
});

describe('G2 D1 の batch の文の数（§8）', () => {
  it('区切りを2つ持つ増やすキーを上限の数だけ書く1回のbatchがローカルのD1で通る', async () => {
    // 変更の数の上限ぶんの add のキー。どれもデイリーと週間の 2 つの区切りを宣言する
    const keys = Array.from({ length: MAX_CHANGES_PER_WRITE }, (_, i) => `hard-add-${String(i).padStart(2, '0')}`);
    const now = nowSeconds();
    const declareKey = baseEnv.DB.prepare("INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, 'add', 1000, 10)");
    const declarePeriod = baseEnv.DB.prepare('INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at) VALUES (?, ?, ?, 0, ?)');
    await baseEnv.DB.batch(keys.map((k) => declareKey.bind(game, k)));
    await baseEnv.DB.batch(keys.flatMap((k) => [declarePeriod.bind(game, k, 'daily', now), declarePeriod.bind(game, k, 'weekly', now)]));
    // 1 回の batch の文: 記録 1 + 変更 20 + 区切りの値 40 + 実績 1 + 写し 1 = 63（hardening-design.md §8）
    const res = await send('POST', '/v1/player-data', {
      body: { changes: keys.map((key) => ({ key, value: 3 })) }, headers: { 'Idempotency-Key': crypto.randomUUID() },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ values: Array<{ key: string; value: number }> }>();
    expect(body.values).toEqual(keys.map((key) => ({ key, value: 3 })));
    expect(await countRows('player_data_writes')).toBe(1);
    expect(await countRows('player_data', 'game_id = ? AND value = 3', game)).toBe(MAX_CHANGES_PER_WRITE);
    const periodValues = (await baseEnv.DB.prepare('SELECT kind, COUNT(*) AS n, SUM(value) AS total FROM player_data_period_values '
      + 'WHERE game_id = ? GROUP BY kind ORDER BY kind').bind(game).all<{ kind: string; n: number; total: number }>()).results;
    expect(periodValues).toEqual([
      { kind: 'daily', n: MAX_CHANGES_PER_WRITE, total: 3 * MAX_CHANGES_PER_WRITE },
      { kind: 'weekly', n: MAX_CHANGES_PER_WRITE, total: 3 * MAX_CHANGES_PER_WRITE },
    ]);
  });
});
