// parse.ts — 管理の口の問い合わせと本文の確かめ。入出力を持たない（外れは使う側が 400 INVALID_ARGUMENT にする）。
//
// いまは監査を読む口の limit・before（受領の履歴の parseHistoryQuery と同じ形）と、プレイヤーを読む口の履歴の行の数。
// BAN・増減・品目・イベントの定義の本文の確かめは、その束でここに足す。正は docs/guides/working/admin-design.md §2・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

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
