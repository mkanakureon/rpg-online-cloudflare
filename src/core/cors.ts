// cors.ts — ブラウザから呼ぶための CORS の見出しを作る 1 か所（ローカルだけ）。
//
// APP_ENV が local で、Origin が決めた 2 つ（ブラウザのサンプルを出す 127.0.0.1:5173・localhost:5173）のどちらかのときだけ見出しを足す。
// それ以外（local でない環境・決めていないオリジン・file:// の null・Origin の無い要求）には何も足さない（APP_ENV の守りと同じ向き）。
// どのオリジンでも許す形（ワイルドカード）は使わない。事前確認（OPTIONS）は入口の src/worker.ts がルーターの前で preflight に答えさせる。
// 許す見出し・公開の見出しの正は docs/guides/working/client-integration-design.md §5.6 と docs/api-contract.md の「CORS」。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01
import type { Env } from './env';

/** CORS を許すオリジン（ブラウザのサンプルの置き場。設計書 §5.5）。 */
export const CORS_ORIGINS: readonly string[] = ['http://127.0.0.1:5173', 'http://localhost:5173'];
/** ページから送ってよい見出し（Access-Control-Allow-Headers）。 */
export const CORS_ALLOW_HEADERS: readonly string[] = ['Authorization', 'Content-Type', 'Idempotency-Key', 'If-None-Match'];
/** ページから読めるようにする見出し（Access-Control-Expose-Headers）。 */
export const CORS_EXPOSE_HEADERS: readonly string[] = ['Retry-After', 'ETag'];
const ALLOW_METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
const PREFLIGHT_MAX_AGE_SECONDS = 600;

/** 許すときだけ、その要求に足す CORS の見出しを返す。許さないときは null（何も足さない）。 */
export function corsHeaders(req: Request, env: Pick<Env, 'APP_ENV'>): Record<string, string> | null {
  if (env.APP_ENV !== 'local') return null;
  const origin = req.headers.get('Origin');
  if (origin === null || !CORS_ORIGINS.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS.join(', '),
    Vary: 'Origin',
  };
}

/** 許すオリジンからの事前確認（OPTIONS）なら 204 を返す。そうでなければ null（ルーターへ進む。OPTIONS のルートは無いので 404）。 */
export function preflight(req: Request, env: Pick<Env, 'APP_ENV'>): Response | null {
  if (req.method !== 'OPTIONS') return null;
  const headers = corsHeaders(req, env);
  if (!headers) return null;
  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      'Access-Control-Allow-Methods': ALLOW_METHODS.join(', '),
      'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS.join(', '),
      'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECONDS),
    },
  });
}

/** 応答に CORS の見出しを足す（許さないときは応答をそのまま返す）。 */
export function withCors(req: Request, env: Pick<Env, 'APP_ENV'>, res: Response): Response {
  const headers = corsHeaders(req, env);
  if (!headers) return res;
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(headers)) {
    if (name === 'Vary') out.headers.append(name, value);
    else out.headers.set(name, value);
  }
  return out;
}
