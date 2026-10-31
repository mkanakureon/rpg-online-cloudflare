-- プレイヤーデータ U1（キーの宣言・値・書き込みの記録）。設計の正は docs/guides/working/player-data-design.md §3・§6。
-- サーバーが持つのはキーの書き方と上限と、プレイヤーごとの整数の値だけ（キーの名前・説明はマスターデータ。ADR 0002）。
-- add の二重は player_data_writes の UNIQUE (game_id, player_id, request_key)（Idempotency-Key）と、記録と値を書く 1 つの batch
-- （src/modules/player-data/index.ts）で止める。値の上限 1000000000 は src/core/player-data.ts の MAX_PLAYER_DATA_VALUE と 2 か所。
-- games(game_id) の ON DELETE CASCADE は 0003〜0010 と同じ理由。IF NOT EXISTS・INSERT OR IGNORE だけなので 2 回当てても壊れない。
-- キーの宣言（ゲームごと。書き方と上限だけ。名前・説明はマスターデータ）
CREATE TABLE IF NOT EXISTS player_data_keys (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  key TEXT NOT NULL,                            -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  mode TEXT NOT NULL CHECK (mode IN ('add', 'max', 'set', 'flag')),
  max_value INTEGER NOT NULL CHECK (max_value BETWEEN 1 AND 1000000000),   -- MAX_PLAYER_DATA_VALUE（src/core/player-data.ts と 2 か所）
  max_delta INTEGER CHECK (max_delta BETWEEN 1 AND 1000000000),            -- add の 1 回の増加の上限。add のときだけ値がある
  CHECK ((mode = 'add') = (max_delta IS NOT NULL)),
  CHECK (mode <> 'flag' OR max_value = 1),
  PRIMARY KEY (game_id, key)
);
-- プレイヤーごとの値（キーごとに 1 行。書いたことの無いキーの行は作らない）
CREATE TABLE IF NOT EXISTS player_data (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（saves・inventory_balances と同じ理由）
  key TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 1000000000),
  updated_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  PRIMARY KEY (game_id, player_id, key),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 書き込みの記録（書き込み 1 回で 1 行。二重の止めの Idempotency-Key と、送り直しに返す応答の写し）
CREATE TABLE IF NOT EXISTS player_data_writes (
  write_id INTEGER PRIMARY KEY,                 -- 増える番号
  write_ref TEXT NOT NULL UNIQUE,               -- 要求ごとにサーバーが作る（crypto.randomUUID()）。応答の writeId
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  request_key TEXT NOT NULL,                    -- Idempotency-Key（必須）
  request_hash TEXT NOT NULL,                   -- 本文の SHA-256（16 進）。同じ鍵で違う本文を見分ける
  result_json TEXT,                             -- 応答の写し（同じ batch の最後の文で入れる。§6）
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, player_id, request_key)
);
-- それまでに登録したゲームは player-data を使う設定にする（0003・0009 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'player-data' FROM games;
-- demo-rpg の手本のキー（CLI モックの通しに使う）
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'slimes-defeated', 'add', 1000000000, 100);
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'highest-floor', 'max', 999, NULL);
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'chapter', 'set', 100, NULL);
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'boss-1-defeated', 'flag', 1, NULL);
