// announcements/index.ts — お知らせのモジュール（GET /v1/announcements）。
//
// gameId の形 → ゲームの登録（src/core/games.ts）の順に確かめてから、そのゲームの
// お知らせを id の順に 50 件まで返す。形の正は docs/api-contract.md。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { requireGame } from '../../core/games';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';

export const announcements: GameModule = {
  name: 'announcements',
  routes: [
    {
      method: 'GET',
      pattern: /^\/v1\/announcements$/,
      async handle(_req, env, _match, url) {
        const gameId = url.searchParams.get('gameId');
        if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
        const unknown = await requireGame(env, gameId, announcements.name);
        if (unknown) return unknown;
        const data = await env.DB.prepare(
          'SELECT id, title, body FROM announcements WHERE game_id = ? ORDER BY id ASC LIMIT 50'
        ).bind(gameId).all<{ id: string; title: string; body: string }>();
        return json({ gameId, items: data.results });
      },
    },
  ],
};
