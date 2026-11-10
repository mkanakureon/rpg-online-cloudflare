// analytics.ts — 管理の集計の口（GET /v1/admin/analytics/players・GET /v1/admin/analytics/grants）の、入出力の無い関数と SQL の文字列。
//
// parseAnalyticsRange は問い合わせの from・to（UTC の YYYY-MM-DD）の形・順・日数の上限（MAX_ANALYTICS_RANGE_DAYS・両端を含む）・
// 今日（サーバーの時刻の UTC）までを確かめる。fillDays は数の無い日を 0 で埋めて昇順に並べ、retentionCell は N 日目が今日より後なら null
// （まだ決まらない）にする。集計は要求の時に表 player_activity_days を数え（まとめた表を持たない）、応答に playerId も行ごとの時刻も入れない。
// 継続の文の '+N day' は定数 RETENTION_OFFSETS の整数から作る（要求の値は文に入れず、バインドは gameId・from・to の 3 つ）。
// 継続率の割り算はクライアント（scripts/admin-cli.mjs の analytics）がする。ゲストのトークンは 30 日で切れ、更新しないまま越えた人は
// 新しいプレイヤーで戻るので、D30 は低く、newPlayers は高く出る（docs/api-contract.md の「管理の API」に書く）。
// 配った量の口は受領の履歴 inventory_ledger を日・種類・品目ごとに、受け取りの行 quest_claims を日・クエストごとにまとめる。日の範囲は
// rangeSeconds で UNIX 秒にして比べ（バインドは gameId・始まりの秒・終わりの秒の 3 つ）、文の LIMIT は定数 MAX_ANALYTICS_ROWS より 1 多くして、
// shapeGrants が日付の昇順で切って truncated を立てる。管理の口（src/core/admin/routes.ts）が読む。
// core はモジュールを読み込まない。設計の正は docs/guides/working/analytics-design.md §3・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { activityDay } from './activity';

/** 集計の口の from〜to の日数（両端を含む）の上限。 */
export const MAX_ANALYTICS_RANGE_DAYS = 92;
/** 継続の数を出す、発行の日から何日目か（D1・D7・D30）。 */
export const RETENTION_OFFSETS = [1, 7, 30] as const;
export type RetentionOffset = (typeof RETENTION_OFFSETS)[number];
/** 配った量の口の grants・questClaims のそれぞれの行の上限（越えたら日付の昇順で切って truncated: true）。 */
export const MAX_ANALYTICS_ROWS = 5000;

const DAY = 86_400;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' の日付の UTC の 0 時（UNIX 秒）。形が外れる・無い日付（2 月 30 日など）なら null。 */
function dayStart(value: string | null): number | null {
  if (value === null || !datePattern.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) return null;
  return ms / 1000;
}

export type AnalyticsRange = { from: string; to: string };
export type AnalyticsRangeResult = { ok: true; value: AnalyticsRange } | { ok: false; message: string };

/** 問い合わせの from・to を確かめる。両方要り、from <= to・日数が MAX_ANALYTICS_RANGE_DAYS 以下・to が今日（UTC）以下。 */
export function parseAnalyticsRange(url: URL, nowSeconds: number): AnalyticsRangeResult {
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const start = dayStart(from);
  if (start === null) return { ok: false, message: 'from must be a date YYYY-MM-DD' };
  const end = dayStart(to);
  if (end === null) return { ok: false, message: 'to must be a date YYYY-MM-DD' };
  if (start > end) return { ok: false, message: 'from must not be after to' };
  if ((end - start) / DAY + 1 > MAX_ANALYTICS_RANGE_DAYS) {
    return { ok: false, message: `The range can cover at most ${MAX_ANALYTICS_RANGE_DAYS} days` };
  }
  if (to! > activityDay(nowSeconds)) return { ok: false, message: 'to must not be after today (UTC)' };
  return { ok: true, value: { from: from!, to: to! } };
}

/** その日付から N 日後の日付（UTC）。 */
export function addDays(day: string, days: number): string {
  return activityDay(dayStart(day)! + days * DAY);
}

export type DailyRow = { day: string; active_players: number; new_players: number };
export type DailyCount = { date: string; activePlayers: number; newPlayers: number };

/** from〜to の全部の日を昇順に並べ、行の無い日は 0 にする。 */
export function fillDays(from: string, to: string, rows: readonly DailyRow[]): DailyCount[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const days: DailyCount[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const row = byDay.get(day);
    days.push({ date: day, activePlayers: row?.active_players ?? 0, newPlayers: row?.new_players ?? 0 });
  }
  return days;
}

/** 発行の日の N 日目の継続の数。N 日目が今日（UTC）より後ならまだ決まらないので null。 */
export function retentionCell(cohortDay: string, today: string, offset: number, count: number): number | null {
  return addDays(cohortDay, offset) > today ? null : count;
}

/** 日ごとの遊んだ人と新しい人の数（バインドは gameId・from・to）。 */
export const dailyActivitySql = `SELECT day, COUNT(*) AS active_players, SUM(is_new) AS new_players
  FROM player_activity_days WHERE game_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`;

/** 発行の日ごとの新しい人の数と、RETENTION_OFFSETS の日に遊んだ人の数（列 d1・d7・d30。バインドは gameId・from・to）。 */
export const cohortRetentionSql = `SELECT c.day AS day, COUNT(*) AS new_players,
  ${RETENTION_OFFSETS.map((n) => `SUM(EXISTS (SELECT 1 FROM player_activity_days a WHERE a.game_id = c.game_id
    AND a.day = date(c.day, '+${n} day') AND a.player_id = c.player_id)) AS d${n}`).join(',\n  ')}
  FROM player_activity_days c WHERE c.game_id = ? AND c.is_new = 1 AND c.day BETWEEN ? AND ? GROUP BY c.day ORDER BY c.day`;

export type CohortRow = { day: string; new_players: number } & Record<`d${RetentionOffset}`, number>;
export type Cohort = { date: string; newPlayers: number; retained: Record<`d${RetentionOffset}`, number | null> };

/** 継続の文の行を応答の形にする（N 日目が今日より後の数は null）。新しい人のいない日は行が無い。 */
export function shapeCohorts(rows: readonly CohortRow[], today: string): Cohort[] {
  return rows.map((row) => ({
    date: row.day,
    newPlayers: row.new_players,
    retained: Object.fromEntries(RETENTION_OFFSETS.map((n) => [`d${n}`, retentionCell(row.day, today, n, row[`d${n}`])])) as Cohort['retained'],
  }));
}

/** 日の範囲（両端の日を含む）を UNIX 秒の [始まり, 終わり) にする。範囲は parseAnalyticsRange で確かめた後の値。 */
export function rangeSeconds(range: AnalyticsRange): { start: number; end: number } {
  return { start: dayStart(range.from)!, end: dayStart(range.to)! + DAY };
}

/** 日・種類・品目ごとの増やした量・減らした量（負の delta の絶対値）・行の数（バインドは gameId・始まりの秒・終わりの秒）。 */
export const grantsSql = `SELECT date(created_at, 'unixepoch') AS day, source_type, item_id,
  SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END) AS added, SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END) AS removed, COUNT(*) AS entries
  FROM inventory_ledger WHERE game_id = ? AND created_at >= ? AND created_at < ?
  GROUP BY day, source_type, item_id ORDER BY day, source_type, item_id LIMIT ${MAX_ANALYTICS_ROWS + 1}`;

/** 日・クエストごとの受け取りの数（バインドは gameId・始まりの秒・終わりの秒）。 */
export const questClaimsSql = `SELECT date(claimed_at, 'unixepoch') AS day, quest_id, COUNT(*) AS claims
  FROM quest_claims WHERE game_id = ? AND claimed_at >= ? AND claimed_at < ?
  GROUP BY day, quest_id ORDER BY day, quest_id LIMIT ${MAX_ANALYTICS_ROWS + 1}`;

export type GrantRow = { day: string; source_type: string; item_id: string; added: number; removed: number; entries: number };
export type QuestClaimCountRow = { day: string; quest_id: string; claims: number };
export type Grant = { date: string; sourceType: string; itemId: string; added: number; removed: number; entries: number };
export type QuestClaimCount = { date: string; questId: string; claims: number };
export type GrantsSummary = { grants: Grant[]; questClaims: QuestClaimCount[]; truncated: boolean };

/** 2 つの文の行（日付の昇順）を応答の形にする。どちらかが limit を越えたら、その並びを先頭の limit 行で切って truncated: true。 */
export function shapeGrants(grantRows: readonly GrantRow[], claimRows: readonly QuestClaimCountRow[], limit = MAX_ANALYTICS_ROWS): GrantsSummary {
  return {
    grants: grantRows.slice(0, limit).map((row) => ({
      date: row.day, sourceType: row.source_type, itemId: row.item_id, added: row.added, removed: row.removed, entries: row.entries,
    })),
    questClaims: claimRows.slice(0, limit).map((row) => ({ date: row.day, questId: row.quest_id, claims: row.claims })),
    truncated: grantRows.length > limit || claimRows.length > limit,
  };
}
