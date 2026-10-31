/**
 * 利用制限 R1: D1 の固定窓の利用制限（src/core/rate-limit.ts・src/core/rate-limit-policy.ts）と、
 * ゲストの発行（IP ごと・ゲームごと）とスコアの投稿（プレイヤーごと）への掛け方。K3 の残りの 2 本（連投の 429・送信 ID）もここ。
 * 名前と確かめることの正は docs/guides/working/abuse-protection-design.md §7（K3 の 2 本の名前の正は
 * docs/guides/working/failure-case-test-plan.md §3）。スキーマの 2 本は test/schema-conformance.test.ts、CLI モックの 1 本は
 * test/failure-server.test.ts。L1 は関数を直に呼ぶ。L2 は src/worker.ts の default.fetch を直に呼び、制限を超える試験は
 * 数の表に開始状態を入れてから 1 回だけ送る（test/support/rate-limits.ts）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { decide, retryAfterSeconds, windowStart } from '../src/core/rate-limit';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { bearer } from './support/auth';
import { countRateLimitRows, fillRateLimit, resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

function postGuest(ip: string | null, e: unknown = localEnv): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip !== null) headers['CF-Connecting-IP'] = ip;
  return worker.fetch(new Request(`${base}/v1/accounts/guest`, {
    method: 'POST', headers, body: JSON.stringify({ gameId: 'demo-rpg' }),
  }), e as never);
}
/** player のトークンで player のスコアを送る。authorization が null なら付けない。 */
async function postScore(
  player: string, score: number, options: { authorization?: string | null; headers?: Record<string, string>; e?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...options.headers };
  const authorization = options.authorization === undefined ? await bearer('demo-rpg', player) : options.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}/v1/rankings/boss-score`, {
    method: 'POST', headers, body: JSON.stringify({ gameId: 'demo-rpg', playerId: player, displayName: player, score }),
  }), (options.e ?? localEnv) as never);
}
async function count(table: 'accounts' | 'game_players' | 'ranking_entries'): Promise<number> {
  const row = await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}
async function expectRateLimited(res: Response): Promise<void> {
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  const retryAfter = res.headers.get('Retry-After');
  expect(retryAfter).toMatch(/^\d+$/);
  expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  expect(Number(retryAfter)).toBeLessThanOrEqual(60);
}
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(async () => {
  await resetRateLimits(baseEnv.DB);
  await baseEnv.DB.prepare('DELETE FROM ranking_entries').run();
});

describe('R1: 数え方（L1）', () => {
  it('利用制限の窓の始まりと残りの秒は時刻と長さから決まる', () => {
    expect(windowStart(125, 60)).toBe(120);
    expect(retryAfterSeconds(125, 60)).toBe(55);
    expect(retryAfterSeconds(120, 60)).toBe(60);
  });

  it('足した後の数が上限までなら通し上限を超えたら断る', () => {
    expect(decide(30, 30)).toBe(true);
    expect(decide(31, 30)).toBe(false);
  });

  it('利用制限の回数と窓は定数のモジュールにある', () => {
    expect(RATE_LIMITS).toEqual({
      guestIp: { scope: 'guest-ip', limit: 10, period: 60 },
      guestGame: { scope: 'guest-game', limit: 300, period: 60 },
      score: { scope: 'score', limit: 30, period: 60 },
      saves: { scope: 'saves', limit: 60, period: 60 },
      rewards: { scope: 'rewards', limit: 60, period: 60 },
      admin: { scope: 'admin-ip', limit: 60, period: 60 },
      playerData: { scope: 'player-data', limit: 60, period: 60 },
      quests: { scope: 'quests', limit: 60, period: 60 },
    });
  });
});

describe('R1: ゲストの発行', () => {
  it('同じIPからゲストを上限より多く発行すると429とRetry-Afterを返し行を作らない', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.guestIp, await sha256Hex('203.0.113.1'));
    const accounts = await count('accounts');
    const players = await count('game_players');
    await expectRateLimited(await postGuest('203.0.113.1'));
    expect(await count('accounts')).toBe(accounts);
    expect(await count('game_players')).toBe(players);
  });

  it('ゲストの発行の利用制限はIPごとに別に数える', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.guestIp, await sha256Hex('203.0.113.1'));
    expect((await postGuest('203.0.113.1')).status).toBe(429);
    const res = await postGuest('203.0.113.2');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gameId: 'demo-rpg' });
  });

  it('ゲームごとのゲストの発行の上限を超えると429を返す', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.guestGame, 'demo-rpg');
    const accounts = await count('accounts');
    const players = await count('game_players');
    await expectRateLimited(await postGuest('203.0.113.50'));
    expect(await count('accounts')).toBe(accounts);
    expect(await count('game_players')).toBe(players);
  });

  it('利用制限の表にIPをそのまま残さない', async () => {
    expect((await postGuest('203.0.113.9')).status).toBe(200);
    const rows = (await baseEnv.DB.prepare('SELECT scope, subject FROM rate_limit_counters').all<{ scope: string; subject: string }>()).results;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.subject).not.toContain('203.0.113.9');
    expect(rows.find((r) => r.scope === 'guest-ip')?.subject).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('R1: スコアの投稿', () => {
  it('スコアの投稿の利用制限はプレイヤーごとに別に数える', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.score, 'demo-rpg:p1');
    expect((await postScore('p2', 100)).status).toBe(200);
    await expectRateLimited(await postScore('p1', 100));
  });

  it('トークンの無い書き込みは利用制限を数えず401を返す', async () => {
    const res = await postScore('p1', 100, { authorization: null });
    expect(res.status).toBe(401);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('UNAUTHENTICATED');
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('本番の設定では利用制限より先にNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    const disabled = { ...baseEnv, APP_ENV: 'disabled' };
    for (const res of [await postGuest('203.0.113.1', disabled), await postScore('p1', 100, { e: disabled })]) {
      expect(res.status).toBe(403);
      expect((await res.json<{ error: { code: string } }>()).error.code).toBe('NOT_READY_FOR_PRODUCTION');
    }
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('前の窓の数は次の窓に持ち越さない', async () => {
    const { scope, period, limit } = RATE_LIMITS.score;
    const previous = windowStart(Math.floor(Date.now() / 1000), period) - period;
    await baseEnv.DB.prepare('INSERT INTO rate_limit_counters (scope, subject, window_start, count) VALUES (?, ?, ?, ?)')
      .bind(scope, 'demo-rpg:p1', previous, limit).run();
    expect((await postScore('p1', 100)).status).toBe(200);
    const old = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM rate_limit_counters WHERE scope = ? AND subject = ? AND window_start <= ?')
      .bind(scope, 'demo-rpg:p1', previous).first<{ n: number }>();
    expect(old?.n).toBe(0);
  });
});

describe('K3: 連投の制限と送信 ID', () => {
  it('決めた回数を超えて連投すると429を返す', async () => {
    expect((await postScore('p1', 1000)).status).toBe(200);
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.score, 'demo-rpg:p1');
    await expectRateLimited(await postScore('p1', 2000));
    const rows = (await baseEnv.DB.prepare('SELECT player_id, score FROM ranking_entries').all<{ player_id: string; score: number }>()).results;
    expect(rows).toEqual([{ player_id: 'p1', score: 1000 }]);
  });

  it('同じ送信IDの二重送信は1回分として扱う', async () => {
    const headers = { 'Idempotency-Key': 'submit-0001' };
    const first = await postScore('p1', 1200, { headers });
    const second = await postScore('p1', 1200, { headers });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const rows = (await baseEnv.DB.prepare('SELECT player_id, score FROM ranking_entries').all<{ player_id: string; score: number }>()).results;
    expect(rows).toEqual([{ player_id: 'p1', score: 1200 }]);
  });
});
