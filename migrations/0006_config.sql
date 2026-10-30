-- 設定配信 C1（機能フラグとクライアントの版）。設計の正は docs/guides/working/config-design.md §2。
-- 設定を書き換える API は無い。設定を変えるときは新しい番号のマイグレーションに UPDATE・ON CONFLICT DO UPDATE を書く。
-- games(game_id) の ON DELETE CASCADE は 0003〜0005 と同じ理由（ゲームの行だけを消す試験の beforeEach が外部キーで断られないため）。
-- 版の形は SQLite に正規表現が無いので CHECK にせず、読むときに確かめる（形の外れは 500）。
-- ゲームごとのクライアントの版（1 ゲーム 1 行。行が無ければ版の決まりが無い）
CREATE TABLE IF NOT EXISTS game_configs (
  game_id TEXT NOT NULL PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  min_client_version TEXT,                     -- これより古いクライアントは update: "required"。NULL は決まりなし
  latest_client_version TEXT                   -- これより古いクライアントは update: "available"。NULL は決まりなし
);
-- 機能フラグ（名前ごとに 1 行。真偽値だけ）
CREATE TABLE IF NOT EXISTS config_flags (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (game_id, name)
);
-- それまでに登録したゲームは config を使う設定にする（0003・0005 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'config' FROM games;
-- demo-rpg の手本の設定（CLI モックの通しの確かめに使う）
INSERT OR IGNORE INTO game_configs (game_id, min_client_version, latest_client_version) VALUES ('demo-rpg', '1.0.0', '1.0.0');
INSERT OR IGNORE INTO config_flags (game_id, name, enabled) VALUES ('demo-rpg', 'demo-flag', 1);
