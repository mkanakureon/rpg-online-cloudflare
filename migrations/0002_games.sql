CREATE TABLE IF NOT EXISTS games (
  game_id TEXT NOT NULL PRIMARY KEY,           -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO games (game_id, display_name) VALUES ('demo-rpg', 'Demo RPG');
