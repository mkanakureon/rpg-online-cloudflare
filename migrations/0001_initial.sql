CREATE TABLE IF NOT EXISTS announcements (
  id TEXT NOT NULL PRIMARY KEY,
  game_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_game ON announcements(game_id);

CREATE TABLE IF NOT EXISTS ranking_entries (
  game_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL CHECK(score >= 0 AND score <= 1000000000),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, board_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_rankings_score ON ranking_entries(game_id, board_id, score DESC, updated_at ASC);

INSERT OR IGNORE INTO announcements (id, game_id, title, body) VALUES
  ('welcome', 'demo-rpg', 'ようこそ', 'ローカル検証用のお知らせです。');
