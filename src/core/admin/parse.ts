// parse.ts — 管理の口の問い合わせと本文の確かめ。入出力を持たない（外れは使う側が 400 INVALID_ARGUMENT にする）。
//
// いまは監査を読む口の limit・before（受領の履歴の parseHistoryQuery と同じ形）と、プレイヤーを読む口の履歴の行の数と、
// BAN の本文の期限（expiresAt）と、所持品と通貨の増減の本文（itemId・delta）と、品目の種類（parseItemKind）とイベントの定義の本文
// （parseEventDefinition。区切り・期間・時差・報酬の行）と、プレイヤーデータのキーの宣言（parsePlayerDataKey。表 player_data_keys の
// CHECK と同じ決まりを先に見て、DB の CHECK で落ちて 500 にしない）・実績の宣言（parseAchievement）・値を置く本文（parsePlayerDataValue）。
// 書き込みの口に共通の X-Admin-Actor・reason は audit.ts。
// 正は docs/guides/working/admin-design.md §2・§4〜§7 と docs/guides/working/player-data-design.md §8。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { validId } from '../ids';
import { ITEM_KINDS, MAX_ITEM_AMOUNT, MAX_REWARD_LINES, type ItemKind } from '../inventory';
import { MAX_PLAYER_DATA_VALUE, PLAYER_DATA_MODES, type PlayerDataKey, type PlayerDataMode } from '../player-data';

/** 監査を読む口の limit の既定と上限。 */
export const AUDIT_LIMIT_DEFAULT = 20;
export const AUDIT_LIMIT_MAX = 100;
/** プレイヤーを読む口が返す受領の履歴の行の数（新しい順）。 */
export const PLAYER_HISTORY_ROWS = 20;

export type PageQuery = { limit: number; before: number | null };
export type PageQueryResult = { ok: true; value: PageQuery } | { ok: false; message: string };

/** 数字だけの文字列を 1 以上の安全な整数に直す。外れは null。 */
function positiveInteger(raw: string): number | null {
  if (!/^[0-9]{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/** 監査を読む口の問い合わせを読む。limit は 1〜AUDIT_LIMIT_MAX（無ければ AUDIT_LIMIT_DEFAULT）、before は 1 以上の整数か無し。 */
export function parseAuditQuery(url: URL): PageQueryResult {
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? AUDIT_LIMIT_DEFAULT : positiveInteger(rawLimit);
  if (limit === null || limit > AUDIT_LIMIT_MAX) {
    return { ok: false, message: `limit must be an integer 1..${AUDIT_LIMIT_MAX}` };
  }
  const rawBefore = url.searchParams.get('before');
  const before = rawBefore === null ? null : positiveInteger(rawBefore);
  if (rawBefore !== null && before === null) return { ok: false, message: 'before must be a positive integer' };
  return { ok: true, value: { limit, before } };
}

export type ExpiresAtResult = { ok: true; value: number | null } | { ok: false; message: string };

const isoUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** ISO 8601 の UTC の文字列を UNIX 秒にする（ミリ秒は切り捨て）。形の誤り・無い日付は null。 */
function isoToSeconds(value: unknown): number | null {
  if (typeof value !== 'string' || !isoUtc.test(value)) return null;
  const ms = Date.parse(value);
  // 2026-02-30 のような日付は Date が繰り上げるので、読み直して同じ日時かで見分ける
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return null;
  return Math.floor(ms / 1000);
}

/** BAN の本文の expiresAt を UNIX 秒にする（ミリ秒は切り捨て）。無いか null はずっと（null）。形の誤り・now より後でない値は外れ。 */
export function parseExpiresAt(value: unknown, now: number): ExpiresAtResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  const seconds = isoToSeconds(value);
  return seconds !== null && seconds > now
    ? { ok: true, value: seconds }
    : { ok: false, message: 'expiresAt must be a future ISO 8601 UTC time' };
}

export type AdjustmentBody = { itemId: string; delta: number };
export type AdjustmentResult = { ok: true; value: AdjustmentBody } | { ok: false; message: string };

/** 増減の本文の itemId と delta を確かめる。delta は 0 でない整数で、絶対値が MAX_ITEM_AMOUNT 以下（負は取り消し）。 */
export function parseAdjustment(body: Record<string, unknown>): AdjustmentResult {
  if (!validId(body.itemId)) return { ok: false, message: 'Invalid itemId' };
  const delta = body.delta;
  if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_ITEM_AMOUNT) {
    return { ok: false, message: `delta must be a non-zero integer within ±${MAX_ITEM_AMOUNT}` };
  }
  return { ok: true, value: { itemId: body.itemId, delta } };
}

/** 品目の定義の本文の kind（currency か item）を確かめる。外れは null。 */
export function parseItemKind(value: unknown): ItemKind | null {
  return (ITEM_KINDS as readonly unknown[]).includes(value) ? value as ItemKind : null;
}

/** イベントの区切り（表 events の kind）。src/modules/events/period.ts の EVENT_KINDS と同じ（core は modules を読み込まない）。 */
export const EVENT_DEFINITION_KINDS = ['once', 'daily', 'weekly'] as const;
/** 区切りの時差（分）の範囲（migrations/0010_events.sql の CHECK と同じ）。 */
export const MIN_RESET_OFFSET_MINUTES = -720;
export const MAX_RESET_OFFSET_MINUTES = 840;

export type EventReward = { itemId: string; amount: number };
export type EventDefinition = {
  kind: (typeof EVENT_DEFINITION_KINDS)[number]; startsAt: number; endsAt: number; resetOffsetMinutes: number; rewards: EventReward[];
};
export type EventDefinitionResult = { ok: true; value: EventDefinition } | { ok: false; message: string };

/**
 * イベントの定義の本文を確かめる。kind は once・daily・weekly、startsAt < endsAt（ISO 8601 の UTC。秒に丸める）、
 * resetOffsetMinutes は -720〜840 の整数（無ければ 0）、rewards は 1〜MAX_REWARD_LINES 行で品目が重ならず、amount は 1〜MAX_ITEM_AMOUNT。
 * 時刻は UNIX 秒、報酬は品目の ID の昇順にして返す。品目があるか・受け取りがあるかは DB を引く使う側が見る。
 */
export function parseEventDefinition(body: Record<string, unknown>): EventDefinitionResult {
  const kind = body.kind;
  if (!(EVENT_DEFINITION_KINDS as readonly unknown[]).includes(kind)) return { ok: false, message: 'kind must be once, daily or weekly' };
  const startsAt = isoToSeconds(body.startsAt);
  const endsAt = isoToSeconds(body.endsAt);
  if (startsAt === null || endsAt === null) return { ok: false, message: 'startsAt and endsAt must be ISO 8601 UTC times' };
  if (startsAt >= endsAt) return { ok: false, message: 'startsAt must be before endsAt' };
  const offset = body.resetOffsetMinutes ?? 0;
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < MIN_RESET_OFFSET_MINUTES || offset > MAX_RESET_OFFSET_MINUTES) {
    return { ok: false, message: `resetOffsetMinutes must be an integer ${MIN_RESET_OFFSET_MINUTES}..${MAX_RESET_OFFSET_MINUTES}` };
  }
  const lines = body.rewards;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_REWARD_LINES) {
    return { ok: false, message: `rewards must have 1..${MAX_REWARD_LINES} lines` };
  }
  const rewards: EventReward[] = [];
  for (const line of lines) {
    const { itemId, amount } = (typeof line === 'object' && line !== null ? line : {}) as Record<string, unknown>;
    if (!validId(itemId)) return { ok: false, message: 'Invalid reward itemId' };
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > MAX_ITEM_AMOUNT) {
      return { ok: false, message: `reward amount must be an integer 1..${MAX_ITEM_AMOUNT}` };
    }
    if (rewards.some((r) => r.itemId === itemId)) return { ok: false, message: 'reward items must not repeat' };
    rewards.push({ itemId, amount });
  }
  rewards.sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
  return { ok: true, value: { kind: kind as EventDefinition['kind'], startsAt, endsAt, resetOffsetMinutes: offset, rewards } };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** lo〜hi の整数か。 */
function integerWithin(value: unknown, lo: number, hi: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= lo && value <= hi;
}

/**
 * キーの宣言の本文を確かめる（表 player_data_keys の CHECK と同じ決まり）。mode は add・max・set・flag、maxValue は 1〜MAX_PLAYER_DATA_VALUE
 * （flag は 1 だけ）、maxDelta は add のときだけ必須で 1〜MAX_PLAYER_DATA_VALUE、ほかの書き方では送らない（null は送らないと同じ）。
 */
export function parsePlayerDataKey(body: Record<string, unknown>): Parsed<Omit<PlayerDataKey, 'key'>> {
  const mode = body.mode;
  if (!(PLAYER_DATA_MODES as readonly unknown[]).includes(mode)) return { ok: false, message: 'mode must be add, max, set or flag' };
  const maxValue = body.maxValue;
  if (!integerWithin(maxValue, 1, MAX_PLAYER_DATA_VALUE)) return { ok: false, message: `maxValue must be an integer 1..${MAX_PLAYER_DATA_VALUE}` };
  if (mode === 'flag' && maxValue !== 1) return { ok: false, message: 'maxValue of a flag key must be 1' };
  const maxDelta = body.maxDelta ?? null;
  if (mode === 'add') {
    if (!integerWithin(maxDelta, 1, MAX_PLAYER_DATA_VALUE)) return { ok: false, message: `maxDelta must be an integer 1..${MAX_PLAYER_DATA_VALUE}` };
  } else if (maxDelta !== null) {
    return { ok: false, message: 'maxDelta is only for add keys' };
  }
  return { ok: true, value: { mode: mode as PlayerDataMode, maxValue, maxDelta: maxDelta as number | null } };
}

/** 実績の宣言の本文を確かめる。key は ID の形、threshold は 1〜MAX_PLAYER_DATA_VALUE の整数。キーの宣言があるかは DB を引く使う側が見る。 */
export function parseAchievement(body: Record<string, unknown>): Parsed<{ key: string; threshold: number }> {
  if (!validId(body.key)) return { ok: false, message: 'Invalid key' };
  if (!integerWithin(body.threshold, 1, MAX_PLAYER_DATA_VALUE)) {
    return { ok: false, message: `threshold must be an integer 1..${MAX_PLAYER_DATA_VALUE}` };
  }
  return { ok: true, value: { key: body.key, threshold: body.threshold } };
}

/** 値を置く本文の value を確かめる（0〜MAX_PLAYER_DATA_VALUE の整数）。キーの maxValue 以下かは宣言を読む使う側が見る。 */
export function parsePlayerDataValue(body: Record<string, unknown>): Parsed<number> {
  return integerWithin(body.value, 0, MAX_PLAYER_DATA_VALUE)
    ? { ok: true, value: body.value }
    : { ok: false, message: `value must be an integer 0..${MAX_PLAYER_DATA_VALUE}` };
}
