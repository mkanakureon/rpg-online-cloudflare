// accounts.ts — ゲストの発行（POST /v1/accounts/guest）のルートと、その本文の検証。
//
// 検査の順は docs/guides/working/account-design.md §3 と abuse-protection-design.md §3: APP_ENV=local の門（本文を読む前）
// → IP ごとの利用制限（本文を読む前。429）→ 本文の大きさ（413。src/core/body.ts）→ JSON → 本文の形 → ゲームの登録（game_modules は見ない。アカウントはどのゲームにも
// 要る土台）→ ゲームごとの利用制限（429）→ 鍵 → accounts と game_players と、発行の日の遊んだ行（player_activity_days の is_new = 1。
// docs/guides/working/analytics-design.md §4）に 1 行ずつ（batch で全部か無し）→ トークン。応答・トークン・ログに account_id を出さない。
// トークンの更新（POST /v1/accounts/token。refreshRoute）も同じファイルに置く。確かめの順はほかのトークンの口と同じ:
// APP_ENV=local の門 → トークン（requireAuth。期限切れは 401 TOKEN_EXPIRED・壊れたものは 401 UNAUTHENTICATED）→ プレイヤーごとの
// 利用制限（RATE_LIMITS.tokenRefresh）→ 止めた印（403 PLAYER_BANNED）→ 同じ g・p で期限を更新した時刻から 30 日先にした新しいトークン
// （署名はいまの鍵だけ。前の鍵で確かめたトークンも、ここでいまの鍵のトークンになる）。
// 本文は読まない。表は足さず（トークンは自己完結のまま）、遊んだ記録にも数えない。設計の正は client-integration-design.md §2.7。
// モジュールでなく core に置き、src/core/router.ts が /health の次に当てる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { activityDay } from './activity';
import { requireAuth } from './auth';
import { requireNotBanned } from './bans';
import { MAX_JSON_BODY_BYTES, readJson } from './body';
import { loadGame } from './games';
import { requireLocalWrite } from './guards';
import { error, json } from './http';
import { validId } from './ids';
import type { Route } from './module';
import { consume, ipSubject } from './rate-limit';
import { RATE_LIMITS } from './rate-limit-policy';
import { signToken, tokenSecret, TOKEN_TTL_SECONDS } from './token';
import { serverNow } from './clock';

/** トークンの本文（g・p）と発行の時刻から、応答の本文（ゲストの発行と同じ形）を作る。期限は now から TOKEN_TTL_SECONDS 先。 */
async function issueToken(gameId: string, playerId: string, now: number, secret: string) {
  const exp = now + TOKEN_TTL_SECONDS;
  const token = await signToken({ gameId, playerId, exp }, secret);
  return { gameId, playerId, token, expiresAt: new Date(exp * 1000).toISOString() };
}

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
    const ipLimited = await consume(env.DB, RATE_LIMITS.guestIp, await ipSubject(req, env));
    if (ipLimited) return ipLimited;
    const body = await readJson(req, MAX_JSON_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = parseGuestRequest(body.value);
    if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
    const { gameId } = parsed;
    if (!await loadGame(env.DB, gameId, known)) return error('NOT_FOUND', 'Unknown game', 404);
    const gameLimited = await consume(env.DB, RATE_LIMITS.guestGame, gameId);
    if (gameLimited) return gameLimited;
    const secret = tokenSecret(env);
    // 鍵の値はメッセージに入れない。入口の try/catch が 500 INTERNAL_ERROR にする
    if (!secret) throw new Error('Token signing secret is not configured');
    const accountId = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    const now = serverNow();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO accounts (account_id) VALUES (?)').bind(accountId),
      env.DB.prepare('INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, ?, ?)').bind(gameId, playerId, accountId),
      // 発行の日の遊んだ行（新しい人。新しいプレイヤーなので衝突しない）
      env.DB.prepare('INSERT INTO player_activity_days (game_id, day, player_id, is_new) VALUES (?, ?, ?, 1)')
        .bind(gameId, activityDay(now), playerId),
    ]);
    return json(await issueToken(gameId, playerId, now, secret));
  },
};

export const refreshRoute: Route = {
  method: 'POST',
  pattern: /^\/v1\/accounts\/token$/,
  async handle(req, env) {
    const blocked = requireLocalWrite(env);
    if (blocked) return blocked;
    const now = serverNow();
    const auth = await requireAuth(req, env, now);
    if (!auth.ok) return auth.response;
    const { gameId, playerId } = auth.claims;
    const limited = await consume(env.DB, RATE_LIMITS.tokenRefresh, `${gameId}:${playerId}`, now);
    if (limited) return limited;
    const banned = await requireNotBanned(env, auth.claims, now);
    if (banned) return banned;
    const secret = tokenSecret(env);
    // requireAuth が鍵の無いときに投げるので、ここに来るときは必ずある
    if (!secret) throw new Error('Token signing secret is not configured');
    return json(await issueToken(gameId, playerId, now, secret));
  },
};
