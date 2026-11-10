/**
 * セーブ V2: セーブの一覧（GET /v1/saves）・削除（DELETE /v1/saves/{slotId}。墓石）・スロットの数の上限（MAX_SLOTS）の試験。
 * 墓石も数えた行の上限（MAX_SAVE_ROWS）と一番古い墓石の使い回しの試験（G6。docs/guides/working/hardening-design.md §11 の G6）も置く。
 * 名前と期待する結果の正は docs/guides/working/save-design.md §7 の V2 の行（スキーマと CLI モックの V2 の試験は
 * test/schema-conformance.test.ts・test/failure-server.test.ts に置く）。
 * L2 の試験は src/worker.ts の default.fetch を直に呼ぶ。どの操作も APP_ENV=local を渡す（一覧にも門を掛ける。§4）。
 * トークンは test/support/auth.ts の bearer で作る。プレイヤーはトークンの p だけで決まる。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { sha256Hex } from '../src/modules/saves/checksum';
import { MAX_SAVE_ROWS, MAX_SLOTS } from '../src/modules/saves/limits';
import { bearer } from './support/auth';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

type SaveBody = { revision: number; formatVersion: number; data?: string; checksum: string; size: number; updatedAt: string };
type ListBody = { gameId: string; items: Array<Record<string, unknown>> };
type ErrorBody = { error: { code: string; message: string } };
type Who = { playerId?: string; e?: unknown };

async function send(method: string, path: string, who: Who = {}, body?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: await bearer('demo-rpg', who.playerId ?? 'p1'),
  };
  return worker.fetch(new Request(`${base}${path}`, { method, headers, body }), (who.e ?? localEnv) as never);
}
async function write(slotId: string, data: string, baseRevision: number, who: Who = {}): Promise<Response> {
  const body = JSON.stringify({ formatVersion: 1, data, checksum: await sha256Hex(data), baseRevision });
  return send('PUT', `/v1/saves/${slotId}?gameId=demo-rpg`, who, body);
}
function read(slotId: string, who: Who = {}): Promise<Response> {
  return send('GET', `/v1/saves/${slotId}?gameId=demo-rpg`, who);
}
function list(who: Who = {}): Promise<Response> {
  return send('GET', '/v1/saves?gameId=demo-rpg', who);
}
function remove(slotId: string, baseRevision: number | string | null, who: Who = {}): Promise<Response> {
  const query = baseRevision === null ? 'gameId=demo-rpg' : `gameId=demo-rpg&baseRevision=${baseRevision}`;
  return send('DELETE', `/v1/saves/${slotId}?${query}`, who);
}
/** スロットに書いてリビジョンを revision まで進める。 */
async function writeTo(slotId: string, revision: number, who: Who = {}): Promise<void> {
  for (let r = 0; r < revision; r++) expect((await write(slotId, `${slotId}-${r + 1}`, r, who)).status).toBe(200);
}
async function countRows(where = '1 = 1'): Promise<number> {
  const row = await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM saves WHERE ${where}`).first<{ n: number }>();
  return row?.n ?? 0;
}
/**
 * 墓石（消したスロットの印）を DB に直に入れる（API で作ると利用制限に当たるため）。名前は `${prefix}-000` から、
 * updated_at は 2026-01-01 から 1 秒ずつ新しく、リビジョンは revision。
 */
async function seedTombstones(count: number, prefix = 't', playerId = 'p1', revision = 3): Promise<void> {
  const stmts = Array.from({ length: count }, (_, i) => baseEnv.DB.prepare(
    `INSERT INTO saves (game_id, player_id, slot_id, revision, format_version, data, checksum, size, deleted, updated_at)
     VALUES ('demo-rpg', ?, ?, ?, 1, '', '', 0, 1, ?)`,
  ).bind(playerId, `${prefix}-${String(i).padStart(3, '0')}`, revision, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()));
  await baseEnv.DB.batch(stmts);
}
async function hasRow(slotId: string, playerId = 'p1'): Promise<boolean> {
  return (await countRows(`player_id = '${playerId}' AND slot_id = '${slotId}'`)) === 1;
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
async function ok<T>(res: Response): Promise<T> {
  expect(res.status).toBe(200);
  return res.json<T>();
}

// 試験の間で前のデータに頼らない
beforeEach(async () => {
  await baseEnv.DB.prepare('DELETE FROM saves').run();
  await resetRateLimits(baseEnv.DB);
});

describe('V2 セーブの一覧', () => {
  it('セーブの一覧は自分のスロットのメタデータだけをdata無しで返す', async () => {
    await writeTo('b', 1);
    await writeTo('a', 2);
    await writeTo('c', 1, { playerId: 'p2' });
    const body = await ok<ListBody>(await list());
    expect(body.gameId).toBe('demo-rpg');
    expect(body.items.map((i) => i.slotId)).toEqual(['a', 'b']);
    for (const item of body.items) {
      expect(item).not.toHaveProperty('data');
      expect(Object.keys(item).sort()).toEqual(['checksum', 'formatVersion', 'revision', 'size', 'slotId', 'updatedAt']);
    }
    const a = await ok<SaveBody>(await read('a'));
    expect(body.items[0]).toEqual({
      slotId: 'a', revision: 2, formatVersion: a.formatVersion, checksum: a.checksum, size: a.size, updatedAt: a.updatedAt,
    });
  });

  it('セーブの一覧は書いたことの無いプレイヤーには空の一覧を返す', async () => {
    await writeTo('auto', 1, { playerId: 'p2' });
    expect(await ok<ListBody>(await list())).toEqual({ gameId: 'demo-rpg', items: [] });
  });
});

describe('V2 セーブの削除', () => {
  it('リビジョンが合う削除はスロットを消して同じスロットに前のリビジョン0で書き直せる', async () => {
    await writeTo('auto', 2);
    expect(await ok(await remove('auto', 2))).toEqual({ ok: true, gameId: 'demo-rpg', slotId: 'auto' });
    await expectError(await read('auto'), 404, 'NOT_FOUND');
    expect((await ok<ListBody>(await list())).items).toEqual([]);
    const again = await ok<SaveBody>(await write('auto', 'again', 0));
    expect(again.revision).toBe(4);
    expect(await ok<SaveBody>(await read('auto'))).toMatchObject({ data: 'again', revision: 4 });
  });

  it('消してから書き直したスロットへの消す前のリビジョンからの書き込みはSAVE_CONFLICTの409を返す', async () => {
    await writeTo('auto', 2);
    expect((await remove('auto', 2)).status).toBe(200);
    expect((await ok<SaveBody>(await write('auto', 'new-1', 0))).revision).toBe(4);
    expect((await ok<SaveBody>(await write('auto', 'new-2', 4))).revision).toBe(5);
    for (const stale of [2, 3]) await expectError(await write('auto', `stale-${stale}`, stale), 409, 'SAVE_CONFLICT');
    expect(await ok<SaveBody>(await read('auto'))).toMatchObject({ data: 'new-2', revision: 5 });
  });

  it('リビジョンが古い削除はSAVE_CONFLICTの409を返し消さない', async () => {
    await writeTo('auto', 2);
    await expectError(await remove('auto', 1), 409, 'SAVE_CONFLICT');
    expect(await ok<SaveBody>(await read('auto'))).toMatchObject({ data: 'auto-2', revision: 2 });
  });

  it('書いていないスロットの削除はNOT_FOUNDの404を返す', async () => {
    await expectError(await remove('never', 1), 404, 'NOT_FOUND');
    await expectError(await remove('never', null), 400, 'INVALID_ARGUMENT');
    await expectError(await remove('never', 0), 400, 'INVALID_ARGUMENT');
    for (const bad of ['1.5', '-1', 'abc', '']) await expectError(await remove('never', bad), 400, 'INVALID_ARGUMENT');
    // 消した後のスロットも無いのと同じ
    await writeTo('auto', 1);
    expect((await remove('auto', 1)).status).toBe(200);
    await expectError(await remove('auto', 2), 404, 'NOT_FOUND');
    expect(await countRows()).toBe(1);
  });

  it('他のプレイヤーのセーブは一覧に出ず消せない', async () => {
    await writeTo('auto', 1);
    expect((await ok<ListBody>(await list({ playerId: 'p2' }))).items).toEqual([]);
    await expectError(await remove('auto', 1, { playerId: 'p2' }), 404, 'NOT_FOUND');
    expect(await ok<SaveBody>(await read('auto'))).toMatchObject({ data: 'auto-1', revision: 1 });
  });
});

describe('V2 スロットの数の上限', () => {
  it('スロットの数の上限を超える新しいスロットへの書き込みはSLOT_LIMIT_EXCEEDEDの409を返す', async () => {
    for (let i = 0; i < MAX_SLOTS; i++) await writeTo(`slot-${i}`, 1);
    await expectError(await write('one-more', 'x', 0), 409, 'SLOT_LIMIT_EXCEEDED');
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SLOTS);
    await expectError(await read('one-more'), 404, 'NOT_FOUND');
    // 別のプレイヤーは同じゲームで書ける
    expect((await write('one-more', 'x', 0, { playerId: 'p2' })).status).toBe(200);
    // 消したスロットは数えないので、1 つ消せば新しいスロットに書ける
    expect((await remove('slot-0', 1)).status).toBe(200);
    expect((await write('one-more', 'x', 0)).status).toBe(200);
    // 墓石のスロットに書き直すのも新しいスロットと同じく数える
    await expectError(await write('slot-0', 'x', 0), 409, 'SLOT_LIMIT_EXCEEDED');
  });

  it('上限まで埋まっていても既にあるスロットの上書きは通る', async () => {
    for (let i = 0; i < MAX_SLOTS; i++) await writeTo(`slot-${i}`, 1);
    const body = await ok<SaveBody>(await write('slot-3', 'updated', 1));
    expect(body.revision).toBe(2);
    // 上限の時も、生きているスロットへの前のリビジョン0の書き込みは SAVE_CONFLICT（上限のエラーにしない）
    await expectError(await write('slot-3', 'again', 0), 409, 'SAVE_CONFLICT');
  });
});

describe('G6 墓石の使い回し', () => {
  it('墓石を含めたスロットの行が上限なら一番古い墓石を使い回して新しいスロットを書く', async () => {
    await seedTombstones(MAX_SAVE_ROWS - 1);
    await seedTombstones(3, 'other', 'p2');
    await writeTo('live', 1);
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
    const body = await ok<SaveBody>(await write('fresh', 'fresh-1', 0));
    expect(body.revision).toBe(1);
    expect(await ok<SaveBody>(await read('fresh'))).toMatchObject({ data: 'fresh-1', revision: 1 });
    // 行の数は上限のまま。消えたのは一番古い墓石の 1 つだけ
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
    expect(await hasRow('t-000')).toBe(false);
    expect(await hasRow('t-001')).toBe(true);
    expect(await countRows("player_id = 'p1' AND deleted = 1")).toBe(MAX_SAVE_ROWS - 2);
    // 他のプレイヤーの墓石は使い回さない
    expect(await countRows("player_id = 'p2'")).toBe(3);
    // 上限に届いていなければ墓石を消さない
    await baseEnv.DB.prepare("DELETE FROM saves WHERE player_id = 'p1' AND slot_id = 'fresh'").run();
    expect((await write('fresh-2', 'x', 0)).status).toBe(200);
    expect(await hasRow('t-001')).toBe(true);
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
  });

  it('墓石の使い回しは生きているスロットを消さない', async () => {
    // 生きているスロットを墓石より古くしても、消すのは墓石だけ
    for (let i = 0; i < MAX_SLOTS - 1; i++) await writeTo(`live-${i}`, 1);
    await baseEnv.DB.prepare("UPDATE saves SET updated_at = '2000-01-01T00:00:00.000Z' WHERE deleted = 0").run();
    await seedTombstones(MAX_SAVE_ROWS - (MAX_SLOTS - 1));
    expect((await write('fresh', 'x', 0)).status).toBe(200);
    for (let i = 0; i < MAX_SLOTS - 1; i++) {
      expect(await ok<SaveBody>(await read(`live-${i}`))).toMatchObject({ data: `live-${i}-1`, revision: 1 });
    }
    expect(await hasRow('t-000')).toBe(false);
    expect(await countRows("player_id = 'p1' AND deleted = 0")).toBe(MAX_SLOTS);
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
    // 新しい行が入らない書き込み（生きているスロットが上限・生きている行への 0・墓石への書き直し）は墓石を消さない
    await expectError(await write('one-more', 'x', 0), 409, 'SLOT_LIMIT_EXCEEDED');
    await expectError(await write('live-0', 'x', 0), 409, 'SAVE_CONFLICT');
    expect(await hasRow('t-001')).toBe(true);
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
    expect((await remove('live-0', 1)).status).toBe(200);
    const revived = await ok<SaveBody>(await write('t-050', 'back', 0));
    expect(revived.revision).toBe(4);
    expect(await hasRow('t-001')).toBe(true);
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
  });

  it('使い回された名前のスロットはリビジョン1から書ける', async () => {
    await seedTombstones(MAX_SAVE_ROWS - 1, 't', 'p1', 5);
    await writeTo('live', 1);
    expect((await write('fresh', 'x', 0)).status).toBe(200);
    expect(await hasRow('t-000')).toBe(false);
    // 使い回された名前は行の無いスロットと同じ。前のリビジョン 0 で書けてリビジョンは 1 から（墓石の 5 の次にならない）
    await expectError(await read('t-000'), 404, 'NOT_FOUND');
    const again = await ok<SaveBody>(await write('t-000', 'again', 0));
    expect(again.revision).toBe(1);
    expect((await ok<SaveBody>(await write('t-000', 'again-2', 1))).revision).toBe(2);
    expect(await ok<SaveBody>(await read('t-000'))).toMatchObject({ data: 'again-2', revision: 2 });
    // この書き込みでも次に古い墓石を使い回し、行の数は上限のまま
    expect(await hasRow('t-001')).toBe(false);
    expect(await countRows("player_id = 'p1'")).toBe(MAX_SAVE_ROWS);
  });
});

describe('V2 本番の設定', () => {
  it('本番の設定ではセーブの一覧と削除もNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await writeTo('auto', 1);
    await expectError(await list({ e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    await expectError(await remove('auto', 1, { e: baseEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    expect(await countRows('deleted = 0')).toBe(1);
    expect(await ok<SaveBody>(await read('auto'))).toMatchObject({ revision: 1 });
  });
});
