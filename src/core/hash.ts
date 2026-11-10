// hash.ts — 文字列の UTF-8 のバイト列の SHA-256 を小文字の 16 進にする。入出力を持たない（Workers の Web Crypto だけ）。
//
// セーブのチェックサム（src/modules/saves/checksum.ts が出し直す）・設定の ETag（src/modules/config/etag.ts）・
// 二重の止めの中身のハッシュ（src/core/idempotency.ts が出し直す）・利用制限の IP の鍵（src/core/rate-limit.ts）が読む。
// 管理の鍵の比べ（src/core/admin/key.ts）は 16 進にせず生のバイト列を timingSafeEqual で比べるので、ここを使わない。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10

/** text の UTF-8 のバイト列の SHA-256 を小文字の 16 進 64 文字で返す。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
