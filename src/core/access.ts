// access.ts — プレイヤーのトークンで呼ぶ機能の口が、本文を読む前に通る確かめ（checkPlayerAccess）。
//
// 順: APP_ENV=local の門（403 NOT_READY_FOR_PRODUCTION）→ トークン（401）→ プレイヤーの利用制限（429。規則は呼ぶ側が渡す）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形（400）→ トークンのゲームとの突き合わせ（403）→ 渡されたときだけゲームの登録と
// 機能の設定（404）。セーブ・所持品・イベント・プレイヤーデータ・クエストのモジュールが呼ぶ（セーブは機能の設定を後で見るので渡さない）。
// 利用制限はトークンのプレイヤーで数え（偽れない鍵）、断った要求も数える。止めた印は数えた後に見る（理由・期限は返さない）。
// 順の正は docs/guides/working/core-foundation-design.md §1 と docs/guides/working/abuse-protection-design.md §3。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import { consumeForPlayer } from './activity';
import { requireAuth } from './auth';
import { requireNotBanned } from './bans';
import type { Env } from './env';
import { requireGame } from './games';
import { requireLocalWrite } from './guards';
import { error } from './http';
import { validId } from './ids';
import type { RateLimitRule } from './rate-limit-policy';
import type { TokenClaims } from './token';

export type PlayerAccess = { ok: true; claims: TokenClaims; gameId: string } | { ok: false; response: Response };

/** ゲームの登録と機能の設定を見るときに渡す（機能の名前と、入口から受け取った既知の機能の名前）。 */
export type FeatureCheck = { name: string; known: readonly string[] };

/** 本文を読む前の確かめ。通ればトークンの中身と gameId、通らなければ断る応答。 */
export async function checkPlayerAccess(
  req: Request, env: Env, url: URL, rule: RateLimitRule, feature?: FeatureCheck,
): Promise<PlayerAccess> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const auth = await requireAuth(req, env);
  if (!auth.ok) return auth;
  const limited = await consumeForPlayer(env.DB, rule, auth.claims);
  if (limited) return { ok: false, response: limited };
  const banned = await requireNotBanned(env, auth.claims);
  if (banned) return { ok: false, response: banned };
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (auth.claims.gameId !== gameId) {
    return { ok: false, response: error('PERMISSION_DENIED', 'Token does not match game', 403) };
  }
  if (feature) {
    const unknown = await requireGame(env, gameId, feature.name, feature.known);
    if (unknown) return { ok: false, response: unknown };
  }
  return { ok: true, claims: auth.claims, gameId };
}
