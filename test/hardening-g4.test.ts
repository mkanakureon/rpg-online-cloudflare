/**
 * 堅め G4: 要求の本文を読む手伝い（src/core/body.ts の readJson・readBytes と上限 MAX_JSON_BODY_BYTES）と、本文を受け取る口
 * （ゲストの発行・ランキングの POST・プレイヤーデータの POST・管理の書き込みの口）の 413 PAYLOAD_TOO_LARGE の試験。
 * 名前と期待する結果の正は docs/guides/working/hardening-design.md §11 の G4 の行（§2.3）。契約は docs/api-contract.md の「本文の大きさの上限」。
 * L2 は src/worker.ts の default.fetch を直に呼ぶ。「読まずに」「読むのをやめ」は、本文を数えながら流す ReadableStream で確かめる。
 * 試験のゲームは専用の body-game（rankings・player-data）。管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-10
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_JSON_BODY_BYTES, readJson } from '../src/core/body';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local', ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'body-game';
type ErrorBody = { error: { code: string; message: string } };

/** chunk バイトずつ、count 回まで流す本文（pulled に流した回数を数える）。 */
function countingStream(chunk: number, count: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= count) { controller.close(); return; }
      pulled += 1;
      controller.enqueue(new Uint8Array(chunk).fill(0x20));
    },
  }, { highWaterMark: 0 });  // 読まれるまで先に流さない（流した回数 = 読んだ回数）
  return { stream, pulled: () => pulled };
}
/** limit を 1 バイト超える JSON の本文（オブジェクトで、欄の形は外れていない値）。 */
function oversized(fields: Record<string, unknown>, size = MAX_JSON_BODY_BYTES + 1): string {
  const head = JSON.stringify({ ...fields, pad: '' });
  return head.replace('"pad":""', `"pad":"${'x'.repeat(size - head.length)}"`);
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
async function count(table: string): Promise<number> {
  return (await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`).bind(game).first<{ n: number }>())?.n ?? 0;
}

beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM inventory_items WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM admin_audit_log WHERE game_id = ?').bind(game),
  ]);
  await registerGame(baseEnv.DB, game, ['rankings', 'player-data']);
  await resetRateLimits(baseEnv.DB);
});

describe('堅め G4: 本文の大きさの上限', () => {
  it('Content-Lengthが上限を超える本文は読まずにPAYLOAD_TOO_LARGEの413を返す', async () => {
    expect(MAX_JSON_BODY_BYTES).toBe(16_384);
    // 手伝い: Content-Length が上限を超えれば、本文の流れを 1 度も読まない
    const { stream, pulled } = countingStream(1024, 100);
    const req = new Request(`${base}/x`, { method: 'POST', body: stream, headers: { 'Content-Length': String(MAX_JSON_BODY_BYTES + 1) } });
    const read = await readJson(req);
    expect(read.ok).toBe(false);
    if (!read.ok) await expectError(read.response, 413, 'PAYLOAD_TOO_LARGE');
    expect(pulled()).toBe(0);
    expect(req.bodyUsed).toBe(false);
    // 上限ちょうどは読めて JSON になる
    const exact = oversized({ a: 1 }, MAX_JSON_BODY_BYTES);
    expect(new TextEncoder().encode(exact).byteLength).toBe(MAX_JSON_BODY_BYTES);
    const ok = await readJson(new Request(`${base}/x`, { method: 'POST', body: exact }));
    expect(ok.ok && (ok.value as { a: number }).a).toBe(1);
    // 口: 文字列の本文（Content-Length が付く）が 1 バイト超えれば 413
    const res = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: oversized({ gameId: game }),
    }), localEnv as never);
    await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
  });

  it('Content-Lengthの無い本文も上限を超えた所で読むのをやめ413を返す', async () => {
    // 4 KiB ずつ 1000 回（約 4 MB）流せる本文でも、上限を超えた所（5 回目）でやめる
    const { stream, pulled } = countingStream(4096, 1000);
    const req = new Request(`${base}/x`, { method: 'POST', body: stream });
    expect(req.headers.get('Content-Length')).toBeNull();
    const read = await readJson(req);
    expect(read.ok).toBe(false);
    if (!read.ok) await expectError(read.response, 413, 'PAYLOAD_TOO_LARGE');
    expect(pulled()).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES / 4096 + 2);
    // Content-Length が嘘（実際より小さい）でも、流れを読む側の上限で止める
    const lying = countingStream(4096, 1000);
    const lie = new Request(`${base}/x`, { method: 'POST', body: lying.stream, headers: { 'Content-Length': '10' } });
    const lied = await readJson(lie);
    expect(lied.ok).toBe(false);
    if (!lied.ok) await expectError(lied.response, 413, 'PAYLOAD_TOO_LARGE');
    expect(lying.pulled()).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES / 4096 + 2);
    // 上限の中の流れは全部読んで JSON にする・JSON でなければ 400 INVALID_JSON
    const small = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"gameId":')); c.enqueue(new TextEncoder().encode('"g"}')); c.close(); } });
    const fine = await readJson(new Request(`${base}/x`, { method: 'POST', body: small }));
    expect(fine.ok && fine.value).toEqual({ gameId: 'g' });
    const bad = await readJson(new Request(`${base}/x`, { method: 'POST', body: 'not json' }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) await expectError(bad.response, 400, 'INVALID_JSON');
    // 口: 流れの本文のゲストの発行も 413 で、アカウントを作らない
    const before = (await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?').bind(game).first<{ n: number }>())?.n;
    const big = countingStream(4096, 1000);
    const res = await worker.fetch(new Request(`${base}/v1/accounts/guest`, { method: 'POST', body: big.stream }), localEnv as never);
    await expectError(res, 413, 'PAYLOAD_TOO_LARGE');
    expect(big.pulled()).toBeLessThanOrEqual(MAX_JSON_BODY_BYTES / 4096 + 2);
    expect((await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?').bind(game).first<{ n: number }>())?.n).toBe(before);
  });

  it('ゲストの発行とランキングとプレイヤーデータと管理の書き込みは本文の上限で413を返す', async () => {
    const auth = await bearer(game, 'p1');
    const json = { 'content-type': 'application/json' };
    // ゲストの発行
    await expectError(await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST', headers: json, body: oversized({ gameId: game }),
    }), localEnv as never), 413, 'PAYLOAD_TOO_LARGE');
    // ランキングの POST（書かない）
    await expectError(await worker.fetch(new Request(`${base}/v1/rankings/boss-score`, {
      method: 'POST', headers: { ...json, authorization: auth }, body: oversized({ gameId: game, playerId: 'p1', displayName: 'P1', score: 1 }),
    }), localEnv as never), 413, 'PAYLOAD_TOO_LARGE');
    expect(await count('ranking_entries')).toBe(0);
    // 順は変えない: トークンが無ければ本文を読む前に 401
    await expectError(await worker.fetch(new Request(`${base}/v1/rankings/boss-score`, {
      method: 'POST', headers: json, body: oversized({ gameId: game }),
    }), localEnv as never), 401, 'UNAUTHENTICATED');
    // 上限の中の本文はそのまま通る
    const posted = await worker.fetch(new Request(`${base}/v1/rankings/boss-score`, {
      method: 'POST', headers: { ...json, authorization: auth }, body: JSON.stringify({ gameId: game, playerId: 'p1', displayName: 'P1', score: 1 }),
    }), localEnv as never);
    expect(posted.status).toBe(200);
    // プレイヤーデータの POST
    await expectError(await worker.fetch(new Request(`${base}/v1/player-data?gameId=${game}`, {
      method: 'POST', headers: { ...json, authorization: auth, 'Idempotency-Key': 'body-limit-1' },
      body: oversized({ changes: [{ key: 'k', value: 1 }] }),
    }), localEnv as never), 413, 'PAYLOAD_TOO_LARGE');
    // 管理の書き込みの口（品目の定義。書かず、監査の行も残さない）
    await expectError(await worker.fetch(new Request(`${base}/v1/admin/items/gem?gameId=${game}`, {
      method: 'PUT', headers: { ...json, authorization: `Bearer ${adminKey}`, 'X-Admin-Actor': 'local-admin' },
      body: oversized({ kind: 'currency', reason: 'test' }),
    }), localEnv as never), 413, 'PAYLOAD_TOO_LARGE');
    expect(await count('inventory_items')).toBe(0);
    expect(await count('admin_audit_log')).toBe(0);
    // 管理の口も順は変えない: 鍵が違えば本文を読む前に 401
    await expectError(await worker.fetch(new Request(`${base}/v1/admin/items/gem?gameId=${game}`, {
      method: 'PUT', headers: { ...json, authorization: `Bearer ${'b'.repeat(32)}`, 'X-Admin-Actor': 'local-admin' },
      body: oversized({ kind: 'currency', reason: 'test' }),
    }), localEnv as never), 401, 'UNAUTHENTICATED');
  });
});
