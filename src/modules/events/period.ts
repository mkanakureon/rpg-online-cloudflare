// period.ts — イベントの期間と区切り（一度きり・デイリー・週間）の計算。入出力を持たない。
//
// src/modules/events/index.ts が、サーバーの時刻（Math.floor(Date.now() / 1000)）だけを now に渡して呼ぶ。クライアントの時刻
// （本文・問い合わせ・Date の見出し）は受け取らない。時刻はどれも UNIX 秒（UTC）、区切りの時差は固定の分（夏時間を持たない）。
// 決まりと例の正は docs/guides/working/event-reward-design.md §4。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** イベントの区切り（表 events の kind）。 */
export const EVENT_KINDS = ['once', 'daily', 'weekly'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const DAY = 86_400;

/** 期間の内か（始まりを含み、終わりを含まない）。 */
export function isOpen(startsAt: number, endsAt: number, now: number): boolean {
  return startsAt <= now && now < endsAt;
}

/** 時差を足した時刻の、1970-01-01 からの日の番号（UTC の日付として数える）。 */
function localDay(now: number, offsetMinutes: number): number {
  return Math.floor((now + offsetMinutes * 60) / DAY);
}

/** 日の番号の日付 `YYYY-MM-DD`。 */
function dateOf(day: number): string {
  return new Date(day * DAY * 1000).toISOString().slice(0, 10);
}

/** その日を含む週の月曜の日の番号（1970-01-01 は木曜）。 */
function mondayOf(day: number): number {
  return day - (((day + 3) % 7) + 7) % 7;
}

/** いまの区切りの鍵。once → 'once'、daily → 時差の日付、weekly → 時差でその日を含む週の月曜の日付。 */
export function periodKey(kind: EventKind, now: number, offsetMinutes: number): string {
  if (kind === 'once') return 'once';
  const day = localDay(now, offsetMinutes);
  return dateOf(kind === 'daily' ? day : mondayOf(day));
}

/** 次の区切りの時刻（UNIX 秒）。daily → 次の時差の 0 時、weekly → 次の時差の月曜 0 時。endsAt を越えるなら endsAt。once → null。 */
export function nextResetAt(kind: EventKind, now: number, offsetMinutes: number, endsAt: number): number | null {
  if (kind === 'once') return null;
  const day = localDay(now, offsetMinutes);
  const nextDay = kind === 'daily' ? day + 1 : mondayOf(day) + 7;
  return Math.min(nextDay * DAY - offsetMinutes * 60, endsAt);
}

/** UNIX 秒を ISO 8601 の UTC（秒まで。`2026-10-30T15:30:00Z`）に直す。 */
export function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
