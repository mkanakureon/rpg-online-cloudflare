/**
 * アカウント A1: トークン（src/core/token.ts）とゲストの発行（POST /v1/accounts/guest）。
 * 名前と確かめることの正は docs/guides/working/account-design.md §6 の A1（スキーマの 2 本は test/schema-conformance.test.ts）。
 * L1 はトークンの関数を直に呼ぶ。L2 は src/worker.ts の default.fetch を直に呼び、書き込みだけ APP_ENV=local を渡す。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { idPattern } from '../src/core/ids';
import {
  LOCAL_DEV_TOKEN_SECRET, parseBearer, signToken, tokenSecret, TOKEN_TTL_SECONDS, verifyToken,
} from '../src/core/token';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';
const key = 'test-secret-0123456789abcdefghijklmnop';
const now = 1_800_000_000;

type Issued = { gameId: string; playerId: string; token: string; expiresAt: string };

function postGuestRaw(body: string, e: unknown = localEnv): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/accounts/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }), e as never);
}
function postGuest(body: unknown, e: unknown = localEnv): Promise<Response> {
  return postGuestRaw(JSON.stringify(body), e);
}
async function count(table: 'accounts' | 'game_players'): Promise<number> {
  const row = await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json<{ error: { code: string; message: string } }>();
  expect(body.error.code).toBe(code);
}
function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
}
/** 1 文字を別の文字に替える（base64url の文字の中で）。 */
function flip(text: string, at: number): string {
  const c = text[at] === 'A' ? 'B' : 'A';
  return text.slice(0, at) + c + text.slice(at + 1);
}
/** signToken を通さず、任意の本文に正しい署名を付ける（崩れた本文のトークンを作るため）。 */
async function signRaw(body: string, secret: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const encoded = b64url(body);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`v1.${encoded}`)));
  return `v1.${encoded}.${b64url(String.fromCharCode(...sig))}`;
}

// 行の数を見る試験が、前の試験や他のファイルの残りに引きずられないように消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM game_players'),
    baseEnv.DB.prepare('DELETE FROM accounts'),
  ]);
});

describe('A1: トークン（L1）', () => {
  it('トークンを作って確かめると同じゲームとプレイヤーと期限が戻る', async () => {
    const claims = { gameId: 'demo-rpg', playerId: 'p1', exp: now + 60 };
    const token = await signToken(claims, key);
    expect(token.startsWith('v1.')).toBe(true);
    expect(token.split('.')).toHaveLength(3);
    expect(await verifyToken(token, key, now)).toEqual({ ok: true, claims });
  });

  it('トークンの本文か署名を1文字でも変えると署名の誤りとして弾く', async () => {
    const token = await signToken({ gameId: 'demo-rpg', playerId: 'p1', exp: now + 60 }, key);
    const [v, body, sig] = token.split('.');
    const tampered = [
      ...[0, body.length - 1].map((i) => `${v}.${flip(body, i)}.${sig}`),
      // 署名は全部の位置で（最後の文字の使わないビットだけを変えても通さない）
      ...[...sig].map((_, i) => `${v}.${body}.${flip(sig, i)}`),
      await signToken({ gameId: 'demo-rpg', playerId: 'p1', exp: now + 60 }, 'another-secret-0123456789abcdefghijk'),
    ];
    for (const t of tampered) {
      expect(await verifyToken(t, key, now), t).toEqual({ ok: false, reason: 'bad_signature' });
    }
  });

  it('期限の時刻を過ぎたトークンは期限切れとして弾く', async () => {
    const at = (exp: number) => signToken({ gameId: 'demo-rpg', playerId: 'p1', exp }, key);
    expect(await verifyToken(await at(now), key, now)).toEqual({ ok: false, reason: 'expired' });
    expect(await verifyToken(await at(now - 1), key, now)).toEqual({ ok: false, reason: 'expired' });
    expect((await verifyToken(await at(now + 1), key, now)).ok).toBe(true);
  });

  it('形の崩れたトークンは形の誤りとして弾く', async () => {
    const good = await signToken({ gameId: 'demo-rpg', playerId: 'p1', exp: now + 60 }, key);
    const [, body, sig] = good.split('.');
    const malformed = [
      '',
      `v1.${body}`,
      `v2.${body}.${sig}`,
      await signRaw('not json', key),
      await signRaw(JSON.stringify({ g: 'demo.rpg', p: 'p1', exp: now + 60 }), key),
    ];
    for (const t of malformed) {
      expect(await verifyToken(t, key, now), t).toEqual({ ok: false, reason: 'malformed' });
    }
    // 署名の正しくないものは、本文が崩れていても署名の誤りが先
    expect(await verifyToken(`v1.${b64url('not json')}.${sig}`, key, now)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('Authorizationの値からBearerのトークンだけを取り出す', () => {
    expect(parseBearer('Bearer abc')).toBe('abc');
    expect(parseBearer('bearer  abc')).toBe('abc');
    expect(parseBearer('Basic abc')).toBeNull();
    expect(parseBearer('Bearer')).toBeNull();
    expect(parseBearer('abc')).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });

  it('鍵はAUTH_TOKEN_SECRETを使いローカルでだけ既定の鍵に戻る', () => {
    const secret = 'x'.repeat(32);
    expect(tokenSecret({ APP_ENV: 'local', AUTH_TOKEN_SECRET: secret })).toBe(secret);
    expect(tokenSecret({ APP_ENV: 'disabled', AUTH_TOKEN_SECRET: secret })).toBe(secret);
    expect(tokenSecret({ APP_ENV: 'local' })).toBe(LOCAL_DEV_TOKEN_SECRET);
    expect(tokenSecret({ APP_ENV: 'disabled' })).toBeNull();
    expect(tokenSecret({ APP_ENV: 'disabled', AUTH_TOKEN_SECRET: 'x'.repeat(31) })).toBeNull();
    expect(tokenSecret({ APP_ENV: 'local', AUTH_TOKEN_SECRET: 'x'.repeat(31) })).toBeNull();
  });
});

describe('A1: ゲストの発行（L2）', () => {
  it('ゲストの発行はアカウントとゲーム別のプレイヤーを1つずつ作りトークンを返す', async () => {
    const res = await postGuest({ gameId: 'demo-rpg' });
    expect(res.status).toBe(200);
    const body = await res.json<Issued>();
    expect(body.gameId).toBe('demo-rpg');
    expect(body.playerId).toMatch(idPattern);
    const verified = await verifyToken(body.token, LOCAL_DEV_TOKEN_SECRET, Math.floor(Date.now() / 1000));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.gameId).toBe('demo-rpg');
    expect(verified.claims.playerId).toBe(body.playerId);
    expect(body.expiresAt).toBe(new Date(verified.claims.exp * 1000).toISOString());
    expect(verified.claims.exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(TOKEN_TTL_SECONDS);
    expect(await count('accounts')).toBe(1);
    expect(await count('game_players')).toBe(1);
    const row = await baseEnv.DB.prepare(
      'SELECT p.game_id, p.player_id, a.account_id FROM game_players p JOIN accounts a ON a.account_id = p.account_id',
    ).first<{ game_id: string; player_id: string; account_id: string }>();
    expect(row?.game_id).toBe('demo-rpg');
    expect(row?.player_id).toBe(body.playerId);
  });

  it('ゲストの発行の応答に内部のaccount_idを入れない', async () => {
    const res = await postGuest({ gameId: 'demo-rpg' });
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Issued;
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'gameId', 'playerId', 'token']);
    const row = await baseEnv.DB.prepare('SELECT account_id FROM accounts').first<{ account_id: string }>();
    const accountId = row!.account_id;
    expect(accountId).not.toBe(body.playerId);
    expect(text).not.toContain(accountId);
    expect(fromB64url(body.token.split('.')[1])).not.toContain(accountId);
  });

  it('ゲストを2回発行すると別のアカウントと別のプレイヤーIDになる', async () => {
    const first = await (await postGuest({ gameId: 'demo-rpg' })).json<Issued>();
    const second = await (await postGuest({ gameId: 'demo-rpg' })).json<Issued>();
    expect(first.playerId).not.toBe(second.playerId);
    expect(await count('accounts')).toBe(2);
    expect(await count('game_players')).toBe(2);
  });

  it('登録の無いゲームへのゲストの発行はNOT_FOUNDの404を返し何も作らない', async () => {
    const res = await postGuest({ gameId: 'no-such-game' });
    await expectError(res, 404, 'NOT_FOUND');
    expect(await count('accounts')).toBe(0);
    expect(await count('game_players')).toBe(0);
  });

  it('本番の設定ではゲストの発行もNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    for (const e of [baseEnv, { ...baseEnv, APP_ENV: 'production' }, { ...baseEnv, APP_ENV: 'disabled', AUTH_TOKEN_SECRET: 'x'.repeat(32) }]) {
      await expectError(await postGuest({ gameId: 'demo-rpg' }, e), 403, 'NOT_READY_FOR_PRODUCTION');
    }
    expect(await count('accounts')).toBe(0);
    expect(await count('game_players')).toBe(0);
  });

  it('ゲストの発行の本文が正しくなければ400を返す', async () => {
    await expectError(await postGuestRaw('{"gameId":'), 400, 'INVALID_JSON');
    await expectError(await postGuest(['demo-rpg']), 400, 'INVALID_ARGUMENT');
    await expectError(await postGuest({}), 400, 'INVALID_ARGUMENT');
    await expectError(await postGuest({ gameId: 'demo.rpg' }), 400, 'INVALID_ARGUMENT');
    expect(await count('accounts')).toBe(0);
    expect(await count('game_players')).toBe(0);
  });
});
