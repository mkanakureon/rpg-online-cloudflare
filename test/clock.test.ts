/**
 * G1: サーバーの時刻を取る 1 つの関数（src/core/clock.ts の serverNow）と、時計の境目・期限ちょうど・並べて送る試験。
 * 名前の正は docs/guides/working/hardening-design.md §11 の G1 の 8 行（設計は §6 の案 A）。
 * 時計は Date.now を vi.spyOn で差し替える（試験とハンドラーは同じ isolate で動き、src/worker.ts の default.fetch を直に呼ぶので効く）。
 * 偽のタイマー（vitest の時計の差し替えの仕組み）は Workers の試験の環境での挙動が要確認なので使わない（§6）。
 * 並べて送る試験は Promise.all で同じ要求を同時に送り、行の数と応答の分け方を見る（ローカルの D1 で通ることを確かめる）。
 * 試験のゲームは専用の clock-game。試験の前後でそのゲームの行（ゲームを消すと CASCADE で消える）と利用制限の行を消す。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-10
 */
import { env } from 'cloudflare:workers';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import { serverNow } from '../src/core/clock';
import { isoSeconds, periodKey } from '../src/core/period';
import { RATE_LIMITS } from '../src/core/rate-limit-policy';
import { windowStart } from '../src/core/rate-limit';
import { LOCAL_DEV_TOKEN_SECRET, TOKEN_TTL_SECONDS, verifyToken } from '../src/core/token';
import { MAX_SLOTS } from '../src/modules/saves/limits';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';
const game = 'clock-game';

type ErrorBody = { error: { code: string; message: string } };
type TokenBody = { gameId: string; playerId: string; token: string; expiresAt: string };
type ListBody = { serverTime: string; items: Array<{ periodKey: string; progress?: number; claimed: boolean }> };
type ClaimBody = { periodKey: string; claimId: string; claimedAt: string };

/** 区切りの境目に使う UTC の 0 時（2030-01-15 火曜。デイリーの区切りの境目で、60 秒の窓の境目でもある）。 */
const BOUNDARY = Date.UTC(2030, 0, 15) / 1000;

/** サーバーの時計をこの UNIX 秒に合わせる（ミリ秒の端数を足しても秒は変わらないことも見るため、既定で 0.5 秒を足す）。 */
function setClock(seconds: number, extraMs = 500): void {
  vi.spyOn(Date, 'now').mockReturnValue(seconds * 1000 + extraMs);
}

async function send(method: 'GET' | 'POST' | 'PUT', path: string, init: { authorization?: string | null; headers?: Record<string, string>;
  body?: string; playerId?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...init.headers };
  const authorization = init.authorization === undefined ? await bearer(game, init.playerId ?? 'p1') : init.authorization;
  if (authorization !== null) headers.authorization = authorization;
  const sep = path.includes('?') ? '&' : '?';
  return worker.fetch(new Request(`${base}${path}${sep}gameId=${game}`, { method, headers, body: init.body }), localEnv as never);
}
const guest = (ip: string) => worker.fetch(new Request(`${base}/v1/accounts/guest`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ gameId: game }),
}), localEnv as never);
const refresh = (authorization: string) => worker.fetch(new Request(`${base}/v1/accounts/token`, {
  method: 'POST', headers: { authorization },
}), localEnv as never);
const addSteps = (value: number) => send('POST', '/v1/player-data', {
  headers: { 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ changes: [{ key: 'steps', value }] }),
});
async function saveTo(slotId: string): Promise<Response> {
  const data = JSON.stringify({ slotId });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  const checksum = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return send('PUT', `/v1/saves/${slotId}`, { body: JSON.stringify({ formatVersion: 1, data, checksum, baseRevision: 0 }) });
}

async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
async function countOf(sql: string, ...args: unknown[]): Promise<number> {
  const row = await baseEnv.DB.prepare(sql).bind(...args).first<{ n: number }>();
  return row?.n ?? 0;
}
async function counterRows(scope: string): Promise<Array<{ windowStart: number; count: number }>> {
  return (await baseEnv.DB.prepare(`SELECT window_start AS windowStart, count FROM rate_limit_counters WHERE scope = ?
    ORDER BY window_start`).bind(scope).all<{ windowStart: number; count: number }>()).results;
}
const statuses = (responses: readonly Response[]) => responses.map((r) => r.status).sort((a, b) => a - b);

/** clock-game の行を消す（アカウントを消すとプレイヤーが、ゲームを消すとほかの行が CASCADE で消える）と、利用制限の行を消す。 */
async function cleanGame(): Promise<void> {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM accounts WHERE account_id IN (SELECT account_id FROM game_players WHERE game_id = ?)').bind(game),
    baseEnv.DB.prepare('DELETE FROM games WHERE game_id = ?').bind(game),
  ]);
  await resetRateLimits(baseEnv.DB);
}

beforeEach(async () => {
  await cleanGame();
  await registerGame(baseEnv.DB, game, ['events', 'inventory', 'player-data', 'quests', 'saves']);
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, ?, ?)').bind(game, 'gold', 'currency'),
    baseEnv.DB.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)')
      .bind(game, 'steps', 'add', 1000, 100),
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await cleanGame();
});

describe('G1 サーバーの時刻と時計の境目', () => {
  it('サーバーの時刻は1か所の関数から取りDate.nowを差し替えると全部の口が従う', async () => {
    const t = BOUNDARY + 1234;
    setClock(t, 999);
    expect(serverNow()).toBe(t);
    await baseEnv.DB.prepare('INSERT INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes) VALUES (?, ?, ?, ?, ?, 0)')
      .bind(game, 'login', 'daily', t - 10, t + 10).run();
    await baseEnv.DB.prepare('INSERT INTO event_rewards (game_id, event_id, item_id, amount) VALUES (?, ?, ?, ?)').bind(game, 'login', 'gold', 1).run();

    // イベントとクエストの一覧のサーバーの時刻
    const events = await send('GET', '/v1/events');
    expect(events.status).toBe(200);
    expect((await events.json<ListBody>()).serverTime).toBe(isoSeconds(t));
    const quests = await send('GET', '/v1/quests');
    expect(quests.status).toBe(200);
    expect((await quests.json<ListBody>()).serverTime).toBe(isoSeconds(t));
    // イベントの受け取りの時刻と区切り
    const claimed = await send('POST', '/v1/events/login/claim');
    expect(claimed.status).toBe(200);
    expect(await claimed.json<ClaimBody>()).toMatchObject({ claimedAt: isoSeconds(t), periodKey: periodKey('daily', t, 0) });
    // ゲストの発行とトークンの更新の期限
    const issued = await guest('203.0.113.1');
    expect(issued.status).toBe(200);
    const issuedBody = await issued.json<TokenBody>();
    expect(issuedBody.expiresAt).toBe(isoSeconds(t + TOKEN_TTL_SECONDS).replace('Z', '.000Z'));
    const verified = await verifyToken(issuedBody.token, LOCAL_DEV_TOKEN_SECRET, t);
    expect(verified.ok && verified.claims.exp).toBe(t + TOKEN_TTL_SECONDS);
    const refreshed = await refresh(`Bearer ${issuedBody.token}`);
    expect(refreshed.status).toBe(200);
    expect((await refreshed.json<TokenBody>()).expiresAt).toBe(issuedBody.expiresAt);
    // 遊んだ日と利用制限の窓
    expect(await countOf('SELECT COUNT(*) AS n FROM player_activity_days WHERE game_id = ? AND day = ?', game, isoSeconds(t).slice(0, 10)))
      .toBeGreaterThan(0);
    for (const scope of [RATE_LIMITS.rewards.scope, RATE_LIMITS.quests.scope, RATE_LIMITS.guestIp.scope, RATE_LIMITS.tokenRefresh.scope]) {
      expect((await counterRows(scope)).map((r) => r.windowStart), scope).toEqual([windowStart(t, 60)]);
    }
  });

  it('期限ちょうどの秒のトークンはTOKEN_EXPIREDの401を返し1秒前は通る', async () => {
    const exp = BOUNDARY + 100;
    const authorization = await bearer(game, 'p1', { exp });
    setClock(exp - 1, 999);
    expect((await send('GET', '/v1/quests', { authorization })).status).toBe(200);
    expect((await refresh(authorization)).status).toBe(200);
    setClock(exp, 0);
    await expectError(await send('GET', '/v1/quests', { authorization }), 401, 'TOKEN_EXPIRED');
    await expectError(await refresh(authorization), 401, 'TOKEN_EXPIRED');
  });

  it('デイリーのクエストは区切りの境目の1秒前と境目で別の区切りとして数える', async () => {
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(`INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
        VALUES (?, 'steps', 'daily', 0, ?)`).bind(game, BOUNDARY - 86400),
      baseEnv.DB.prepare(`INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, key, threshold)
        VALUES (?, 'walk', 'daily', ?, ?, 'steps', 3)`).bind(game, BOUNDARY - 86400, BOUNDARY + 86400),
      baseEnv.DB.prepare("INSERT INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES (?, 'walk', 'gold', 10)").bind(game),
    ]);
    const before = periodKey('daily', BOUNDARY - 1, 0);
    const after = periodKey('daily', BOUNDARY, 0);
    expect(before).not.toBe(after);

    // 境目の 1 秒前: 3 歩で達成し、前の日の区切りで受け取る
    setClock(BOUNDARY - 1, 999);
    expect((await addSteps(3)).status).toBe(200);
    const listBefore = await (await send('GET', '/v1/quests')).json<ListBody>();
    expect(listBefore.items).toEqual([expect.objectContaining({ periodKey: before, progress: 3, claimed: false })]);
    const claimBefore = await send('POST', '/v1/quests/walk/claim');
    expect(claimBefore.status).toBe(200);
    expect((await claimBefore.json<ClaimBody>()).periodKey).toBe(before);

    // 境目: 新しい区切りの進捗は 0 からで、前の区切りの受け取りは数えない
    setClock(BOUNDARY, 0);
    const listAfter = await (await send('GET', '/v1/quests')).json<ListBody>();
    expect(listAfter.items).toEqual([expect.objectContaining({ periodKey: after, progress: 0, claimed: false })]);
    await expectError(await send('POST', '/v1/quests/walk/claim'), 409, 'QUEST_NOT_COMPLETED');
    expect((await addSteps(3)).status).toBe(200);
    const claimAfter = await send('POST', '/v1/quests/walk/claim');
    expect(claimAfter.status).toBe(200);
    expect((await claimAfter.json<ClaimBody>()).periodKey).toBe(after);

    const rows = (await baseEnv.DB.prepare(`SELECT period_key AS periodKey, value FROM player_data_period_values
      WHERE game_id = ? AND key = 'steps' ORDER BY period_key`).bind(game).all<{ periodKey: string; value: number }>()).results;
    expect(rows).toEqual([{ periodKey: before, value: 3 }, { periodKey: after, value: 3 }]);
    expect(await countOf('SELECT COUNT(*) AS n FROM quest_claims WHERE game_id = ?', game)).toBe(2);
  });

  it('イベントの受け取りは区切りの境目をまたぐと次の区切りで受け取れる', async () => {
    await baseEnv.DB.batch([
      baseEnv.DB.prepare(`INSERT INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes)
        VALUES (?, 'login', 'daily', ?, ?, 0)`).bind(game, BOUNDARY - 86400, BOUNDARY + 86400),
      baseEnv.DB.prepare("INSERT INTO event_rewards (game_id, event_id, item_id, amount) VALUES (?, 'login', 'gold', 100)").bind(game),
    ]);
    setClock(BOUNDARY - 1, 999);
    const first = await (await send('POST', '/v1/events/login/claim')).json<ClaimBody>();
    expect(first.periodKey).toBe(periodKey('daily', BOUNDARY - 1, 0));
    // 同じ区切りの中の 2 回目は同じ受け取り（二重にしない）
    const again = await (await send('POST', '/v1/events/login/claim')).json<ClaimBody>();
    expect(again.claimId).toBe(first.claimId);

    setClock(BOUNDARY, 0);
    const listed = await (await send('GET', '/v1/events')).json<ListBody>();
    expect(listed.items).toEqual([expect.objectContaining({ periodKey: periodKey('daily', BOUNDARY, 0), claimed: false })]);
    const next = await send('POST', '/v1/events/login/claim');
    expect(next.status).toBe(200);
    const nextBody = await next.json<ClaimBody>();
    expect(nextBody.periodKey).toBe(periodKey('daily', BOUNDARY, 0));
    expect(nextBody.claimId).not.toBe(first.claimId);
    expect(await countOf('SELECT COUNT(*) AS n FROM event_claims WHERE game_id = ?', game)).toBe(2);
    expect(await countOf("SELECT amount AS n FROM inventory_balances WHERE game_id = ? AND player_id = 'p1' AND item_id = 'gold'", game))
      .toBe(200);
  });

  it('利用制限は窓の境目で数え直し境目の1秒前までは同じ窓で数える', async () => {
    const rule = RATE_LIMITS.tokenRefresh;
    const start = windowStart(BOUNDARY, rule.period);
    const authorization = await bearer(game, 'p1', { exp: BOUNDARY + 86400 });
    setClock(start, 0);
    for (let i = 0; i < rule.limit - 1; i += 1) expect((await refresh(authorization)).status).toBe(200);
    // 窓の終わりの 1 秒前はまだ同じ窓: 上限ちょうどまで通り、次は 429（Retry-After は残りの 1 秒）
    setClock(start + rule.period - 1, 999);
    expect((await refresh(authorization)).status).toBe(200);
    const limited = await refresh(authorization);
    await expectError(limited.clone(), 429, 'RATE_LIMITED');
    expect(limited.headers.get('Retry-After')).toBe('1');
    expect(await counterRows(rule.scope)).toEqual([{ windowStart: start, count: rule.limit + 1 }]);
    // 窓の境目で数え直す（前の窓の行は消える）
    setClock(start + rule.period, 0);
    expect((await refresh(authorization)).status).toBe(200);
    expect(await counterRows(rule.scope)).toEqual([{ windowStart: start + rule.period, count: 1 }]);
  });
});

describe('G1 並べて送る', () => {
  it('ゲストの発行を並べて送ってもIPごとの上限を超えて発行しない', async () => {
    const rule = RATE_LIMITS.guestIp;
    const responses = await Promise.all(Array.from({ length: rule.limit + 5 }, () => guest('198.51.100.7')));
    expect(statuses(responses)).toEqual([...Array(rule.limit).fill(200), ...Array(5).fill(429)]);
    for (const r of responses.filter((x) => x.status === 429)) await expectError(r, 429, 'RATE_LIMITED');
    expect(await countOf('SELECT COUNT(*) AS n FROM game_players WHERE game_id = ?', game)).toBe(rule.limit);
    expect((await counterRows(rule.scope)).map((r) => r.count)).toEqual([rule.limit + 5]);
  });

  it('新しいスロットへの書き込みを並べて送ってもMAX_SLOTSを超えない', async () => {
    const extra = 5;
    const responses = await Promise.all(Array.from({ length: MAX_SLOTS + extra }, (_, i) => saveTo(`slot-${i}`)));
    expect(statuses(responses)).toEqual([...Array(MAX_SLOTS).fill(200), ...Array(extra).fill(409)]);
    for (const r of responses.filter((x) => x.status === 409)) await expectError(r, 409, 'SLOT_LIMIT_EXCEEDED');
    expect(await countOf("SELECT COUNT(*) AS n FROM saves WHERE game_id = ? AND player_id = 'p1'", game)).toBe(MAX_SLOTS);
  });

  it('同じプレイヤーの要求を並べて送っても利用制限は全部を数える', async () => {
    const rule = RATE_LIMITS.tokenRefresh;
    // 窓の境目をまたがないように、窓の始まりに時計を止める（トークンの期限はその時計から数える）
    setClock(windowStart(BOUNDARY, rule.period), 0);
    const authorization = await bearer(game, 'p1');
    const responses = await Promise.all(Array.from({ length: rule.limit + 5 }, () => refresh(authorization)));
    expect(statuses(responses)).toEqual([...Array(rule.limit).fill(200), ...Array(5).fill(429)]);
    expect((await counterRows(rule.scope)).map((r) => r.count)).toEqual([rule.limit + 5]);
  });
});
