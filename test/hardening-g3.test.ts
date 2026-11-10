/**
 * 堅めの G3: 契約を変えない内側の直し（入口の 500 のログ・お知らせの上限の定数・ローカルの Vary: Origin・区切りの宣言を読む所・
 * 管理コマンドの数の引数）の試験。名前と期待する結果の正は docs/guides/working/hardening-design.md §11 の G3 の 5 本（§3.6・§9.2〜§9.4・§9.6）。
 * L1 は関数と定数を直に見る。L2 は src/worker.ts の default.fetch を直に呼ぶ（APP_ENV を local と disabled で切り替える）。
 * 応答の状態・コード・本文はいまの試験が見るので、ここはログ・Vary の見出し・DB に送る SQL・HTTP を呼ばないことだけを見る。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-10
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import { ANNOUNCEMENTS_LIMIT } from '../src/modules/announcements/index';
import { hasAddKey } from '../src/modules/player-data/index';
import { commands } from '../scripts/admin-cli.mjs';
import contract from '../docs/api-contract.md?raw';
import specJson from '../openapi/rpg-online.v1.json';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const disabledEnv: TestEnv = { ...baseEnv, APP_ENV: 'disabled' };
const base = 'http://127.0.0.1:8787';
const pageOrigin = 'http://127.0.0.1:5173';
const game = 'g3-game';

const send = (req: Request, e: unknown) => worker.fetch(req, e as never);
const list = (value: string | null) => (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const accessControl = (res: Response) => [...res.headers.keys()].filter((k) => k.toLowerCase().startsWith('access-control-'));

// prepare が D1 のエラーに似た例外（SQL と値の入った文と cause）を投げる偽の DB（本物の D1 を壊さない）
const dbMessage = 'D1_ERROR: SQLITE_ERROR: near "SELECT id, title, body FROM announcements WHERE game_id = \'secret-value\'"';
const brokenDB = {
  prepare(): never { throw new Error(dbMessage, { cause: new Error('SQLITE_CONSTRAINT: SELECT secret-value') }); },
};

/** 本物の D1 に渡しつつ、prepare に渡った SQL を残す DB。 */
function recordingDB(sqls: string[]) {
  const real = baseEnv.DB;
  return {
    prepare(sql: string) { sqls.push(sql); return real.prepare(sql); },
    batch(statements: D1PreparedStatement[]) { return real.batch(statements); },
  };
}

beforeEach(async () => {
  await resetRateLimits(baseEnv.DB);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('G3: 入口のログ', () => {
  it('入口の500のログはエラーの文とSQLを出さない', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send(new Request(`${base}/v1/announcements?gameId=demo-rpg`), { ...baseEnv, DB: brokenDB });
    expect(res.status).toBe(500);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('INTERNAL_ERROR');
    expect(spy).toHaveBeenCalled();
    // ログに渡した値を全部（Error なら message・cause・stack も）文字にして見る
    const text = spy.mock.calls.flat().map((v) => (v instanceof Error ? `${v.message} ${String(v.cause)} ${v.stack}` : String(v))).join('\n');
    for (const leak of ['D1_ERROR', 'SQLITE', 'SELECT', 'secret-value']) expect(text, leak).not.toContain(leak);
    expect(spy.mock.calls.flat().some((v) => v instanceof Error)).toBe(false);
    // 出すのは決まったラベルとエラーの名前
    expect(text).toContain('Unhandled Worker error');
    expect(text).toContain('Error');
  });
});

describe('G3: お知らせの上限', () => {
  it('お知らせの一覧の上限は定数で契約の件数と同じ', () => {
    expect(ANNOUNCEMENTS_LIMIT).toBe(50);
    const section = contract.split('## GET /v1/announcements')[1].split('\n## ')[0];
    expect(section).toMatch(new RegExp(`最大 ${ANNOUNCEMENTS_LIMIT} 件`));
    const spec = specJson as unknown as { paths: Record<string, { get: { summary: string } }> };
    expect(spec.paths['/v1/announcements'].get.summary).toContain(`最大 ${ANNOUNCEMENTS_LIMIT} 件`);
  });
});

describe('G3: ローカルの Vary', () => {
  it('ローカルでは許さないオリジンの応答にもVary Originを足す', async () => {
    for (const origin of ['http://evil.example', 'null', 'http://127.0.0.1:5174']) {
      const headers = { Origin: origin };
      const get = await send(new Request(`${base}/v1/config?gameId=demo-rpg&clientVersion=1.0.0`, { headers }), localEnv);
      expect(get.status, origin).toBe(200);
      expect(list(get.headers.get('Vary')), origin).toContain('origin');
      expect(accessControl(get), origin).toEqual([]);
      const pre = await send(new Request(`${base}/v1/config?gameId=demo-rpg`, {
        method: 'OPTIONS', headers: { ...headers, 'Access-Control-Request-Method': 'GET' },
      }), localEnv);
      expect(pre.status, origin).toBe(404);
      expect(list(pre.headers.get('Vary')), origin).toContain('origin');
      expect(accessControl(pre), origin).toEqual([]);
    }
    // 許すオリジンは今のまま Vary: Origin が 1 つ（重ねない）
    const allowed = await send(new Request(`${base}/health`, { headers: { Origin: pageOrigin } }), localEnv);
    expect(list(allowed.headers.get('Vary')).filter((v) => v === 'origin')).toHaveLength(1);
    // local でない環境と Origin の無い要求には何も足さない
    const disabled = await send(new Request(`${base}/health`, { headers: { Origin: 'http://evil.example' } }), disabledEnv);
    expect(list(disabled.headers.get('Vary'))).not.toContain('origin');
    const noOrigin = await send(new Request(`${base}/health`), localEnv);
    expect(list(noOrigin.headers.get('Vary'))).not.toContain('origin');
  });
});

describe('G3: 区切りの宣言を読む所', () => {
  beforeEach(async () => {
    await baseEnv.DB.batch([
      baseEnv.DB.prepare('DELETE FROM player_data_period_values WHERE game_id = ?').bind(game),
      baseEnv.DB.prepare('DELETE FROM player_data WHERE game_id = ?').bind(game),
      baseEnv.DB.prepare('DELETE FROM player_data_writes WHERE game_id = ?').bind(game),
      baseEnv.DB.prepare('DELETE FROM player_data_key_periods WHERE game_id = ?').bind(game),
      baseEnv.DB.prepare('DELETE FROM player_data_keys WHERE game_id = ?').bind(game),
    ]);
    await registerGame(baseEnv.DB, game, ['player-data']);
    const insert = baseEnv.DB.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)');
    await baseEnv.DB.batch([insert.bind(game, 'kills', 'add', 1000, 10), insert.bind(game, 'floor', 'max', 999, null),
      insert.bind(game, 'chapter', 'set', 100, null), insert.bind(game, 'boss', 'flag', 1, null)]);
    await baseEnv.DB.prepare(`INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
      VALUES (?, 'kills', 'daily', 0, ?)`).bind(game, Math.floor(Date.now() / 1000)).run();
  });

  const write = async (changes: unknown, sqls: string[], key: string) => send(new Request(`${base}/v1/player-data?gameId=${game}`, {
    method: 'POST',
    headers: { authorization: await bearer(game, 'p1'), 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ changes }),
  }), { ...localEnv, DB: recordingDB(sqls) });
  const readsPeriods = (sqls: string[]) => sqls.some((s) => /FROM player_data_key_periods/.test(s));

  it('増やすキーの無い書き込みは区切りの宣言を読まない', async () => {
    const modes = (pairs: Array<[string, string]>) => new Map(pairs.map(([key, mode]) => [key, { key, mode, maxValue: 1000, maxDelta: null }]));
    expect(hasAddKey([{ key: 'floor', value: 1 }], modes([['floor', 'max']]) as never)).toBe(false);
    expect(hasAddKey([{ key: 'floor', value: 1 }, { key: 'kills', value: 1 }], modes([['floor', 'max'], ['kills', 'add']]) as never)).toBe(true);

    const none: string[] = [];
    const res = await write([{ key: 'floor', value: 3 }, { key: 'chapter', value: 2 }, { key: 'boss', value: 1 }], none, 'g3-key-none');
    expect(res.status).toBe(200);
    expect(none.length).toBeGreaterThan(0);
    expect(readsPeriods(none)).toBe(false);

    // add のキーがある書き込みは今のまま読み、区切りの値を足す（読んだ結果は同じ）
    const withAdd: string[] = [];
    const added = await write([{ key: 'kills', value: 2 }, { key: 'floor', value: 4 }], withAdd, 'g3-key-add');
    expect(added.status).toBe(200);
    expect(readsPeriods(withAdd)).toBe(true);
    const row = await baseEnv.DB.prepare(`SELECT value FROM player_data_period_values WHERE game_id = ? AND player_id = 'p1' AND key = 'kills'
      AND kind = 'daily'`).bind(game).first<{ value: number }>();
    expect(row?.value).toBe(2);
  });
});

describe('G3: 管理コマンドの引数', () => {
  it('管理コマンドは整数でないlimitを送る前に止める', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    for (const limit of ['abc', '1.5', ' ', '10x']) {
      await expect(commands.audit('k'.repeat(32), [], { limit }, 'local-admin', 'demo-rpg'), limit).rejects.toThrow(/--limit must be an integer/);
    }
    await expect(commands.audit('k'.repeat(32), [], { before: 'x' }, 'local-admin', 'demo-rpg')).rejects.toThrow(/--before must be an integer/);
    expect(fetchSpy).not.toHaveBeenCalled();
    // 整数なら今のまま送る（範囲の外はサーバーの 400 のまま）
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await commands.audit('k'.repeat(32), [], { limit: '5' }, 'local-admin', 'demo-rpg');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(new URL((fetchSpy.mock.calls[0][0] as Request).url).searchParams.get('limit')).toBe('5');
  });
});
