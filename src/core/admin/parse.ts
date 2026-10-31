// parse.ts — 管理の口の問い合わせと本文の確かめ。入出力を持たない（外れは使う側が 400 INVALID_ARGUMENT にする）。
//
// いまは監査を読む口の limit・before（受領の履歴の parseHistoryQuery と同じ形）と、プレイヤーを読む口の履歴の行の数と、
// BAN の本文の期限（expiresAt）と、所持品と通貨の増減の本文（itemId・delta）。品目・イベントの定義の本文の確かめは、その束でここに足す。
// 書き込みの口に共通の X-Admin-Actor・reason は audit.ts。正は docs/guides/working/admin-design.md §2・§4・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { validId } from '../ids';
import { MAX_ITEM_AMOUNT } from '../inventory';

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

/** BAN の本文の expiresAt を UNIX 秒にする（ミリ秒は切り捨て）。無いか null はずっと（null）。形の誤り・now より後でない値は外れ。 */
export function parseExpiresAt(value: unknown, now: number): ExpiresAtResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  const message = 'expiresAt must be a future ISO 8601 UTC time';
  if (typeof value !== 'string' || !isoUtc.test(value)) return { ok: false, message };
  const ms = Date.parse(value);
  // 2026-02-30 のような日付は Date が繰り上げるので、読み直して同じ日時かで見分ける
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) return { ok: false, message };
  const seconds = Math.floor(ms / 1000);
  return seconds > now ? { ok: true, value: seconds } : { ok: false, message };
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
