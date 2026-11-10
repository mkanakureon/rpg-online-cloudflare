/**
 * 堅めの G9: トークンの鍵の取り替えの重なり（前の鍵 AUTH_TOKEN_SECRET_PREVIOUS で確かめ、署名はいまの鍵だけ）・
 * 管理の口の利用制限（鍵を確かめた後に、外れだけを IP ごとに数える）・利用制限の IP の鍵付きのハッシュ（トークンの鍵から作る HMAC）。
 * 名前と見ることの正は docs/guides/working/hardening-design.md §11 の G9 の行（§4・§5）。置き換えた試験
 * `管理の鍵の外れだけをIPごとに数え正しい鍵の要求は外れの上限で塞がれない` は test/admin.test.ts にある。
 * L1 は関数を直に呼ぶ。L2 は src/worker.ts の default.fetch を直に呼ぶ。鍵は試験の中で作る秘密でない値。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-11
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { IP_HASH_PURPOSE, ipSubject, NO_IP_SUBJECT } from '../src/core/rate-limit';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import {
  LOCAL_DEV_TOKEN_SECRET, signToken, TOKEN_TTL_SECONDS, verificationSecrets, verifyToken, verifyTokenWithSecrets,
} from '../src/core/token';
import { countRateLimitRows, fillRateLimit, resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string; AUTH_TOKEN_SECRET?: string; AUTH_TOKEN_SECRET_PREVIOUS?: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local', AUTH_TOKEN_SECRET: undefined, AUTH_TOKEN_SECRET_PREVIOUS: undefined };
const adminKey = 'a'.repeat(32);
const adminEnv: TestEnv = { ...localEnv, ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const previousKey = 'p'.repeat(40);
const currentKey = 'n'.repeat(40);
const auditPath = '/v1/admin/audit?gameId=demo-rpg';

type ErrorBody = { error: { code: string; message: string } };
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
const now = () => Math.floor(Date.now() / 1000);
const tokenWith = (secret: string, playerId = 'g9-player') =>
  signToken({ gameId: 'demo-rpg', playerId, exp: now() + TOKEN_TTL_SECONDS }, secret);
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(key: string, text: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(text)));
}
function adminGet(e: TestEnv, authorization: string | null, ip: string | null = null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (authorization !== null) headers.authorization = authorization;
  if (ip !== null) headers['CF-Connecting-IP'] = ip;
  return worker.fetch(new Request(`${base}${auditPath}`, { headers }), e as never);
}

beforeEach(async () => {
  await resetRateLimits(baseEnv.DB);
});

describe('G9: トークンの鍵の取り替えの重なり（§4）', () => {
  it('前の鍵で署名したトークンも確かめに通り更新すると新しい鍵のトークンになる', async () => {
    const rotated: TestEnv = { ...localEnv, AUTH_TOKEN_SECRET: currentKey, AUTH_TOKEN_SECRET_PREVIOUS: previousKey };
    const oldToken = await tokenWith(previousKey);
    // 前の鍵のトークンで書き込みが通る
    const score = await worker.fetch(new Request(`${base}/v1/rankings/boss-score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${oldToken}` },
      body: JSON.stringify({ gameId: 'demo-rpg', playerId: 'g9-player', displayName: 'g9', score: 1 }),
    }), rotated as never);
    expect(score.status).toBe(200);
    // 更新の口で、いまの鍵だけで署名した新しいトークンになる（同じゲームとプレイヤー）
    const refreshed = await worker.fetch(new Request(`${base}/v1/accounts/token`, {
      method: 'POST', headers: { authorization: `Bearer ${oldToken}` },
    }), rotated as never);
    expect(refreshed.status).toBe(200);
    const body = await refreshed.json<{ gameId: string; playerId: string; token: string }>();
    expect(body).toMatchObject({ gameId: 'demo-rpg', playerId: 'g9-player' });
    const byCurrent = await verifyToken(body.token, currentKey, now());
    expect(byCurrent.ok && byCurrent.claims).toMatchObject({ gameId: 'demo-rpg', playerId: 'g9-player' });
    expect(await verifyToken(body.token, previousKey, now())).toEqual({ ok: false, reason: 'bad_signature' });
    // 前の鍵を消した後は、前の鍵のトークンは 401・新しいトークンは通る
    const removed: TestEnv = { ...localEnv, AUTH_TOKEN_SECRET: currentKey };
    const post = (token: string) => worker.fetch(new Request(`${base}/v1/accounts/token`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    }), removed as never);
    await expectError(await post(oldToken), 401, 'UNAUTHENTICATED');
    expect((await post(body.token)).status).toBe(200);
  });

  it('前の鍵の秘密が無い環境ではいまの鍵だけで確かめる', async () => {
    expect(verificationSecrets({ APP_ENV: 'disabled', AUTH_TOKEN_SECRET: currentKey })).toEqual([currentKey]);
    expect(verificationSecrets({ APP_ENV: 'local' })).toEqual([LOCAL_DEV_TOKEN_SECRET]);
    // 短い前の鍵は使わない
    expect(verificationSecrets({ APP_ENV: 'disabled', AUTH_TOKEN_SECRET: currentKey, AUTH_TOKEN_SECRET_PREVIOUS: 'x'.repeat(31) }))
      .toEqual([currentKey]);
    // 前の鍵があれば、いまの鍵 → 前の鍵の順
    expect(verificationSecrets({ APP_ENV: 'disabled', AUTH_TOKEN_SECRET: currentKey, AUTH_TOKEN_SECRET_PREVIOUS: previousKey }))
      .toEqual([currentKey, previousKey]);
    // いまの鍵が無ければ前の鍵があっても無し（使う側は 500）
    expect(verificationSecrets({ APP_ENV: 'disabled', AUTH_TOKEN_SECRET_PREVIOUS: previousKey })).toBeNull();
    // 前の鍵のトークンは、いまの鍵だけでは bad_signature。いまの鍵のトークンは通る
    const t = now();
    expect(await verifyTokenWithSecrets(await tokenWith(previousKey), [currentKey], t)).toEqual({ ok: false, reason: 'bad_signature' });
    expect((await verifyTokenWithSecrets(await tokenWith(currentKey), [currentKey], t)).ok).toBe(true);
    // 前の鍵の期限切れのトークンは、前の鍵の答え（expired）を返す
    const expired = await signToken({ gameId: 'demo-rpg', playerId: 'g9-player', exp: t }, previousKey);
    expect(await verifyTokenWithSecrets(expired, [currentKey, previousKey], t)).toEqual({ ok: false, reason: 'expired' });
  });
});

describe('G9: 管理の口の利用制限（§5.1）', () => {
  it('IPの無い要求の管理の鍵の外れが上限でも正しい鍵の管理の口は通る', async () => {
    // 見出しの無い外れは no-ip で数え、上限までは 401
    await expectError(await adminGet(adminEnv, `Bearer ${'b'.repeat(32)}`), 401, 'UNAUTHENTICATED');
    const counted = await baseEnv.DB.prepare('SELECT SUM(count) AS n FROM rate_limit_counters WHERE scope = ? AND subject = ?')
      .bind(RATE_LIMITS.admin.scope, NO_IP_SUBJECT).first<{ n: number }>();
    expect(counted?.n).toBe(1);
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.admin, NO_IP_SUBJECT);
    await expectError(await adminGet(adminEnv, `Bearer ${'b'.repeat(32)}`), 429, 'RATE_LIMITED');
    await expectError(await adminGet(adminEnv, null), 429, 'RATE_LIMITED');
    // 正しい鍵は見出しが無くても通る
    const ok = await adminGet(adminEnv, `Bearer ${adminKey}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ gameId: 'demo-rpg' });
  });
});

describe('G9: 利用制限の IP の鍵付きのハッシュ（§5.2）', () => {
  it('利用制限のIPの鍵はトークンの鍵から作った鍵付きのハッシュで素のSHA-256と違う', async () => {
    const ip = '203.0.113.77';
    const req = new Request(`${base}/`, { headers: { 'CF-Connecting-IP': ip } });
    const subject = await ipSubject(req, { APP_ENV: 'disabled', AUTH_TOKEN_SECRET: currentKey });
    expect(subject).toMatch(/^[0-9a-f]{64}$/);
    // 素の SHA-256 と違う
    expect(subject).not.toBe(hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))));
    // トークンの鍵と用途の名前から作った鍵の HMAC-SHA256 と同じ
    expect(subject).toBe(await hmacHex(await hmacHex(currentKey, IP_HASH_PURPOSE), ip));
    // トークンの鍵が違えば違う値。ローカルの既定の鍵でも作れる
    expect(await ipSubject(req, { APP_ENV: 'disabled', AUTH_TOKEN_SECRET: previousKey })).not.toBe(subject);
    expect(await ipSubject(req, { APP_ENV: 'local' })).toBe(await hmacHex(await hmacHex(LOCAL_DEV_TOKEN_SECRET, IP_HASH_PURPOSE), ip));
    // 見出しが無ければ no-ip。トークンの鍵が無ければ投げる
    expect(await ipSubject(new Request(`${base}/`), { APP_ENV: 'local' })).toBe(NO_IP_SUBJECT);
    await expect(ipSubject(req, { APP_ENV: 'disabled' })).rejects.toThrow();
  });

  it('トークンの鍵が無い環境では管理の鍵が正しくても管理の口がINTERNAL_ERRORの500を返す', async () => {
    const noTokenKey: TestEnv = { ...adminEnv, AUTH_TOKEN_SECRET: 'x'.repeat(31) };
    for (const ip of [null, '203.0.113.78']) {
      const res = await adminGet(noTokenKey, `Bearer ${adminKey}`, ip);
      await expectError(res, 500, 'INTERNAL_ERROR');
    }
    // 数の表に行を作らない（数える前に断る）
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
    // 同じ管理の鍵でも、トークンの鍵がある環境では通る
    expect((await adminGet(adminEnv, `Bearer ${adminKey}`)).status).toBe(200);
  });
});
