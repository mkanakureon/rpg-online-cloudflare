-- 0017_player_activity.sql — 「遊んだ」の印（1 人 1 日 1 行）。DAU・新しい人の数・D1／D7／D30 の継続の数の元。
-- 書くのはトークンの要る 6 つの口の consumeForPlayer（INSERT OR IGNORE・is_new = 0）と、ゲストの発行の batch（is_new = 1）。
-- day は UTC の 'YYYY-MM-DD'（src/core/activity.ts の activityDay = periodKey('daily', now, 0)）。
-- player_id はトークンの p。外部キーは付けない（player_data と同じ理由）。IP・トークン・時刻は持たない。
-- 索引 (day) は掃除（N2）が日付だけで探すため。設計の正は docs/guides/working/analytics-design.md §3・§4。
-- IF NOT EXISTS だけで、2 回当てても壊れない（既存の表に列を足さない）。
CREATE TABLE IF NOT EXISTS player_activity_days (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  player_id TEXT NOT NULL,
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1)),
  PRIMARY KEY (game_id, day, player_id)
);
CREATE INDEX IF NOT EXISTS player_activity_days_day ON player_activity_days (day);
