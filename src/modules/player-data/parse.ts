// parse.ts — プレイヤーデータの書き込みの本文の形の確かめ（parseChanges）と、二重の止めに使う中身のハッシュ（writeRequestHash）。
//
// どちらも DB を読まない（キーの宣言と書き方の範囲は index.ts が宣言を読んでから src/core/player-data.ts の checkChange で見る）。
// 本文の changes 以外の欄（時刻・実績の申告など）は読まない。ハッシュは changes をキーの昇順に並べ直して作るので、並びだけ違う
// 同じ本文は同じ書き込みとみなす。決まりの正は docs/guides/working/player-data-design.md §4・§6。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { validId } from '../../core/ids';
import { sha256Hex } from '../../core/idempotency';
import { MAX_CHANGES_PER_WRITE } from './limits';

/** 1 つの変更（宣言したキーと、書き方で意味の決まる整数）。 */
export type Change = { key: string; value: number };
export type ChangesResult = { ok: true; value: Change[] } | { ok: false; message: string };

/** 本文の changes を確かめる。1〜MAX_CHANGES_PER_WRITE 行・キーが ID の形で重ならない・value が安全な整数。外れは 400 の文。 */
export function parseChanges(body: unknown): ChangesResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, message: 'Body must be an object' };
  const changes = (body as Record<string, unknown>).changes;
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MAX_CHANGES_PER_WRITE) {
    return { ok: false, message: `changes must have 1 to ${MAX_CHANGES_PER_WRITE} entries` };
  }
  const seen = new Set<string>();
  const out: Change[] = [];
  for (const c of changes) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return { ok: false, message: 'Each change must be an object' };
    const { key, value } = c as Record<string, unknown>;
    if (!validId(key)) return { ok: false, message: 'Invalid key' };
    if (seen.has(key)) return { ok: false, message: 'Duplicate key' };
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) return { ok: false, message: 'value must be an integer' };
    seen.add(key);
    out.push({ key, value });
  }
  return { ok: true, value: out };
}

/** 中身（gameId と、キーの昇順に並べ直した changes）を決まった順の JSON にして SHA-256（16 進）にする。 */
export function writeRequestHash(gameId: string, changes: readonly Change[]): Promise<string> {
  const sorted = [...changes].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((c) => ({ key: c.key, value: c.value }));
  return sha256Hex(JSON.stringify({ gameId, changes: sorted }));
}
