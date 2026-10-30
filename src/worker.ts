/** Local-only proof of concept. NOT production safe: no authentication or anti-cheat. */
// worker.ts — Worker の入口。モジュールの一覧をルーターに渡し、例外を 500 で受け止める。
//
// ルートと SQL は src/modules/<機能>/、共通の手伝いは src/core/ にある。試験と
// wrangler.jsonc の main がこのパスと default の書き出しを指すので、動かさない。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Env } from './core/env';
import { error } from './core/http';
import { createRouter } from './core/router';
import { modules } from './modules';

const route = createRouter(modules);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await route(req, env); }
    catch (err) {
      // Intentionally do not leak database errors to the client.
      console.error('Unhandled Worker error', err);
      return error('INTERNAL_ERROR', 'Internal server error', 500);
    }
  }
};
