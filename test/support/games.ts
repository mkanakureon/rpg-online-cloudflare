/**
 * 試験の手伝い: 試験の D1 にゲームを登録する（games の表。migrations/0002_games.sql）。
 * INSERT OR IGNORE なので beforeEach で何度呼んでも主キーで落ちない。
 * 使い方の正は docs/guides/working/core-foundation-design.md §4。機能の引数は M3 で足す。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */

export async function registerGame(db: D1Database, gameId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO games (game_id, display_name) VALUES (?, ?)')
    .bind(gameId, gameId).run();
}
