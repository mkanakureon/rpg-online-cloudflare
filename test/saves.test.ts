/**
 * セーブ V1: セーブを書く・読む（PUT・GET /v1/saves/{slotId}）と、検証・チェックサム・大きさの関数の試験。
 * 名前と期待する結果の正は docs/guides/working/save-design.md §7 の V1 の行。
 * L2 の試験は src/worker.ts の default.fetch を直に呼ぶ。読み書きとも APP_ENV=local を渡す（読むのにも門を掛ける。§4）。
 * トークンは test/support/auth.ts の bearer で作る。プレイヤーはトークンの p だけで決まる。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { sha256Hex } from '../src/modules/saves/checksum';
import { MAX_REQUEST_BYTES, MAX_SAVE_BYTES } from '../src/modules/saves/limits';
import { parseSaveWrite, utf8Size } from '../src/modules/saves/validate';
import { bearer } from './support/auth';
import { registerGame } from './support/games';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

type SaveBody = {
  gameId: string; slotId: string; revision: number; formatVersion: number;
  data?: string; checksum: string; size: number; updatedAt: string;
};
type ErrorBody = { error: { code: string; message: string } };
type Who = { gameId?: string; playerId?: string; authorization?: string | null; e?: unknown };

// prepare が D1 のエラーに似た例外を投げる偽の DB（本物の D1 を壊さない）
const brokenDB = {
  prepare(): never { throw new Error('D1_ERROR: SQLITE_ERROR: no such table: saves'); },
};

async function headersFor(who: Who): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const authorization = who.authorization === undefined
    ? await bearer(who.gameId ?? 'demo-rpg', who.playerId ?? 'p1')
    : who.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return headers;
}
async function putRaw(slotId: string, body: string, who: Who = {}, query = `gameId=${who.gameId ?? 'demo-rpg'}`): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/saves/${slotId}?${query}`, {
    method: 'PUT', headers: await headersFor(who), body,
  }), (who.e ?? localEnv) as never);
}
async function write(slotId: string, data: string, baseRevision: number, who: Who = {}, formatVersion = 1): Promise<Response> {
  return putRaw(slotId, JSON.stringify({ formatVersion, data, checksum: await sha256Hex(data), baseRevision }), who);
}
async function read(slotId: string, who: Who = {}, query = `gameId=${who.gameId ?? 'demo-rpg'}`): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/saves/${slotId}?${query}`, {
    headers: await headersFor(who),
  }), (who.e ?? localEnv) as never);
}
async function countRows(): Promise<number> {
  const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM saves').first<{ n: number }>();
  return row?.n ?? 0;
}
async function expectError(res: Response, status: number, code: string, message?: string): Promise<void> {
  expect(res.status, code).toBe(status);
  const body = await res.json<ErrorBody>();
  expect(body.error.code).toBe(code);
  if (message !== undefined) expect(body.error.message).toBe(message);
}
async function ok(res: Response): Promise<SaveBody> {
  expect(res.status).toBe(200);
  return res.json<SaveBody>();
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）だけ残す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM saves'),
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
});

describe('V1 セーブの関数', () => {
  it('セーブの本文の検証関数は形の版とdataとチェックサムと前のリビジョンの外れを見つける', () => {
    const good = { formatVersion: 1, data: '{"hp":30}', checksum: 'a'.repeat(64), baseRevision: 0 };
    for (const v of [good, { ...good, formatVersion: 2147483647 }, { ...good, data: '' }, { ...good, baseRevision: 5 }]) {
      expect(parseSaveWrite(v)).toEqual({ ok: true, value: v });
    }
    expect(parseSaveWrite({ ...good, extra: 'x' })).toEqual({ ok: true, value: good });
    const { data: _d, ...noData } = good;
    const { checksum: _c, ...noChecksum } = good;
    const { baseRevision: _b, ...noBase } = good;
    for (const ng of [
      { ...good, formatVersion: 0 }, { ...good, formatVersion: 1.5 }, { ...good, formatVersion: 2147483648 }, { ...good, formatVersion: '1' },
      { ...good, data: 1 }, noData,
      { ...good, checksum: 'a'.repeat(63) }, { ...good, checksum: 'A'.repeat(64) }, noChecksum,
      { ...good, baseRevision: -1 }, { ...good, baseRevision: 1.5 }, noBase,
      [], null,
    ]) expect(parseSaveWrite(ng).ok, JSON.stringify(ng)).toBe(false);
  });

  it('チェックサムはdataのUTF-8のバイト列のSHA-256の16進で計算する', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('あ'));
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await sha256Hex('あ')).toBe(expected);
    expect(new TextEncoder().encode('あ').byteLength).toBe(3);
  });

  it('セーブの大きさはdataのUTF-8のバイト数で数える', () => {
    expect(utf8Size('abc')).toBe(3);
    expect(utf8Size('あ')).toBe(3);
    expect(utf8Size('😀')).toBe(4);
  });
});

describe('V1 セーブを書く・読む', () => {
  it('初めてのセーブは前のリビジョン0で書けてリビジョン1が返る', async () => {
    const data = JSON.stringify({ hp: 30, map: 'town' });
    const body = await ok(await write('auto', data, 0));
    expect(body).toMatchObject({ gameId: 'demo-rpg', slotId: 'auto', revision: 1, formatVersion: 1, size: utf8Size(data) });
    expect(body.checksum).toBe(await sha256Hex(data));
    expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(body).not.toHaveProperty('data');
    expect(await countRows()).toBe(1);
  });

  it('書いたセーブを読むと同じdataと形の版とチェックサムとリビジョンが返る', async () => {
    const data = '{"hp":30,"名前":"勇者"}';
    const written = await ok(await write('auto', data, 0));
    const loaded = await ok(await read('auto'));
    expect(loaded).toEqual({ ...written, data });
  });

  it('前のリビジョンが合う書き込みはリビジョンを1つ進める', async () => {
    await ok(await write('auto', 'v1', 0));
    expect((await ok(await write('auto', 'v2', 1))).revision).toBe(2);
    expect((await ok(await write('auto', 'v3', 2))).revision).toBe(3);
    const loaded = await ok(await read('auto'));
    expect(loaded.data).toBe('v3');
    expect(loaded.revision).toBe(3);
  });

  it('前のリビジョンが古い書き込みはSAVE_CONFLICTの409を返し上書きしない', async () => {
    await ok(await write('auto', 'v1', 0));
    await ok(await write('auto', 'v2', 1));
    await expectError(await write('auto', 'stale', 1), 409, 'SAVE_CONFLICT');
    const loaded = await ok(await read('auto'));
    expect(loaded.data).toBe('v2');
    expect(loaded.revision).toBe(2);
  });

  it('セーブがあるスロットへの前のリビジョン0の書き込みはSAVE_CONFLICTの409を返す', async () => {
    await ok(await write('auto', 'v1', 0));
    await expectError(await write('auto', 'again', 0), 409, 'SAVE_CONFLICT');
    const loaded = await ok(await read('auto'));
    expect(loaded.data).toBe('v1');
    expect(loaded.revision).toBe(1);
  });

  it('セーブの無いスロットへの前のリビジョン1以上の書き込みはSAVE_CONFLICTの409を返す', async () => {
    await expectError(await write('auto', 'v1', 1), 409, 'SAVE_CONFLICT');
    expect(await countRows()).toBe(0);
  });

  it('同じリビジョンから並べて送った2つの書き込みは片方だけが通る', async () => {
    await ok(await write('auto', 'v1', 0));
    const [a, b] = await Promise.all([write('auto', 'from-a', 1), write('auto', 'from-b', 1)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? 'from-a' : 'from-b';
    const loser = a.status === 200 ? b : a;
    expect((await loser.json<ErrorBody>()).error.code).toBe('SAVE_CONFLICT');
    const loaded = await ok(await read('auto'));
    expect(loaded.revision).toBe(2);
    expect(loaded.data).toBe(winner);
  });

  it('チェックサムがdataと合わない書き込みはINVALID_ARGUMENTの400を返し書かない', async () => {
    const body = JSON.stringify({ formatVersion: 1, data: 'real', checksum: await sha256Hex('other'), baseRevision: 0 });
    await expectError(await putRaw('auto', body), 400, 'INVALID_ARGUMENT', 'checksum does not match data');
    expect(await countRows()).toBe(0);
  });

  it('上限ちょうどの大きさのセーブは書けて1バイト超えるとPAYLOAD_TOO_LARGEの413を返す', async () => {
    const exact = await ok(await write('exact', 'a'.repeat(MAX_SAVE_BYTES), 0));
    expect(exact.size).toBe(MAX_SAVE_BYTES);
    await expectError(await write('over', 'a'.repeat(MAX_SAVE_BYTES + 1), 0), 413, 'PAYLOAD_TOO_LARGE');
    // data が上限の中でも、本文が MAX_REQUEST_BYTES を超えれば読まずに断る
    const huge = JSON.stringify({ formatVersion: 1, data: 'a', checksum: await sha256Hex('a'), baseRevision: 0, pad: 'x'.repeat(MAX_REQUEST_BYTES) });
    await expectError(await putRaw('huge', huge), 413, 'PAYLOAD_TOO_LARGE');
    expect(await countRows()).toBe(1);
  });

  it('書いていないスロットを読むとNOT_FOUNDの404を返す', async () => {
    await expectError(await read('auto'), 404, 'NOT_FOUND', 'Save not found');
  });

  it('他のプレイヤーのセーブは読めず上書きもできない', async () => {
    await ok(await write('auto', 'p1-data', 0, { playerId: 'p1' }));
    await expectError(await read('auto', { playerId: 'p2' }), 404, 'NOT_FOUND', 'Save not found');
    const p2 = await ok(await write('auto', 'p2-data', 0, { playerId: 'p2' }));
    expect(p2.revision).toBe(1);
    const p1 = await ok(await read('auto', { playerId: 'p1' }));
    expect(p1.data).toBe('p1-data');
    expect(p1.revision).toBe(1);
    expect((await ok(await read('auto', { playerId: 'p2' }))).data).toBe('p2-data');
  });

  it('トークンのゲームと違うgameIdのセーブの要求はPERMISSION_DENIEDの403を返す', async () => {
    await registerGame(baseEnv.DB, 'other-rpg', ['saves']);
    const authorization = await bearer('demo-rpg', 'p1');
    const data = 'x';
    const body = JSON.stringify({ formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision: 0 });
    await expectError(await putRaw('auto', body, { authorization }, 'gameId=other-rpg'), 403, 'PERMISSION_DENIED', 'Token does not match game');
    await expectError(await read('auto', { authorization }, 'gameId=other-rpg'), 403, 'PERMISSION_DENIED', 'Token does not match game');
    expect(await countRows()).toBe(0);
  });

  it('トークンの無いセーブの読み書きは401を返す', async () => {
    await expectError(await write('auto', 'x', 0, { authorization: null }), 401, 'UNAUTHENTICATED');
    await expectError(await read('auto', { authorization: null }), 401, 'UNAUTHENTICATED');
    await expectError(await read('auto', { authorization: await bearer('demo-rpg', 'p1', { exp: 1 }) }), 401, 'TOKEN_EXPIRED');
    expect(await countRows()).toBe(0);
  });

  it('本番の設定ではセーブの読み書きもNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    expect(baseEnv.APP_ENV).not.toBe('local');
    await expectError(await write('auto', 'x', 0, { e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectError(await read('auto', { e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    expect(await countRows()).toBe(0);
  });

  it('savesを使わない設定のゲームのセーブはNOT_FOUNDの404を返し書かない', async () => {
    await registerGame(baseEnv.DB, 'no-saves', ['rankings']);
    const who = { gameId: 'no-saves', playerId: 'p1' };
    await expectError(await write('auto', 'x', 0, who), 404, 'NOT_FOUND', 'Feature not enabled for this game');
    await expectError(await read('auto', who), 404, 'NOT_FOUND', 'Feature not enabled for this game');
    expect(await countRows()).toBe(0);
  });

  it('形の版はサーバーが解釈せず書いた値をそのまま返す', async () => {
    expect((await ok(await write('auto', 'new', 0, {}, 7))).formatVersion).toBe(7);
    expect((await ok(await write('auto', 'old', 1, {}, 3))).formatVersion).toBe(3);
    expect((await ok(await read('auto'))).formatVersion).toBe(3);
  });

  it('ゲームの行を消すとそのゲームのセーブも消える', async () => {
    await registerGame(baseEnv.DB, 'other-rpg', ['saves']);
    await ok(await write('auto', 'other', 0, { gameId: 'other-rpg' }));
    await ok(await write('auto', 'demo', 0));
    await baseEnv.DB.prepare("DELETE FROM games WHERE game_id = 'other-rpg'").run();
    const rows = await baseEnv.DB.prepare('SELECT game_id FROM saves').all<{ game_id: string }>();
    expect(rows.results.map((r) => r.game_id)).toEqual(['demo-rpg']);
  });

  it('セーブの書き込みでDBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない', async () => {
    const data = 'secret-save-data';
    const authorization = await bearer('demo-rpg', 'p1');
    const body = JSON.stringify({ formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision: 0 });
    const res = await putRaw('auto', body, { authorization, e: { ...localEnv, DB: brokenDB } });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(text).not.toMatch(/SQLITE|D1_ERROR|no such table|saves/);
    expect(text).not.toContain(data);
    expect(text).not.toContain(authorization.slice('Bearer '.length));
  });
});
