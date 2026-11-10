// token.ts — トークン（v1.<本文>.<HMAC-SHA256>）の署名・確かめ・Authorization の読み取り・鍵の選び方。
//
// 入出力は Workers の Web Crypto（crypto.subtle）だけのふつうの関数。パッケージを足さない。形と確かめの順の正は
// docs/guides/working/account-design.md §4。本文は {"g","p","exp"} の JSON を base64url にしたもので、
// account_id は入れない（本文はクライアントが読める）。時刻は引数で受け取る（試験で動かすため）。
// 発行は src/core/accounts.ts、書き込みの確かめは src/core/auth.ts（A2）が使う。
// 鍵の取り替えの重なり: 署名はいまの鍵（tokenSecret）だけ、確かめはいまの鍵と前の鍵（AUTH_TOKEN_SECRET_PREVIOUS。無くてよい）の
// 両方を試す（verificationSecrets・verifyTokenWithSecrets）。kid は付けない（hardening-design.md §4 の案 A）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { validId } from './ids';

/** トークンの期限（30 日）。 */
export const TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** ローカル専用の公開された鍵。AUTH_TOKEN_SECRET が無く APP_ENV=local のときだけ使う。 */
export const LOCAL_DEV_TOKEN_SECRET = 'LOCAL_DEV_ONLY-rpg-online-token-secret-do-not-use-in-production';
/** AUTH_TOKEN_SECRET に求める最小の長さ。 */
const MIN_SECRET_LENGTH = 32;
const VERSION = 'v1';

export type TokenClaims = { gameId: string; playerId: string; exp: number };
export type VerifyResult =
  | { ok: true; claims: TokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

const encoder = new TextEncoder();

function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url（= 無し）を戻す。形が外れるか、戻した値を書き直すと元に戻らない（使わないビットが違う）なら null。 */
function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  let bin: string;
  try { bin = atob(text.replace(/-/g, '+').replace(/_/g, '/')); }
  catch { return null; }
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return toBase64url(bytes) === text ? bytes : null;
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** 本文を署名してトークンにする。 */
export async function signToken(claims: TokenClaims, secret: string): Promise<string> {
  const body = toBase64url(encoder.encode(JSON.stringify({ g: claims.gameId, p: claims.playerId, exp: claims.exp })));
  const signed = `${VERSION}.${body}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(signed));
  return `${signed}.${toBase64url(new Uint8Array(signature))}`;
}

/** 形 → 署名 → 本文 → 期限の順に確かめ、最初に外れた理由を返す。署名の正しくない本文は JSON として読まない。 */
export async function verifyToken(token: string, secret: string, nowSeconds: number): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'malformed' };
  const [, body, sig] = parts;
  const signature = fromBase64url(sig);
  // 文字列の比較をせず crypto.subtle.verify で確かめる（かかる時間が中身で変わらない）
  const valid = signature !== null && signature.length > 0
    && await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(`${VERSION}.${body}`));
  if (!valid) return { ok: false, reason: 'bad_signature' };
  const claims = readClaims(body);
  if (!claims) return { ok: false, reason: 'malformed' };
  if (claims.exp <= nowSeconds) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/** いまの鍵で確かめ、署名が外れたときだけ次の鍵（前の鍵）で確かめ直す。どの鍵でも署名が外れたら bad_signature。 */
export async function verifyTokenWithSecrets(token: string, secrets: readonly string[], nowSeconds: number): Promise<VerifyResult> {
  let result: VerifyResult = { ok: false, reason: 'bad_signature' };
  for (const secret of secrets) {
    result = await verifyToken(token, secret, nowSeconds);
    if (result.ok || result.reason !== 'bad_signature') return result;
  }
  return result;
}

function readClaims(body: string): TokenClaims | null {
  const bytes = fromBase64url(body);
  if (!bytes) return null;
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)); }
  catch { return null; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { g, p, exp } = value as Record<string, unknown>;
  if (!validId(g) || !validId(p) || !Number.isSafeInteger(exp)) return null;
  return { gameId: g, playerId: p, exp: exp as number };
}

/** Authorization の値が `Bearer <トークン>`（Bearer は大文字小文字を問わない・間は空白 1 つ以上）ならトークン、ほかは null。 */
export function parseBearer(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(value);
  return match ? match[1] : null;
}

/**
 * 署名の鍵を選ぶ。AUTH_TOKEN_SECRET（32 文字以上）があればそれ、無くて APP_ENV=local なら LOCAL_DEV_TOKEN_SECRET、
 * ほかは null（使う側は 500。local でない環境で公開された鍵を使わない・短い鍵を黙って既定に戻さない）。
 */
export function tokenSecret(env: { APP_ENV: string; AUTH_TOKEN_SECRET?: string }): string | null {
  const secret = env.AUTH_TOKEN_SECRET;
  if (secret !== undefined) return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH ? secret : null;
  return env.APP_ENV === 'local' ? LOCAL_DEV_TOKEN_SECRET : null;
}

/**
 * 前の鍵を選ぶ。AUTH_TOKEN_SECRET_PREVIOUS が 32 文字以上ならそれ、ほか（無い・短い）は null（前の鍵を試さない）。
 * 署名には使わない。取り替えの重なりの間だけ入れておき、30 日（TOKEN_TTL_SECONDS）たったら消す（docs/guides/manuals/deploy.md）。
 */
export function previousTokenSecret(env: { AUTH_TOKEN_SECRET_PREVIOUS?: string }): string | null {
  const secret = env.AUTH_TOKEN_SECRET_PREVIOUS;
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

/** 確かめで試す鍵の並び（いまの鍵 → 前の鍵）。いまの鍵が無ければ null（使う側は 500。前の鍵だけでは通さない）。 */
export function verificationSecrets(env: { APP_ENV: string; AUTH_TOKEN_SECRET?: string; AUTH_TOKEN_SECRET_PREVIOUS?: string }): string[] | null {
  const current = tokenSecret(env);
  if (!current) return null;
  const previous = previousTokenSecret(env);
  return previous && previous !== current ? [current, previous] : [current];
}
