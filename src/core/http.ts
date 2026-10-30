// http.ts — JSON の応答と、エラーの応答 `{ error: { code, message } }` を作る手伝い。
//
// ヘッダー（content-type・cache-control: no-store）はここ 1 か所。core とモジュールの
// 全部の応答がここを通る。形の正は docs/api-contract.md。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
export function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}
