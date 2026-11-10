// http.ts — JSON の応答と、エラーの応答 `{ error: { code, message } }` を作る手伝い。
//
// ヘッダー（content-type・cache-control: no-store）はここ 1 か所。core とモジュールの
// 全部の応答がここを通る。errorName は入口の 500 のログに出すエラーの名前（message と cause は出さない）。
// error の headers は足す見出し（429 の Retry-After など）。形の正は docs/api-contract.md。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
}
export function error(code: string, message: string, status: number, headers: Record<string, string> = {}): Response {
  return json({ error: { code, message } }, status, headers);
}

/** ログに出してよいエラーの名前（Error の name だけ。DB のエラーの文・SQL・値の入る message と cause は出さない）。 */
export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
