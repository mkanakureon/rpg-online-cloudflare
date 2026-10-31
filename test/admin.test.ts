/**
 * 管理 O1: 管理の鍵（adminSecret・requireAdmin）と、プレイヤーを読む口（GET /v1/admin/players/{playerId}）・監査を読む口
 * （GET /v1/admin/audit）と、管理のスキーマ（openapi/rpg-online-admin.v1.json）の試験。
 * 管理 O3: データ修正（所持品と通貨の増減 POST /v1/admin/players/{playerId}/inventory・Idempotency-Key・スコアを消す
 * DELETE /v1/admin/rankings/{boardId}/entries/{playerId}・src/core/ledger.ts の LEDGER_SOURCES）の試験。
 * 管理 O4: 品目とイベントの定義（PUT /v1/admin/items/{itemId}・PUT /v1/admin/events/{eventId}・parseEventDefinition）と、管理コマンドの
 * 要求の形（scripts/admin-requests.mjs。smoke の流れ runSmoke に src/worker.ts の fetch を渡す）の試験。
 * プレイヤーデータ U3: プレイヤーを読む口の playerData と、キーと実績の宣言・値を置く・実績の取り消しの 4 つの口（名前と期待する結果の正は
 * docs/guides/working/player-data-design.md §10 の U3 の行）。プレイヤーデータの表は U3 の describe の前後で消す。
 * クエスト Q3: クエストの定義の口（PUT /v1/admin/quests/{questId}・MAX_QUESTS）・プレイヤーを読む口の questClaims・値を置く口の区切りの値の
 * 頭打ち（名前と期待する結果の正は docs/guides/working/quest-design.md §10 の Q3 の行）。クエストと区切りの表は Q3 の describe の前後で消す。
 * 名前と期待する結果の正は docs/guides/working/admin-design.md §8 の O1・O3・O4 の行。L1 は関数を直に呼ぶ。L2 は src/worker.ts の
 * default.fetch を直に呼ぶ。管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）で、鍵の無い場合は ADMIN_API_KEY: undefined を
 * env に明示する（試験のランタイムが .dev.vars を読み込んでも、人の鍵に頼らない）。試験のゲームは専用の adm-game。
 * O1 の監査を読む試験の行は表に直に入れる（O1 の時点で監査の行を書く口が無かったため）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { adminSecret, requireAdmin } from '../src/core/admin/key';
import { parseAdjustment, parseEventDefinition } from '../src/core/admin/parse';
import { adminRoutes } from '../src/core/admin/routes';
import { MAX_ITEM_AMOUNT, MAX_REWARD_LINES } from '../src/core/inventory';
import { LEDGER_SOURCES } from '../src/core/ledger';
import { periodKey } from '../src/core/period';
import { MAX_PLAYER_DATA_KEYS } from '../src/core/player-data';
import { MAX_QUESTS } from '../src/core/quests';
import { NO_IP_SUBJECT } from '../src/core/rate-limit';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import adminSpecJson from '../openapi/rpg-online-admin.v1.json';
import {
  SMOKE_AUDIT_ACTIONS, adminRequest, auditOp, playerOp, putAchievementOp, putDataKeyOp, putEventOp, putItemOp, putQuestOp, revokeAchievementOp,
  runSmoke, setDataOp, type AdminOp, type EventDefinitionBody, type QuestDefinitionBody,
} from '../scripts/admin-requests.mjs';
import {
  authHeaders, claimPath, eventsPath, guestRequest, inventoryPath, playerDataHeaders, playerDataPath, playerDataWrite, questClaimPath, questsPath,
} from '../scripts/cli-requests.mjs';
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
// 受け取り・イベント（demo-rpg の手本の daily-login は残す）・止めた印 → 監査・残高・履歴・セーブ・スコア → プレイヤー →
// 品目（demo-rpg の手本の gold・potion は残す）→ 機能の設定 → ゲームの順に消す
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM event_claims'),
    baseEnv.DB.prepare("DELETE FROM event_rewards WHERE NOT (game_id = 'demo-rpg' AND event_id = 'daily-login')"),
    baseEnv.DB.prepare("DELETE FROM events WHERE NOT (game_id = 'demo-rpg' AND event_id = 'daily-login')"),
    baseEnv.DB.prepare('DELETE FROM player_bans'),
    baseEnv.DB.prepare('DELETE FROM admin_audit_log'),
    baseEnv.DB.prepare('DELETE FROM inventory_ledger'),
    baseEnv.DB.prepare('DELETE FROM inventory_balances'),
    baseEnv.DB.prepare('DELETE FROM saves'),
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare('DELETE FROM game_players'),
    baseEnv.DB.prepare('DELETE FROM accounts'),
    baseEnv.DB.prepare("DELETE FROM inventory_items WHERE game_id <> 'demo-rpg' OR item_id NOT IN ('gold', 'potion')"),
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

// ---- O3 データ修正 ----

type AdjustBody = { gameId: string; playerId: string; itemId: string; delta: number; amount: number; auditId: number };
type WriteOptions = { key?: string | null; actor?: string | null; gameId?: string; e?: TestEnv };

/** 管理の増減の口に送る（既定の鍵は試験ごとに作る）。key を null にすると Idempotency-Key を付けない。 */
function adjust(playerId: string, body: unknown, options: WriteOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' };
  const actor = options.actor === undefined ? 'local-admin' : options.actor;
  if (actor !== null) headers['X-Admin-Actor'] = actor;
  const key = options.key === undefined ? crypto.randomUUID() : options.key;
  if (key !== null) headers['Idempotency-Key'] = key;
  return worker.fetch(new Request(`${base}/v1/admin/players/${playerId}/inventory?gameId=${options.gameId ?? game}`, {
    method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body),
  }), (options.e ?? adminEnv) as never);
}
const grant = (playerId: string, itemId: string, delta: number, options: WriteOptions = {}) =>
  adjust(playerId, { itemId, delta, reason: '試験の修正' }, options);
/** 管理でスコアを消す口に送る。 */
function deleteScore(boardId: string, playerId: string, body: unknown = { reason: '不正なスコア' }): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/admin/rankings/${boardId}/entries/${playerId}?gameId=${game}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json', 'X-Admin-Actor': 'local-admin' },
    body: JSON.stringify(body),
  }), adminEnv as never);
}
async function balanceOf(playerId: string, itemId: string): Promise<number | null> {
  const row = await baseEnv.DB.prepare('SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?')
    .bind(game, playerId, itemId).first<{ amount: number }>();
  return row?.amount ?? null;
}
async function countRows(table: 'inventory_ledger' | 'inventory_balances' | 'admin_audit_log' | 'ranking_entries'): Promise<number> {
  return (await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
}
async function ledgerRows(playerId: string): Promise<Array<{ delta: number; sourceType: string; sourceId: string }>> {
  return (await baseEnv.DB.prepare('SELECT delta, source_type AS sourceType, source_id AS sourceId FROM inventory_ledger '
    + 'WHERE game_id = ? AND player_id = ? ORDER BY entry_id').bind(game, playerId).all<{ delta: number; sourceType: string; sourceId: string }>()).results;
}
/** 管理のスキーマの、そのメソッドとパスの操作の応答の形に当てる。 */
async function expectAdminConforms(res: Response, specPath: string, method: 'post' | 'delete' | 'put'): Promise<unknown> {
  const r = adminSpec.paths[specPath][method].responses[String(res.status)];
  expect(r, `${method} ${specPath} の応答に状態 ${res.status} がある`).toBeDefined();
  const body = await res.json();
  expect(validate(body, r.content!['application/json'].schema, adminSpec), `${specPath} ${res.status} の本文`).toEqual([]);
  if (r['x-error-codes']) expect(r['x-error-codes']).toContain((body as ErrorBody).error.code);
  return body;
}
const adjustSpec = '/v1/admin/players/{playerId}/inventory';
const deleteSpec = '/v1/admin/rankings/{boardId}/entries/{playerId}';
/** 何も書いていないことを見るための行の数。 */
async function snapshot(): Promise<number[]> {
  return [await countRows('inventory_ledger'), await countRows('inventory_balances'), await countRows('admin_audit_log')];
}

describe('O3 データ修正の関数', () => {
  it('管理の増減の本文はdeltaが0でない整数で上限の内のときだけ通す', () => {
    for (const delta of [1, -1, 50, -20, MAX_ITEM_AMOUNT, -MAX_ITEM_AMOUNT]) {
      expect(parseAdjustment({ itemId: 'gold', delta }), String(delta)).toEqual({ ok: true, value: { itemId: 'gold', delta } });
    }
    for (const delta of [0, -0, 1.5, -0.5, MAX_ITEM_AMOUNT + 1, -MAX_ITEM_AMOUNT - 1, Number.NaN, Infinity, '10', null, undefined, true]) {
      expect(parseAdjustment({ itemId: 'gold', delta }).ok, String(delta)).toBe(false);
    }
    for (const itemId of [undefined, '', 'bad id', 'x'.repeat(65), 7]) {
      expect(parseAdjustment({ itemId, delta: 1 }).ok, String(itemId)).toBe(false);
    }
  });

  it('受領の履歴の種類の名前は台帳のモジュールの1か所にある', () => {
    // クエストの Q1 で questClaim の行を足した（quest-design.md §6。名前は変えず、いまの 2 行は変えない）
    expect(LEDGER_SOURCES).toEqual({ eventClaim: 'event-claim', questClaim: 'quest-claim', admin: 'admin' });
  });
});

describe('O3 所持品と通貨の増減', () => {
  it('管理の付与で所持品が増え受領の履歴にadminの行が残る', async () => {
    await addPlayer('p1');
    const res = await grant('p1', 'gold', 50);
    expect(res.status).toBe(200);
    const body = await expectAdminConforms(res, adjustSpec, 'post') as AdjustBody;
    expect(body).toMatchObject({ gameId: game, playerId: 'p1', itemId: 'gold', delta: 50, amount: 50 });
    expect(await balanceOf('p1', 'gold')).toBe(50);
    const rows = await ledgerRows('p1');
    expect(rows).toHaveLength(1);
    const audit = await baseEnv.DB.prepare('SELECT audit_ref AS ref FROM admin_audit_log WHERE audit_id = ?').bind(body.auditId)
      .first<{ ref: string }>();
    expect(rows[0]).toEqual({ delta: 50, sourceType: 'admin', sourceId: audit?.ref });
    // プレイヤーを読む口の履歴にも出る
    const player = await (await adminGet(playerPath('p1'))).json<{ balances: unknown[]; history: Array<Record<string, unknown>> }>();
    expect(player.balances).toEqual([{ itemId: 'gold', kind: 'currency', amount: 50 }]);
    expect(player.history[0]).toMatchObject({ itemId: 'gold', delta: 50, sourceType: 'admin', sourceId: audit?.ref });
  });

  it('管理の取り消しは負の増減で履歴に残り残高を減らす', async () => {
    await addPlayer('p1');
    expect((await grant('p1', 'gold', 50)).status).toBe(200);
    const res = await grant('p1', 'gold', -20);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ itemId: 'gold', delta: -20, amount: 30 });
    expect(await balanceOf('p1', 'gold')).toBe(30);
    expect((await ledgerRows('p1')).map((r) => [r.delta, r.sourceType])).toEqual([[50, 'admin'], [-20, 'admin']]);
  });

  it('残高より多い取り消しはINSUFFICIENT_BALANCEの409を返し何も書かない', async () => {
    await addPlayer('p1');
    expect((await grant('p1', 'gold', 30)).status).toBe(200);
    const before = await snapshot();
    const res = await grant('p1', 'gold', -31);
    await expectAdminConforms(res.clone(), adjustSpec, 'post');
    await expectError(res, 409, 'INSUFFICIENT_BALANCE');
    expect(await balanceOf('p1', 'gold')).toBe(30);
    expect(await snapshot()).toEqual(before);
    // 残高の行が無い品目の取り消しも同じ
    await expectError(await grant('p1', 'potion', -1), 409, 'INSUFFICIENT_BALANCE');
    expect(await balanceOf('p1', 'potion')).toBeNull();
    expect(await snapshot()).toEqual(before);
  });

  it('上限を超える管理の付与はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない', async () => {
    await addPlayer('p1');
    await baseEnv.DB.prepare('INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(game, 'p1', 'gold', MAX_ITEM_AMOUNT - 10, 1).run();
    const before = await snapshot();
    const res = await grant('p1', 'gold', 11);
    await expectAdminConforms(res.clone(), adjustSpec, 'post');
    await expectError(res, 409, 'INVENTORY_LIMIT_EXCEEDED');
    expect(await balanceOf('p1', 'gold')).toBe(MAX_ITEM_AMOUNT - 10);
    expect(await snapshot()).toEqual(before);
    // ちょうど上限までは通る
    const ok = await grant('p1', 'gold', 10);
    expect(ok.status).toBe(200);
    expect(await balanceOf('p1', 'gold')).toBe(MAX_ITEM_AMOUNT);
  });

  it('取り消して残高が0になった品目は所持品の一覧から消える', async () => {
    await addPlayer('p1');
    expect((await grant('p1', 'gold', 30)).status).toBe(200);
    expect((await grant('p1', 'potion', 2)).status).toBe(200);
    const res = await grant('p1', 'gold', -30);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ itemId: 'gold', delta: -30, amount: 0 });
    expect(await balanceOf('p1', 'gold')).toBeNull();
    const player = await (await adminGet(playerPath('p1'))).json<{ balances: unknown[] }>();
    expect(player.balances).toEqual([{ itemId: 'potion', kind: 'item', amount: 2 }]);
    // 履歴には付与と取り消しの両方が残る
    expect((await ledgerRows('p1')).map((r) => r.delta)).toEqual([30, 2, -30]);
  });

  it('同じIdempotency-Keyの付与を2回送っても1回分で同じ本文を返す', async () => {
    await addPlayer('p1');
    const key = 'retry-key-0001';
    const first = await grant('p1', 'gold', 50, { key });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    // 別の人が流し直しても（actor は比べない）二重にならない
    const second = await grant('p1', 'gold', 50, { key, actor: 'other-admin' });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(firstBody);
    expect(await balanceOf('p1', 'gold')).toBe(50);
    expect(await ledgerRows('p1')).toHaveLength(1);
    expect(await countRows('admin_audit_log')).toBe(1);
    // 後で残高が動いても、2 回目以降の本文は 1 回目と同じ
    expect((await grant('p1', 'gold', -5)).status).toBe(200);
    expect(await (await grant('p1', 'gold', 50, { key })).json()).toEqual(firstBody);
    expect(await balanceOf('p1', 'gold')).toBe(45);
  });

  it('同じIdempotency-Keyの付与を並べて送っても1回分', async () => {
    await addPlayer('p1');
    const key = 'parallel-key-01';
    const results = await Promise.all([grant('p1', 'gold', 50, { key }), grant('p1', 'gold', 50, { key })]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const [a, b] = await Promise.all(results.map((r) => r.json()));
    expect(a).toEqual(b);
    expect(await ledgerRows('p1')).toHaveLength(1);
    expect(await balanceOf('p1', 'gold')).toBe(50);
    expect(await countRows('admin_audit_log')).toBe(1);
  });

  it('同じIdempotency-Keyで違う中身の付与はIDEMPOTENCY_KEY_REUSEDの422を返す', async () => {
    await addPlayer('p1');
    await addPlayer('p2');
    const key = 'reused-key-0001';
    expect((await grant('p1', 'gold', 50, { key })).status).toBe(200);
    const before = await snapshot();
    const changed = [
      () => grant('p1', 'gold', 60, { key }),
      () => grant('p1', 'potion', 50, { key }),
      () => grant('p2', 'gold', 50, { key }),
      () => adjust('p1', { itemId: 'gold', delta: 50, reason: '別の理由' }, { key }),
    ];
    for (const send of changed) {
      const res = await send();
      await expectAdminConforms(res.clone(), adjustSpec, 'post');
      await expectError(res, 422, 'IDEMPOTENCY_KEY_REUSED');
    }
    expect(await snapshot()).toEqual(before);
    expect(await balanceOf('p1', 'gold')).toBe(50);
    expect(await balanceOf('p2', 'gold')).toBeNull();
  });

  it('Idempotency-Keyの無い管理の付与はINVALID_ARGUMENTの400を返す', async () => {
    await addPlayer('p1');
    for (const key of [null, '', 'short', 'has space key', 'x'.repeat(65), 'bad*key*0001']) {
      const res = await grant('p1', 'gold', 50, { key });
      await expectAdminConforms(res.clone(), adjustSpec, 'post');
      await expectError(res, 400, 'INVALID_ARGUMENT');
    }
    // 本文の外れも 400（delta が 0・X-Admin-Actor が無い）と、JSON でない本文は INVALID_JSON
    await expectError(await grant('p1', 'gold', 0), 400, 'INVALID_ARGUMENT');
    await expectError(await grant('p1', 'gold', 5, { actor: null }), 400, 'INVALID_ARGUMENT');
    await expectError(await adjust('p1', '{bad'), 400, 'INVALID_JSON');
    expect(await snapshot()).toEqual([0, 0, 0]);
  });

  it('知らない品目か知らないプレイヤーへの管理の付与はNOT_FOUNDの404を返す', async () => {
    await addPlayer('p1');
    await addPlayer('p9', 'demo-rpg');
    for (const [playerId, itemId, message] of [['p1', 'no-item', 'Unknown item'], ['nobody', 'gold', 'Unknown player'],
      ['p9', 'gold', 'Unknown player']]) {
      const res = await grant(playerId, itemId, 10);
      await expectAdminConforms(res.clone(), adjustSpec, 'post');
      const body = await expectError(res, 404, 'NOT_FOUND');
      expect(body.error.message).toBe(message);
    }
    expect(await snapshot()).toEqual([0, 0, 0]);
  });

  it('管理の付与は監査のログに前と後の残高が残る', async () => {
    await addPlayer('p1');
    expect((await grant('p1', 'gold', 120, { actor: 'ops.alice' })).status).toBe(200);
    expect((await adjust('p1', { itemId: 'gold', delta: -20, reason: '二重に配った分を戻す' })).status).toBe(200);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items).toHaveLength(2);
    expect(audit.items[0]).toMatchObject({ actor: 'local-admin', action: 'inventory.adjust', target: 'player:p1',
      before: { itemId: 'gold', amount: 120 }, after: { itemId: 'gold', amount: 100 }, reason: '二重に配った分を戻す' });
    expect(audit.items[1]).toMatchObject({ actor: 'ops.alice', action: 'inventory.adjust', target: 'player:p1',
      before: { itemId: 'gold', amount: 0 }, after: { itemId: 'gold', amount: 120 }, reason: '試験の修正' });
    // 鍵と中身のハッシュは監査の行の列に入る（応答には出さない）
    const rows = (await baseEnv.DB.prepare('SELECT request_key AS k, request_hash AS h FROM admin_audit_log ORDER BY audit_id')
      .all<{ k: string; h: string }>()).results;
    for (const r of rows) {
      expect(r.k).toMatch(/^[a-zA-Z0-9_-]{8,64}$/);
      expect(r.h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(JSON.stringify(audit)).not.toContain(rows[0].h);
  });
});

describe('O3 スコアを消す', () => {
  it('管理でスコアを消すとランキングから消え監査に前のスコアが残る', async () => {
    await registerGame(baseEnv.DB, game, ['rankings']);
    await addPlayer('p2');
    const score = baseEnv.DB.prepare('INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score) VALUES (?, ?, ?, ?, ?)');
    // p1 は game_players に無いプレイヤーの行（ランキングの行だけを見て消せる）
    await baseEnv.DB.batch([score.bind(game, 'boss-score', 'p1', 'Cheater', 99999), score.bind(game, 'boss-score', 'p2', 'Hero', 1200),
      score.bind(game, 'arena', 'p1', 'Cheater', 5)]);
    const res = await deleteScore('boss-score', 'p1');
    expect(res.status).toBe(200);
    const body = await expectAdminConforms(res, deleteSpec, 'delete');
    expect(body).toMatchObject({ gameId: game, boardId: 'boss-score', playerId: 'p1', deleted: true });
    const board = await (await worker.fetch(new Request(`${base}/v1/rankings/boss-score?gameId=${game}`), adminEnv as never))
      .json<{ items: Array<{ playerId: string }> }>();
    expect(board.items.map((i) => i.playerId)).toEqual(['p2']);
    // ほかのボードの行は残る
    expect(await countRows('ranking_entries')).toBe(2);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({ action: 'ranking.delete', target: 'ranking:boss-score:p1', actor: 'local-admin',
      before: { score: 99999, displayName: 'Cheater' }, after: null, reason: '不正なスコア' });
    expect(audit.items[0].auditId).toBe((body as { auditId: number }).auditId);
  });

  it('無いスコアを消すとNOT_FOUNDの404を返し監査に残さない', async () => {
    await baseEnv.DB.prepare("INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score) VALUES (?, 'boss-score', 'p1', 'Hero', 10)")
      .bind(game).run();
    for (const [boardId, playerId] of [['boss-score', 'p2'], ['arena', 'p1']]) {
      const res = await deleteScore(boardId, playerId);
      await expectAdminConforms(res.clone(), deleteSpec, 'delete');
      const body = await expectError(res, 404, 'NOT_FOUND');
      expect(body.error.message).toBe('Unknown ranking entry');
    }
    expect(await countRows('admin_audit_log')).toBe(0);
    // 2 回目は 404（もう無い）で、監査は 1 回目の 1 行だけ
    expect((await deleteScore('boss-score', 'p1')).status).toBe(200);
    await expectError(await deleteScore('boss-score', 'p1'), 404, 'NOT_FOUND');
    expect(await countRows('admin_audit_log')).toBe(1);
    expect(await countRows('ranking_entries')).toBe(0);
  });
});

// ---- O4 イベントの定義と管理コマンド ----

type EventResult = { gameId: string; eventId: string; kind: string; startsAt: string; endsAt: string; resetOffsetMinutes: number;
  rewards: Array<{ itemId: string; amount: number }> };
type ListedEvent = { eventId: string; kind: string; endsAt: string; rewards: Array<{ itemId: string; amount: number }>; claimed: boolean };
const itemSpec = '/v1/admin/items/{itemId}';
const eventSpec = '/v1/admin/events/{eventId}';
const isoAt = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** いま開いているデイリーのイベントの定義（1 時間前から 1 日後まで。報酬は gold 100）。 */
function openDefinition(overrides: Partial<EventDefinitionBody> = {}): EventDefinitionBody {
  const now = Math.floor(Date.now() / 1000);
  return { kind: 'daily', startsAt: isoAt(now - 3600), endsAt: isoAt(now + 86_400), resetOffsetMinutes: 0,
    rewards: [{ itemId: 'gold', amount: 100 }], reason: '試験のイベント', ...overrides };
}
/** 管理コマンドと同じ要求の形（scripts/admin-requests.mjs）で品目とイベントを入れる。 */
const putItem = (itemId: string, kind: string, gameId = game) =>
  worker.fetch(adminRequest(base, adminKey, putItemOp(itemId, kind, '試験の品目', gameId)), adminEnv as never);
const putEvent = (eventId: string, definition: EventDefinitionBody, gameId = game) =>
  worker.fetch(adminRequest(base, adminKey, putEventOp(eventId, definition, gameId)), adminEnv as never);
/** イベントと所持品を使う設定にして、ゲストを発行する（トークンを返す）。 */
async function eventGuest(): Promise<string> {
  await registerGame(baseEnv.DB, game, ['inventory', 'events']);
  const res = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: game }),
  }), adminEnv as never);
  expect(res.status).toBe(200);
  return (await res.json<{ token: string }>()).token;
}
async function listEvents(token: string): Promise<ListedEvent[]> {
  const res = await worker.fetch(new Request(`${base}${eventsPath(game)}`, { headers: authHeaders(token) }), adminEnv as never);
  expect(res.status).toBe(200);
  return (await res.json<{ items: ListedEvent[] }>()).items;
}
const claimEvent = (token: string, eventId: string) =>
  worker.fetch(new Request(`${base}${claimPath(eventId, game)}`, { method: 'POST', headers: authHeaders(token) }), adminEnv as never);
/** 何も書いていないことを見るための行（イベント・報酬・監査）。 */
async function eventSnapshot(): Promise<unknown[]> {
  return [
    (await baseEnv.DB.prepare('SELECT event_id, kind, starts_at, ends_at, reset_offset_minutes FROM events WHERE game_id = ? ORDER BY event_id')
      .bind(game).all()).results,
    (await baseEnv.DB.prepare('SELECT event_id, item_id, amount FROM event_rewards WHERE game_id = ? ORDER BY event_id, item_id')
      .bind(game).all()).results,
    await countRows('admin_audit_log'),
  ];
}

describe('O4 イベントの定義の関数', () => {
  it('イベントの定義の本文は期間と区切りと時差と報酬の行の数を確かめる', () => {
    expect(MAX_REWARD_LINES).toBe(10);
    const valid = { kind: 'daily', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', resetOffsetMinutes: 540,
      rewards: [{ itemId: 'gold', amount: 100 }] };
    expect(parseEventDefinition(valid)).toEqual({ ok: true, value: { kind: 'daily', startsAt: Date.parse(valid.startsAt) / 1000,
      endsAt: Date.parse(valid.endsAt) / 1000, resetOffsetMinutes: 540, rewards: [{ itemId: 'gold', amount: 100 }] } });
    const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ itemId: `item-${String(i).padStart(2, '0')}`, amount: 1 }));
    // 通る: 区切りの全部・時差の端・時差の無い本文（0）・ミリ秒（秒に丸める）・報酬の行の上限・amount の上限・報酬は品目の ID の昇順になる
    const passing: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ kind: 'once' }, { kind: 'once' }], [{ kind: 'weekly' }, { kind: 'weekly' }],
      [{ resetOffsetMinutes: -720 }, { resetOffsetMinutes: -720 }], [{ resetOffsetMinutes: 840 }, { resetOffsetMinutes: 840 }],
      [{ resetOffsetMinutes: undefined }, { resetOffsetMinutes: 0 }],
      [{ startsAt: '2026-11-01T00:00:00.999Z' }, { startsAt: Date.parse(valid.startsAt) / 1000 }],
      [{ rewards: lines(MAX_REWARD_LINES) }, { rewards: lines(MAX_REWARD_LINES) }],
      [{ rewards: [{ itemId: 'gold', amount: MAX_ITEM_AMOUNT }] }, { rewards: [{ itemId: 'gold', amount: MAX_ITEM_AMOUNT }] }],
      [{ rewards: [{ itemId: 'potion', amount: 2 }, { itemId: 'gold', amount: 1 }] },
        { rewards: [{ itemId: 'gold', amount: 1 }, { itemId: 'potion', amount: 2 }] }],
    ];
    for (const [change, expected] of passing) {
      const result = parseEventDefinition({ ...valid, ...change });
      expect(result.ok, JSON.stringify(change).slice(0, 80)).toBe(true);
      if (result.ok) expect(result.value).toMatchObject(expected);
    }
    // 外れ: 始まり ≥ 終わり（秒に丸めて同じも）・知らない区切り・時差の外・報酬 0 行と上限より 1 行多い・品目の重なり・amount の外・形の誤り
    const failing: Array<Record<string, unknown>> = [
      { endsAt: valid.startsAt }, { startsAt: valid.endsAt, endsAt: valid.startsAt },
      { startsAt: '2026-11-01T00:00:00.100Z', endsAt: '2026-11-01T00:00:00.900Z' },
      { kind: 'monthly' }, { kind: undefined }, { kind: 'Daily' },
      { resetOffsetMinutes: -721 }, { resetOffsetMinutes: 841 }, { resetOffsetMinutes: 1.5 }, { resetOffsetMinutes: '540' },
      { rewards: [] }, { rewards: lines(MAX_REWARD_LINES + 1) }, { rewards: undefined }, { rewards: { itemId: 'gold', amount: 1 } },
      { rewards: [{ itemId: 'gold', amount: 1 }, { itemId: 'gold', amount: 2 }] },
      { rewards: [{ itemId: 'gold', amount: 0 }] }, { rewards: [{ itemId: 'gold', amount: MAX_ITEM_AMOUNT + 1 }] },
      { rewards: [{ itemId: 'gold', amount: 1.5 }] }, { rewards: [{ itemId: 'bad id', amount: 1 }] }, { rewards: [null] },
      { startsAt: '2026-02-30T00:00:00Z' }, { startsAt: '2026-11-01 00:00:00' }, { startsAt: 1_793_491_200 }, { endsAt: undefined },
    ];
    for (const change of failing) {
      expect(parseEventDefinition({ ...valid, ...change }).ok, JSON.stringify(change).slice(0, 80)).toBe(false);
    }
  });
});

describe('O4 品目とイベントの定義', () => {
  it('管理の口で入れた品目とイベントがプレイヤーのイベントの一覧に出る', async () => {
    const token = await eventGuest();
    const item = await putItem('gem', 'currency');
    expect(item.status).toBe(200);
    expect(await expectAdminConforms(item, itemSpec, 'put')).toEqual({ gameId: game, itemId: 'gem', kind: 'currency' });
    const definition = openDefinition({ rewards: [{ itemId: 'gold', amount: 100 }, { itemId: 'gem', amount: 5 }] });
    const res = await putEvent('login', definition);
    expect(res.status).toBe(200);
    expect(await expectAdminConforms(res, eventSpec, 'put')).toEqual({ gameId: game, eventId: 'login', kind: 'daily',
      startsAt: definition.startsAt, endsAt: definition.endsAt, resetOffsetMinutes: 0,
      rewards: [{ itemId: 'gem', amount: 5 }, { itemId: 'gold', amount: 100 }] });
    const listed = (await listEvents(token)).find((e) => e.eventId === 'login');
    expect(listed).toMatchObject({ kind: 'daily', endsAt: definition.endsAt, claimed: false,
      rewards: [{ itemId: 'gem', amount: 5 }, { itemId: 'gold', amount: 100 }] });
    // 受け取ると品目が増える
    expect((await claimEvent(token, 'login')).status).toBe(200);
    const owned = await (await worker.fetch(new Request(`${base}${inventoryPath(game)}`, { headers: authHeaders(token) }), adminEnv as never))
      .json<{ currencies: Array<{ itemId: string; amount: number }> }>();
    expect(owned.currencies).toEqual([{ itemId: 'gem', amount: 5 }, { itemId: 'gold', amount: 100 }]);
    expect((await listEvents(token)).find((e) => e.eventId === 'login')?.claimed).toBe(true);
  });

  it('イベントの定義を入れ直すと報酬の中身が置き換わる', async () => {
    const token = await eventGuest();
    const definition = openDefinition({ rewards: [{ itemId: 'gold', amount: 100 }, { itemId: 'potion', amount: 1 }] });
    expect((await putEvent('login', definition)).status).toBe(200);
    const again = await putEvent('login', { ...definition, rewards: [{ itemId: 'potion', amount: 3 }] });
    expect(again.status).toBe(200);
    expect((await again.json<EventResult>()).rewards).toEqual([{ itemId: 'potion', amount: 3 }]);
    expect((await listEvents(token)).find((e) => e.eventId === 'login')?.rewards).toEqual([{ itemId: 'potion', amount: 3 }]);
    const rows = await baseEnv.DB.prepare('SELECT item_id AS itemId, amount FROM event_rewards WHERE game_id = ? AND event_id = ?')
      .bind(game, 'login').all();
    expect(rows.results).toEqual([{ itemId: 'potion', amount: 3 }]);
    // 受け取ると新しい中身だけが増える
    expect((await claimEvent(token, 'login')).status).toBe(200);
    expect(await (await worker.fetch(new Request(`${base}${inventoryPath(game)}`, { headers: authHeaders(token) }), adminEnv as never))
      .json()).toMatchObject({ currencies: [], items: [{ itemId: 'potion', amount: 3 }] });
  });

  it('受け取りのあるイベントの区切りと始まりと時差は変えられない', async () => {
    const token = await eventGuest();
    const definition = openDefinition();
    expect((await putEvent('login', definition)).status).toBe(200);
    // 受け取りの無いうちは区切りも変えられる
    expect((await putEvent('login', { ...definition, kind: 'weekly' })).status).toBe(200);
    expect((await putEvent('login', definition)).status).toBe(200);
    expect((await claimEvent(token, 'login')).status).toBe(200);
    const before = await eventSnapshot();
    const startsAt = isoAt(Date.parse(definition.startsAt) / 1000 - 60);
    for (const change of [{ kind: 'weekly' }, { kind: 'once' }, { startsAt }, { resetOffsetMinutes: 540 }]) {
      const res = await putEvent('login', { ...definition, ...change });
      await expectAdminConforms(res.clone(), eventSpec, 'put');
      await expectError(res, 400, 'INVALID_ARGUMENT');
    }
    expect(await eventSnapshot()).toEqual(before);
    // 終わりと報酬だけの変更は通り、一覧に出る
    const endsAt = isoAt(Date.parse(definition.endsAt) / 1000 + 86_400);
    const res = await putEvent('login', { ...definition, endsAt, rewards: [{ itemId: 'potion', amount: 2 }] });
    expect(res.status).toBe(200);
    expect((await listEvents(token)).find((e) => e.eventId === 'login')).toMatchObject({ endsAt, claimed: true,
      rewards: [{ itemId: 'potion', amount: 2 }] });
  });

  it('知らない品目を報酬にしたイベントの定義はNOT_FOUNDの404を返し何も書かない', async () => {
    await registerGame(baseEnv.DB, game, ['inventory', 'events']);
    const definition = openDefinition();
    expect((await putEvent('login', definition)).status).toBe(200);
    const before = await eventSnapshot();
    // 新しいイベントも、あるイベントの入れ直しも。demo-rpg にある品目でもこのゲームに無ければ知らない品目
    for (const [eventId, rewards] of [['login', [{ itemId: 'gold', amount: 1 }, { itemId: 'no-item', amount: 1 }]],
      ['fresh', [{ itemId: 'no-item', amount: 1 }]]] as const) {
      const res = await putEvent(eventId, { ...definition, rewards: [...rewards] });
      await expectAdminConforms(res.clone(), eventSpec, 'put');
      const body = await expectError(res, 404, 'NOT_FOUND');
      expect(body.error.message).toBe('Unknown item');
    }
    await baseEnv.DB.prepare("INSERT INTO inventory_items (game_id, item_id, kind) VALUES ('demo-rpg', 'demo-only', 'item')").run();
    await expectError(await putEvent('fresh', { ...definition, rewards: [{ itemId: 'demo-only', amount: 1 }] }), 404, 'NOT_FOUND');
    expect(await eventSnapshot()).toEqual(before);
  });

  it('品目の種類は後から変えられない', async () => {
    const res = await putItem('gold', 'item');
    await expectAdminConforms(res.clone(), itemSpec, 'put');
    await expectError(res, 400, 'INVALID_ARGUMENT');
    await expectError(await putItem('gem', 'weapon'), 400, 'INVALID_ARGUMENT');
    expect(await countRows('admin_audit_log')).toBe(0);
    const kind = () => baseEnv.DB.prepare('SELECT kind FROM inventory_items WHERE game_id = ? AND item_id = ?').bind(game, 'gold')
      .first<{ kind: string }>();
    expect((await kind())?.kind).toBe('currency');
    // 同じ種類なら何も変えずに 200（監査の行は残す）。無い品目は作る
    expect(await (await putItem('gold', 'currency')).json()).toEqual({ gameId: game, itemId: 'gold', kind: 'currency' });
    expect((await kind())?.kind).toBe('currency');
    expect((await putItem('sword', 'item')).status).toBe(200);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items.map((a) => [a.action, a.target, a.before, a.after])).toEqual([
      ['item.put', 'item:sword', null, { kind: 'item' }],
      ['item.put', 'item:gold', { kind: 'currency' }, { kind: 'currency' }],
    ]);
  });

  it('イベントの定義を入れると監査のログに前と後の定義が残る', async () => {
    await registerGame(baseEnv.DB, game, ['inventory', 'events']);
    const definition = openDefinition({ resetOffsetMinutes: 540, rewards: [{ itemId: 'potion', amount: 1 }, { itemId: 'gold', amount: 100 }] });
    expect((await putEvent('login', definition)).status).toBe(200);
    const changed = { ...definition, rewards: [{ itemId: 'gold', amount: 50 }], reason: '報酬を減らす' };
    expect((await putEvent('login', changed)).status).toBe(200);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    const first = { kind: 'daily', startsAt: definition.startsAt, endsAt: definition.endsAt, resetOffsetMinutes: 540,
      rewards: [{ itemId: 'gold', amount: 100 }, { itemId: 'potion', amount: 1 }] };
    expect(audit.items).toHaveLength(2);
    expect(audit.items[1]).toMatchObject({ actor: 'local-admin', action: 'event.put', target: 'event:login', before: null, after: first,
      reason: '試験のイベント' });
    expect(audit.items[0]).toMatchObject({ actor: 'local-admin', action: 'event.put', target: 'event:login', before: first,
      after: { ...first, rewards: [{ itemId: 'gold', amount: 50 }] }, reason: '報酬を減らす' });
  });
});

describe('O4 管理コマンド', () => {
  it('管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る', async () => {
    // scripts/admin-cli.mjs の smoke と同じ関数（runSmoke）に、HTTP の代わりに worker の fetch を渡す。期待と違えば runSmoke が投げる
    const steps: Array<[string, number]> = [];
    const result = await runSmoke({
      send: (request) => worker.fetch(request, adminEnv as never), baseUrl: base, adminKey,
      log: (step, status) => steps.push([step, status]),
    });
    expect(steps).toEqual([['guest', 200], ['player', 200], ['grant', 200], ['grant (same key)', 200], ['revoke', 200],
      ['revoke (too much)', 409], ['ban', 200], ['inventory (banned)', 403], ['unban', 200], ['inventory', 200], ['put-item', 200],
      ['put-event', 200], ['events', 200], ['audit', 200]]);
    expect(result.gameId).toBe('demo-rpg');
    const p = `player:${result.playerId}`;
    expect(result.audit.map((a) => [a.action, a.target, a.before, a.after])).toEqual([
      ['event.put', `event:${result.eventId}`, null, expect.objectContaining({ kind: 'daily', rewards: [{ itemId: result.itemId, amount: 5 }] })],
      ['item.put', `item:${result.itemId}`, null, { kind: 'currency' }],
      ['player.unban', p, expect.objectContaining({ reason: 'smoke: 止める', expiresAt: null }), null],
      ['player.ban', p, null, { reason: 'smoke: 止める', expiresAt: null }],
      ['inventory.adjust', p, { itemId: 'gold', amount: 50 }, { itemId: 'gold', amount: 30 }],
      ['inventory.adjust', p, { itemId: 'gold', amount: 0 }, { itemId: 'gold', amount: 50 }],
    ]);
    expect(result.audit.map((a) => a.action)).toEqual(SMOKE_AUDIT_ACTIONS);
    expect(result.audit.every((a) => a.actor === 'local-admin')).toBe(true);
    // 二重の付与と足りない取り消しは何も書かない（履歴は 2 行・残高 30）
    const ledger = await baseEnv.DB.prepare('SELECT delta FROM inventory_ledger WHERE game_id = ? AND player_id = ? ORDER BY entry_id')
      .bind('demo-rpg', result.playerId).all<{ delta: number }>();
    expect(ledger.results.map((r) => r.delta)).toEqual([50, -20]);
    const balance = await baseEnv.DB.prepare('SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?')
      .bind('demo-rpg', result.playerId, 'gold').first<{ amount: number }>();
    expect(balance?.amount).toBe(30);
    expect(await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM player_bans').first<{ n: number }>()).toEqual({ n: 0 });
  });
});

// ---- U3 プレイヤーデータの管理 ----

type PlayerDataBody = { values: Array<{ key: string; mode: string; value: number; updatedAt: string }>;
  achievements: Array<{ achievementId: string; unlockedAt: string; writeId: string }> };
const dataKeySpec = '/v1/admin/player-data/keys/{key}';
const achievementSpec = '/v1/admin/achievements/{achievementId}';
const dataSetSpec = '/v1/admin/players/{playerId}/player-data/{key}';
const revokeSpec = '/v1/admin/players/{playerId}/achievements/{achievementId}';
const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
/** 管理コマンドと同じ要求の形（scripts/admin-requests.mjs）で管理の口に送る。 */
const adminSend = (op: AdminOp, e: TestEnv = adminEnv) => worker.fetch(adminRequest(base, adminKey, op), e as never);
/** プレイヤーデータの表を消す（demo-rpg の手本のキーと実績は残す）。 */
async function resetPlayerData(): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM player_achievements'),
    baseEnv.DB.prepare('DELETE FROM player_data'),
    baseEnv.DB.prepare('DELETE FROM player_data_writes'),
    baseEnv.DB.prepare("DELETE FROM achievements WHERE NOT (game_id = 'demo-rpg' AND achievement_id IN ('first-slime', 'boss-1'))"),
    baseEnv.DB.prepare("DELETE FROM player_data_keys WHERE NOT (game_id = 'demo-rpg' "
      + "AND key IN ('slimes-defeated', 'highest-floor', 'chapter', 'boss-1-defeated'))"),
  ]);
}
/** adm-game の宣言: kills（add・上限 1000・1 回 100）・floor（max）・chapter（set）・boss（flag）と、kills が 10 以上で解ける実績 kill-10。 */
async function declareData(): Promise<void> {
  const key = baseEnv.DB.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)');
  await baseEnv.DB.batch([
    key.bind(game, 'kills', 'add', 1000, 100), key.bind(game, 'floor', 'max', 999, null), key.bind(game, 'chapter', 'set', 100, null),
    key.bind(game, 'boss', 'flag', 1, null),
    baseEnv.DB.prepare("INSERT INTO achievements (game_id, achievement_id, key, threshold) VALUES (?, 'kill-10', 'kills', 10)").bind(game),
  ]);
}
async function putValue(playerId: string, key: string, value: number, gameId = game): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO player_data (game_id, player_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)')
    .bind(gameId, playerId, key, value, Math.floor(Date.now() / 1000)).run();
}
async function putUnlocked(playerId: string, achievementId: string, writeRef: string): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO player_achievements (game_id, player_id, achievement_id, unlocked_at, write_ref) VALUES (?, ?, ?, ?, ?)')
    .bind(game, playerId, achievementId, Math.floor(Date.now() / 1000), writeRef).run();
}
async function valueOf(playerId: string, key: string): Promise<number | null> {
  const row = await baseEnv.DB.prepare('SELECT value FROM player_data WHERE game_id = ? AND player_id = ? AND key = ?')
    .bind(game, playerId, key).first<{ value: number }>();
  return row?.value ?? null;
}
const countOf = async (sql: string) => (await baseEnv.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
/** 何も書いていないことを見るための行（宣言・値・解いた実績・監査）。 */
async function dataSnapshot(): Promise<unknown[]> {
  const all = (sql: string) => baseEnv.DB.prepare(sql).all().then((r) => r.results);
  return [
    await all('SELECT game_id, key, mode, max_value, max_delta FROM player_data_keys ORDER BY game_id, key'),
    await all('SELECT game_id, achievement_id, key, threshold FROM achievements ORDER BY game_id, achievement_id'),
    await all('SELECT game_id, player_id, key, value FROM player_data ORDER BY game_id, player_id, key'),
    await all('SELECT game_id, player_id, achievement_id, unlocked_at FROM player_achievements ORDER BY game_id, player_id, achievement_id'),
    await countRows('admin_audit_log'),
  ];
}
/** プレイヤーデータを使う設定にして、ゲストを発行する。 */
async function dataGuest(): Promise<{ token: string; playerId: string }> {
  await registerGame(baseEnv.DB, game, ['player-data']);
  const res = await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId: game }),
  }), adminEnv as never);
  expect(res.status).toBe(200);
  return res.json<{ token: string; playerId: string }>();
}
/** ゲストのトークンでプレイヤーデータを書く（scripts/cli-requests.mjs の形。鍵は毎回新しく）。 */
const writeData = (token: string, key: string, value: number, gameId = game) =>
  worker.fetch(new Request(`${base}${playerDataPath(gameId)}`, {
    method: 'POST', headers: playerDataHeaders(token, crypto.randomUUID()), body: JSON.stringify(playerDataWrite(key, value)),
  }), adminEnv as never);

describe('U3 プレイヤーデータの管理', () => {
  beforeEach(async () => {
    await resetPlayerData();
    await declareData();
  });
  afterEach(resetPlayerData);

  it('管理の読み取りはプレイヤーデータの値と解いた実績を返す', async () => {
    await addPlayer('p1');
    await addPlayer('p2');
    await addPlayer('p3');
    await putValue('p1', 'kills', 12);
    await putValue('p1', 'chapter', 2);
    await putValue('p2', 'kills', 5);
    await putUnlocked('p1', 'kill-10', 'write-ref-1');
    const body = await (await adminSend(playerOp('p1', game))).json<{ playerData: PlayerDataBody }>();
    expect(body.playerData.values.map(({ updatedAt, ...v }) => ({ ...v, updatedAt: iso.test(updatedAt) }))).toEqual([
      { key: 'chapter', mode: 'set', value: 2, updatedAt: true }, { key: 'kills', mode: 'add', value: 12, updatedAt: true },
    ]);
    expect(body.playerData.achievements).toHaveLength(1);
    expect(body.playerData.achievements[0]).toMatchObject({ achievementId: 'kill-10', writeId: 'write-ref-1' });
    expect(body.playerData.achievements[0].unlockedAt).toMatch(iso);
    // ほかのプレイヤーの行は載らない。行の無い人は空の配列
    const other = await (await adminSend(playerOp('p2', game))).json<{ playerData: PlayerDataBody }>();
    expect(other.playerData.values.map((v) => [v.key, v.value])).toEqual([['kills', 5]]);
    expect(other.playerData.achievements).toEqual([]);
    expect((await (await adminSend(playerOp('p3', game))).json<{ playerData: PlayerDataBody }>()).playerData).toEqual({ values: [], achievements: [] });
    // 読み取りは監査に残さない
    expect(await countRows('admin_audit_log')).toBe(0);
  });

  it('管理の口で宣言したキーにプレイヤーが書ける', async () => {
    const { token } = await dataGuest();
    // 宣言の前は書けない
    await expectError(await writeData(token, 'gems-found', 5), 404, 'NOT_FOUND');
    const res = await adminSend(putDataKeyOp('gems-found', { mode: 'add', maxValue: 1000, maxDelta: 10 }, '宝石の数を数える', game));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gameId: game, key: 'gems-found', mode: 'add', maxValue: 1000, maxDelta: 10 });
    const written = await writeData(token, 'gems-found', 5);
    expect(written.status).toBe(200);
    expect((await written.json<{ values: unknown[] }>()).values).toEqual([{ key: 'gems-found', value: 5 }]);
    // 宣言の 1 回の増加の上限が効く
    await expectError(await writeData(token, 'gems-found', 11), 400, 'INVALID_ARGUMENT');
    // add でない書き方の宣言は maxDelta が null で返り、プレイヤーが書ける
    const flag = await adminSend(putDataKeyOp('door-opened', { mode: 'flag', maxValue: 1 }, '扉の印', game));
    expect(await flag.json()).toEqual({ gameId: game, key: 'door-opened', mode: 'flag', maxValue: 1, maxDelta: null });
    expect((await writeData(token, 'door-opened', 1)).status).toBe(200);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items.map((a) => [a.action, a.target, a.before, a.after])).toEqual([
      ['player-data-key.put', 'player-data-key:door-opened', null, { mode: 'flag', maxValue: 1, maxDelta: null }],
      ['player-data-key.put', 'player-data-key:gems-found', null, { mode: 'add', maxValue: 1000, maxDelta: 10 }],
    ]);
  });

  it('値のあるキーの書き方は変えられない', async () => {
    await addPlayer('p1');
    await putValue('p1', 'kills', 3);
    const before = await dataSnapshot();
    const res = await adminSend(putDataKeyOp('kills', { mode: 'set', maxValue: 1000 }, '書き方を変える', game));
    await expectAdminConforms(res.clone(), dataKeySpec, 'put');
    await expectError(res, 400, 'INVALID_ARGUMENT');
    // 本文の確かめ（表の CHECK と同じ決まり）も DB の前に断る
    for (const declaration of [{ mode: 'add', maxValue: 1000 }, { mode: 'set', maxValue: 10, maxDelta: 5 }, { mode: 'flag', maxValue: 2 },
      { mode: 'max', maxValue: 0 }, { mode: 'max', maxValue: 1_000_000_001 }, { mode: 'add', maxValue: 10, maxDelta: 0 }, { mode: 'count', maxValue: 10 }]) {
      await expectError(await adminSend(putDataKeyOp('kills', declaration, '外れ', game)), 400, 'INVALID_ARGUMENT');
    }
    expect(await dataSnapshot()).toEqual(before);
    // maxValue だけの変更は通る（前の値は消さない）
    const lowered = await adminSend(putDataKeyOp('kills', { mode: 'add', maxValue: 2, maxDelta: 1 }, '上限を下げる', game));
    expect(lowered.status).toBe(200);
    expect(await valueOf('p1', 'kills')).toBe(3);
    const row = await baseEnv.DB.prepare('SELECT mode, max_value AS maxValue, max_delta AS maxDelta FROM player_data_keys WHERE game_id = ? AND key = ?')
      .bind(game, 'kills').first();
    expect(row).toEqual({ mode: 'add', maxValue: 2, maxDelta: 1 });
    // 値の行の無いキーは書き方も変えられる
    expect((await adminSend(putDataKeyOp('floor', { mode: 'set', maxValue: 999 }, '書き方を変える', game))).status).toBe(200);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items.map((a) => [a.action, a.before, a.after])).toEqual([
      ['player-data-key.put', { mode: 'max', maxValue: 999, maxDelta: null }, { mode: 'set', maxValue: 999, maxDelta: null }],
      ['player-data-key.put', { mode: 'add', maxValue: 1000, maxDelta: 100 }, { mode: 'add', maxValue: 2, maxDelta: 1 }],
    ]);
    // 宣言は MAX_PLAYER_DATA_KEYS まで（あるキーの入れ直しは通る）
    const declared = await countOf(`SELECT COUNT(*) AS n FROM player_data_keys WHERE game_id = '${game}'`);
    const fill = baseEnv.DB.prepare("INSERT INTO player_data_keys (game_id, key, mode, max_value) VALUES (?, ?, 'set', 10)");
    await baseEnv.DB.batch(Array.from({ length: MAX_PLAYER_DATA_KEYS - declared }, (_, i) => fill.bind(game, `fill-${i}`)));
    const full = await dataSnapshot();
    await expectError(await adminSend(putDataKeyOp('one-more', { mode: 'set', maxValue: 10 }, '多すぎる', game)), 400, 'INVALID_ARGUMENT');
    expect(await dataSnapshot()).toEqual(full);
    expect((await adminSend(putDataKeyOp('fill-0', { mode: 'set', maxValue: 20 }, '入れ直す', game))).status).toBe(200);
  });

  it('宣言の無いキーを見る実績の宣言はNOT_FOUNDの404を返し何も書かない', async () => {
    const before = await dataSnapshot();
    for (const achievementId of ['fresh', 'kill-10']) {
      const res = await adminSend(putAchievementOp(achievementId, 'no-such-key', 1, '無いキー', game));
      await expectAdminConforms(res.clone(), achievementSpec, 'put');
      const body = await expectError(res, 404, 'NOT_FOUND');
      expect(body.error.message).toBe('Unknown key');
    }
    // demo-rpg にあるキーでもこのゲームに無ければ宣言の無いキー
    await expectError(await adminSend(putAchievementOp('fresh', 'slimes-defeated', 1, '別のゲームのキー', game)), 404, 'NOT_FOUND');
    expect(await dataSnapshot()).toEqual(before);
    // 宣言のあるキーなら入る
    const ok = await adminSend(putAchievementOp('boss-down', 'boss', 1, 'ボスの実績', game));
    expect(await ok.json()).toEqual({ gameId: game, achievementId: 'boss-down', key: 'boss', threshold: 1 });
  });

  it('管理でプレイヤーデータを直すと値が置き換わり監査に前と後が残る', async () => {
    await addPlayer('p1');
    await putValue('p1', 'kills', 50);
    const res = await adminSend(setDataOp('p1', 'kills', 0, '不正な連打の分を戻す', game));
    expect(res.status).toBe(200);
    const body = await res.json<{ auditId: number }>();
    expect(body).toMatchObject({ gameId: game, playerId: 'p1', key: 'kills', value: 0 });
    expect(await valueOf('p1', 'kills')).toBe(0);
    // 値の行が無いキーは前が null。書き方に関わらず 0〜maxValue（flag も 0 に戻せる）
    expect((await adminSend(setDataOp('p1', 'chapter', 7, '章を進める', game))).status).toBe(200);
    expect(await valueOf('p1', 'chapter')).toBe(7);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items).toHaveLength(2);
    expect(audit.items[1]).toMatchObject({ auditId: body.auditId, actor: 'local-admin', action: 'player-data.set', target: 'player:p1',
      before: { key: 'kills', value: 50 }, after: { key: 'kills', value: 0 }, reason: '不正な連打の分を戻す' });
    expect(audit.items[0]).toMatchObject({ action: 'player-data.set', before: null, after: { key: 'chapter', value: 7 } });
    // 外れは何も書かない: 無いプレイヤー・無いキー（404）・キーの上限の外・負・小数（400）
    const before = await dataSnapshot();
    expect((await expectError(await adminSend(setDataOp('nobody', 'kills', 1, 'x', game)), 404, 'NOT_FOUND')).error.message).toBe('Unknown player');
    expect((await expectError(await adminSend(setDataOp('p1', 'no-key', 1, 'x', game)), 404, 'NOT_FOUND')).error.message).toBe('Unknown key');
    for (const value of [1001, -1, 1.5]) await expectError(await adminSend(setDataOp('p1', 'kills', value, 'x', game)), 400, 'INVALID_ARGUMENT');
    await expectError(await adminSend(setDataOp('p1', 'boss', 2, 'x', game)), 400, 'INVALID_ARGUMENT');
    expect(await dataSnapshot()).toEqual(before);
  });

  it('管理で値を直しても実績は解けず取り消されない', async () => {
    await addPlayer('p1');
    await addPlayer('p2');
    // 閾値を超える値に直しても解けない
    expect((await adminSend(setDataOp('p1', 'kills', 20, '閾値を超える', game))).status).toBe(200);
    expect(await countOf('SELECT COUNT(*) AS n FROM player_achievements')).toBe(0);
    // 解いた人の値を 0 に直しても取り消されない
    await putValue('p2', 'kills', 12);
    await putUnlocked('p2', 'kill-10', 'write-ref-2');
    expect((await adminSend(setDataOp('p2', 'kills', 0, '戻す', game))).status).toBe(200);
    const rows = await baseEnv.DB.prepare('SELECT player_id AS playerId, achievement_id AS achievementId FROM player_achievements').all();
    expect(rows.results).toEqual([{ playerId: 'p2', achievementId: 'kill-10' }]);
  });

  it('管理で実績を取り消すと解いた行が消え監査に残る', async () => {
    const { token, playerId } = await dataGuest();
    const written = await writeData(token, 'kills', 10);
    const unlocked = (await written.json<{ unlocked: Array<{ achievementId: string; unlockedAt: string }> }>()).unlocked;
    expect(unlocked.map((u) => u.achievementId)).toEqual(['kill-10']);
    const res = await adminSend(revokeAchievementOp(playerId, 'kill-10', '不正な値で解けた', game));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ gameId: game, playerId, achievementId: 'kill-10', revoked: true });
    const read = await worker.fetch(new Request(`${base}${playerDataPath(game)}`, { headers: authHeaders(token) }), adminEnv as never);
    expect((await read.json<{ achievements: unknown[] }>()).achievements).toEqual([]);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items).toHaveLength(1);
    expect(audit.items[0]).toMatchObject({ actor: 'local-admin', action: 'achievement.revoke', target: `player:${playerId}`,
      before: { achievementId: 'kill-10', unlockedAt: unlocked[0].unlockedAt }, after: null, reason: '不正な値で解けた' });
    // 2 回目は 404 で監査が増えない
    const again = await adminSend(revokeAchievementOp(playerId, 'kill-10', '不正な値で解けた', game));
    expect((await expectError(again, 404, 'NOT_FOUND')).error.message).toBe('Unknown achievement');
    expect(await countRows('admin_audit_log')).toBe(1);
  });

  it('本番の設定ではプレイヤーデータの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    await addPlayer('p1');
    await putValue('p1', 'kills', 12);
    await putUnlocked('p1', 'kill-10', 'write-ref-1');
    const before = await dataSnapshot();
    const disabled: TestEnv = { ...baseEnv, APP_ENV: 'disabled', ADMIN_API_KEY: adminKey };
    for (const op of [putDataKeyOp('new-key', { mode: 'set', maxValue: 10 }, 'x', game), putAchievementOp('new-ach', 'kills', 1, 'x', game),
      setDataOp('p1', 'kills', 0, 'x', game), revokeAchievementOp('p1', 'kill-10', 'x', game)]) {
      await expectError(await adminSend(op, disabled), 403, 'NOT_READY_FOR_PRODUCTION');
    }
    expect(await dataSnapshot()).toEqual(before);
  });

  it('プレイヤーデータの管理の口の応答は管理のスキーマに合う', async () => {
    await addPlayer('p1');
    await putValue('p1', 'kills', 12);
    await putUnlocked('p1', 'kill-10', 'write-ref-1');
    const check = async (op: AdminOp, spec: string, method: 'put' | 'delete', status: number) => {
      const res = await adminSend(op);
      expect(res.status, `${op.method} ${op.path}`).toBe(status);
      await expectAdminConforms(res, spec, method);
    };
    // プレイヤーを読む口の 200（playerData がある）
    await expectConforms(await adminSend(playerOp('p1', game)), '/v1/admin/players/{playerId}');
    // キーの宣言: 200（add・set）・400（本文・値のあるキーの書き方）・404（ゲーム）
    await check(putDataKeyOp('gems', { mode: 'add', maxValue: 100, maxDelta: 5 }, 'x', game), dataKeySpec, 'put', 200);
    await check(putDataKeyOp('stage', { mode: 'set', maxValue: 100 }, 'x', game), dataKeySpec, 'put', 200);
    await check(putDataKeyOp('gems', { mode: 'flag', maxValue: 2 }, 'x', game), dataKeySpec, 'put', 400);
    await check(putDataKeyOp('kills', { mode: 'max', maxValue: 100 }, 'x', game), dataKeySpec, 'put', 400);
    await check(putDataKeyOp('gems', { mode: 'set', maxValue: 100 }, 'x', 'no-such-game'), dataKeySpec, 'put', 404);
    // 実績の宣言: 200・400（解いた人のいる実績のキー・閾値）・404（キー）
    await check(putAchievementOp('kill-10', 'kills', 20, 'x', game), achievementSpec, 'put', 200);
    await check(putAchievementOp('kill-10', 'gems', 20, 'x', game), achievementSpec, 'put', 400);
    await check(putAchievementOp('gem-1', 'gems', 0, 'x', game), achievementSpec, 'put', 400);
    await check(putAchievementOp('gem-1', 'no-key', 1, 'x', game), achievementSpec, 'put', 404);
    // 値を置く: 200・400・404
    await check(setDataOp('p1', 'kills', 0, 'x', game), dataSetSpec, 'put', 200);
    await check(setDataOp('p1', 'kills', 1001, 'x', game), dataSetSpec, 'put', 400);
    await check(setDataOp('nobody', 'kills', 1, 'x', game), dataSetSpec, 'put', 404);
    // 実績の取り消し: 200・400（reason）・404
    await check(revokeAchievementOp('p1', 'kill-10', '', game), revokeSpec, 'delete', 400);
    await check(revokeAchievementOp('p1', 'kill-10', 'x', game), revokeSpec, 'delete', 200);
    await check(revokeAchievementOp('p1', 'kill-10', 'x', game), revokeSpec, 'delete', 404);
  });

  it('管理コマンドと同じ流れでプレイヤーデータの宣言と直しと実績の取り消しが監査に残る', async () => {
    // scripts/admin-requests.mjs の関数で demo-rpg に宣言を入れ、scripts/cli-requests.mjs の形でゲストが書く
    const gameId = guestRequest().gameId;
    const stamp = Date.now().toString(36);
    const key = `admin-smoke-kills-${stamp}`;
    const achievementId = `admin-smoke-ach-${stamp}`;
    const steps: Array<[string, number]> = [];
    const step = async (name: string, res: Response) => {
      steps.push([name, res.status]);
      return res.json<Record<string, unknown>>();
    };
    expect(await step('put-data-key', await adminSend(putDataKeyOp(key, { mode: 'add', maxValue: 1000, maxDelta: 10 }, 'smoke: キー', gameId))))
      .toEqual({ gameId, key, mode: 'add', maxValue: 1000, maxDelta: 10 });
    expect(await step('put-achievement', await adminSend(putAchievementOp(achievementId, key, 3, 'smoke: 実績', gameId))))
      .toEqual({ gameId, achievementId, key, threshold: 3 });
    const guest = await step('guest', await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guestRequest()),
    }), adminEnv as never)) as { token: string; playerId: string };
    const written = await step('write', await writeData(guest.token, key, 3, gameId)) as { writeId: string; unlocked: Array<{ achievementId: string }> };
    expect(written.unlocked.map((u) => u.achievementId)).toEqual([achievementId]);
    const read = await step('player', await adminSend(playerOp(guest.playerId, gameId))) as { playerData: PlayerDataBody };
    expect(read.playerData.values.map((v) => [v.key, v.mode, v.value])).toEqual([[key, 'add', 3]]);
    expect(read.playerData.achievements.map((a) => [a.achievementId, a.writeId])).toEqual([[achievementId, written.writeId]]);
    expect(await step('set-data', await adminSend(setDataOp(guest.playerId, key, 0, 'smoke: 直す', gameId))))
      .toMatchObject({ gameId, playerId: guest.playerId, key, value: 0 });
    expect(await step('revoke-achievement', await adminSend(revokeAchievementOp(guest.playerId, achievementId, 'smoke: 取り消す', gameId))))
      .toMatchObject({ achievementId, revoked: true });
    const after = await step('player (after)', await adminSend(playerOp(guest.playerId, gameId))) as { playerData: PlayerDataBody };
    expect(after.playerData.values.map((v) => [v.key, v.value])).toEqual([[key, 0]]);
    expect(after.playerData.achievements).toEqual([]);
    const audit = await step('audit', await adminSend(auditOp(gameId, { limit: 4 }))) as { items: AuditItem[] };
    expect(steps).toEqual([['put-data-key', 200], ['put-achievement', 200], ['guest', 200], ['write', 200], ['player', 200], ['set-data', 200],
      ['revoke-achievement', 200], ['player (after)', 200], ['audit', 200]]);
    const p = `player:${guest.playerId}`;
    expect(audit.items.map((a) => [a.action, a.target, a.before, a.after])).toEqual([
      ['achievement.revoke', p, { achievementId, unlockedAt: expect.stringMatching(iso) }, null],
      ['player-data.set', p, { key, value: 3 }, { key, value: 0 }],
      ['achievement.put', `achievement:${achievementId}`, null, { key, threshold: 3 }],
      ['player-data-key.put', `player-data-key:${key}`, null, { mode: 'add', maxValue: 1000, maxDelta: 10 }],
    ]);
    expect(audit.items.every((a) => a.actor === 'local-admin')).toBe(true);
  });
});

// ---- Q3 クエストの管理 ----

type ListedQuest = { questId: string; kind: string; endsAt: string; key: string; threshold: number; progress: number; completed: boolean;
  claimed: boolean; periodKey: string; rewards: Array<{ itemId: string; amount: number }> };
type QuestClaimItem = { questId: string; periodKey: string; claimId: string; claimedAt: string };
const questSpec = '/v1/admin/quests/{questId}';
const nowSeconds = () => Math.floor(Date.now() / 1000);
/** いま開いている一度きりのクエストの定義（1 時間前から 1 日後まで。kills が 3 以上・報酬は gold 50）。 */
function questDefinition(overrides: Partial<QuestDefinitionBody> = {}): QuestDefinitionBody {
  const now = nowSeconds();
  return { kind: 'once', startsAt: isoAt(now - 3600), endsAt: isoAt(now + 86_400), resetOffsetMinutes: 0, key: 'kills', threshold: 3,
    rewards: [{ itemId: 'gold', amount: 50 }], reason: '試験のクエスト', ...overrides };
}
const putQuest = (questId: string, definition: QuestDefinitionBody, gameId = game, e: TestEnv = adminEnv) =>
  adminSend(putQuestOp(questId, definition, gameId), e);
/** クエストと区切りの表を消す（demo-rpg の手本のクエスト first-hunt・daily-slimes と slimes-defeated のデイリーの宣言は残す）。 */
async function resetQuests(): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM quest_claims'),
    baseEnv.DB.prepare('DELETE FROM player_data_period_values'),
    baseEnv.DB.prepare("DELETE FROM quests WHERE NOT (game_id = 'demo-rpg' AND quest_id IN ('first-hunt', 'daily-slimes'))"),
    baseEnv.DB.prepare("DELETE FROM player_data_key_periods WHERE NOT (game_id = 'demo-rpg' AND key = 'slimes-defeated' AND kind = 'daily')"),
  ]);
  await resetPlayerData();
}
/** クエスト・プレイヤーデータ・所持品を使う設定にして、ゲストを発行する。 */
async function questGuest(): Promise<{ token: string; playerId: string }> {
  await registerGame(baseEnv.DB, game, ['player-data', 'quests', 'inventory']);
  return dataGuest();
}
async function listQuests(token: string, gameId = game): Promise<ListedQuest[]> {
  const res = await worker.fetch(new Request(`${base}${questsPath(gameId)}`, { headers: authHeaders(token) }), adminEnv as never);
  expect(res.status).toBe(200);
  return (await res.json<{ items: ListedQuest[] }>()).items;
}
const claimQuest = (token: string, questId: string, gameId = game) =>
  worker.fetch(new Request(`${base}${questClaimPath(questId, gameId)}`, { method: 'POST', headers: authHeaders(token) }), adminEnv as never);
async function putClaim(playerId: string, questId: string, period: string, claimedAt: number, claimId = crypto.randomUUID()): Promise<string> {
  await baseEnv.DB.prepare('INSERT INTO quest_claims (game_id, player_id, quest_id, period_key, claim_id, claimed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(game, playerId, questId, period, claimId, claimedAt).run();
  return claimId;
}
async function putPeriodValue(playerId: string, key: string, kind: string, period: string, value: number): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO player_data_period_values (game_id, player_id, key, kind, period_key, value, updated_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?)').bind(game, playerId, key, kind, period, value, nowSeconds()).run();
}
async function periodValues(): Promise<unknown[]> {
  return (await baseEnv.DB.prepare('SELECT player_id AS playerId, key, kind, period_key AS periodKey, value FROM player_data_period_values '
    + 'WHERE game_id = ? ORDER BY player_id, key, kind, period_key').bind(game).all()).results;
}
async function keyPeriods(): Promise<unknown[]> {
  return (await baseEnv.DB.prepare('SELECT key, kind, reset_offset_minutes AS offsetMinutes FROM player_data_key_periods WHERE game_id = ? '
    + 'ORDER BY key, kind').bind(game).all()).results;
}
/** 何も書いていないことを見るための行（クエスト・報酬・区切りの宣言・監査）。 */
async function questSnapshot(): Promise<unknown[]> {
  const all = (sql: string) => baseEnv.DB.prepare(sql).bind(game).all().then((r) => r.results);
  return [
    await all('SELECT quest_id, kind, starts_at, ends_at, reset_offset_minutes, key, threshold FROM quests WHERE game_id = ? ORDER BY quest_id'),
    await all('SELECT quest_id, item_id, amount FROM quest_rewards WHERE game_id = ? ORDER BY quest_id, item_id'),
    await keyPeriods(),
    await countRows('admin_audit_log'),
  ];
}

describe('Q3 クエストの管理', () => {
  beforeEach(async () => {
    await resetQuests();
    await declareData();
  });
  afterEach(resetQuests);

  it('管理の口でクエストを定義するとプレイヤーの一覧に出て監査に前と後が残る', async () => {
    const { token } = await questGuest();
    const definition = questDefinition();
    const res = await putQuest('hunt', definition);
    expect(res.status).toBe(200);
    const first = { kind: 'once', startsAt: definition.startsAt, endsAt: definition.endsAt, resetOffsetMinutes: 0, key: 'kills', threshold: 3,
      rewards: [{ itemId: 'gold', amount: 50 }] };
    expect(await res.json()).toEqual({ gameId: game, questId: 'hunt', ...first });
    expect((await listQuests(token)).find((q) => q.questId === 'hunt')).toMatchObject({ kind: 'once', key: 'kills', threshold: 3, progress: 0,
      completed: false, claimed: false, rewards: [{ itemId: 'gold', amount: 50 }] });
    // 定義を変えてもう一度（閾値と報酬を置き換える）
    const changed = { ...definition, threshold: 5, rewards: [{ itemId: 'potion', amount: 2 }, { itemId: 'gold', amount: 10 }], reason: '閾値を上げる' };
    const again = await putQuest('hunt', changed);
    expect(again.status).toBe(200);
    const second = { ...first, threshold: 5, rewards: [{ itemId: 'gold', amount: 10 }, { itemId: 'potion', amount: 2 }] };
    expect(await again.json()).toEqual({ gameId: game, questId: 'hunt', ...second });
    expect((await listQuests(token)).find((q) => q.questId === 'hunt')).toMatchObject({ threshold: 5, rewards: second.rewards });
    const rows = await baseEnv.DB.prepare('SELECT item_id AS itemId, amount FROM quest_rewards WHERE game_id = ? AND quest_id = ? ORDER BY item_id')
      .bind(game, 'hunt').all();
    expect(rows.results).toEqual(second.rewards);
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items).toHaveLength(2);
    expect(audit.items[1]).toMatchObject({ actor: 'local-admin', action: 'quest.put', target: 'quest:hunt', before: null, after: first,
      reason: '試験のクエスト' });
    expect(audit.items[0]).toMatchObject({ actor: 'local-admin', action: 'quest.put', target: 'quest:hunt', before: first, after: second,
      reason: '閾値を上げる' });
  });

  it('宣言の無いキーか品目を使うクエストの定義はNOT_FOUNDの404を返し何も書かない', async () => {
    expect((await putQuest('hunt', questDefinition())).status).toBe(200);
    const before = await questSnapshot();
    // 新しいクエストも、あるクエストの入れ直しも。デイリーでも区切りの宣言を入れない。demo-rpg にあるキーでもこのゲームに無ければ宣言の無いキー
    for (const questId of ['hunt', 'fresh']) {
      for (const key of ['no-such-key', 'slimes-defeated']) {
        for (const kind of ['once', 'daily']) {
          const res = await putQuest(questId, questDefinition({ kind, key }));
          await expectAdminConforms(res.clone(), questSpec, 'put');
          expect((await expectError(res, 404, 'NOT_FOUND')).error.message).toBe('Unknown key');
        }
      }
      for (const rewards of [[{ itemId: 'no-item', amount: 1 }], [{ itemId: 'gold', amount: 1 }, { itemId: 'no-item', amount: 1 }]]) {
        const res = await putQuest(questId, questDefinition({ kind: 'daily', rewards }));
        await expectAdminConforms(res.clone(), questSpec, 'put');
        expect((await expectError(res, 404, 'NOT_FOUND')).error.message).toBe('Unknown item');
      }
    }
    expect(await questSnapshot()).toEqual(before);
  });

  it('受け取りのあるクエストの区切りと見るキーは変えられない', async () => {
    await baseEnv.DB.prepare("INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, 'steps', 'add', 1000, 100)")
      .bind(game).run();
    const definition = questDefinition();
    expect((await putQuest('hunt', definition)).status).toBe(200);
    // 受け取りの無いうちは区切りも見るキーも変えられる
    expect((await putQuest('hunt', { ...definition, kind: 'daily', key: 'steps' })).status).toBe(200);
    expect((await putQuest('hunt', definition)).status).toBe(200);
    await putClaim('p1', 'hunt', 'once', nowSeconds());
    const before = await questSnapshot();
    const startsAt = isoAt(Date.parse(definition.startsAt) / 1000 - 60);
    for (const change of [{ kind: 'daily' }, { kind: 'weekly' }, { startsAt }, { resetOffsetMinutes: 540 }, { key: 'steps' }]) {
      const res = await putQuest('hunt', { ...definition, ...change });
      await expectAdminConforms(res.clone(), questSpec, 'put');
      await expectError(res, 400, 'INVALID_ARGUMENT');
    }
    expect(await questSnapshot()).toEqual(before);
    // 終わり・閾値・報酬だけの変更は通る
    const endsAt = isoAt(Date.parse(definition.endsAt) / 1000 + 86_400);
    const res = await putQuest('hunt', { ...definition, endsAt, threshold: 7, rewards: [{ itemId: 'potion', amount: 2 }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ endsAt, threshold: 7, rewards: [{ itemId: 'potion', amount: 2 }] });
    const row = await baseEnv.DB.prepare('SELECT kind, key, threshold, ends_at AS endsAt FROM quests WHERE game_id = ? AND quest_id = ?')
      .bind(game, 'hunt').first();
    expect(row).toEqual({ kind: 'once', key: 'kills', threshold: 7, endsAt: Date.parse(endsAt) / 1000 });
  });

  it('デイリーのクエストの定義は増やすキーだけを受け付け区切りの数え方を宣言する', async () => {
    const { token } = await questGuest();
    const before = await questSnapshot();
    // add でないキー（set・max・flag）の区切りのあるクエストは 400
    for (const [kind, key] of [['daily', 'chapter'], ['weekly', 'floor'], ['daily', 'boss']]) {
      const res = await putQuest('daily-hunt', questDefinition({ kind, key, threshold: 1 }));
      await expectAdminConforms(res.clone(), questSpec, 'put');
      await expectError(res, 400, 'INVALID_ARGUMENT');
    }
    expect(await questSnapshot()).toEqual(before);
    // 一度きりのクエストは add でないキーも見られ、区切りの宣言を入れない
    expect((await putQuest('chapter-2', questDefinition({ key: 'chapter', threshold: 2 }))).status).toBe(200);
    expect(await keyPeriods()).toEqual([]);
    // add のキーのデイリーは通り、同じ batch で区切りの宣言が入る（入れ直しても 1 行）
    expect((await putQuest('daily-hunt', questDefinition({ kind: 'daily', resetOffsetMinutes: 540 }))).status).toBe(200);
    expect((await putQuest('daily-hunt', questDefinition({ kind: 'daily', resetOffsetMinutes: 540, threshold: 2 }))).status).toBe(200);
    expect(await keyPeriods()).toEqual([{ key: 'kills', kind: 'daily', offsetMinutes: 540 }]);
    expect((await putQuest('weekly-hunt', questDefinition({ kind: 'weekly' }))).status).toBe(200);
    expect(await keyPeriods()).toEqual([{ key: 'kills', kind: 'daily', offsetMinutes: 540 }, { key: 'kills', kind: 'weekly', offsetMinutes: 0 }]);
    // 宣言の後の書き込みから区切りの値が数えられ、一覧の進捗になる
    expect((await writeData(token, 'kills', 2)).status).toBe(200);
    const listed = await listQuests(token);
    expect(listed.find((q) => q.questId === 'daily-hunt')).toMatchObject({ kind: 'daily', progress: 2, completed: true,
      periodKey: periodKey('daily', nowSeconds(), 540) });
    expect(listed.find((q) => q.questId === 'weekly-hunt')).toMatchObject({ kind: 'weekly', progress: 2, completed: false });
  });

  it('時差の違う区切りを同じキーに宣言するクエストの定義は400を返す', async () => {
    expect((await putQuest('daily-a', questDefinition({ kind: 'daily', resetOffsetMinutes: 0 }))).status).toBe(200);
    const before = await questSnapshot();
    // 新しいクエストも、受け取りの無いクエストの時差の入れ直しも
    for (const questId of ['daily-b', 'daily-a']) {
      const res = await putQuest(questId, questDefinition({ kind: 'daily', resetOffsetMinutes: 540 }));
      await expectAdminConforms(res.clone(), questSpec, 'put');
      await expectError(res, 400, 'INVALID_ARGUMENT');
    }
    expect(await questSnapshot()).toEqual(before);
    // 同じ時差のデイリー・別の区切りの種類（週間）は通る
    expect((await putQuest('daily-b', questDefinition({ kind: 'daily', resetOffsetMinutes: 0 }))).status).toBe(200);
    expect((await putQuest('weekly-a', questDefinition({ kind: 'weekly', resetOffsetMinutes: 540 }))).status).toBe(200);
    expect(await keyPeriods()).toEqual([{ key: 'kills', kind: 'daily', offsetMinutes: 0 }, { key: 'kills', kind: 'weekly', offsetMinutes: 540 }]);
  });

  it('管理で値を下げるとデイリーのクエストの区切りの値も新しい値で頭打ちになる', async () => {
    const { token, playerId } = await questGuest();
    expect((await putQuest('daily-hunt', questDefinition({ kind: 'daily' }))).status).toBe(200);
    expect((await writeData(token, 'kills', 5)).status).toBe(200);
    const today = periodKey('daily', nowSeconds(), 0);
    const yesterday = periodKey('daily', nowSeconds() - 86_400, 0);
    // 前の区切りの行（1 は下がらない・4 は下がる）と、ほかのプレイヤーの行（変わらない）
    await putPeriodValue(playerId, 'kills', 'daily', yesterday, 4);
    await putPeriodValue(playerId, 'kills', 'daily', '2000-01-01', 1);
    await addPlayer('p-other');
    await putPeriodValue('p-other', 'kills', 'daily', today, 9);
    expect((await listQuests(token)).find((q) => q.questId === 'daily-hunt')).toMatchObject({ progress: 5, completed: true });
    const res = await adminSend(setDataOp(playerId, 'kills', 2, '不正な連打の分を戻す', game));
    expect(res.status).toBe(200);
    const valuesAfterLowering = [
      { playerId: 'p-other', key: 'kills', kind: 'daily', periodKey: today, value: 9 },
      ...[{ periodKey: '2000-01-01', value: 1 }, { periodKey: yesterday, value: 2 }, { periodKey: today, value: 2 }]
        .sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1)).map((v) => ({ playerId, key: 'kills', kind: 'daily', ...v })),
    ].sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
    expect(await periodValues()).toEqual(valuesAfterLowering);
    expect((await listQuests(token)).find((q) => q.questId === 'daily-hunt')).toMatchObject({ progress: 2, completed: false });
    // 上げる直しは区切りの値を上げない
    expect((await adminSend(setDataOp(playerId, 'kills', 10, '戻しすぎを直す', game))).status).toBe(200);
    expect(await valueOf(playerId, 'kills')).toBe(10);
    expect(await periodValues()).toEqual(valuesAfterLowering);
    expect((await listQuests(token)).find((q) => q.questId === 'daily-hunt')).toMatchObject({ progress: 2, completed: false });
    // 監査の前と後は合計の値のまま
    const audit = await (await adminGet(auditPath())).json<AuditBody>();
    expect(audit.items.map((a) => [a.action, a.before, a.after])).toEqual([
      ['player-data.set', { key: 'kills', value: 2 }, { key: 'kills', value: 10 }],
      ['player-data.set', { key: 'kills', value: 5 }, { key: 'kills', value: 2 }],
      ['quest.put', null, expect.objectContaining({ kind: 'daily', key: 'kills' })],
    ]);
  });

  it('クエストの定義が上限の数を超えると400を返す', async () => {
    expect(MAX_QUESTS).toBe(200);
    const now = nowSeconds();
    const fill = baseEnv.DB.prepare("INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, key, threshold) VALUES (?, ?, 'once', ?, ?, 'kills', 1)");
    await baseEnv.DB.batch(Array.from({ length: MAX_QUESTS }, (_, i) => fill.bind(game, `fill-${i}`, now - 3600, now + 86_400)));
    const before = await questSnapshot();
    const res = await putQuest('one-more', questDefinition());
    await expectAdminConforms(res.clone(), questSpec, 'put');
    await expectError(res, 400, 'INVALID_ARGUMENT');
    expect(await questSnapshot()).toEqual(before);
    // あるクエストの置き換えは通る
    expect((await putQuest('fill-0', questDefinition({ threshold: 2 }))).status).toBe(200);
  });

  it('管理の読み取りはプレイヤーのクエストの受け取りを新しい順に返す', async () => {
    const now = nowSeconds();
    for (const [questId, kind] of [['q-a', 'once'], ['q-b', 'once'], ['q-d', 'daily']]) {
      expect((await putQuest(questId, questDefinition({ kind }))).status).toBe(200);
    }
    await addPlayer('p1');
    await addPlayer('p2');
    await addPlayer('p3');
    const a = await putClaim('p1', 'q-a', 'once', now - 100);
    const d1 = await putClaim('p1', 'q-d', '2026-10-29', now - 50);
    const d2 = await putClaim('p1', 'q-d', '2026-10-30', now - 10);
    // 同じ秒の受け取りは後に入れたほうが先
    const b = await putClaim('p1', 'q-b', 'once', now - 10);
    await putClaim('p2', 'q-a', 'once', now);
    const res = await adminSend(playerOp('p1', game));
    const body = await expectConforms(res, '/v1/admin/players/{playerId}') as { questClaims: QuestClaimItem[] };
    expect(body.questClaims).toEqual([
      { questId: 'q-b', periodKey: 'once', claimId: b, claimedAt: isoAt(now - 10) },
      { questId: 'q-d', periodKey: '2026-10-30', claimId: d2, claimedAt: isoAt(now - 10) },
      { questId: 'q-d', periodKey: '2026-10-29', claimId: d1, claimedAt: isoAt(now - 50) },
      { questId: 'q-a', periodKey: 'once', claimId: a, claimedAt: isoAt(now - 100) },
    ]);
    // 受け取りの無い人は空の配列
    expect((await (await adminSend(playerOp('p3', game))).json<{ questClaims: unknown[] }>()).questClaims).toEqual([]);
    // 新しい順に 20 件まで
    for (let i = 0; i < 22; i++) await putClaim('p3', 'q-d', `2026-09-${String(i + 1).padStart(2, '0')}`, now - 1000 + i);
    const many = (await (await adminSend(playerOp('p3', game))).json<{ questClaims: QuestClaimItem[] }>()).questClaims;
    expect(many.map((c) => c.periodKey)).toEqual(Array.from({ length: 20 }, (_, i) => `2026-09-${String(22 - i).padStart(2, '0')}`));
    // 読み取りは監査に残さない（定義の 3 行だけ）
    expect(await countRows('admin_audit_log')).toBe(3);
  });

  it('本番の設定ではクエストの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    expect((await putQuest('hunt', questDefinition())).status).toBe(200);
    const before = await questSnapshot();
    const disabled: TestEnv = { ...baseEnv, APP_ENV: 'disabled', ADMIN_API_KEY: adminKey };
    for (const [questId, definition] of [['hunt', questDefinition({ threshold: 9 })], ['fresh', questDefinition({ kind: 'daily' })]] as const) {
      const res = await putQuest(questId, definition, game, disabled);
      await expectAdminConforms(res.clone(), questSpec, 'put');
      await expectError(res, 403, 'NOT_READY_FOR_PRODUCTION');
    }
    expect(await questSnapshot()).toEqual(before);
  });

  it('クエストの管理の口の応答は管理のスキーマに合う', async () => {
    const check = async (questId: string, definition: QuestDefinitionBody, status: number, gameId = game) => {
      const res = await putQuest(questId, definition, gameId);
      expect(res.status, `${questId} ${JSON.stringify(definition).slice(0, 80)}`).toBe(status);
      await expectAdminConforms(res, questSpec, 'put');
    };
    // 200（一度きり・デイリー）
    await check('hunt', questDefinition(), 200);
    await check('daily-hunt', questDefinition({ kind: 'daily', resetOffsetMinutes: 540 }), 200);
    // 400（閾値・キーの形・区切りのあるクエストの add でないキー・時差の違う区切り・reason）
    await check('hunt', questDefinition({ threshold: 0 }), 400);
    await check('hunt', questDefinition({ threshold: 1_000_000_001 }), 400);
    await check('hunt', questDefinition({ key: 'bad key' }), 400);
    await check('hunt', questDefinition({ kind: 'weekly', key: 'chapter' }), 400);
    await check('other', questDefinition({ kind: 'daily' }), 400);
    await check('hunt', questDefinition({ reason: '' }), 400);
    // 404（キー・品目・ゲーム）
    await check('hunt', questDefinition({ key: 'no-key' }), 404);
    await check('hunt', questDefinition({ rewards: [{ itemId: 'no-item', amount: 1 }] }), 404);
    await check('hunt', questDefinition(), 404, 'no-such-game');
    // プレイヤーを読む口の 200（questClaims がある）
    await addPlayer('p1');
    await putClaim('p1', 'hunt', 'once', nowSeconds());
    const body = await expectConforms(await adminSend(playerOp('p1', game)), '/v1/admin/players/{playerId}') as { questClaims: unknown[] };
    expect(body.questClaims).toHaveLength(1);
  });

  it('管理コマンドと同じ流れでクエストの定義と受け取りが監査と受領の履歴に残る', async () => {
    // scripts/admin-requests.mjs の関数で demo-rpg にデイリーのクエストを入れ、scripts/cli-requests.mjs の形でゲストが書いて受け取る
    const gameId = guestRequest().gameId;
    const questId = `admin-smoke-quest-${Date.now().toString(36)}`;
    const steps: Array<[string, number]> = [];
    const step = async (name: string, res: Response) => {
      steps.push([name, res.status]);
      return res.json<Record<string, unknown>>();
    };
    const definition = questDefinition({ kind: 'daily', key: 'slimes-defeated', threshold: 2, rewards: [{ itemId: 'gold', amount: 20 }],
      reason: 'smoke: クエスト' });
    expect(await step('put-quest', await adminSend(putQuestOp(questId, definition, gameId)))).toMatchObject({ gameId, questId, kind: 'daily',
      key: 'slimes-defeated', threshold: 2, rewards: [{ itemId: 'gold', amount: 20 }] });
    const guest = await step('guest', await worker.fetch(new Request(`${base}/v1/accounts/guest`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(guestRequest()),
    }), adminEnv as never)) as { token: string; playerId: string };
    expect((await step('write', await writeData(guest.token, 'slimes-defeated', 2, gameId)))).toMatchObject({ values: [{ key: 'slimes-defeated', value: 2 }] });
    const listed = await listQuests(guest.token, gameId);
    expect(listed.find((q) => q.questId === questId)).toMatchObject({ progress: 2, completed: true, claimed: false });
    const claimed = await step('claim', await claimQuest(guest.token, questId, gameId)) as { claimId: string };
    const read = await step('player', await adminSend(playerOp(guest.playerId, gameId))) as {
      questClaims: QuestClaimItem[]; history: Array<{ itemId: string; delta: number; sourceType: string; sourceId: string }> };
    expect(read.questClaims).toEqual([{ questId, periodKey: periodKey('daily', nowSeconds(), 0), claimId: claimed.claimId,
      claimedAt: expect.stringMatching(iso) }]);
    expect(read.history.filter((h) => h.sourceType === LEDGER_SOURCES.questClaim))
      .toEqual([expect.objectContaining({ itemId: 'gold', delta: 20, sourceType: 'quest-claim', sourceId: claimed.claimId })]);
    const audit = await step('audit', await adminSend(auditOp(gameId, { limit: 1 }))) as { items: AuditItem[] };
    expect(steps).toEqual([['put-quest', 200], ['guest', 200], ['write', 200], ['claim', 200], ['player', 200], ['audit', 200]]);
    expect(audit.items.map((a) => [a.actor, a.action, a.target, a.before, a.reason])).toEqual([
      ['local-admin', 'quest.put', `quest:${questId}`, null, 'smoke: クエスト'],
    ]);
    expect(audit.items[0].after).toMatchObject({ kind: 'daily', key: 'slimes-defeated', threshold: 2 });
  });
});
