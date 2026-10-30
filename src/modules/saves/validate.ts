// validate.ts — セーブの書き込みの本文の検証と、data の大きさの数え方。入出力を持たない。
//
// src/modules/saves/index.ts が JSON を読んだ後の本文（と削除の問い合わせの baseRevision）をここに渡し、外れなら 400 INVALID_ARGUMENT にする。
// 欄の範囲の正は docs/guides/working/save-design.md §3 の検査の順 9。data の中身は見ない（解釈しない）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export type SaveWrite = {
  formatVersion: number;
  data: string;
  checksum: string;
  baseRevision: number;
};
export type SaveWriteResult = { ok: true; value: SaveWrite } | { ok: false; message: string };

const MAX_FORMAT_VERSION = 2_147_483_647;
const checksumPattern = /^[0-9a-f]{64}$/;

/** JSON を読んだ後の本文を確かめる。通れば知っている 4 つの欄だけを返す（知らない欄は捨てる）。 */
export function parseSaveWrite(value: unknown): SaveWriteResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'Object required' };
  }
  const { formatVersion, data, checksum, baseRevision } = value as Record<string, unknown>;
  if (!Number.isInteger(formatVersion) || (formatVersion as number) < 1 || (formatVersion as number) > MAX_FORMAT_VERSION) {
    return { ok: false, message: 'formatVersion must be an integer 1..2147483647' };
  }
  if (typeof data !== 'string') return { ok: false, message: 'data must be a string' };
  if (typeof checksum !== 'string' || !checksumPattern.test(checksum)) {
    return { ok: false, message: 'checksum must be 64 lowercase hex characters' };
  }
  if (!Number.isSafeInteger(baseRevision) || (baseRevision as number) < 0) {
    return { ok: false, message: 'baseRevision must be a non-negative integer' };
  }
  return { ok: true, value: { formatVersion: formatVersion as number, data, checksum, baseRevision: baseRevision as number } };
}

/** text の UTF-8 のバイト数。 */
export function utf8Size(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 削除の問い合わせの baseRevision（数字だけの文字列）を 1 以上の安全な整数に直す。外れは null。 */
export function parseRevision(raw: string | null): number | null {
  if (raw === null || !/^[0-9]{1,16}$/.test(raw)) return null;
  const revision = Number(raw);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}
