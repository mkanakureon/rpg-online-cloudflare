/**
 * 設定配信 C1: 機能フラグとクライアントの版を読む API（GET /v1/config）と、版の比べ・ETag の関数の試験。
 * 名前と確かめることの正は docs/guides/working/config-design.md §7 の C1 の行（スキーマ・機能の一覧・CLI モックの流れの
 * 試験は、同じ表のとおりほかのファイルに置く）。L1 は関数を直に呼び、L2 は src/worker.ts の default.fetch を直に呼ぶ。
 * 設定を書き換える試験は専用のゲームで行い、demo-rpg の手本（0006 の demo-flag と版）は書き換えない。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { etagOf, matchesIfNoneMatch } from '../src/modules/config/etag';
import { compareVersions, parseVersion, updateStatus } from '../src/modules/config/version';
import { registerGame } from './support/games';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const disabledEnv: TestEnv = { ...baseEnv, APP_ENV: 'disabled' };
const base = 'http://example.com';

type ConfigBody = {
  gameId: string;
  clientVersion: { minimum: string | null; latest: string | null; update: string };
  flags: Record<string, boolean>;
};

// prepare が D1 のエラーに似た例外を投げる偽の DB（本物の D1 を壊さない）
const brokenDB = {
  prepare(): never { throw new Error('D1_ERROR: SQLITE_ERROR: no such table: config_flags'); },
};

function getConfig(query: string, options: { headers?: Record<string, string>; e?: unknown } = {}): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/config?${query}`, { headers: options.headers }), (options.e ?? baseEnv) as never);
}
async function readConfig(query: string): Promise<ConfigBody> {
  const res = await getConfig(query);
  expect(res.status).toBe(200);
  return res.json<ConfigBody>();
}
async function expectError(res: Response, status: number, code: string, message?: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json<{ error: { code: string; message: string } }>();
  expect(body.error.code).toBe(code);
  if (message) expect(body.error.message).toBe(message);
}
/** 専用のゲームを config つきで登録し、版とフラグを入れる。 */
async function setupGame(gameId: string, min: string | null, latest: string | null, flags: Record<string, boolean> = {}): Promise<void> {
  await registerGame(baseEnv.DB, gameId, ['config']);
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('INSERT INTO game_configs (game_id, min_client_version, latest_client_version) VALUES (?, ?, ?)').bind(gameId, min, latest),
    ...Object.entries(flags).map(([name, enabled]) =>
      baseEnv.DB.prepare('INSERT INTO config_flags (game_id, name, enabled) VALUES (?, ?, ?)').bind(gameId, name, enabled ? 1 : 0)),
  ]);
}

// 試験のゲーム（demo-rpg 以外）を消す。設定の表は games を ON DELETE CASCADE で指すので一緒に消える
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
});

describe('C1 版の比べとETagの関数', () => {
  it('版の文字列の検証関数は数字とドットの1から3つの組だけを通す', () => {
    expect(parseVersion('1')).toEqual([1]);
    expect(parseVersion('1.2')).toEqual([1, 2]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('0.0.0')).toEqual([0, 0, 0]);
    for (const bad of ['', '1.', '.1', '1.2.3.4', '1.2.3-beta', 'v1', '1.a', '1234567890', null]) {
      expect(parseVersion(bad), String(bad)).toBeNull();
    }
  });

  it('版の比べ方は区切りごとに数として比べ足りない区切りを0とみなす', () => {
    const v = (s: string) => parseVersion(s)!;
    expect(compareVersions(v('1.10'), v('1.9'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.9'), v('1.10'))).toBeLessThan(0);
    expect(compareVersions(v('1'), v('1.0.0'))).toBe(0);
    expect(compareVersions(v('1.0.0'), v('1'))).toBe(0);
    expect(compareVersions(v('2.0'), v('1.99.99'))).toBeGreaterThan(0);
    expect(compareVersions(v('1.99.99'), v('2.0'))).toBeLessThan(0);
  });

  it('クライアントの版と最低の版と最新の版から更新の要否を決める', () => {
    const v = (s: string) => parseVersion(s)!;
    const min = v('1.2.0');
    const latest = v('1.3.0');
    expect(updateStatus(v('1.1.9'), min, latest)).toBe('required');
    expect(updateStatus(v('1.2.0'), min, latest)).toBe('available');
    expect(updateStatus(v('1.3.0'), min, latest)).toBe('none');
    expect(updateStatus(v('1.10.0'), min, latest)).toBe('none');
    expect(updateStatus(null, min, latest)).toBe('unknown');
    expect(updateStatus(v('0.0.1'), null, null)).toBe('none');
  });

  it('If-None-Matchの解釈は弱い印と複数の値と星印を扱う', async () => {
    const etag = await etagOf('{"a":1}');
    expect(matchesIfNoneMatch(null, etag)).toBe(false);
    expect(matchesIfNoneMatch(etag, etag)).toBe(true);
    expect(matchesIfNoneMatch(`W/${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch(`"x", ${etag}`, etag)).toBe(true);
    expect(matchesIfNoneMatch('*', etag)).toBe(true);
    expect(matchesIfNoneMatch(await etagOf('{"a":2}'), etag)).toBe(false);
  });

  it('ETagは本文のSHA-256の16進を引用符で囲み同じ本文なら同じ値になる', async () => {
    const a = await etagOf('{"gameId":"demo-rpg"}');
    expect(a).toMatch(/^"[0-9a-f]{64}"$/);
    expect(await etagOf('{"gameId":"demo-rpg"}')).toBe(a);
    expect(await etagOf('{"gameId":"demo-rpG"}')).not.toBe(a);
    // SHA-256 の既知の値（空の文字列）
    expect(await etagOf('')).toBe('"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"');
  });
});

describe('C1 GET /v1/config', () => {
  it('設定を読むとそのゲームの機能フラグとクライアントの版が返る', async () => {
    const body = await readConfig('gameId=demo-rpg&clientVersion=1.0.0');
    expect(body).toEqual({
      gameId: 'demo-rpg',
      clientVersion: { minimum: '1.0.0', latest: '1.0.0', update: 'none' },
      flags: { 'demo-flag': true },
    });
    // 0006 の手本の版が形に合う
    expect(parseVersion(body.clientVersion.minimum)).not.toBeNull();
    expect(parseVersion(body.clientVersion.latest)).not.toBeNull();
  });

  it('設定の応答にはETagとno-cacheのcache-controlが付く', async () => {
    const res = await getConfig('gameId=demo-rpg&clientVersion=1.0.0');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('etag')).toBe(await etagOf(await res.text()));
  });

  it('同じETagをIf-None-Matchで送ると本文の無い304を返す', async () => {
    const first = await getConfig('gameId=demo-rpg&clientVersion=1.0.0');
    const etag = first.headers.get('etag')!;
    const again = await getConfig('gameId=demo-rpg&clientVersion=1.0.0', { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get('etag')).toBe(etag);
    expect(again.headers.get('cache-control')).toBe('no-cache');
  });

  it('設定が変わるとETagが変わり古いETagでは200と新しい本文を返す', async () => {
    await setupGame('cfg-etag', '1.0.0', '1.0.0', { shop: false });
    const first = await getConfig('gameId=cfg-etag');
    expect(first.status).toBe(200);
    const oldEtag = first.headers.get('etag')!;
    await baseEnv.DB.prepare("UPDATE config_flags SET enabled = 1 WHERE game_id = 'cfg-etag' AND name = 'shop'").run();
    const again = await getConfig('gameId=cfg-etag', { headers: { 'if-none-match': oldEtag } });
    expect(again.status).toBe(200);
    expect((await again.json<ConfigBody>()).flags).toEqual({ shop: true });
    expect(again.headers.get('etag')).not.toBe(oldEtag);
  });

  it('最低の版より古いクライアントの版を送るとupdateがrequiredの200を返す', async () => {
    await setupGame('cfg-ver', '1.2.0', '1.3.0', { shop: true });
    const body = await readConfig('gameId=cfg-ver&clientVersion=1.1.9');
    expect(body.clientVersion).toEqual({ minimum: '1.2.0', latest: '1.3.0', update: 'required' });
    expect(body.flags).toEqual({ shop: true });
  });

  it('最新の版より古く最低の版以上のクライアントにはupdateがavailableを返す', async () => {
    await setupGame('cfg-ver', '1.2.0', '1.3.0');
    expect((await readConfig('gameId=cfg-ver&clientVersion=1.2.0')).clientVersion.update).toBe('available');
    expect((await readConfig('gameId=cfg-ver&clientVersion=1.3.0')).clientVersion.update).toBe('none');
    expect((await readConfig('gameId=cfg-ver&clientVersion=1.10.0')).clientVersion.update).toBe('none');
  });

  it('クライアントの版を送らなければupdateがunknownを返す', async () => {
    await setupGame('cfg-ver', '1.2.0', '1.3.0');
    expect((await readConfig('gameId=cfg-ver')).clientVersion).toEqual({ minimum: '1.2.0', latest: '1.3.0', update: 'unknown' });
  });

  it('形の外れたクライアントの版はINVALID_ARGUMENTの400を返す', async () => {
    await expectError(await getConfig('gameId=demo-rpg&clientVersion=1.2.3-beta'), 400, 'INVALID_ARGUMENT', 'Invalid clientVersion');
    await expectError(await getConfig('gameId=demo-rpg&clientVersion='), 400, 'INVALID_ARGUMENT', 'Invalid clientVersion');
  });

  it('設定の行が無いゲームは版がnullで機能フラグが空の設定を返す', async () => {
    await registerGame(baseEnv.DB, 'cfg-empty', ['config']);
    expect(await readConfig('gameId=cfg-empty&clientVersion=1.0.0')).toEqual({
      gameId: 'cfg-empty',
      clientVersion: { minimum: null, latest: null, update: 'none' },
      flags: {},
    });
  });

  it('他のゲームの機能フラグは設定に混ざらない', async () => {
    await setupGame('other-rpg', null, null, { 'other-only-flag': true });
    const body = await readConfig('gameId=demo-rpg');
    expect(Object.keys(body.flags)).not.toContain('other-only-flag');
    expect(body.flags).toEqual({ 'demo-flag': true });
  });

  it('configを使わない設定のゲームの設定はNOT_FOUNDの404を返す', async () => {
    await registerGame(baseEnv.DB, 'no-config', ['rankings']);
    const res = await getConfig('gameId=no-config');
    expect(res.headers.get('cache-control')).toBe('no-store');
    await expectError(res, 404, 'NOT_FOUND', 'Feature not enabled for this game');
  });

  it('登録の無いゲームの設定はNOT_FOUNDの404を返す', async () => {
    await expectError(await getConfig('gameId=no-such-game'), 404, 'NOT_FOUND', 'Unknown game');
    await expectError(await getConfig('gameId=demo.rpg'), 400, 'INVALID_ARGUMENT', 'Invalid gameId');
  });

  it('設定はトークンが無くても本番の設定でも読める', async () => {
    const query = 'gameId=demo-rpg&clientVersion=1.0.0';
    const responses = [
      await getConfig(query, { e: disabledEnv }),
      await getConfig(query, { e: disabledEnv, headers: { authorization: 'Bearer v1.broken.token' } }),
      await getConfig(query, { e: localEnv }),
    ];
    const bodies: string[] = [];
    for (const res of responses) {
      expect(res.status).toBe(200);
      bodies.push(await res.text());
    }
    expect(new Set(bodies).size).toBe(1);
    expect(bodies[0]).not.toMatch(/NOT_READY_FOR_PRODUCTION|UNAUTHENTICATED/);
  });

  it('設定のパスへのGETのほかのメソッドはNOT_FOUNDの404を返す', async () => {
    const before = await baseEnv.DB.prepare("SELECT name, enabled FROM config_flags WHERE game_id = 'demo-rpg'").all();
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await worker.fetch(new Request(`${base}/v1/config?gameId=demo-rpg`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flags: { 'demo-flag': false } }),
      }), localEnv as never);
      await expectError(res, 404, 'NOT_FOUND', 'Endpoint not found');
    }
    const after = await baseEnv.DB.prepare("SELECT name, enabled FROM config_flags WHERE game_id = 'demo-rpg'").all();
    expect(after.results).toEqual(before.results);
  });

  it('ゲームの行を消すとそのゲームの設定も消える', async () => {
    await setupGame('other-rpg', '1.0.0', '2.0.0', { shop: true });
    await baseEnv.DB.prepare("DELETE FROM games WHERE game_id = 'other-rpg'").run();
    const count = async (table: string, gameId: string) =>
      (await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`).bind(gameId).first<{ n: number }>())?.n;
    expect(await count('game_configs', 'other-rpg')).toBe(0);
    expect(await count('config_flags', 'other-rpg')).toBe(0);
    expect(await count('game_configs', 'demo-rpg')).toBe(1);
    expect(await count('config_flags', 'demo-rpg')).toBe(1);
  });

  it('設定の読み取りでDBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない', async () => {
    const broken = await getConfig('gameId=demo-rpg', { e: { ...baseEnv, DB: brokenDB } });
    expect(broken.status).toBe(500);
    const text = await broken.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(text).not.toMatch(/SQLITE|D1_ERROR|config_flags|no such table/);

    await setupGame('cfg-bad', '1.x', null);
    const bad = await getConfig('gameId=cfg-bad&clientVersion=1.0.0');
    expect(bad.status).toBe(500);
    const badText = await bad.text();
    expect(JSON.parse(badText)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(badText).not.toMatch(/1\.x|game_configs|SELECT/);
  });
});
