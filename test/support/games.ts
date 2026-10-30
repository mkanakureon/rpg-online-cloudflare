/**
 * 試験の手伝い: 試験の D1 にゲームと、そのゲームが使う機能を登録する
 * （games・game_modules の表。migrations/0002_games.sql・0003_game_modules.sql）。
 * INSERT OR IGNORE なので beforeEach で何度呼んでも主キーで落ちない。
 * 使い方の正は docs/guides/working/core-foundation-design.md §4。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */

export async function registerGame(
  db: D1Database, gameId: string, modules: readonly string[] = ['announcements', 'rankings'],
): Promise<void> {
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO games (game_id, display_name) VALUES (?, ?)').bind(gameId, gameId),
    ...modules.map((m) => db.prepare('INSERT OR IGNORE INTO game_modules (game_id, module) VALUES (?, ?)').bind(gameId, m)),
  ]);
}
