// validate.ts — ランキングの入力の検証（limit とスコアの投稿の本文）。入出力を持たない。
//
// src/modules/rankings/index.ts が要求から値を取り出してここを呼び、外れなら 400 にする。
// 合否の境目（limit 1〜50・スコア 0〜10 億・表示名 1〜40 文字）は src/worker.ts から移したまま。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { validId } from '../../core/ids';

export type ScoreSubmission = {
  gameId: string;
  playerId: string;
  displayName: string;
  score: number;
};
export type ScoreSubmissionResult =
  | { ok: true; value: ScoreSubmission }
  | { ok: false; message: 'Object required' | 'Invalid ranking payload' };

/** `limit` の生の値（無ければ null）を 1〜50 の整数にする。外れは null。無ければ 10。 */
export function parseLimit(raw: string | null): number | null {
  const rawLimit = raw ?? '10';
  const limit = Number(rawLimit);
  if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  return limit;
}

/** JSON を読んだ後の本文を確かめる。通れば知っている 4 つの欄だけを返す。 */
export function parseScoreSubmission(value: unknown): ScoreSubmissionResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, message: 'Object required' };
  }
  const input = value as Record<string, unknown>;
  const { gameId, playerId, displayName, score } = input;
  if (!validId(gameId) || !validId(playerId)
    || typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 40
    || !Number.isSafeInteger(score) || (score as number) < 0 || (score as number) > 1_000_000_000) {
    return { ok: false, message: 'Invalid ranking payload' };
  }
  return { ok: true, value: { gameId, playerId, displayName, score: score as number } };
}
