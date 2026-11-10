// announcements/index.ts — お知らせのモジュール（GET /v1/announcements）。
//
// gameId の形 → ゲームの登録と機能の設定（src/core/games.ts）の順に確かめてから、そのゲームの
// お知らせを id の順に ANNOUNCEMENTS_LIMIT（50）件まで返す。形の正は docs/api-contract.md。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { requireGame } from '../../core/games';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';

/** 1 回に返すお知らせの上限の件数（docs/api-contract.md の「最大 50 件」と同じ値。試験で突き合わせる）。 */
export const ANNOUNCEMENTS_LIMIT = 50;

export const announcements: GameModule = {
  name: 'announcements',
  routes: [
    {
      method: 'GET',
      pattern: /^\/v1\/announcements$/,
      async handle(_req, env, _match, url, known) {
        const gameId = url.searchParams.get('gameId');
        if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
        const unknown = await requireGame(env, gameId, announcements.name, known);
        if (unknown) return unknown;
        const data = await env.DB.prepare(
          'SELECT id, title, body FROM announcements WHERE game_id = ? ORDER BY id ASC LIMIT ?'
        ).bind(gameId, ANNOUNCEMENTS_LIMIT).all<{ id: string; title: string; body: string }>();
        return json({ gameId, items: data.results });
      },
    },
  ],
};
