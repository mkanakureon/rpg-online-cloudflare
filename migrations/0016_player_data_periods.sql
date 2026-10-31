-- クエスト Q2（デイリー・週間の区切りごとの値）。設計の正は docs/guides/working/quest-design.md §3・§6・§7。
-- 区切りごとの値はプレイヤーデータの機能の表に置く。書くのはプレイヤーデータの書き込み（src/modules/player-data/index.ts）の
-- batch だけで、クエストのモジュールは読むだけ。区切りで数えるのは宣言した add のキーだけで、宣言の後の書き込みから数える
-- （さかのぼらない）。区切りの鍵は src/core/period.ts の periodKey（サーバーの時刻と時差の 0 時。週間は時差の月曜 0 時）。
-- 区切りを player_data_keys の列にしないのは、既存の表に列を足せず（2 回当てると壊れる）、表を作り直すとプレイヤーデータの外部キーが全部動くため。
-- games(game_id) の ON DELETE CASCADE は 0003〜0015 と同じ理由（ゲームを消すと宣言と値も消える）。
-- IF NOT EXISTS・INSERT OR IGNORE だけなので 2 回当てても壊れない。
-- 区切りごとに数えるキーの宣言（増やすキーだけ。クエストの定義の口〔Q3〕が、デイリー・週間のクエストを入れるときに同じ batch で入れる）
CREATE TABLE IF NOT EXISTS player_data_key_periods (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  reset_offset_minutes INTEGER NOT NULL CHECK (reset_offset_minutes BETWEEN -720 AND 840),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, key, kind),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 区切りごとの値（プレイヤー・キー・区切りの種類・区切りごとに 1 行。その区切りの中で add した合計）
CREATE TABLE IF NOT EXISTS player_data_period_values (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（player_data と同じ）
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  period_key TEXT NOT NULL,                     -- periodKey(kind, now, reset_offset_minutes)
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 1000000000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, key, kind, period_key),
  FOREIGN KEY (game_id, key, kind) REFERENCES player_data_key_periods(game_id, key, kind)
);
-- demo-rpg の手本: slimes-defeated をデイリーで数え、その日に 3 体倒すクエスト（薬 1）
INSERT OR IGNORE INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
  VALUES ('demo-rpg', 'slimes-defeated', 'daily', 0, CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER));
INSERT OR IGNORE INTO quests (game_id, quest_id, kind, starts_at, ends_at, reset_offset_minutes, key, threshold)
  VALUES ('demo-rpg', 'daily-slimes', 'daily', CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER),
          CAST(strftime('%s', '2100-01-01 00:00:00') AS INTEGER), 0, 'slimes-defeated', 3);
INSERT OR IGNORE INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES ('demo-rpg', 'daily-slimes', 'potion', 1);
