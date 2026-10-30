-- ゲストのアカウント（accounts）とゲーム別のプレイヤー（game_players）。設計の正は docs/guides/working/account-design.md §2。
-- account_id は内部の ID でクライアントに返さない。API の playerId は game_players.player_id（account_id とは別の乱数）。
-- games(game_id) の ON DELETE CASCADE は 0003 と同じ理由（ゲームの行だけを消す試験の beforeEach が外部キーで断られないため）。
-- 初期データは入れない。
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT NOT NULL PRIMARY KEY,        -- 内部の ID。クライアントに返さない
  kind TEXT NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                     -- ゲーム別のプレイヤー ID（API の playerId）
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, account_id)                 -- 1 つのアカウントは 1 つのゲームに 1 人
);
