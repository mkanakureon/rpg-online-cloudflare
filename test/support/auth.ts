/**
 * 試験の手伝い: スコアの投稿に付ける Authorization（Bearer のトークン）を作る。
 * トークンは src/core/token.ts の signToken と、既定では LOCAL_DEV_TOKEN_SECRET（localEnv で使われる鍵）で作る。
 * gameId か playerId が validId に合わない（本文がオブジェクトでない等）ときは demo-rpg・p1 のトークンにする
 * （形の正しくない ID のトークンは malformed の 401 になり、本文の検証の 400 に届かないため）。
 * 使い方の正は docs/guides/working/account-design.md §4・§7。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { validId } from '../../src/core/ids';
import { LOCAL_DEV_TOKEN_SECRET, signToken, TOKEN_TTL_SECONDS } from '../../src/core/token';

export type TokenOptions = { exp?: number; secret?: string };

/** gameId・playerId のトークンを作る（期限は今から 30 日・鍵は既定のローカルの鍵）。 */
export function tokenFor(gameId: unknown, playerId: unknown, options: TokenOptions = {}): Promise<string> {
  const exp = options.exp ?? Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return signToken({
    gameId: validId(gameId) ? gameId : 'demo-rpg',
    playerId: validId(playerId) ? playerId : 'p1',
    exp,
  }, options.secret ?? LOCAL_DEV_TOKEN_SECRET);
}

/** Authorization の値（`Bearer <トークン>`）を作る。 */
export async function bearer(gameId: unknown, playerId: unknown, options: TokenOptions = {}): Promise<string> {
  return `Bearer ${await tokenFor(gameId, playerId, options)}`;
}

/** 本文（オブジェクトか JSON の文字列）の gameId・playerId から Authorization の値を作る。読めなければ demo-rpg・p1。 */
export function bearerForBody(body: unknown): Promise<string> {
  let value = body;
  if (typeof body === 'string') {
    try { value = JSON.parse(body); }
    catch { value = null; }
  }
  const fields = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return bearer(fields.gameId, fields.playerId);
}
