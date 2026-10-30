// module.ts — 機能のモジュール（GameModule）とそのルート（Route）の型。
//
// モジュールは src/modules/<機能>/ に置き、名前とルートの並びを持つ。core はこの型だけを
// 知り、src/modules/ を読み込まない（一覧を組み立てるのは src/worker.ts）。handle の known は、
// ルーターが一覧から作る既知の機能の名前（requireGame に渡す）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Env } from './env';

export type Route = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  pattern: RegExp;                       // url.pathname に当てる。^…$ で書く
  handle(req: Request, env: Env, match: RegExpExecArray, url: URL, known: readonly string[]): Promise<Response>;
};
export type GameModule = {
  name: string;                          // 'announcements' | 'rankings' | 'saves'（game_modules の module と同じ）
  routes: Route[];
};
