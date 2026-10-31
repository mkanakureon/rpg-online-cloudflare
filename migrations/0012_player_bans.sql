-- 管理 O2（BAN）。設計の正は docs/guides/working/admin-design.md §4。
-- 止めたプレイヤー（ゲームごと）。行があり期限の前なら止まっている。解くときは行を消す（解いた記録は監査のログに残る）。
-- ゲームの行を消したときは CASCADE で消える（0003〜0011 と同じ理由。ゲームの行だけを消す試験の beforeEach が外部キーで断られないため）。
-- game_players に列を足さず新しい表にするので、IF NOT EXISTS だけで 2 回当てても壊れない。初期データは入れない。
CREATE TABLE IF NOT EXISTS player_bans (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- game_players.player_id（トークンの p）
  reason TEXT NOT NULL,                         -- 1〜200 文字（管理の人のメモ。プレイヤーには返さない）
  banned_at INTEGER NOT NULL,                   -- サーバーの時刻（UNIX 秒）
  expires_at INTEGER,                           -- NULL はずっと。値があればその時刻から止めない
  PRIMARY KEY (game_id, player_id)
);
