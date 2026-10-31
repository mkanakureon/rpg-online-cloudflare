-- プレイヤーデータ U2（実績の宣言・解いた実績）。設計の正は docs/guides/working/player-data-design.md §3・§7。
-- サーバーが持つのは実績の ID と、見るキーと閾値と、解いた時刻だけ（名前・説明・絵はマスターデータ。ADR 0002）。
-- 解くのはサーバーだけで、プレイヤーデータの書き込みの batch の中（src/modules/player-data/index.ts）で、書いた後の値が閾値以上の実績を
-- 入れる。主キー (game_id, player_id, achievement_id) で二重に解かない。申告で解く口は作らない。
-- games(game_id) の ON DELETE CASCADE は 0003〜0013 と同じ理由。IF NOT EXISTS・INSERT OR IGNORE だけなので 2 回当てても壊れない。
-- 実績の宣言（ゲームごと。見るキーと閾値だけ。名前・説明・絵はマスターデータ）
CREATE TABLE IF NOT EXISTS achievements (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,                 -- ^[a-zA-Z0-9_-]{1,64}$
  key TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold BETWEEN 1 AND 1000000000),
  PRIMARY KEY (game_id, achievement_id),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 解いた実績（プレイヤー・実績ごとに 1 行。一意の鍵で二重に解かない）
CREATE TABLE IF NOT EXISTS player_achievements (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,                 -- サーバーの時刻（UNIX 秒）
  write_ref TEXT NOT NULL,                      -- 解いた書き込み（player_data_writes.write_ref）。応答の unlocked を引く鍵
  PRIMARY KEY (game_id, player_id, achievement_id),
  FOREIGN KEY (game_id, achievement_id) REFERENCES achievements(game_id, achievement_id)
);
-- 書き込みの batch の応答の写しの文が、この書き込みで解いた実績を write_ref で引く
CREATE INDEX IF NOT EXISTS player_achievements_write ON player_achievements (write_ref);
-- demo-rpg の手本の実績（CLI モックの通しに使う）
INSERT OR IGNORE INTO achievements (game_id, achievement_id, key, threshold) VALUES ('demo-rpg', 'first-slime', 'slimes-defeated', 1);
INSERT OR IGNORE INTO achievements (game_id, achievement_id, key, threshold) VALUES ('demo-rpg', 'boss-1', 'boss-1-defeated', 1);
