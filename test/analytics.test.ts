/**
 * 分析 N1: 「遊んだ」の印（表 player_activity_days・src/core/activity.ts の activityDay と consumeForPlayer・ゲストの発行の is_new の行）と、
 * 管理の集計の口（GET /v1/admin/analytics/players・src/core/analytics.ts）と、管理コマンドの要求の形（scripts/admin-requests.mjs の
 * analyticsPlayersOp）の試験と、分析 N3: 管理の配った量の口（GET /v1/admin/analytics/grants・src/core/analytics.ts の shapeGrants）と
 * 管理コマンドの要求の形（analyticsGrantsOp）の試験。名前と期待する結果の正は docs/guides/working/analytics-design.md §10 の N1・N3 の行。
 * L1 は関数を直に呼ぶ（now を渡す。時計を動かさない）。L2 は src/worker.ts の default.fetch を直に呼ぶ。過去の日の行は表に直に入れる。
 * 試験のゲームは専用の analytics-game（全部の機能を使う設定）。beforeEach で利用制限の数と遊んだ行を消す。N3 は受領の履歴と受け取りの行を
 * 表に直に入れ（ほかのゲームの行は analytics-other）、N3 の beforeEach で 2 つのゲームの行を消す。
 * 管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { activityDay } from '../src/core/activity';
import {
  addDays, fillDays, grantsSql, MAX_ANALYTICS_RANGE_DAYS, MAX_ANALYTICS_ROWS, parseAnalyticsRange, questClaimsSql, retentionCell, shapeGrants,
  type GrantRow, type QuestClaimCountRow,
} from '../src/core/analytics';
import { windowStart } from '../src/core/rate-limit';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import adminSpecJson from '../openapi/rpg-online-admin.v1.json';
import {
  adminRequest, analyticsGrantsOp, analyticsPlayersOp, retentionRates, type AnalyticsGrantsBody, type AnalyticsPlayersBody,
} from '../scripts/admin-requests.mjs';
import { authHeaders, claimPath, guestRequest, inventoryPath, SMOKE_EVENT_ID } from '../scripts/cli-requests.mjs';
import { tokenFor } from './support/auth';
import { registerGame } from './support/games';
import { fillRateLimit, resetRateLimits } from './support/rate-limits';
import { validate, type Schema, type SchemaRoot } from './support/schema-check';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const adminEnv: TestEnv = { ...localEnv, ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'analytics-game';
const modules = ['announcements', 'rankings', 'saves', 'config', 'inventory', 'events', 'player-data', 'quests'];

type ErrorBody = { error: { code: string; message: string } };
type ResponseSpec = { headers?: Record<string, { required?: boolean; schema: Schema }>; content?: Record<string, { schema: Schema }>;
  'x-error-codes'?: string[] };
type AdminSpec = SchemaRoot & { paths: Record<string, Record<string, { responses: Record<string, ResponseSpec> }>> };
const adminSpec = adminSpecJson as unknown as AdminSpec;
const specPath = '/v1/admin/analytics/players';

const nowSeconds = () => Math.floor(Date.now() / 1000);
const today = () => activityDay(nowSeconds());
const analyticsPath = (from: string, to: string, gameId = game) => `${specPath}?gameId=${gameId}&from=${from}&to=${to}`;

function adminGet(path: string, options: { e?: TestEnv; authorization?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  const authorization = options.authorization === undefined ? `Bearer ${adminKey}` : options.authorization;
  if (authorization !== null) headers.authorization = authorization;
  return worker.fetch(new Request(`${base}${path}`, { headers }), (options.e ?? adminEnv) as never);
}
function send(path: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${base}${path}`, init), localEnv as never);
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
/** 管理のスキーマの集計の口（既定は遊んだ人の口）の、その状態の形に応答を当てる。 */
async function expectConforms(res: Response, path = specPath): Promise<unknown> {
  const r = adminSpec.paths[path].get.responses[String(res.status)];
  expect(r, `${path} の応答に状態 ${res.status} がある`).toBeDefined();
  for (const [name, h] of Object.entries(r.headers ?? {})) {
    const value = res.headers.get(name);
    if (h.required) expect(value, `ヘッダー ${name} がある`).not.toBeNull();
    if (value !== null) expect(validate(value, h.schema, adminSpec), `ヘッダー ${name}`).toEqual([]);
  }
  const body = await res.json();
  expect(validate(body, r.content!['application/json'].schema, adminSpec), `${path} ${res.status} の本文`).toEqual([]);
  const codes = r['x-error-codes'];
  if (codes) expect(codes).toContain((body as ErrorBody).error.code);
  return body;
}
async function activityRows(gameId = game): Promise<Array<{ day: string; player_id: string; is_new: number }>> {
  return (await baseEnv.DB.prepare('SELECT day, player_id, is_new FROM player_activity_days WHERE game_id = ? ORDER BY day, player_id')
    .bind(gameId).all<{ day: string; player_id: string; is_new: number }>()).results;
}
async function countAll(table: string): Promise<number> {
  return (await baseEnv.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;
}
async function addActivity(day: string, playerId: string, isNew = 0, gameId = game): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO player_activity_days (game_id, day, player_id, is_new) VALUES (?, ?, ?, ?)')
    .bind(gameId, day, playerId, isNew).run();
}
async function auth(playerId: string): Promise<Record<string, string>> {
  return authHeaders(await tokenFor(game, playerId));
}

beforeEach(async () => {
  await registerGame(baseEnv.DB, game, modules);
  await resetRateLimits(baseEnv.DB);
  await baseEnv.DB.prepare('DELETE FROM player_activity_days').run();
});

describe('N1 L1: 日の鍵と集計の関数', () => {
  it('遊んだ日の鍵はサーバーの時刻のUTCの日付', () => {
    const lastSecond = Date.UTC(2026, 9, 31, 23, 59, 59) / 1000;
    expect(activityDay(lastSecond)).toBe('2026-10-31');
    expect(activityDay(lastSecond + 1)).toBe('2026-11-01');
    // 日本の 0 時（UTC の 15 時）では日付が変わらない（時差を入れない）
    expect(activityDay(Date.UTC(2026, 9, 31, 15, 0, 0) / 1000)).toBe('2026-10-31');
  });

  it('集計の日の範囲は形と順と上限日数と今日までを確かめる', () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0) / 1000;
    const range = (query: string) => parseAnalyticsRange(new URL(`${base}${specPath}?gameId=${game}&${query}`), now);
    expect(MAX_ANALYTICS_RANGE_DAYS).toBe(92);
    // 92 日（両端を含む）までは通る
    expect(range('from=2026-08-01&to=2026-10-31')).toEqual({ ok: true, value: { from: '2026-08-01', to: '2026-10-31' } });
    expect(range('from=2026-10-31&to=2026-10-31')).toEqual({ ok: true, value: { from: '2026-10-31', to: '2026-10-31' } });
    const refused: Array<[string, RegExp]> = [
      ['to=2026-10-31', /from/],
      ['from=2026-10-01', /to/],
      ['from=2026-10-1&to=2026-10-31', /from/],
      ['from=2026-02-30&to=2026-03-01', /from/],
      ['from=2026-10-01&to=20261031', /to/],
      ['from=2026-10-31&to=2026-10-30', /after to/],
      ['from=2026-07-31&to=2026-10-31', /92 days/],
      ['from=2026-10-31&to=2026-11-01', /today/],
    ];
    for (const [query, why] of refused) {
      const result = range(query);
      expect(result.ok, query).toBe(false);
      if (!result.ok) expect(result.message, query).toMatch(why);
    }
  });

  it('集計の日の並びは数の無い日を0で埋める', () => {
    const days = fillDays('2026-10-29', '2026-11-02', [
      { day: '2026-10-29', active_players: 3, new_players: 1 },
      { day: '2026-11-01', active_players: 2, new_players: 0 },
    ]);
    expect(days).toEqual([
      { date: '2026-10-29', activePlayers: 3, newPlayers: 1 },
      { date: '2026-10-30', activePlayers: 0, newPlayers: 0 },
      { date: '2026-10-31', activePlayers: 0, newPlayers: 0 },
      { date: '2026-11-01', activePlayers: 2, newPlayers: 0 },
      { date: '2026-11-02', activePlayers: 0, newPlayers: 0 },
    ]);
  });

  it('継続の数はまだ来ていない日をnullにする', () => {
    expect(retentionCell('2026-10-01', '2026-10-31', 7, 4)).toBe(4);
    expect(retentionCell('2026-10-01', '2026-10-31', 30, 2)).toBe(2);
    expect(retentionCell('2026-10-02', '2026-10-31', 30, 0)).toBeNull();
    expect(retentionCell('2026-10-31', '2026-10-31', 1, 0)).toBeNull();
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});

describe('N1 L2: 遊んだ行の記録', () => {
  it('ゲストを発行するとその日の遊んだ行が新しい人として1行入る', async () => {
    const res = await send('/v1/accounts/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: game }) });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, unknown>>();
    // 応答は今と同じ形
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'gameId', 'playerId', 'token']);
    expect(await activityRows()).toEqual([{ day: today(), player_id: body.playerId, is_new: 1 }]);
  });

  it('トークンの要る要求を同じ日に何回送っても遊んだ行は1人1行', async () => {
    const guest = await send('/v1/accounts/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: game }) });
    const { playerId, token } = await guest.json<{ playerId: string; token: string }>();
    const headers = authHeaders(token);
    for (const path of ['/v1/inventory', '/v1/player-data', '/v1/quests', '/v1/inventory', '/v1/player-data']) {
      expect((await send(`${path}?gameId=${game}`, { headers })).status, path).toBe(200);
    }
    // 発行の日なので is_new = 1 のまま
    expect(await activityRows()).toEqual([{ day: today(), player_id: playerId, is_new: 1 }]);
  });

  it('トークンの要る6つの機能の口はどれも遊んだ行を残す', async () => {
    const calls: Array<[string, (headers: Record<string, string>) => Promise<Response>]> = [
      ['saves', (headers) => send(`/v1/saves?gameId=${game}`, { headers })],
      ['rankings', (headers) => send('/v1/rankings/boss-score', { method: 'POST', headers,
        body: JSON.stringify({ gameId: game, playerId: 'act-rankings', displayName: 'Act', score: 10 }) })],
      ['inventory', (headers) => send(`/v1/inventory?gameId=${game}`, { headers })],
      ['events', (headers) => send(`/v1/events?gameId=${game}`, { headers })],
      ['player-data', (headers) => send(`/v1/player-data?gameId=${game}`, { headers })],
      ['quests', (headers) => send(`/v1/quests?gameId=${game}`, { headers })],
    ];
    for (const [name, call] of calls) {
      expect((await call(await auth(`act-${name}`))).status, name).toBe(200);
    }
    expect(await activityRows()).toEqual(calls.map(([name]) => ({ day: today(), player_id: `act-${name}`, is_new: 0 }))
      .sort((a, b) => a.player_id.localeCompare(b.player_id)));
  });

  it('トークンの無い要求と外れたトークンは遊んだ行を残さない', async () => {
    const forged = authHeaders(await tokenFor(game, 'act-forged', { secret: 'x'.repeat(64) }));
    const expired = authHeaders(await tokenFor(game, 'act-expired', { exp: nowSeconds() - 1 }));
    for (const headers of [{}, forged, expired] as Array<Record<string, string>>) {
      expect((await send(`/v1/inventory?gameId=${game}`, { headers })).status).toBe(401);
    }
    // 登録の無いゲームのトークンは、今までどおり 404 で行を残さない
    const unknown = authHeaders(await tokenFor('no-such-game', 'act-unknown'));
    expect((await send('/v1/inventory?gameId=no-such-game', { headers: unknown })).status).toBe(404);
    expect((await send(`/v1/announcements?gameId=${game}`)).status).toBe(200);
    expect(await countAll('player_activity_days')).toBe(0);
  });

  it('利用制限で断られた要求も遊んだ行を残し制限の数え方は変わらない', async () => {
    const playerId = 'act-limited';
    const subject = `${game}:${playerId}`;
    await fillRateLimit(baseEnv.DB, RATE_LIMITS.rewards, subject);
    const res = await send(`/v1/inventory?gameId=${game}`, { headers: await auth(playerId) });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toMatch(/^[1-9][0-9]*$/);
    expect(await activityRows()).toEqual([{ day: today(), player_id: playerId, is_new: 0 }]);
    // 鍵と行は今のまま。いまの窓の数が 1 増える（窓の境目をまたいだら、新しい窓の数が上限の次になる）
    const start = windowStart(nowSeconds(), RATE_LIMITS.rewards.period);
    const row = await baseEnv.DB.prepare('SELECT count FROM rate_limit_counters WHERE scope = ? AND subject = ? AND window_start = ?')
      .bind(RATE_LIMITS.rewards.scope, subject, start).first<{ count: number }>();
    expect(row?.count).toBe(RATE_LIMITS.rewards.limit + 1);
  });
});

describe('N1 L2: 管理の集計の口', () => {
  it('管理の集計はその日の遊んだ人と新しい人の数を返しプレイヤーIDを返さない', async () => {
    const t = today();
    const d = (n: number) => addDays(t, n);
    const ids = ['secret-player-a', 'secret-player-b', 'secret-player-c'];
    await addActivity(d(-3), ids[0], 1);
    await addActivity(d(-3), ids[1], 1);
    await addActivity(d(-3), ids[2]);
    await addActivity(d(-2), ids[0]);
    await addActivity(t, ids[1]);
    await addActivity(t, ids[2], 1);
    // ほかのゲームの行は数えない
    await addActivity(t, 'other-player', 1, 'demo-rpg');
    const res = await adminGet(analyticsPath(d(-3), t));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const id of [...ids, 'other-player']) expect(text).not.toContain(id);
    const body = JSON.parse(text) as AnalyticsPlayersBody;
    expect(body).toMatchObject({ gameId: game, from: d(-3), to: t, timezone: 'UTC' });
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.days).toEqual([
      { date: d(-3), activePlayers: 3, newPlayers: 2 },
      { date: d(-2), activePlayers: 1, newPlayers: 0 },
      { date: d(-1), activePlayers: 0, newPlayers: 0 },
      { date: t, activePlayers: 2, newPlayers: 1 },
    ]);
  });

  it('管理の集計は発行の日ごとにD1とD7とD30に戻った人の数を返す', async () => {
    const t = today();
    const cohort = addDays(t, -31);
    const players = ['c1', 'c2', 'c3', 'c4'];
    for (const p of players) await addActivity(cohort, p, 1);
    await addActivity(addDays(cohort, 1), 'c1');
    await addActivity(addDays(cohort, 1), 'c2');
    await addActivity(addDays(cohort, 7), 'c1');
    await addActivity(addDays(cohort, 30), 'c3');
    // 31 日目（今日）の行は D30 に数えない。2 日目の行は D1 に数えない
    await addActivity(addDays(cohort, 31), 'c4');
    await addActivity(addDays(cohort, 2), 'c4');
    // 昨日の新しい人は D1 が今日（決まる）、D7・D30 はまだ来ていない
    await addActivity(addDays(t, -1), 'y1', 1);
    const res = await adminGet(analyticsPath(cohort, t));
    expect(res.status).toBe(200);
    const body = await res.json<AnalyticsPlayersBody>();
    expect(body.cohorts).toEqual([
      { date: cohort, newPlayers: 4, retained: { d1: 2, d7: 1, d30: 1 } },
      { date: addDays(t, -1), newPlayers: 1, retained: { d1: 0, d7: null, d30: null } },
    ]);
  });

  it('管理の集計は日の範囲の誤りにINVALID_ARGUMENTの400を返し知らないゲームにNOT_FOUNDの404を返す', async () => {
    const t = today();
    const before = { activity: await countAll('player_activity_days'), audit: await countAll('admin_audit_log') };
    for (const path of [
      `${specPath}?gameId=${game}&to=${t}`,
      analyticsPath('2026-1-01', t),
      analyticsPath(t, addDays(t, -1)),
      analyticsPath(addDays(t, -MAX_ANALYTICS_RANGE_DAYS), t),
      analyticsPath(t, addDays(t, 1)),
    ]) {
      await expectError(await adminGet(path), 400, 'INVALID_ARGUMENT');
    }
    await expectError(await adminGet(analyticsPath(t, t, 'no-such-game')), 404, 'NOT_FOUND');
    expect({ activity: await countAll('player_activity_days'), audit: await countAll('admin_audit_log') }).toEqual(before);
  });

  it('管理の集計は管理の鍵が無いと401で本番の設定ではNOT_READY_FOR_PRODUCTIONの403を返す', async () => {
    const t = today();
    await expectError(await adminGet(analyticsPath(t, t), { authorization: null }), 401, 'UNAUTHENTICATED');
    await expectError(await adminGet(analyticsPath(t, t), { authorization: 'Bearer wrong' }), 401, 'UNAUTHENTICATED');
    await expectError(await adminGet(analyticsPath(t, t), { e: { ...adminEnv, APP_ENV: 'disabled' } }), 403, 'NOT_READY_FOR_PRODUCTION');
  });

  it('管理の集計の応答は管理のスキーマに合う', async () => {
    const t = today();
    await addActivity(addDays(t, -8), 's1', 1);
    await addActivity(addDays(t, -7), 's1');
    await addActivity(t, 's2', 1);
    expect((await adminGet(analyticsPath(addDays(t, -8), t))).status).toBe(200);
    await expectConforms(await adminGet(analyticsPath(addDays(t, -8), t)));
    await expectConforms(await adminGet(analyticsPath(t, addDays(t, -1))));
    await expectConforms(await adminGet(analyticsPath(t, t, 'no-such-game')));
  });

  it('管理コマンドと同じ要求の形で集計を読める', async () => {
    await resetRateLimits(baseEnv.DB);
    const guest = await send('/v1/accounts/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestRequest()) });
    expect(guest.status).toBe(200);
    const { token, gameId } = await guest.json<{ token: string; gameId: string }>();
    expect((await send(inventoryPath(gameId), { headers: authHeaders(token) })).status).toBe(200);
    const res = await worker.fetch(adminRequest(base, adminKey, analyticsPlayersOp(gameId)), adminEnv as never);
    expect(res.status).toBe(200);
    const body = await res.json<AnalyticsPlayersBody>();
    const day = body.days.find((row) => row.date === today());
    expect(day?.activePlayers).toBeGreaterThanOrEqual(1);
    expect(day?.newPlayers).toBeGreaterThanOrEqual(1);
    // 管理コマンドの既定は今日までの 7 日。継続率の割り算は管理コマンドの側
    expect(body.days).toHaveLength(7);
    expect(retentionRates(body).find((row) => row.date === today())?.rates).toEqual({ d1: null, d7: null, d30: null });
  });
});

// ---- N3 配った量とクエストの受け取りの数 ----

const grantsSpecPath = '/v1/admin/analytics/grants';
const otherGame = 'analytics-other';
const grantsPath = (from: string, to: string, gameId = game) => `${grantsSpecPath}?gameId=${gameId}&from=${from}&to=${to}`;
/** その日（UTC）の 0 時から seconds 秒後の UNIX 秒。 */
const at = (day: string, seconds = 0) => Date.parse(`${day}T00:00:00Z`) / 1000 + seconds;

async function addLedger(playerId: string, itemId: string, delta: number, sourceType: string, createdAt: number, gameId = game): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at) '
    + 'VALUES (?, ?, ?, ?, ?, ?, ?)').bind(gameId, playerId, itemId, delta, sourceType, crypto.randomUUID(), createdAt).run();
}
async function addClaim(playerId: string, questId: string, periodKey: string, claimedAt: number, gameId = game): Promise<void> {
  await baseEnv.DB.prepare('INSERT INTO quest_claims (game_id, player_id, quest_id, period_key, claim_id, claimed_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(gameId, playerId, questId, periodKey, crypto.randomUUID(), claimedAt).run();
}

describe('N3 L2: 管理の配った量の口', () => {
  beforeEach(async () => {
    await registerGame(baseEnv.DB, otherGame, ['inventory', 'player-data', 'quests']);
    const db = baseEnv.DB;
    const games = [game, otherGame];
    const now = nowSeconds();
    await db.batch([
      ...['quest_claims', 'quest_rewards', 'quests', 'inventory_ledger', 'inventory_balances', 'player_data_key_periods', 'player_data_keys',
        'inventory_items'].flatMap((table) => games.map((g) => db.prepare(`DELETE FROM ${table} WHERE game_id = ?`).bind(g))),
      ...games.flatMap((g) => [
        db.prepare("INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, 'gold', 'currency'), (?, 'potion', 'item')").bind(g, g),
        db.prepare("INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, 'kills', 'add', 1000, 100)").bind(g),
        db.prepare("INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, key, threshold) VALUES (?, 'q-a', 'daily', ?, ?, 'kills', 1), "
          + "(?, 'q-b', 'daily', ?, ?, 'kills', 1)").bind(g, now - 400 * 86400, now + 86400, g, now - 400 * 86400, now + 86400),
      ]),
    ]);
  });

  it('管理の配った量の集計は日と種類と品目ごとに増やした量と減らした量を返す', async () => {
    const t = today();
    const y = addDays(t, -1);
    const ids = ['secret-player-a', 'secret-player-b', 'secret-player-c'];
    // 範囲の外（前の日の最後の秒）は数えない
    await addLedger(ids[0], 'gold', 999, 'event-claim', at(addDays(t, -2), 86399));
    await addLedger(ids[0], 'gold', 50, 'quest-claim', at(y, 10));
    await addLedger(ids[1], 'gold', 50, 'quest-claim', at(y, 86399));
    await addLedger(ids[0], 'gold', 100, 'event-claim', at(y, 20));
    await addLedger(ids[0], 'gold', 30, 'admin', at(y, 30));
    // 管理の取り消し（負の数）は removed に出る
    await addLedger(ids[1], 'gold', -10, 'admin', at(y, 40));
    await addLedger(ids[1], 'potion', 1, 'admin', at(y, 50));
    await addLedger(ids[2], 'gold', 100, 'event-claim', at(t));
    const res = await adminGet(grantsPath(y, t));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const id of ids) expect(text).not.toContain(id);
    const body = JSON.parse(text) as AnalyticsGrantsBody;
    expect(body).toMatchObject({ gameId: game, from: y, to: t, timezone: 'UTC', truncated: false });
    expect(body.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(body.grants).toEqual([
      { date: y, sourceType: 'admin', itemId: 'gold', added: 30, removed: 10, entries: 2 },
      { date: y, sourceType: 'admin', itemId: 'potion', added: 1, removed: 0, entries: 1 },
      { date: y, sourceType: 'event-claim', itemId: 'gold', added: 100, removed: 0, entries: 1 },
      { date: y, sourceType: 'quest-claim', itemId: 'gold', added: 100, removed: 0, entries: 2 },
      { date: t, sourceType: 'event-claim', itemId: 'gold', added: 100, removed: 0, entries: 1 },
    ]);
    expect(body.questClaims).toEqual([]);
  });

  it('管理の配った量の集計はクエストごとの受け取りの数を日ごとに返す', async () => {
    const t = today();
    const y = addDays(t, -1);
    await addClaim('p1', 'q-a', y, at(y, 100));
    await addClaim('p2', 'q-a', y, at(y, 200));
    await addClaim('p1', 'q-b', y, at(y, 300));
    await addClaim('p1', 'q-a', t, at(t));
    await addClaim('p2', 'q-b', t, at(t));
    await addClaim('p3', 'q-b', t, at(t));
    // 範囲の外は数えない
    await addClaim('p1', 'q-a', addDays(t, -2), at(addDays(t, -2), 86399));
    const res = await adminGet(grantsPath(y, t));
    expect(res.status).toBe(200);
    const text = await res.text();
    for (const id of ['p1', 'p2', 'p3']) expect(text).not.toContain(`"${id}"`);
    const body = JSON.parse(text) as AnalyticsGrantsBody;
    expect(body.questClaims).toEqual([
      { date: y, questId: 'q-a', claims: 2 },
      { date: y, questId: 'q-b', claims: 1 },
      { date: t, questId: 'q-a', claims: 1 },
      { date: t, questId: 'q-b', claims: 2 },
    ]);
    expect(body.truncated).toBe(false);
  });

  it('管理の配った量の集計は行の上限を越えると切ってtruncatedを返す', () => {
    expect(MAX_ANALYTICS_ROWS).toBe(5000);
    // 文は上限より 1 行多く読み、越えたかを見分ける
    expect(grantsSql).toContain(`LIMIT ${MAX_ANALYTICS_ROWS + 1}`);
    expect(questClaimsSql).toContain(`LIMIT ${MAX_ANALYTICS_ROWS + 1}`);
    const grant = (day: string, itemId: string): GrantRow => ({ day, source_type: 'admin', item_id: itemId, added: 1, removed: 0, entries: 1 });
    const claim = (day: string, questId: string): QuestClaimCountRow => ({ day, quest_id: questId, claims: 1 });
    const grants = [grant('2026-10-01', 'gold'), grant('2026-10-01', 'potion'), grant('2026-10-02', 'gold')];
    const claims = [claim('2026-10-01', 'q-a'), claim('2026-10-02', 'q-a')];
    const cut = shapeGrants(grants, claims, 2);
    expect(cut.truncated).toBe(true);
    expect(cut.grants.map((g) => [g.date, g.itemId])).toEqual([['2026-10-01', 'gold'], ['2026-10-01', 'potion']]);
    expect(cut.questClaims).toHaveLength(2);
    // どちらの並びが越えても立つ
    expect(shapeGrants(grants.slice(0, 2), [...claims, claim('2026-10-03', 'q-a')], 2).truncated).toBe(true);
    // ちょうど上限なら切らない
    expect(shapeGrants(grants.slice(0, 2), claims, 2)).toMatchObject({ truncated: false });
    expect(shapeGrants(grants, claims).truncated).toBe(false);
  });

  it('管理の配った量の集計はほかのゲームの履歴を数えない', async () => {
    const t = today();
    await addLedger('p1', 'gold', 10, 'event-claim', at(t));
    await addLedger('p1', 'gold', 70, 'event-claim', at(t), otherGame);
    await addLedger('p1', 'potion', 3, 'admin', at(t), otherGame);
    await addClaim('p1', 'q-a', t, at(t));
    await addClaim('p1', 'q-a', t, at(t), otherGame);
    await addClaim('p2', 'q-b', t, at(t), otherGame);
    const body = await (await adminGet(grantsPath(t, t))).json<AnalyticsGrantsBody>();
    expect(body.grants).toEqual([{ date: t, sourceType: 'event-claim', itemId: 'gold', added: 10, removed: 0, entries: 1 }]);
    expect(body.questClaims).toEqual([{ date: t, questId: 'q-a', claims: 1 }]);
    const other = await (await adminGet(grantsPath(t, t, otherGame))).json<AnalyticsGrantsBody>();
    expect(other.grants).toHaveLength(2);
    expect(other.questClaims).toHaveLength(2);
  });

  it('管理の配った量の集計の応答は管理のスキーマに合う', async () => {
    const t = today();
    await addLedger('s1', 'gold', 5, 'quest-claim', at(t));
    await addLedger('s1', 'gold', -5, 'admin', at(t));
    await addClaim('s1', 'q-a', t, at(t));
    const ok = await adminGet(grantsPath(addDays(t, -3), t));
    expect(ok.status).toBe(200);
    const body = await expectConforms(ok, grantsSpecPath) as AnalyticsGrantsBody;
    expect(body.grants).toHaveLength(2);
    expect(body.questClaims).toHaveLength(1);
    await expectConforms(await adminGet(grantsPath(t, addDays(t, -1))), grantsSpecPath);
    await expectConforms(await adminGet(grantsPath(t, t, 'no-such-game')), grantsSpecPath);
  });

  it('管理コマンドと同じ要求の形で配った量を読める', async () => {
    await resetRateLimits(baseEnv.DB);
    const guest = await send('/v1/accounts/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(guestRequest()) });
    expect(guest.status).toBe(200);
    const { token, gameId } = await guest.json<{ token: string; gameId: string }>();
    expect((await send(claimPath(SMOKE_EVENT_ID, gameId), { method: 'POST', headers: authHeaders(token) })).status).toBe(200);
    const res = await worker.fetch(adminRequest(base, adminKey, analyticsGrantsOp(gameId)), adminEnv as never);
    expect(res.status).toBe(200);
    const body = await res.json<AnalyticsGrantsBody>();
    // 管理コマンドの既定は今日までの 7 日
    expect(body.to).toBe(today());
    expect(body.from).toBe(addDays(today(), -6));
    const row = body.grants.find((g) => g.date === today() && g.sourceType === 'event-claim' && g.itemId === 'gold');
    expect(row?.added).toBeGreaterThanOrEqual(100);
    expect(row?.entries).toBeGreaterThanOrEqual(1);
  });
});
