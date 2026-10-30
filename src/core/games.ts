// games.ts — ゲームの登録（games）と機能の設定（game_modules）を引き、断る要求を決める。
//
// モジュールの handle が、入力の形を確かめた後・DB を読み書きする前に requireGame を呼ぶ
// （検査の順は core-foundation-design.md §3）。登録の無いゲームは 404 NOT_FOUND `Unknown game`、
// その機能を使わない設定のゲームは 404 NOT_FOUND `Feature not enabled for this game`。
// 既知の機能の名前（known）は入口から受け取り、src/modules/ を読み込まない。SQL の失敗は入口の try/catch で 500 になる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Database, Env } from './env';
import { error } from './http';

/** 機能の設定の行から使える機能の集合を作る。known に無い名前と null（設定の行が無い）は捨てる。 */
export function enabledModules(rows: Array<{ module: string | null }>, known: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.module !== null && known.includes(row.module)) set.add(row.module);
  }
  return set;
}

/** D1 を 1 回引く。登録が無ければ null。 */
export async function loadGame(
  db: Database, gameId: string, known: readonly string[],
): Promise<{ gameId: string; modules: Set<string> } | null> {
  const rows = await db.prepare(
    'SELECT g.game_id, m.module FROM games g LEFT JOIN game_modules m ON m.game_id = g.game_id WHERE g.game_id = ?'
  ).bind(gameId).all<{ game_id: string; module: string | null }>();
  const first = rows.results[0];
  return first ? { gameId: first.game_id, modules: enabledModules(rows.results, known) } : null;
}

/** 断る応答か null。known は src/modules/index.ts の名前（入口が渡す）。 */
export async function requireGame(
  env: Env, gameId: string, module: string, known: readonly string[],
): Promise<Response | null> {
  const game = await loadGame(env.DB, gameId, known);
  if (!game) return error('NOT_FOUND', 'Unknown game', 404);
  if (!game.modules.has(module)) return error('NOT_FOUND', 'Feature not enabled for this game', 404);
  return null;
}
