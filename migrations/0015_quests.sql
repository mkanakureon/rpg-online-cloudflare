-- クエスト Q1（宣言・報酬・受け取り）。設計の正は docs/guides/working/quest-design.md §3・§6。
-- サーバーが持つのは区切り・期間・見るキーと閾値・報酬の品目と数だけ（名前・説明・物語はマスターデータ。ADR 0002）。
-- 進捗はプレイヤーデータの値（player_data）を読むだけで、クエストの表には持たない。受け取りの二重は quest_claims の主キー
-- （プレイヤー・クエスト・区切り）と、受け取り・履歴・残高を書く 1 つの batch（src/modules/quests/index.ts）で止める。
-- デイリー・週間の区切りごとの値の表は Q2 の 0016 で作る（quest-design.md §3）。
-- games(game_id) の ON DELETE CASCADE は 0003〜0013 と同じ理由。IF NOT EXISTS・INSERT OR IGNORE だけなので 2 回当てても壊れない。
-- クエストの宣言（ゲームごと。区切り・期間・見るキーと閾値だけ。名前・説明はマスターデータ）。時刻はどれも UNIX 秒（UTC）
CREATE TABLE IF NOT EXISTS quests (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,                       -- ^[a-zA-Z0-9_-]{1,64}$
  kind TEXT NOT NULL CHECK (kind IN ('once', 'daily', 'weekly')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  reset_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (reset_offset_minutes BETWEEN -720 AND 840),  -- 区切りの時差（events と同じ範囲）
  key TEXT NOT NULL,                            -- 見るキー（player_data_keys）
  threshold INTEGER NOT NULL CHECK (threshold BETWEEN 1 AND 1000000000),   -- MAX_PLAYER_DATA_VALUE と同じ上限
  CHECK (ends_at > starts_at),
  PRIMARY KEY (game_id, quest_id),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 報酬の中身（クエストごとに品目と数。1 クエスト最大 MAX_REWARD_LINES 行。event_rewards と同じ形）
CREATE TABLE IF NOT EXISTS quest_rewards (
  game_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1 AND amount <= 1000000000),
  PRIMARY KEY (game_id, quest_id, item_id),
  FOREIGN KEY (game_id, quest_id) REFERENCES quests(game_id, quest_id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
-- 受け取り（プレイヤー・クエスト・区切りごとに 1 行。二重を止める一意の鍵。event_claims と同じ形）
CREATE TABLE IF NOT EXISTS quest_claims (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（event_claims と同じ）
  quest_id TEXT NOT NULL,
  period_key TEXT NOT NULL,                     -- 'once'・'2026-10-30'（デイリー）・'2026-10-26'（週間。月曜の日付）
  claim_id TEXT NOT NULL UNIQUE,                -- サーバーが作る（crypto.randomUUID()）
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, quest_id, period_key),
  FOREIGN KEY (game_id, quest_id) REFERENCES quests(game_id, quest_id)
);
-- 管理の読み取り（quest-design.md §8）が新しい順に引く
CREATE INDEX IF NOT EXISTS quest_claims_player ON quest_claims (game_id, player_id, claimed_at);
-- それまでに登録したゲームは quests を使う設定にする（0003・0005・0006・0009・0010・0013 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'quests' FROM games;
-- demo-rpg の手本のクエスト（CLI モックの通しに使う）。スライムを 1 体倒す・金貨 50
INSERT OR IGNORE INTO quests (game_id, quest_id, kind, starts_at, ends_at, reset_offset_minutes, key, threshold)
  VALUES ('demo-rpg', 'first-hunt', 'once', CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER),
          CAST(strftime('%s', '2100-01-01 00:00:00') AS INTEGER), 0, 'slimes-defeated', 1);
INSERT OR IGNORE INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES ('demo-rpg', 'first-hunt', 'gold', 50);
