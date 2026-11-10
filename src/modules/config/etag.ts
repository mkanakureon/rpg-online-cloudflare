// etag.ts — 設定の応答の ETag（本文の SHA-256）と、If-None-Match が合うかの判定。
//
// ETag は本文の UTF-8 の SHA-256 の小文字の 16 進（src/core/hash.ts の sha256Hex）を引用符で囲んだ強い ETag
// （パッケージを足さない）。
// 決まりの正は docs/guides/working/config-design.md §3。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { sha256Hex } from '../../core/hash';

/** 本文の ETag（"<64 文字の 16 進>"）。 */
export async function etagOf(body: string): Promise<string> {
  return `"${await sha256Hex(body)}"`;
}

/** If-None-Match の値が etag に合うか。* と , で区切った複数と W/ の弱い印を扱う（比べるのは弱い比べ）。 */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const bare = (tag: string) => (tag.startsWith('W/') ? tag.slice(2) : tag);
  return header.split(',').map((t) => t.trim()).some((t) => t === '*' || bare(t) === bare(etag));
}
