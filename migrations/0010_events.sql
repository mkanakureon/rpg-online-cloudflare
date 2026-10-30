-- イベント E2（イベント・報酬の中身・受け取り）。設計の正は docs/guides/working/event-reward-design.md §3・§5。
-- 期間と区切りはサーバーの時刻（UNIX 秒・UTC）で要求の時に計算する（Cron Triggers は使わない）。受け取りの二重は
-- event_claims の主キー（プレイヤー・イベント・区切り）と、受け取り・履歴・残高を書く 1 つの batch（src/modules/events/index.ts）で止める。
-- games(game_id) の ON DELETE CASCADE は 0003〜0009 と同じ理由。IF NOT EXISTS・INSERT OR IGNORE だけなので 2 回当てても壊れない。
-- イベント（ゲームごと）。時刻はどれも UNIX 秒（UTC）
CREATE TABLE IF NOT EXISTS events (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,                       -- ^[a-zA-Z0-9_-]{1,64}$
  kind TEXT NOT NULL CHECK (kind IN ('once', 'daily', 'weekly')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  reset_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (reset_offset_minutes BETWEEN -720 AND 840),  -- 区切りの時差（0 は UTC）
  CHECK (ends_at > starts_at),
  PRIMARY KEY (game_id, event_id)
);
-- 報酬の中身（イベントごとに品目と数。1 イベント最大 MAX_REWARD_LINES 行。src/modules/events/limits.ts）
CREATE TABLE IF NOT EXISTS event_rewards (
  game_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1 AND amount <= 1000000000),
  PRIMARY KEY (game_id, event_id, item_id),
  FOREIGN KEY (game_id, event_id) REFERENCES events(game_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
-- 受け取り（プレイヤー・イベント・区切りごとに 1 行。二重を止める一意の鍵）
CREATE TABLE IF NOT EXISTS event_claims (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  period_key TEXT NOT NULL,                     -- 'once'・'2026-10-30'（デイリー）・'2026-10-26'（週間。月曜の日付）
  claim_id TEXT NOT NULL UNIQUE,                -- サーバーが作る（crypto.randomUUID()。ゲストの発行の src/core/accounts.ts と同じ作り方）
  claimed_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  PRIMARY KEY (game_id, player_id, event_id, period_key)
);
-- それまでに登録したゲームは events を使う設定にする（0003・0005・0009 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'events' FROM games;
-- demo-rpg の手本のイベント（CLI モックの通しに使う）。デイリーのログインの報酬・金貨 100
INSERT OR IGNORE INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes)
  VALUES ('demo-rpg', 'daily-login', 'daily', CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER),
          CAST(strftime('%s', '2100-01-01 00:00:00') AS INTEGER), 0);
INSERT OR IGNORE INTO event_rewards (game_id, event_id, item_id, amount) VALUES ('demo-rpg', 'daily-login', 'gold', 100);
