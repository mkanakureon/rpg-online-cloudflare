/**
 * 分析 N2: 表ごとの保持の日数と掃除（src/core/cleanup.ts の RETENTION_DAYS・cutoffFor・runCleanup）と、Worker の scheduled の入口
 * （src/worker.ts）と、wrangler.jsonc の triggers.crons の試験。名前と期待する結果の正は docs/guides/working/analytics-design.md §10 の N2 の行。
 * L1 は関数と定数を直に見る。L2 は切り目の前後 1 秒の行を表に直に入れてから runCleanup(db, now) か worker.scheduled を呼ぶ
 * （now を渡す。時計を動かさない。開発サーバーを起動しない）。文の数と落ちた表は、文を数える・投げる偽の DB で確かめる。
 * 試験のゲームは専用の cleanup-game（beforeEach で登録・品目・キーと区切りの宣言を入れ、5 つの表と受け取りの行を消す）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-31
 */
import { env } from 'cloudflare:workers';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/worker';
import { activityDay } from '../src/core/activity';
import { AUDIT_RETENTION_DAYS } from '../src/core/admin/audit';
import { addDays } from '../src/core/analytics';
import {
  CLEANUP_CRON, CLEANUP_MAX_STATEMENTS, CLEANUP_ROWS_PER_STATEMENT, RETENTION_DAYS, cutoffFor, runCleanup, type CleanupTable,
} from '../src/core/cleanup';
import type { Database, Statement } from '../src/core/env';
import { periodKey } from '../src/core/period';
import wranglerText from '../wrangler.jsonc?raw';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const db = baseEnv.DB;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const disabledEnv: TestEnv = { ...baseEnv, APP_ENV: 'disabled' };
const base = 'http://example.com';
const game = 'cleanup-game';
const scope = 'cleanup-test';
const DAY = 86400;
const tables = Object.keys(RETENTION_DAYS) as CleanupTable[];

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** 消す 5 つの表に、その表の切り目の列が at（日付の表は day）の行を 1 行ずつ入れる。tag は行の見分け（プレイヤー ID・鍵など）。 */
async function insertRow(table: CleanupTable, tag: string, at: number | string): Promise<void> {
  const sql: Record<CleanupTable, [string, unknown[]]> = {
    admin_audit_log: [`INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, reason, created_at)
      VALUES (?, ?, 'tester', 'player.ban', ?, 'cleanup', ?)`, [`ref-${tag}`, game, `player:${tag}`, at]],
    player_data_writes: [`INSERT INTO player_data_writes (write_ref, game_id, player_id, request_key, request_hash, created_at)
      VALUES (?, ?, ?, ?, 'h', ?)`, [`ref-${tag}`, game, tag, `key-${tag}`, at]],
    player_data_period_values: [`INSERT INTO player_data_period_values (game_id, player_id, key, kind, period_key, value, updated_at)
      VALUES (?, ?, 'kills', 'daily', ?, 1, ?)`, [game, tag, `pk-${tag}`, at]],
    rate_limit_counters: ['INSERT INTO rate_limit_counters (scope, subject, window_start, count) VALUES (?, ?, ?, 1)', [scope, tag, at]],
    player_activity_days: ['INSERT INTO player_activity_days (game_id, day, player_id) VALUES (?, ?, ?)', [game, at, tag]],
  };
  const [text, binds] = sql[table];
  await db.prepare(text).bind(...binds).run();
}
/** その表の、試験の行の見分け（tag）の並び。 */
async function tagsOf(table: CleanupTable): Promise<string[]> {
  const sql: Record<CleanupTable, string> = {
    admin_audit_log: "SELECT substr(target, 8) AS tag FROM admin_audit_log WHERE game_id = ?",
    player_data_writes: 'SELECT player_id AS tag FROM player_data_writes WHERE game_id = ?',
    player_data_period_values: 'SELECT player_id AS tag FROM player_data_period_values WHERE game_id = ?',
    rate_limit_counters: 'SELECT subject AS tag FROM rate_limit_counters WHERE scope = ?',
    player_activity_days: 'SELECT player_id AS tag FROM player_activity_days WHERE game_id = ?',
  };
  const rows = (await db.prepare(sql[table]).bind(table === 'rate_limit_counters' ? scope : game).all<{ tag: string }>()).results;
  return rows.map((r) => r.tag).sort();
}
/** 各表に、切り目の 1 秒前（日付の表は前の日）の 'old' と切り目ちょうどの 'edge' の行を入れる。 */
async function insertAroundCutoff(now: number): Promise<void> {
  for (const table of tables) {
    const cutoff = cutoffFor(table, now);
    await insertRow(table, 'old', typeof cutoff === 'string' ? addDays(cutoff, -1) : cutoff - 1);
    await insertRow(table, 'edge', cutoff);
  }
}
async function count(table: 'quest_claims' | 'event_claims' | 'inventory_ledger'): Promise<number> {
  return (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE game_id = ?`).bind(game).first<{ n: number }>())?.n ?? 0;
}
async function send(method: 'GET' | 'POST', path: string, playerId = 'p1'): Promise<Response> {
  return worker.fetch(new Request(`${base}${path}?gameId=${game}`, { method, headers: { authorization: await bearer(game, playerId) } }),
    localEnv as never);
}
async function addQuest(questId: string, kind: 'once' | 'daily', threshold = 1): Promise<void> {
  const now = nowSeconds();
  await db.batch([
    db.prepare('INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, key, threshold) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(game, questId, kind, now - 3600, now + 86400, 'kills', threshold),
    db.prepare('INSERT INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES (?, ?, ?, ?)').bind(game, questId, 'gold', 10),
  ]);
}
/** 偽の scheduled の controller と ctx（waitUntil に渡した約束を集める）。 */
function fakeScheduled(now: number): { controller: { scheduledTime: number; cron: string }; ctx: { waitUntil(p: Promise<unknown>): void };
  waited: Promise<unknown>[] } {
  const waited: Promise<unknown>[] = [];
  return { controller: { scheduledTime: now * 1000, cron: CLEANUP_CRON }, ctx: { waitUntil: (p) => { waited.push(p); } }, waited };
}

const clean = () => [
  db.prepare('DELETE FROM quest_claims WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM event_claims WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM inventory_ledger WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM inventory_balances WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM quest_rewards WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM quests WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM admin_audit_log WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM player_data_writes WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM player_data_period_values WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM player_data WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM player_activity_days WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM player_data_key_periods WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM player_data_keys WHERE game_id = ?').bind(game),
  db.prepare('DELETE FROM inventory_items WHERE game_id = ?').bind(game),
];
beforeEach(async () => {
  await db.batch(clean());
  await resetRateLimits(db);
  await registerGame(db, game, ['inventory', 'events', 'player-data', 'quests']);
  await db.batch([
    db.prepare("INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, 'gold', 'currency')").bind(game),
    db.prepare("INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, 'kills', 'add', 1000, 100)").bind(game),
    db.prepare(`INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
      VALUES (?, 'kills', 'daily', 0, ?)`).bind(game, nowSeconds() - 400 * DAY),
  ]);
});
afterEach(() => {
  vi.restoreAllMocks();
});
// ほかの試験のファイルがキーや品目の宣言を消すときに、ここで入れた行が外部キーで邪魔をしない
afterAll(async () => {
  await db.batch(clean());
});

describe('N2 保持の日数と切り目', () => {
  it('掃除の切り目は表ごとの保持の日数から決まり監査のログは保持の定数を読む', () => {
    const now = Date.UTC(2026, 9, 31, 12, 0, 0) / 1000;
    expect(RETENTION_DAYS.admin_audit_log).toBe(AUDIT_RETENTION_DAYS);
    for (const table of tables.filter((t) => t !== 'player_activity_days')) {
      expect(cutoffFor(table, now), table).toBe(now - RETENTION_DAYS[table] * DAY);
    }
    expect(cutoffFor('admin_audit_log', now)).toBe(now - AUDIT_RETENTION_DAYS * DAY);
    expect(cutoffFor('player_activity_days', now)).toBe(activityDay(now - RETENTION_DAYS.player_activity_days * DAY));
    expect(cutoffFor('player_activity_days', now)).toBe('2025-09-26');
  });

  it('保持の日数の表は消す表だけを持ち受け取りの行と受領の履歴を持たない', () => {
    expect(Object.keys(RETENTION_DAYS).sort()).toEqual(
      ['admin_audit_log', 'player_activity_days', 'player_data_period_values', 'player_data_writes', 'rate_limit_counters']);
    for (const keep of ['quest_claims', 'event_claims', 'inventory_ledger']) expect(RETENTION_DAYS).not.toHaveProperty(keep);
  });
});

describe('N2 掃除', () => {
  it('掃除は保持の日数を過ぎた行だけを消し切り目の行は残す', async () => {
    const now = nowSeconds();
    await insertAroundCutoff(now);
    for (const table of tables) expect(await tagsOf(table), table).toEqual(['edge', 'old']);
    const result = await runCleanup(db, now);
    for (const table of tables) {
      expect(await tagsOf(table), table).toEqual(['edge']);
      expect(result.deleted[table], table).toBeGreaterThanOrEqual(1);
    }
    expect(result.failed).toEqual([]);
  });

  it('掃除は受け取りの行と受領の履歴を消さない', async () => {
    const now = nowSeconds();
    const old = now - 400 * DAY;
    await addQuest('once-quest', 'once');
    await addQuest('daily-quest', 'daily');
    await db.prepare('INSERT INTO player_data (game_id, player_id, key, value, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(game, 'p1', 'kills', 5, now).run();
    // 一度きりのクエストを口で受け取り、受け取りと履歴の時刻を 400 日前にする
    const first = await send('POST', '/v1/quests/once-quest/claim');
    expect(first.status).toBe(200);
    await db.batch([
      db.prepare('UPDATE quest_claims SET claimed_at = ? WHERE game_id = ?').bind(old, game),
      db.prepare('UPDATE inventory_ledger SET created_at = ? WHERE game_id = ?').bind(old, game),
      db.prepare(`INSERT INTO quest_claims (game_id, player_id, quest_id, period_key, claim_id, claimed_at)
        VALUES (?, 'p1', 'daily-quest', ?, 'old-daily-claim', ?)`).bind(game, periodKey('daily', old, 0), old),
      db.prepare(`INSERT INTO event_claims (game_id, player_id, event_id, period_key, claim_id, claimed_at)
        VALUES (?, 'p1', 'old-event', 'once', 'old-event-claim', ?)`).bind(game, old),
      db.prepare(`INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
        VALUES (?, 'p1', 'gold', 100, 'event-claim', 'old-event-claim', ?)`).bind(game, old),
    ]);
    const before = await (await send('POST', '/v1/quests/once-quest/claim')).json();
    const counts = [await count('quest_claims'), await count('event_claims'), await count('inventory_ledger')];
    expect(counts).toEqual([2, 1, 2]);

    await runCleanup(db, now);

    expect([await count('quest_claims'), await count('event_claims'), await count('inventory_ledger')]).toEqual(counts);
    const again = await send('POST', '/v1/quests/once-quest/claim');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(before);
    expect(await count('inventory_ledger')).toBe(2);
  });

  it('掃除はいまの区切りの値を消さずクエストの進捗が変わらない', async () => {
    const now = nowSeconds();
    const old = now - 36 * DAY;
    await addQuest('daily-quest', 'daily', 3);
    const insert = db.prepare(`INSERT INTO player_data_period_values (game_id, player_id, key, kind, period_key, value, updated_at)
      VALUES (?, 'p1', 'kills', 'daily', ?, ?, ?)`);
    await db.batch([insert.bind(game, periodKey('daily', now, 0), 2, now), insert.bind(game, periodKey('daily', old, 0), 9, old)]);
    const progressOf = async () => ((await (await send('GET', '/v1/quests')).json()) as { items: Array<{ questId: string; progress: number }> })
      .items.find((q) => q.questId === 'daily-quest')?.progress;
    expect(await progressOf()).toBe(2);

    await runCleanup(db, now);

    const rows = (await db.prepare('SELECT period_key AS pk FROM player_data_period_values WHERE game_id = ?').bind(game)
      .all<{ pk: string }>()).results;
    expect(rows.map((r) => r.pk)).toEqual([periodKey('daily', now, 0)]);
    expect(await progressOf()).toBe(2);
  });

  it('掃除は1つの文で消す行の数と1回に送る文の数に上限がある', async () => {
    const now = nowSeconds();
    // 文を数える偽の DB: 送らずに、いつも上限ちょうどを消したと答える（文の数の上限で止まるか）
    const sent: Array<{ sql: string; binds: unknown[] }> = [];
    const counting: Database = {
      prepare(sql: string): Statement {
        const stmt = {
          binds: [] as unknown[],
          bind(...values: unknown[]) { stmt.binds = values; return stmt as unknown as Statement; },
          async all<T>() { return { results: [] as T[] }; },
          async run() { sent.push({ sql, binds: stmt.binds }); return { meta: { changes: stmt.binds[1] } }; },
        };
        return stmt as unknown as Statement;
      },
      batch() { throw new Error('掃除は batch を使わない'); },
    };
    const fake = await runCleanup(counting, now);
    expect(sent.length).toBe(CLEANUP_MAX_STATEMENTS);
    expect(fake.statements).toBe(CLEANUP_MAX_STATEMENTS);
    for (const s of sent) {
      expect(s.sql).toMatch(/^DELETE FROM \w+ WHERE rowid IN \(SELECT rowid FROM \w+ WHERE \w+ < \? LIMIT \?\)$/);
      expect(s.binds[1]).toBe(CLEANUP_ROWS_PER_STATEMENT);
    }

    // 実の DB: 古い行を上限の 3 倍入れる。1 文は上限まで消し、全部で 4 文（1000・1000・1000・0）
    const total = CLEANUP_ROWS_PER_STATEMENT * 3;
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
      INSERT INTO rate_limit_counters (scope, subject, window_start, count) SELECT ?, 'old-' || i, ?, 1 FROM n`)
      .bind(total, scope, now - 2 * DAY).run();
    const real = await runCleanup(db, now);
    expect(real.deleted.rate_limit_counters).toBe(total);
    expect(real.statements).toBeLessThanOrEqual(CLEANUP_MAX_STATEMENTS);

    // 文の数の上限に届いたら止め、残りは 2 回目で消える（上限を小さくした呼び方）
    await db.prepare(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
      INSERT INTO rate_limit_counters (scope, subject, window_start, count) SELECT ?, 'old-' || i, ?, 1 FROM n`)
      .bind(total, scope, now - 2 * DAY).run();
    const limits = { maxStatements: tables.indexOf('rate_limit_counters') + 2 };
    const firstRun = await runCleanup(db, now, limits);
    expect(firstRun.statements).toBe(limits.maxStatements);
    expect(firstRun.deleted.rate_limit_counters).toBe(CLEANUP_ROWS_PER_STATEMENT * 2);
    expect((await tagsOf('rate_limit_counters')).length).toBe(CLEANUP_ROWS_PER_STATEMENT);
    await runCleanup(db, now);
    expect(await tagsOf('rate_limit_counters')).toEqual([]);
  });

  it('掃除は1つの表で落ちてもほかの表を消しDBのエラーの中身をログに出さない', async () => {
    const now = nowSeconds();
    await insertAroundCutoff(now);
    const secret = 'SQLITE_ERROR secret-row-content p-secret-player';
    const sentTables: string[] = [];
    // 1 つの表の文だけ投げる偽の DB（ほかは実の DB に送る）
    const failing: Database = {
      prepare(sql: string): Statement {
        const table = sql.split(' ')[2];
        if (table !== 'player_data_writes') {
          const real = db.prepare(sql);
          return { bind: (...v: unknown[]) => { sentTables.push(table); return real.bind(...v); } } as unknown as Statement;
        }
        const stmt = {
          bind() { sentTables.push(table); return stmt as unknown as Statement; },
          async all() { throw new Error(secret); },
          async run() { throw new Error(secret); },
        };
        return stmt as unknown as Statement;
      },
      batch() { throw new Error('掃除は batch を使わない'); },
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runCleanup(failing, now);

    expect([...new Set(sentTables)].sort()).toEqual([...tables].sort());
    expect(result.failed).toEqual(['player_data_writes']);
    for (const table of tables.filter((t) => t !== 'player_data_writes')) expect(await tagsOf(table), table).toEqual(['edge']);
    expect(await tagsOf('player_data_writes')).toEqual(['edge', 'old']);
    expect(errors.mock.calls).toEqual([['cleanup failed', 'player_data_writes']]);
    const logged = JSON.stringify([...errors.mock.calls, ...logs.mock.calls]);
    expect(logged).not.toContain('secret');
    expect(logged).not.toContain('SQLITE');
  });
});

describe('N2 scheduled の入口と設定', () => {
  it('scheduledは本番の設定では何も消さない', async () => {
    const now = nowSeconds();
    await insertAroundCutoff(now);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { controller, ctx, waited } = fakeScheduled(now);
    worker.scheduled(controller, disabledEnv as never, ctx);
    await Promise.all(waited);
    for (const table of tables) expect(await tagsOf(table), table).toEqual(['edge', 'old']);
    expect(JSON.stringify(logs.mock.calls)).toContain('skipped');
  });

  it('scheduledはローカルの設定で掃除を待ち合わせて流す', async () => {
    const now = nowSeconds();
    await insertAroundCutoff(now);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { controller, ctx, waited } = fakeScheduled(now);
    worker.scheduled(controller, localEnv as never, ctx);
    expect(waited.length).toBe(1);
    await Promise.all(waited);
    for (const table of tables) expect(await tagsOf(table), table).toEqual(['edge']);
    const logged = JSON.stringify(logs.mock.calls);
    expect(logged).toContain('cleanup deleted');
    expect(logged).not.toContain('old');
  });

  it('wranglerの設定のcronは掃除の定数と同じでAPP_ENVの既定は変わらない', () => {
    const json = wranglerText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const config = JSON.parse(json) as { triggers?: { crons?: string[] }; vars?: { APP_ENV?: string } };
    expect(config.triggers?.crons).toEqual([CLEANUP_CRON]);
    expect(config.vars?.APP_ENV).toBe('disabled');
  });
});
