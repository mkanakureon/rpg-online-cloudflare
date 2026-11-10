/** ローカル専用の PoC。認証はゲストのトークンだけで、書き込みは APP_ENV=local のときだけ通る（src/core/guards.ts）。 */
// worker.ts — Worker の入口。モジュールの一覧をルーターに渡し、例外を 500 で受け止める。
// scheduled は Cron Triggers（wrangler.jsonc の triggers.crons）の入口で、掃除（src/core/cleanup.ts の runScheduled）を
// ctx.waitUntil で待ち合わせる。APP_ENV が local でなければ何も消さない。controller.cron は見ない（Cron は 1 つだけ）。
// ブラウザの CORS（ローカルだけ・決めたオリジンだけ。src/core/cors.ts）は、事前確認をルーターの前で答え、500 を含む全部の応答に足す。
//
// ルートと SQL は src/modules/<機能>/、共通の手伝いは src/core/ にある。試験と
// wrangler.jsonc の main がこのパスと default の書き出しを指すので、動かさない。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01
import { runScheduled } from './core/cleanup';
import { preflight, withCors } from './core/cors';
import type { Env } from './core/env';
import { error } from './core/http';
import { createRouter } from './core/router';
import { modules } from './modules';

const route = createRouter(modules);

async function handle(req: Request, env: Env): Promise<Response> {
  try { return await route(req, env); }
  catch (err) {
    // Intentionally do not leak database errors to the client.
    console.error('Unhandled Worker error', err);
    return error('INTERNAL_ERROR', 'Internal server error', 500);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const early = preflight(req, env);
    if (early) return early;
    return withCors(req, env, await handle(req, env));
  },
  scheduled(controller: { scheduledTime: number }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): void {
    ctx.waitUntil(runScheduled(env, Math.floor(controller.scheduledTime / 1000)));
  }
};
