// key.ts — 管理の鍵（ADMIN_API_KEY）の選び方と、Authorization の管理の鍵の確かめ。
//
// 入出力は Workers の Web Crypto（crypto.subtle）だけのふつうの関数。管理の鍵は Worker ごとに 1 つの共有の鍵で、
// 32 文字以上のときだけ使う。トークンの鍵と違い、APP_ENV=local でも既定の鍵に戻らない（鍵の無い環境で誰でも通れる道を作らない）。
// 比べるときは両方を SHA-256 にして同じ長さ（32 バイト）にしてから timingSafeEqual で比べる（文字列の === を使わない）。
// 外れた理由（見出しが無い・Bearer でない・違う）は応答に入れず、どれも 401 UNAUTHENTICATED。正は docs/guides/working/admin-design.md §3。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { error } from '../http';
import { parseBearer } from '../token';

/** ADMIN_API_KEY に求める最小の長さ。 */
export const MIN_ADMIN_KEY_LENGTH = 32;

/** 管理の鍵を選ぶ。ADMIN_API_KEY が 32 文字以上ならそれ、ほか（無い・短い）は null（使う側は投げて 500）。APP_ENV は見ない。 */
export function adminSecret(env: { ADMIN_API_KEY?: string }): string | null {
  const key = env.ADMIN_API_KEY;
  return typeof key === 'string' && key.length >= MIN_ADMIN_KEY_LENGTH ? key : null;
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
}

/** Authorization の `Bearer <管理の鍵>` が secret と同じなら null、ほかは 401 UNAUTHENTICATED（理由は返さない）。 */
export async function requireAdmin(req: Request, secret: string): Promise<Response | null> {
  const given = parseBearer(req.headers.get('Authorization'));
  // 見出しが無いときも同じ長さの値を比べ、外れた理由でかかる時間を分けない
  const [a, b] = await Promise.all([sha256(given ?? ''), sha256(secret)]);
  if (given !== null && crypto.subtle.timingSafeEqual(a, b)) return null;
  return error('UNAUTHENTICATED', 'Invalid admin credentials', 401);
}
