/**
 * アカウント A2: スコアの投稿（POST /v1/rankings/{boardId}）の認証となりすまし、と K3 の「認証後」の 5 本。
 * 名前と確かめることの正は docs/guides/working/account-design.md §6 の A2（スキーマの 2 本は test/schema-conformance.test.ts）と、
 * K3 の名前の正の docs/guides/working/failure-case-test-plan.md §3。検査の順は account-design.md §5。
 * src/worker.ts の default.fetch を直に呼ぶ L2 の試験。書き込みだけ APP_ENV=local を渡す。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { bearer, tokenFor } from './support/auth';
import { registerGame } from './support/games';

type TestEnv = { DB: D1Database; APP_ENV: string; AUTH_TOKEN_SECRET?: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(base + path), baseEnv as never);
}
/** Authorization を指定して（null なら付けずに）スコアを送る。 */
function postRaw(boardId: string, body: string, authorization: string | null, e: unknown = localEnv): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, { method: 'POST', headers, body }), e as never);
}
function post(boardId: string, body: unknown, authorization: string | null, e: unknown = localEnv): Promise<Response> {
  return postRaw(boardId, JSON.stringify(body), authorization, e);
}
function entry(gameId: string, playerId: string, score: number): Record<string, unknown> {
  return { gameId, playerId, displayName: playerId, score };
}
async function countRows(): Promise<number> {
  const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM ranking_entries').first<{ n: number }>();
  return row?.n ?? 0;
}
async function expectError(res: Response, status: number, code: string): Promise<string> {
  expect(res.status).toBe(status);
  const text = await res.text();
  const body = JSON.parse(text) as { error: { code: string; message: string } };
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
  return text;
}
async function items(gameId: string): Promise<Array<{ playerId: string; score: number }>> {
  const res = await get(`/v1/rankings/boss-score?gameId=${gameId}`);
  expect(res.status).toBe(200);
  return (await res.json<{ items: Array<{ playerId: string; score: number }> }>()).items;
}
/** 署名の先頭の 1 文字を別の文字に替える。 */
function breakSignature(token: string): string {
  const [version, body, sig] = token.split('.');
  return `${version}.${body}.${sig[0] === 'A' ? 'B' : 'A'}${sig.slice(1)}`;
}

beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare('DELETE FROM game_players'),
    baseEnv.DB.prepare('DELETE FROM accounts'),
  ]);
});

describe('A2: スコアの投稿の認証', () => {
  it('トークンのゲームが違うスコアの投稿はPERMISSION_DENIEDの403を返す', async () => {
    await registerGame(baseEnv.DB, 'other-rpg');
    await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1200), await bearer('other-rpg', 'p1')), 403, 'PERMISSION_DENIED');
    expect(await countRows()).toBe(0);
  });

  it('認証の失敗は本文を読む前に返す', async () => {
    await expectError(await postRaw('boss-score', '{"gameId":', null), 401, 'UNAUTHENTICATED');
    expect(await countRows()).toBe(0);
  });

  it('BearerでないAuthorizationは401を返す', async () => {
    const token = await tokenFor('demo-rpg', 'p1');
    for (const authorization of [`Basic ${token}`, 'Bearer']) {
      await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1200), authorization), 401, 'UNAUTHENTICATED');
    }
    expect(await countRows()).toBe(0);
  });

  it('AUTH_TOKEN_SECRETを変えると前の鍵のトークンは401になる', async () => {
    const secret = 'rotated-secret-0123456789abcdefghijkl';
    const rotated: TestEnv = { ...localEnv, AUTH_TOKEN_SECRET: secret };
    const body = entry('demo-rpg', 'p1', 1200);
    await expectError(await post('boss-score', body, await bearer('demo-rpg', 'p1'), rotated), 401, 'UNAUTHENTICATED');
    expect(await countRows()).toBe(0);
    const res = await post('boss-score', body, await bearer('demo-rpg', 'p1', { secret }), rotated);
    expect(res.status).toBe(200);
    expect(await countRows()).toBe(1);
  });

  it('発行したゲストのトークンで送ったスコアがそのプレイヤーとして載る', async () => {
    const issued = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ gameId: 'demo-rpg' }),
    }), localEnv as never);
    expect(issued.status).toBe(200);
    const { playerId, token } = await issued.json<{ playerId: string; token: string }>();
    const res = await post('boss-score', entry('demo-rpg', playerId, 1200), `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, playerId });
    expect(await items('demo-rpg')).toEqual([expect.objectContaining({ playerId, score: 1200 })]);
  });
});

describe('K3: 認証後（ケース 4・8）', () => {
  it('トークンが無い書き込みは401を返す', async () => {
    await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1200), null), 401, 'UNAUTHENTICATED');
    expect(await countRows()).toBe(0);
  });

  it('期限切れのトークンは401を返す', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1200), await bearer('demo-rpg', 'p1', { exp: past })), 401, 'TOKEN_EXPIRED');
    expect(await countRows()).toBe(0);
  });

  it('署名の正しくないトークンは401を返す', async () => {
    const token = breakSignature(await tokenFor('demo-rpg', 'p1'));
    const text = await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1200), `Bearer ${token}`), 401, 'UNAUTHENTICATED');
    expect(text).not.toMatch(/bad_signature|malformed|LOCAL_DEV|secret/i);
    expect(await countRows()).toBe(0);
  });

  it('他のプレイヤーになりすました書き込みを弾く', async () => {
    expect((await post('boss-score', entry('demo-rpg', 'p2', 800), await bearer('demo-rpg', 'p2'))).status).toBe(200);
    await expectError(await post('boss-score', entry('demo-rpg', 'p2', 5000), await bearer('demo-rpg', 'p1')), 403, 'PERMISSION_DENIED');
    expect(await items('demo-rpg')).toEqual([expect.objectContaining({ playerId: 'p2', score: 800 })]);
  });

  it('認証が入っても本番でない環境の無認証の書き込みは403のまま', async () => {
    const disabled: TestEnv = { ...baseEnv, APP_ENV: 'disabled' };
    await expectError(await post('boss-score', entry('demo-rpg', 'p1', 1200), null, disabled), 403, 'NOT_READY_FOR_PRODUCTION');
    expect(await countRows()).toBe(0);
  });
});
