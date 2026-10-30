// checksum.ts — セーブの本体（data）のチェックサム（SHA-256 の小文字の 16 進）を計算する。
//
// 入力は data の UTF-8 のバイト列（JSON に包む前の文字列）。Workers の Web Crypto（crypto.subtle.digest）で計算し、
// パッケージを足さない。クライアント（scripts/cli-requests.mjs の sha256Hex）も同じ算法で計算する。
// 算法と試験の値の正は docs/guides/working/save-design.md §5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** text の UTF-8 のバイト列の SHA-256 を小文字の 16 進 64 文字で返す。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
