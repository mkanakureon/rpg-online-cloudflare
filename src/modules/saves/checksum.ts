// checksum.ts — セーブの本体（data）のチェックサム（SHA-256 の小文字の 16 進）を計算する。
//
// 入力は data の UTF-8 のバイト列（JSON に包む前の文字列）。計算は src/core/hash.ts の sha256Hex（Workers の Web Crypto。
// パッケージを足さない）で、ここから出し直す（試験と saves/index.ts が読む名前）。クライアント（scripts/cli-requests.mjs の sha256Hex）も同じ算法で計算する。
// 算法と試験の値の正は docs/guides/working/save-design.md §5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** text の UTF-8 のバイト列の SHA-256 を小文字の 16 進 64 文字で返す。 */
export { sha256Hex } from '../../core/hash';
