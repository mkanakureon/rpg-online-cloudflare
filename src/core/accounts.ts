// accounts.ts — ゲストの発行（POST /v1/accounts/guest）のルートと、その本文の検証。
//
// 検査の順は docs/guides/working/account-design.md §3: APP_ENV=local の門（本文を読む前）→ JSON → 本文の形
// → ゲームの登録（game_modules は見ない。アカウントはどのゲームにも要る土台）→ 鍵 → accounts と game_players に
// 1 行ずつ（batch で両方か無し）→ トークン。応答・トークン・ログに account_id を出さない。
// モジュールでなく core に置き、src/core/router.ts が /health の次に当てる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { loadGame } from './games';
import { requireLocalWrite } from './guards';
import { error, json } from './http';
import { validId } from './ids';
import type { Route } from './module';
import { signToken, tokenSecret, TOKEN_TTL_SECONDS } from './token';

/** 本文の形を確かめる（知らない欄は無視する）。 */
export function parseGuestRequest(value: unknown): { ok: true; gameId: string } | { ok: false; message: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, message: 'Request body must be an object' };
  const { gameId } = value as Record<string, unknown>;
  if (!validId(gameId)) return { ok: false, message: 'Invalid gameId' };
  return { ok: true, gameId };
}

export const guestRoute: Route = {
  method: 'POST',
  pattern: /^\/v1\/accounts\/guest$/,
  async handle(req, env, _match, _url, known) {
    const blocked = requireLocalWrite(env);
    if (blocked) return blocked;
    let value: unknown;
    try { value = await req.json(); }
    catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
    const parsed = parseGuestRequest(value);
    if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
    const { gameId } = parsed;
    if (!await loadGame(env.DB, gameId, known)) return error('NOT_FOUND', 'Unknown game', 404);
    const secret = tokenSecret(env);
    // 鍵の値はメッセージに入れない。入口の try/catch が 500 INTERNAL_ERROR にする
    if (!secret) throw new Error('Token signing secret is not configured');
    const accountId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (account_id) VALUES (?)').bind(accountId),
      env.DB.prepare('INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, ?, ?)').bind(gameId, playerId, accountId),
    ]);
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    const token = await signToken({ gameId, playerId, exp }, secret);
    return json({ gameId, playerId, token, expiresAt: new Date(exp * 1000).toISOString() });
  },
};
