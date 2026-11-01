// router.ts — GET /health・ゲストの発行とトークンの更新と管理の口（core のルート）と、モジュールのルートを上から順に当てるルーター。
//
// どれにも当たらなければ 404 NOT_FOUND `Endpoint not found`。パスに当たってメソッドが
// 違うときも 404（405 にしない）。例外の受け止め（500）は入口の src/worker.ts が持つ。
// 渡された一覧の name を既知の機能の名前として handle に渡す（機能の設定の確かめに使う）。
// 当てる順は [ゲストの発行, トークンの更新, ...管理の口, ...モジュールのルート]（管理の口は src/core/admin/routes.ts。docs/guides/working/admin-design.md §2）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { guestRoute, refreshRoute } from './accounts';
import { adminRoutes } from './admin/routes';
import type { Env } from './env';
import { error, json } from './http';
import type { GameModule } from './module';

export function createRouter(modules: GameModule[]): (req: Request, env: Env) => Promise<Response> {
  const routes = [guestRoute, refreshRoute, ...adminRoutes, ...modules.flatMap((m) => m.routes)];
  const known = modules.map((m) => m.name);
  return async (req, env) => {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.pathname === '/health') {
      return json({ status: 'ok', service: 'rpg-online-backend' });
    }
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(url.pathname);
      if (match) return route.handle(req, env, match, url, known);
    }
    return error('NOT_FOUND', 'Endpoint not found', 404);
  };
}
