// games.ts — ゲームの登録（games の表）を引き、登録の無いゲームへの要求を断る。
//
// モジュールの handle が、入力の形を確かめた後・DB を読み書きする前に requireGame を呼ぶ
// （検査の順は core-foundation-design.md §3）。登録の無いゲームは 404 NOT_FOUND `Unknown game`。
// 機能の設定（game_modules）はまだ見ない（M3）。SQL の失敗は入口の try/catch で 500 になる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Database, Env } from './env';
import { error } from './http';

/** D1 を 1 回引く。登録が無ければ null。 */
export async function loadGame(db: Database, gameId: string): Promise<{ gameId: string } | null> {
  const rows = await db.prepare('SELECT game_id FROM games WHERE game_id = ?')
    .bind(gameId).all<{ game_id: string }>();
  const row = rows.results[0];
  return row ? { gameId: row.game_id } : null;
}

/** 断る応答か null。module は M3 の機能の設定で使う（いまは登録だけを見る）。 */
export async function requireGame(env: Env, gameId: string, _module: string): Promise<Response | null> {
  const game = await loadGame(env.DB, gameId);
  if (!game) return error('NOT_FOUND', 'Unknown game', 404);
  return null;
}
