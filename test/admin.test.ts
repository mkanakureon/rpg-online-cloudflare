/**
 * 管理 O1: 管理の鍵（adminSecret・requireAdmin）と、プレイヤーを読む口（GET /v1/admin/players/{playerId}）・監査を読む口
 * （GET /v1/admin/audit）と、管理のスキーマ（openapi/rpg-online-admin.v1.json）の試験。
 * 名前と期待する結果の正は docs/guides/working/admin-design.md §8 の O1 の行。L1 は関数を直に呼ぶ。L2 は src/worker.ts の
 * default.fetch を直に呼ぶ。管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）で、鍵の無い場合は ADMIN_API_KEY: undefined を
 * env に明示する（試験のランタイムが .dev.vars を読み込んでも、人の鍵に頼らない）。試験のゲームは専用の adm-game。
 * 監査の行を書く口は O1 に無いので、監査を読む試験の行は表に直に入れる。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { adminSecret, requireAdmin } from '../src/core/admin/key';
import { adminRoutes } from '../src/core/admin/routes';
import { NO_IP_SUBJECT } from '../src/core/rate-limit';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import adminSpecJson from '../openapi/rpg-online-admin.v1.json';
import { registerGame } from './support/games';
import { countRateLimitRows, fillRateLimit, resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const adminEnv: TestEnv = { ...localEnv, ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'adm-game';

type ErrorBody = { error: { code: string; message: string } };
type AuditItem = { auditId: number; actor: string; action: string; target: string; before: unknown; after: unknown; reason: string;
  createdAt: string };
type AuditBody = { gameId: string; items: AuditItem[]; nextBefore?: number };

type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type Operation = { operationId: string; responses: Record<string, ResponseSpec> };
type AdminSpec = SchemaRoot & { openapi: string; paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> } };
const adminSpec = adminSpecJson as unknown as AdminSpec;
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** 管理の口に GET を送る。authorization を null にすると見出しを付けない。 */
function adminGet(path: string, options: { e?: TestEnv; authorization?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const authorization = options.authorization === undefined ? `Bearer ${adminKey}` : options.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}${path}`, { headers }), (options.e ?? adminEnv) as never);
}
const auditPath = (query = '', gameId = game) => `/v1/admin/audit?gameId=${gameId}${query ? `&${query}` : ''}`;
const playerPath = (playerId: string, gameId = game) => `/v1/admin/players/${playerId}?gameId=${gameId}`;

async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  expect(res.status, code).toBe(status);
  const body = await res.json<ErrorBody>();
  expect(body.error.code).toBe(code);
  return body;
}
async function addPlayer(playerId: string, gameId = game): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare("INSERT INTO accounts (account_id, kind) VALUES (?, 'guest')").bind(`acc-${gameId}-${playerId}`),
    baseEnv.DB.prepare('INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, ?, ?)')
      .bind(gameId, playerId, `acc-${gameId}-${playerId}`),
  ]);
}
async function addAudit(action: string, createdAt: number, before: unknown, after: unknown, gameId = game): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, '
    + "created_at) VALUES (?, ?, 'local-admin', ?, 'player:p1', ?, ?, 'test', ?)")
    .bind(crypto.randomUUID(), gameId, action, before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after), createdAt).run();
}
/** 管理のスキーマの操作の、その状態の形に応答を当てる。 */
async function expectConforms(res: Response, specPath: string): Promise<unknown> {
  const r = adminSpec.paths[specPath].get.responses[String(res.status)];
  expect(r, `${specPath} の応答に状態 ${res.status} がある`).toBeDefined();
  for (const [name, h] of Object.entries(r.headers ?? {})) {
    const value = res.headers.get(name);
    if (h.required) expect(value, `ヘッダー ${name} がある`).not.toBeNull();
    if (value !== null) expect(validate(value, h.schema, adminSpec), `ヘッダー ${name}`).toEqual([]);
  }
  expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
  const body = await res.json();
  expect(validate(body, r.content!['application/json'].schema, adminSpec), `${specPath} ${res.status} の本文`).toEqual([]);
  const codes = r['x-error-codes'];
  if (codes) expect(codes).toContain((body as ErrorBody).error.code);
  return body;
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）だけ残す。
// 監査・残高・履歴・セーブ・スコア → プレイヤー → 品目 → 機能の設定 → ゲームの順に消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM admin_audit_log'),
    baseEnv.DB.prepare('DELETE FROM inventory_ledger'),
    baseEnv.DB.prepare('DELETE FROM inventory_balances'),
    baseEnv.DB.prepare('DELETE FROM saves'),
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare('DELETE FROM game_players'),
    baseEnv.DB.prepare('DELETE FROM accounts'),
    baseEnv.DB.prepare("DELETE FROM inventory_items WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
  // 管理の口は機能の設定を見ないので、どの機能も使わない設定で登録する
  await registerGame(baseEnv.DB, game, []);
  const item = baseEnv.DB.prepare('INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, ?, ?)');
  await baseEnv.DB.batch([item.bind(game, 'gold', 'currency'), item.bind(game, 'potion', 'item')]);
});

describe('O1 管理の鍵の関数', () => {
  it('管理の鍵はADMIN_API_KEYが32文字以上のときだけ使う', () => {
    const k32 = 'k'.repeat(32);
    const k31 = 'k'.repeat(31);
    for (const appEnv of ['local', 'disabled']) {
      expect(adminSecret({ APP_ENV: appEnv, ADMIN_API_KEY: k32 } as never), appEnv).toBe(k32);
      expect(adminSecret({ APP_ENV: appEnv, ADMIN_API_KEY: k31 } as never), appEnv).toBeNull();
      expect(adminSecret({ APP_ENV: appEnv } as never), appEnv).toBeNull();
      expect(adminSecret({ APP_ENV: appEnv, ADMIN_API_KEY: undefined } as never), appEnv).toBeNull();
    }
  });

  it('管理の鍵の比べは長さの違う値でも投げずに外れを返す', async () => {
    const withKey = (value: string | null) =>
      new Request(`${base}/v1/admin/audit`, { headers: value === null ? {} : { authorization: value } });
    expect(await requireAdmin(withKey(`Bearer ${adminKey}`), adminKey)).toBeNull();
    for (const value of ['Bearer a', `Bearer ${'a'.repeat(31)}`, `Bearer ${'a'.repeat(33)}`, `Bearer ${'a'.repeat(500)}`,
      `Bearer ${'b'.repeat(32)}`, adminKey, null]) {
      const res = await requireAdmin(withKey(value), adminKey);
      expect(res, String(value).slice(0, 40)).not.toBeNull();
      expect(res!.status).toBe(401);
      expect(await res!.json()).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Invalid admin credentials' } });
    }
  });
});

describe('O1 管理の口の守りと鍵', () => {
  it('管理の鍵の無い環境では管理の口がINTERNAL_ERRORの500を返す', async () => {
    for (const e of [{ ...localEnv, ADMIN_API_KEY: undefined }, { ...localEnv, ADMIN_API_KEY: 'short' }]) {
      const res = await adminGet(auditPath(), { e });
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
      expect(text).not.toContain('ADMIN_API_KEY');
      expect(text).not.toContain(adminKey);
    }
  });

  it('本番の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await addPlayer('p1');
    const prodEnv: TestEnv = { ...baseEnv, APP_ENV: 'disabled', ADMIN_API_KEY: adminKey };
    for (const path of [auditPath(), playerPath('p1')]) {
      await expectError(await adminGet(path, { e: prodEnv }), 403, 'NOT_READY_FOR_PRODUCTION');
    }
    // 数える前に断る（何も書かない）
    expect(await countRateLimitRows(baseEnv.DB)).toBe(0);
  });

  it('管理の鍵が無いか違う要求はUNAUTHENTICATEDの401を返す', async () => {
    await addPlayer('p1');
    for (const authorization of [null, `Bearer ${'b'.repeat(32)}`, `Basic ${adminKey}`, adminKey, 'Bearer ']) {
      for (const path of [auditPath(), playerPath('p1')]) {
        const body = await expectError(await adminGet(path, { authorization }), 401, 'UNAUTHENTICATED');
        expect(body.error.message).toBe('Invalid admin credentials');
      }
    }
  });

  it('プレイヤーのトークンでは管理の口を通れない', async () => {
    const guest = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: game }),
    }), adminEnv as never);
    expect(guest.status).toBe(200);
    const { playerId, token } = await guest.json<{ playerId: string; token: string }>();
    for (const path of [auditPath(), playerPath(playerId)]) {
      await expectError(await adminGet(path, { authorization: `Bearer ${token}` }), 401, 'UNAUTHENTICATED');
    }
  });

  it('管理の口を上限より多く呼ぶと鍵を確かめる前に429を返す', async () => {
    // 正しい鍵の要求も数える
    expect((await adminGet(auditPath())).status).toBe(200);
    const counted = await baseEnv.DB.prepare('SELECT SUM(count) AS n FROM rate_limit_counters WHERE scope = ? AND subject = ?')
      .bind(RATE_LIMITS.admin.scope, NO_IP_SUBJECT).first<{ n: number }>();
    expect(counted?.n).toBe(1);
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.admin, NO_IP_SUBJECT);
    for (const authorization of [`Bearer ${adminKey}`, `Bearer ${'b'.repeat(32)}`, null]) {
      const res = await adminGet(auditPath(), { authorization });
      await expectError(res, 429, 'RATE_LIMITED');
      expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
      expect(Number(res.headers.get('Retry-After'))).toBeLessThanOrEqual(RATE_LIMITS.admin.period);
    }
    // 別の IP は数えが別
    const other = await worker.fetch(new Request(`${base}${auditPath()}`, {
      headers: { authorization: `Bearer ${adminKey}`, 'CF-Connecting-IP': '203.0.113.9' },
    }), adminEnv as never);
    expect(other.status).toBe(200);
  });

  it('管理の鍵を取り替えると前の鍵は401になる', async () => {
    const newKey = 'n'.repeat(40);
    const rotated: TestEnv = { ...localEnv, ADMIN_API_KEY: newKey };
    expect((await adminGet(auditPath())).status).toBe(200);
    await expectError(await adminGet(auditPath(), { e: rotated }), 401, 'UNAUTHENTICATED');
    expect((await adminGet(auditPath(), { e: rotated, authorization: `Bearer ${newKey}` })).status).toBe(200);
  });
});

describe('O1 プレイヤーと監査を読む', () => {
  it('管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない', async () => {
    await addPlayer('p1');
    await addPlayer('p2');
    const now = Math.floor(Date.now() / 1000);
    const db = baseEnv.DB;
    const balance = db.prepare('INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, ?, ?, ?, ?)');
    const ledger = db.prepare('INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at) '
      + "VALUES (?, ?, ?, ?, 'event-claim', ?, ?)");
    const save = db.prepare('INSERT INTO saves (game_id, player_id, slot_id, revision, format_version, data, checksum, size, deleted) '
      + 'VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)');
    const score = db.prepare('INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score) VALUES (?, ?, ?, ?, ?)');
    await db.batch([
      balance.bind(game, 'p1', 'potion', 3, now), balance.bind(game, 'p1', 'gold', 100, now), balance.bind(game, 'p2', 'gold', 999, now),
      ledger.bind(game, 'p1', 'gold', 100, 'claim-a', now), ledger.bind(game, 'p1', 'potion', 3, 'claim-b', now),
      ledger.bind(game, 'p2', 'gold', 999, 'claim-other', now),
      save.bind(game, 'p1', 'slot2', 1, '{"secret":"old"}', 'c'.repeat(64), 16, 1),
      save.bind(game, 'p1', 'auto', 3, '{"hp":10}', 'd'.repeat(64), 9, 0),
      save.bind(game, 'p2', 'auto', 1, '{"hp":1}', 'e'.repeat(64), 8, 0),
      score.bind(game, 'boss-score', 'p1', 'Hero', 1200), score.bind(game, 'arena', 'p1', 'Hero', 30),
      score.bind(game, 'boss-score', 'p2', 'Other', 5000),
    ]);
    const res = await adminGet(playerPath('p1'));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.gameId).toBe(game);
    expect(body.playerId).toBe('p1');
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.balances).toEqual([{ itemId: 'gold', kind: 'currency', amount: 100 }, { itemId: 'potion', kind: 'item', amount: 3 }]);
    expect(body.history.map((h: { sourceId: string }) => h.sourceId)).toEqual(['claim-b', 'claim-a']);
    expect(body.history[1]).toMatchObject({ itemId: 'gold', delta: 100, sourceType: 'event-claim' });
    expect(body.history[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.saves.map((s: Record<string, unknown>) => ({ ...s, updatedAt: typeof s.updatedAt }))).toEqual([
      { slotId: 'auto', revision: 3, size: 9, deleted: false, updatedAt: 'string' },
      { slotId: 'slot2', revision: 1, size: 16, deleted: true, updatedAt: 'string' },
    ]);
    expect(body.rankings).toEqual([{ boardId: 'arena', score: 30, displayName: 'Hero' }, { boardId: 'boss-score', score: 1200, displayName: 'Hero' }]);
    // セーブの本文とチェックサムは返さない（欄も値も無い）
    for (const s of body.saves) {
      expect('data' in s).toBe(false);
      expect('checksum' in s).toBe(false);
    }
    for (const leaked of ['"data"', '"checksum"', 'secret', 'hp', 'c'.repeat(64), 'd'.repeat(64)]) expect(text).not.toContain(leaked);
    // O1 の応答は ban の欄を持たない（O2 で足す）
    expect('ban' in body).toBe(false);
    // 受領の履歴は新しい順に 20 行まで
    const many = Array.from({ length: 25 }, (_, i) => ledger.bind(game, 'p1', 'gold', 1, `bulk-${i}`, now));
    await db.batch(many);
    const full = await (await adminGet(playerPath('p1'))).json<{ history: Array<{ sourceId: string }> }>();
    expect(full.history).toHaveLength(20);
    expect(full.history[0].sourceId).toBe('bulk-24');
    // 読み取りは監査に残さない
    expect((await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log').first<{ n: number }>())?.n).toBe(0);
  });

  it('知らないプレイヤーの管理の読み取りはNOT_FOUNDの404を返す', async () => {
    await addPlayer('p1', 'demo-rpg');
    const body = await expectError(await adminGet(playerPath('p1')), 404, 'NOT_FOUND');
    expect(body.error.message).toBe('Unknown player');
    await expectError(await adminGet(playerPath('nobody')), 404, 'NOT_FOUND');
  });

  it('登録の無いゲームの管理の口はNOT_FOUNDの404を返す', async () => {
    for (const path of [auditPath('', 'no-such-game'), playerPath('p1', 'no-such-game')]) {
      const body = await expectError(await adminGet(path), 404, 'NOT_FOUND');
      expect(body.error.message).toBe('Unknown game');
    }
    // gameId の形の誤りは 400
    await expectError(await adminGet('/v1/admin/audit?gameId=bad%20id'), 400, 'INVALID_ARGUMENT');
    await expectError(await adminGet('/v1/admin/audit'), 400, 'INVALID_ARGUMENT');
  });

  it('監査のログは新しい順に返りlimitで区切って続きを読める', async () => {
    const now = Math.floor(Date.now() / 1000);
    await addAudit('player.ban', now - 20, null, { reason: 'spam', expiresAt: null });
    await addAudit('inventory.adjust', now - 10, { itemId: 'gold', amount: 120 }, { itemId: 'gold', amount: 100 });
    await addAudit('player.unban', now, { reason: 'spam', expiresAt: null }, null);
    await addAudit('player.ban', now, null, null, 'demo-rpg');
    const first = await adminGet(auditPath('limit=2'));
    expect(first.status).toBe(200);
    const page1 = await first.json<AuditBody>();
    expect(page1.gameId).toBe(game);
    expect(page1.items.map((i) => i.action)).toEqual(['player.unban', 'inventory.adjust']);
    expect(page1.items[1]).toMatchObject({ actor: 'local-admin', target: 'player:p1', reason: 'test',
      before: { itemId: 'gold', amount: 120 }, after: { itemId: 'gold', amount: 100 } });
    expect(page1.items[0].after).toBeNull();
    expect(page1.items[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(page1.items[0].auditId).toBeGreaterThan(page1.items[1].auditId);
    expect(page1.nextBefore).toBe(page1.items[1].auditId);
    const second = await adminGet(auditPath(`limit=2&before=${page1.nextBefore}`));
    expect(second.status).toBe(200);
    const page2 = await second.json<AuditBody>();
    expect(page2.items.map((i) => i.action)).toEqual(['player.ban']);
    expect(page2.items[0].before).toBeNull();
    expect('nextBefore' in page2).toBe(false);
    // 既定の limit で全部（ほかのゲームの行は出ない）
    expect((await (await adminGet(auditPath())).json<AuditBody>()).items).toHaveLength(3);
    for (const q of ['limit=0', 'limit=101', 'limit=abc', 'before=0', 'before=-1', 'before=1.5']) {
      await expectError(await adminGet(auditPath(q)), 400, 'INVALID_ARGUMENT');
    }
  });
});

describe('O1 管理のスキーマ', () => {
  it('管理の口の応答は管理のスキーマに合う', async () => {
    await addPlayer('p1');
    const now = Math.floor(Date.now() / 1000);
    await baseEnv.DB.prepare('INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(game, 'p1', 'gold', 10, now).run();
    await baseEnv.DB.prepare('INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at) '
      + "VALUES (?, 'p1', 'gold', 10, 'event-claim', 'c1', ?)").bind(game, now).run();
    await baseEnv.DB.prepare('INSERT INTO saves (game_id, player_id, slot_id, revision, format_version, data, checksum, size) '
      + "VALUES (?, 'p1', 'auto', 1, 1, '{}', ?, 2)").bind(game, 'f'.repeat(64)).run();
    await baseEnv.DB.prepare("INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score) VALUES (?, 'boss-score', 'p1', 'Hero', 7)")
      .bind(game).run();
    await addAudit('inventory.adjust', now, { itemId: 'gold', amount: 0 }, { itemId: 'gold', amount: 10 });
    await addAudit('player.ban', now, null, { reason: 'x', expiresAt: null });
    const playerSpec = '/v1/admin/players/{playerId}';
    const auditSpec = '/v1/admin/audit';
    // 200
    await expectConforms(await adminGet(playerPath('p1')), playerSpec);
    await expectConforms(await adminGet(auditPath()), auditSpec);
    await expectConforms(await adminGet(auditPath('limit=1')), auditSpec);
    // 400・401・403・404・429・500
    await expectConforms(await adminGet(auditPath('limit=0')), auditSpec);
    await expectConforms(await adminGet('/v1/admin/players/p1?gameId=bad%20id'), playerSpec);
    await expectConforms(await adminGet(auditPath(), { authorization: null }), auditSpec);
    await expectConforms(await adminGet(playerPath('p1'), { authorization: `Bearer ${'b'.repeat(32)}` }), playerSpec);
    await expectConforms(await adminGet(auditPath(), { e: { ...baseEnv, APP_ENV: 'disabled', ADMIN_API_KEY: adminKey } }), auditSpec);
    await expectConforms(await adminGet(playerPath('nobody')), playerSpec);
    await expectConforms(await adminGet(auditPath('', 'no-such-game')), auditSpec);
    await expectConforms(await adminGet(playerPath('p1'), { e: { ...localEnv, ADMIN_API_KEY: undefined } }), playerSpec);
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.admin, NO_IP_SUBJECT);
    await expectConforms(await adminGet(auditPath()), auditSpec);
    await expectConforms(await adminGet(playerPath('p1')), playerSpec);
  });

  it('管理のスキーマの操作は管理のルートと1対1で対応する', () => {
    expect(adminSpec.openapi).toMatch(/^3\.1\.\d+$/);
    // スキーマの操作（メソッドとパス）ごとに、パスの {名前} を ID の形の値にして当たるルートがちょうど 1 つ
    const operations = Object.entries(adminSpec.paths).flatMap(([path, item]) =>
      methods.filter((m) => m in item).map((m) => ({ method: m.toUpperCase(), path })));
    const used = new Set<number>();
    for (const op of operations) {
      const sample = op.path.replace(/\{[^}]+\}/g, 'x-1');
      const hits = adminRoutes.map((r, i) => ({ r, i })).filter(({ r }) => r.method === op.method && r.pattern.test(sample));
      expect(hits, `${op.method} ${op.path} に当たる管理のルート`).toHaveLength(1);
      used.add(hits[0].i);
    }
    // スキーマに無いルートが無い
    expect(used.size).toBe(adminRoutes.length);
    expect(operations).toHaveLength(adminRoutes.length);
    for (const op of operations) expect(op.path.startsWith('/v1/admin/'), op.path).toBe(true);
  });

  it('管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する', () => {
    const declared = adminSpec.components.schemas.ErrorCode.enum as string[];
    const used = new Set<string>();
    for (const item of Object.values(adminSpec.paths)) {
      for (const m of methods.filter((k) => k in item)) {
        for (const [status, r] of Object.entries(item[m].responses)) {
          if (Number(status) >= 400) expect(r['x-error-codes'], `${item[m].operationId} ${status} の x-error-codes`).toBeDefined();
          for (const code of r['x-error-codes'] ?? []) used.add(code);
        }
      }
    }
    expect([...declared].sort()).toEqual([...used].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });
});
