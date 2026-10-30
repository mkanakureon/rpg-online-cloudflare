// ids.ts — gameId・playerId などの ID の形（英数字・ハイフン・下線の 1〜64 文字）の検証。
//
// 入出力を持たないふつうの関数。ボードの ID はルートの pattern が同じ形で当てる
// （src/modules/rankings/index.ts）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;

export function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}
