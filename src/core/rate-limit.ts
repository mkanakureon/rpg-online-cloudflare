// rate-limit.ts — 利用制限を D1 の固定の窓で数え、上限を超えた要求を 429 RATE_LIMITED と Retry-After（秒）で断る。
//
// windowStart・retryAfterSeconds・decide は入出力の無い関数（L1 の試験で確かめる）。consume は数える 1 回で、
// 表 rate_limit_counters（migrations/0008_rate_limits.sql）に足して数を返す文と、同じ鍵の古い窓を消す文を batch で流す。
// 断った要求も数える（数えてから比べる）。DB の失敗は投げて、入口の try/catch が 500 INTERNAL_ERROR にする（通さない）。
// 呼ぶ所と順の正は docs/guides/working/abuse-protection-design.md §3（APP_ENV の門・トークンの後）。回数と窓は rate-limit-policy.ts。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Database } from './env';
import { error } from './http';
import type { RateLimitRule } from './rate-limit-policy';

/** CF-Connecting-IP の見出しが無いときの鍵（全員で 1 つ。見出しが無いことを理由に数えずに通さない）。 */
export const NO_IP_SUBJECT = 'no-ip';

/** いまの秒が入る窓の始まり（UNIX 秒）。 */
export function windowStart(nowSeconds: number, period: number): number {
  return nowSeconds - (nowSeconds % period);
}

/** 窓の終わりまでの秒（1 以上・period 以下）。Retry-After の値。 */
export function retryAfterSeconds(nowSeconds: number, period: number): number {
  return period - (nowSeconds % period);
}

/** この要求を足した後の数が上限までなら通す（true）。超えたら断る（false）。 */
export function decide(count: number, limit: number): boolean {
  return count <= limit;
}

/** 利用制限の鍵にする IP: CF-Connecting-IP の値の SHA-256（小文字の 16 進）。見出しが無ければ NO_IP_SUBJECT。 */
export async function ipSubject(req: Request): Promise<string> {
  const ip = req.headers.get('CF-Connecting-IP');
  if (!ip) return NO_IP_SUBJECT;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 1 回数える。上限までなら null、超えたら 429 RATE_LIMITED（見出し Retry-After）の応答。 */
export async function consume(
  db: Database, rule: RateLimitRule, subject: string, nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Response | null> {
  const start = windowStart(nowSeconds, rule.period);
  const [counted] = await db.batch([
    db.prepare(
      `INSERT INTO rate_limit_counters (scope, subject, window_start, count) VALUES (?, ?, ?, 1)
       ON CONFLICT (scope, subject, window_start) DO UPDATE SET count = rate_limit_counters.count + 1
       RETURNING count`
    ).bind(rule.scope, subject, start),
    db.prepare('DELETE FROM rate_limit_counters WHERE scope = ? AND subject = ? AND window_start < ?').bind(rule.scope, subject, start),
  ]);
  const count = (counted as { results?: Array<{ count: number }> }).results?.[0]?.count;
  if (typeof count !== 'number') throw new Error('Rate limit counter did not return a count');
  if (decide(count, rule.limit)) return null;
  // どの鍵で断ったか・上限の数は本文に入れない（クライアントは Retry-After だけ見ればよい）
  return error('RATE_LIMITED', 'Too many requests', 429, { 'Retry-After': String(retryAfterSeconds(nowSeconds, rule.period)) });
}
