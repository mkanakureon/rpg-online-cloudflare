/**
 * クライアント統合の試験 B4: ローカルだけの CORS（src/core/cors.ts）と、ブラウザのサンプル（clients/browser/sample/index.html）。
 * 名前と期待する結果の正は docs/guides/working/client-integration-design.md §9 の B4 の 4 本（§5.5・§5.6）。
 * L2 の試験は src/worker.ts の default.fetch に env を渡して回す（APP_ENV を local と disabled で切り替える）。
 * サンプルは HTML を文字列として読む（開いて押すのは人の確かめ H1）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import sampleHtml from '../clients/browser/sample/index.html?raw';
import { fillRateLimit, ipKey, resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const disabledEnv: TestEnv = { ...baseEnv, APP_ENV: 'disabled' };
const base = 'http://127.0.0.1:8787';
const pageOrigin = 'http://127.0.0.1:5173';

const send = (req: Request, e: TestEnv) => worker.fetch(req, e as never);
const accessControl = (res: Response) => [...res.headers.keys()].filter((k) => k.toLowerCase().startsWith('access-control-'));
const list = (value: string | null) => (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

beforeEach(async () => {
  await resetRateLimits(baseEnv.DB);
});

describe('B4: ローカルだけの CORS', () => {
  it('ローカルではブラウザの事前確認にCORSの見出しを返す', async () => {
    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
      const res = await send(new Request(`${base}/v1/player-data?gameId=demo-rpg`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key',
        },
      }), localEnv);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      const allowed = list(res.headers.get('Access-Control-Allow-Headers'));
      for (const h of ['authorization', 'content-type', 'idempotency-key', 'if-none-match']) expect(allowed).toContain(h);
      expect(list(res.headers.get('Access-Control-Allow-Methods'))).toEqual(expect.arrayContaining(['get', 'post', 'put', 'delete']));
      expect(list(res.headers.get('Vary'))).toContain('origin');
      expect(await res.text()).toBe('');
    }
  });

  it('CORSの応答はRetry-AfterとETagをページから読めるように出す', async () => {
    const config = await send(new Request(`${base}/v1/config?gameId=demo-rpg&clientVersion=1.0.0`, {
      headers: { Origin: pageOrigin },
    }), localEnv);
    expect(config.status).toBe(200);
    expect(config.headers.get('ETag')).toBeTruthy();
    expect(config.headers.get('Access-Control-Allow-Origin')).toBe(pageOrigin);
    expect(list(config.headers.get('Access-Control-Expose-Headers'))).toEqual(expect.arrayContaining(['retry-after', 'etag']));

    // 304 にも同じ見出しが付く（ページが If-None-Match を送って 304 を読む）。
    const again = await send(new Request(`${base}/v1/config?gameId=demo-rpg&clientVersion=1.0.0`, {
      headers: { Origin: pageOrigin, 'If-None-Match': config.headers.get('ETag')! },
    }), localEnv);
    expect(again.status).toBe(304);
    expect(again.headers.get('Access-Control-Allow-Origin')).toBe(pageOrigin);
    expect(list(again.headers.get('Access-Control-Expose-Headers'))).toEqual(expect.arrayContaining(['retry-after', 'etag']));

    // 429 の Retry-After もページから読める。
    const ip = '203.0.113.54';
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.guestIp, await ipKey(ip));
    const limited = await send(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST',
      headers: { Origin: pageOrigin, 'content-type': 'application/json', 'CF-Connecting-IP': ip },
      body: JSON.stringify({ gameId: 'demo-rpg' }),
    }), localEnv);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(pageOrigin);
    expect(list(limited.headers.get('Access-Control-Expose-Headers'))).toEqual(expect.arrayContaining(['retry-after', 'etag']));
  });

  it('ローカルでない環境と決めていないオリジンにはCORSの見出しを返さない', async () => {
    const cases: Array<{ e: TestEnv; origin: string | null }> = [
      { e: disabledEnv, origin: pageOrigin },
      { e: localEnv, origin: 'http://evil.example' },
      { e: localEnv, origin: 'null' },
      { e: localEnv, origin: 'http://127.0.0.1:5174' },
      { e: localEnv, origin: null },
    ];
    for (const { e, origin } of cases) {
      const headers: Record<string, string> = origin === null ? {} : { Origin: origin };
      const pre = await send(new Request(`${base}/v1/config?gameId=demo-rpg`, {
        method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'GET' },
      }), e);
      expect(pre.status).toBe(404);
      expect(accessControl(pre)).toEqual([]);
      const get = await send(new Request(`${base}/v1/config?gameId=demo-rpg&clientVersion=1.0.0`, { headers }), e);
      expect(get.status).toBe(200);
      expect(accessControl(get)).toEqual([]);
      const health = await send(new Request(`${base}/health`, { headers }), e);
      expect(accessControl(health)).toEqual([]);
    }
  });
});

describe('B4: ブラウザのサンプル', () => {
  it('ブラウザのサンプルはSDKを読み込みシナリオの関数を呼ぶ', () => {
    const scripts = [...sampleHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const [, attrs, code] = scripts[0];
    expect(attrs).toMatch(/type="module"/);
    expect(attrs).not.toMatch(/\bsrc=/);
    expect(code).toMatch(/import\s*\{[^}]*\brunScenario\b[^}]*\}\s*from\s*'\.\.\/rpg-online-client\.mjs'/);
    expect(code).toMatch(/import\s*\{[^}]*\bcreateClient\b[^}]*\}/);
    expect(code).toMatch(/runScenario\(\s*client\b/);
    // 案内（127.0.0.1:5173 から開く・出し方）がある。
    expect(sampleHtml).toContain('127.0.0.1:5173');
    expect(sampleHtml).toContain('python3 -m http.server 5173 --bind 127.0.0.1');
    // トークンとセーブの本体を画面に出す行が無い（トークン・保存の口・セーブの data を読まない）。
    expect(code).not.toMatch(/token/i);
    expect(code).not.toMatch(/getItem|localStorage|sessionStorage/);
    expect(code).not.toMatch(/\.data\b/);
    // 文字は textContent で入れる（innerHTML を使わない）。
    expect(code).not.toMatch(/innerHTML/);
    // インターネットの部品を読み込まない。
    expect(sampleHtml).not.toMatch(/\b(?:src|href)="(?:https?:)?\/\//);
    expect(code).not.toMatch(/from\s*'(?:https?:)?\/\//);
  });
});
