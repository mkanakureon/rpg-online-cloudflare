// idempotency.ts — 二重の止めの Idempotency-Key の形と確かめ・本文のハッシュ（SHA-256 の 16 進。定義は hash.ts）。入出力を持たない。
//
// 管理の増減（src/core/admin/。鍵とハッシュは admin_audit_log の列）とプレイヤーデータの書き込み（src/modules/player-data/。
// 鍵とハッシュは player_data_writes の列）の両方が読む。モジュールが src/core/admin/ を読み込まないように core に置く。
// 同じ鍵で違う中身は、どちらも 422 IDEMPOTENCY_KEY_REUSED。形の正は docs/guides/working/admin-design.md §6 と
// docs/guides/working/player-data-design.md §6。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

/** Idempotency-Key の形（必須の口だけが読む）。 */
export const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/** Idempotency-Key の値を確かめる。外れ（無い・形の誤り）は null。 */
export function parseIdempotencyKey(raw: string | null): string | null {
  return raw !== null && IDEMPOTENCY_KEY_PATTERN.test(raw) ? raw : null;
}

/** request_hash に入れるハッシュ（SHA-256 の小文字の 16 進）。定義は src/core/hash.ts（ここから出し直す）。 */
export { sha256Hex } from './hash';
