// env.ts — Worker が受け取る環境（Env）と、D1 を使う所の最小の型。
//
// 型だけで中身は無い。D1 そのものの型でなく prepare().bind() の形だけを書くので、
// 試験は偽の DB（prepare が投げる等）を渡せる。core とモジュールの全部がここを読む。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export type Statement = {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
export type Database = { prepare(sql: string): Statement };
export type Env = { DB: Database; APP_ENV: string };
