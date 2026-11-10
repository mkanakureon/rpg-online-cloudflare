// query.ts — 問い合わせの数の値（limit・before など）を読む。入出力を持たない。
//
// 受領の履歴の問い合わせ（src/modules/inventory/shape.ts の parseHistoryQuery）と、管理の監査を読む口の問い合わせ
// （src/core/admin/parse.ts の parseAuditQuery）が読む。外れ（null）を 400 INVALID_ARGUMENT にするのは使う側。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10

/** 数字だけの文字列を 1 以上の安全な整数に直す。外れは null。 */
export function positiveInteger(raw: string): number | null {
  if (!/^[0-9]{1,16}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
