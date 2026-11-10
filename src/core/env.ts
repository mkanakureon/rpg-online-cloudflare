// env.ts — Worker が受け取る環境（Env）と、D1 を使う所の最小の型。
//
// 型だけで中身は無い。D1 そのものの型でなく prepare().bind() の形だけを書くので、
// 試験は偽の DB（prepare が投げる等）を渡せる。core とモジュールの全部がここを読む。
// AUTH_TOKEN_SECRET はトークンの署名の鍵（本番は wrangler secret put で渡す。src/core/token.ts の tokenSecret）。
// AUTH_TOKEN_SECRET_PREVIOUS は鍵の取り替えの重なりの間だけ入れる前のトークンの鍵（確かめだけに使う。無くてよい。src/core/token.ts の previousTokenSecret）。
// ADMIN_API_KEY は管理の鍵（ローカルは人が .dev.vars に書き、本番は wrangler secret put で渡す。src/core/admin/key.ts の adminSecret）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export type Statement = {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
export type Database = {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;  // 全部が通るか、どれも入らない
};
export type Env = { DB: Database; APP_ENV: string; AUTH_TOKEN_SECRET?: string; AUTH_TOKEN_SECRET_PREVIOUS?: string; ADMIN_API_KEY?: string };
