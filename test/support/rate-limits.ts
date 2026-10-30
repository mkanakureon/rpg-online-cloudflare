/**
 * 試験の手伝い: 利用制限の数の表（rate_limit_counters。migrations/0008_rate_limits.sql）を消す・開始状態を入れる。
 * 書き込みを呼ぶ試験のファイルは beforeEach で resetRateLimits を呼び、前の試験の数に引きずられない（開始状態だけを直す）。
 * 制限を超える試験は fillRateLimit で上限まで数えた行を入れてから 1 回だけ送る（上限の回数を送ると窓の境目をまたいで揺れるため）。
 * 使い方の正は docs/guides/working/abuse-protection-design.md §7 の試験の作り方。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { windowStart } from '../../src/core/rate-limit';
import type { RateLimitRule } from '../../src/core/rate-limit-policy';

/** 数の表を空にする。 */
export async function resetRateLimits(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM rate_limit_counters').run();
}

/** rule・subject の、いまの窓と次の窓の両方に count の行を入れる（既定は上限まで数えた状態）。 */
export async function fillRateLimit(db: D1Database, rule: RateLimitRule, subject: string, count = rule.limit): Promise<void> {
  const start = windowStart(Math.floor(Date.now() / 1000), rule.period);
  const insert = 'INSERT OR REPLACE INTO rate_limit_counters (scope, subject, window_start, count) VALUES (?, ?, ?, ?)';
  await db.batch([
    db.prepare(insert).bind(rule.scope, subject, start, count),
    db.prepare(insert).bind(rule.scope, subject, start + rule.period, count),
  ]);
}

/** 数の表の行の数。 */
export async function countRateLimitRows(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM rate_limit_counters').first<{ n: number }>();
  return row?.n ?? 0;
}
