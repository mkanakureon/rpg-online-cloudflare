-- ゲームごとに使う機能の設定（core-foundation-design.md §3 の M3）。行があればその機能を使う。
-- ON DELETE CASCADE は、ゲームの行だけを消す既存の試験（test/games.test.ts の beforeEach）が外部キーで断られないため。
CREATE TABLE IF NOT EXISTS game_modules (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  module TEXT NOT NULL,                        -- src/modules/index.ts の name
  PRIMARY KEY (game_id, module)
);
-- それまでに登録したゲームは、いまの 2 つの機能を使う設定にする（M2 と M3 の間に足したゲームも断られないように）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'announcements' FROM games;
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'rankings' FROM games;
