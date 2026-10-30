/**
 * 利用制限 R2: セーブの 4 つの操作（PUT・GET /v1/saves/{slotId}・GET /v1/saves・DELETE）に、トークンのプレイヤーごとの
 * 利用制限（RATE_LIMITS.saves。4 つを合わせて数える）を掛けた試験。名前と確かめることの正は
 * docs/guides/working/abuse-protection-design.md §7 の R2 の行。L2 は src/worker.ts の default.fetch を直に呼び、
 * 制限を超える試験は数の表に開始状態を入れてから 1 回だけ送る（test/support/rate-limits.ts）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { sha256Hex } from '../src/modules/saves/checksum';
import { bearer } from './support/auth';
import { fillRateLimit, resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

async function send(method: string, path: string, body?: string): Promise<Response> {
  const headers = { 'content-type': 'application/json', authorization: await bearer('demo-rpg', 'p1') };
  return worker.fetch(new Request(`${base}${path}`, { method, headers, body }), localEnv as never);
}
async function write(slotId: string, data: string, baseRevision: number): Promise<Response> {
  const body = JSON.stringify({ formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision });
  return send('PUT', `/v1/saves/${slotId}?gameId=demo-rpg`, body);
}
async function expectRateLimited(res: Response): Promise<void> {
  expect(res.status).toBe(429);
  expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  const retryAfter = res.headers.get('Retry-After');
  expect(retryAfter).toMatch(/^\d+$/);
  expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
  expect(Number(retryAfter)).toBeLessThanOrEqual(60);
}

beforeEach(async () => {
  await resetRateLimits(baseEnv.DB);
  await baseEnv.DB.prepare('DELETE FROM saves').run();
});

describe('R2: セーブの利用制限（L2）', () => {
  it('セーブの操作を上限より多く呼ぶと429とRetry-Afterを返す', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.saves, 'demo-rpg:p1');
    await expectRateLimited(await send('GET', '/v1/saves?gameId=demo-rpg'));
  });

  it('セーブの利用制限で断った書き込みはリビジョンを進めない', async () => {
    expect((await write('auto', 'first', 0)).status).toBe(200);
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.saves, 'demo-rpg:p1');
    await expectRateLimited(await write('auto', 'second', 1));
    const row = await baseEnv.DB.prepare("SELECT revision, data FROM saves WHERE game_id = 'demo-rpg' AND player_id = 'p1' AND slot_id = 'auto'")
      .first<{ revision: number; data: string }>();
    expect(row).toEqual({ revision: 1, data: 'first' });
  });

  it('セーブの利用制限はスコアの投稿と別に数える', async () => {
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.score, 'demo-rpg:p1');
    const res = await write('auto', 'data', 0);
    expect(res.status).toBe(200);
  });
});
