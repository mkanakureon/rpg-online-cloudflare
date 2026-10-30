-- 設定配信 C2（マスターデータ）。設計の正は docs/guides/working/config-design.md §2。
-- data はサーバーが解釈しない文字列（JSON として読まない）。大きさの上限は UTF-8 のバイト数で 65536（64 KiB）。
-- 上限の数は src/modules/config/limits.ts の MAX_MASTER_DATA_BYTES と同じ（2 か所。片方だけ変えない）。
-- 書き換える API は無い。入れる・変えるときは新しい番号のマイグレーションに INSERT・ON CONFLICT (game_id, key) DO UPDATE を書く。
-- demo-rpg の手本の行はここに入れない: C1 の試験（test/config.test.ts）が demo-rpg の設定の応答の全体を比べていて、
-- 手本を入れると masterData の欄が載って落ちるため。マスターデータの試験は専用のゲームに行を入れて行う。
-- マスターデータ（キーごとに 1 行）
CREATE TABLE IF NOT EXISTS config_master_data (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  key TEXT NOT NULL,                           -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  data TEXT NOT NULL CHECK (length(CAST(data AS BLOB)) <= 65536),  -- MAX_MASTER_DATA_BYTES（UTF-8 のバイト数）
  PRIMARY KEY (game_id, key)
);
