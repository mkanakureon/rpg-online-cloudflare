// auth.ts — 書き込みの要求のトークン（Authorization: Bearer）を確かめ、本文のゲームとプレイヤーと突き合わせる。
//
// 検査の順の正は docs/guides/working/account-design.md §5。requireAuth は APP_ENV=local の門（guards.ts）の後・
// 本文を読む前に呼び、DB を引かない（トークンは自己完結）。外れた理由（malformed・bad_signature）と鍵は応答に入れない。
// requireSamePlayer は本文の検証の後に呼び、トークンと違うゲームかプレイヤーへの書き込み（なりすまし）を 403 にする。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Env } from './env';
import { error } from './http';
import { parseBearer, tokenSecret, verifyToken, type TokenClaims } from './token';

export type AuthResult = { ok: true; claims: TokenClaims } | { ok: false; response: Response };

/** Authorization のトークンを確かめる。通ればトークンの中身、通らなければ 401（鍵が無ければ投げて 500）。 */
export async function requireAuth(req: Request, env: Env, nowSeconds = Math.floor(Date.now() / 1000)): Promise<AuthResult> {
  const token = parseBearer(req.headers.get('Authorization'));
  if (token === null) return { ok: false, response: error('UNAUTHENTICATED', 'Missing or malformed Authorization', 401) };
  const secret = tokenSecret(env);
  // 鍵の値はメッセージに入れない。入口の try/catch が 500 INTERNAL_ERROR にする
  if (!secret) throw new Error('Token signing secret is not configured');
  const verified = await verifyToken(token, secret, nowSeconds);
  if (verified.ok) return { ok: true, claims: verified.claims };
  if (verified.reason === 'expired') return { ok: false, response: error('TOKEN_EXPIRED', 'Token expired', 401) };
  return { ok: false, response: error('UNAUTHENTICATED', 'Invalid token', 401) };
}

/** 本文の gameId・playerId がトークンと同じなら null、違えば 403 PERMISSION_DENIED。 */
export function requireSamePlayer(claims: TokenClaims, gameId: string, playerId: string): Response | null {
  if (claims.gameId !== gameId || claims.playerId !== playerId) {
    return error('PERMISSION_DENIED', 'Token does not match player', 403);
  }
  return null;
}
