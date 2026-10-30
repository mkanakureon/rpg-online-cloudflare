-- 所持品 E1（品目・残高・受領の履歴）。設計の正は docs/guides/working/event-reward-design.md §3。
-- サーバーは品目の ID と種類（通貨か所持品か）だけを持つ。名前・効果・値段はマスターデータ（サーバーは解釈しない）。
-- games(game_id) の ON DELETE CASCADE は 0003〜0006 と同じ理由（ゲームの行だけを消す試験の beforeEach が外部キーで断られないため）。
-- player_id はトークンの p で、外部キーは付けない（saves と同じ理由）。IF NOT EXISTS・INSERT OR IGNORE だけなので 2 回当てても壊れない。
-- 品目（ゲームごと。ID と種類だけ。名前・効果はマスターデータ）
CREATE TABLE IF NOT EXISTS inventory_items (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,                        -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  kind TEXT NOT NULL CHECK (kind IN ('currency', 'item')),
  PRIMARY KEY (game_id, item_id)
);
-- 残高（プレイヤー・品目ごとに 1 行。0 の行は作らない）
CREATE TABLE IF NOT EXISTS inventory_balances (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（saves と同じ理由）
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0 AND amount <= 1000000000),  -- MAX_ITEM_AMOUNT（src/core/inventory.ts と同じ。2 か所）
  updated_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  PRIMARY KEY (game_id, player_id, item_id),
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
-- 受領の履歴（増減 1 回で 1 行。API からは書き換えない・消さない。ゲームの行を消したときだけ CASCADE で消える）
CREATE TABLE IF NOT EXISTS inventory_ledger (
  entry_id INTEGER PRIMARY KEY,                 -- 増える番号（履歴の順と続きの鍵）
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),    -- Phase 2 は付与だけ（正の数）。消費を足すときに負の数を使う（§6）
  source_type TEXT NOT NULL,                    -- 'event-claim'（E2）。後から 'quest'・'admin'（§13）
  source_id TEXT NOT NULL,                      -- 受け取りの claim_id など
  created_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
CREATE INDEX IF NOT EXISTS inventory_ledger_player ON inventory_ledger (game_id, player_id, entry_id);
-- それまでに登録したゲームは inventory を使う設定にする（0003・0005 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'inventory' FROM games;
-- demo-rpg の手本の品目（CLI モックの通しに使う）
INSERT OR IGNORE INTO inventory_items (game_id, item_id, kind) VALUES ('demo-rpg', 'gold', 'currency');
INSERT OR IGNORE INTO inventory_items (game_id, item_id, kind) VALUES ('demo-rpg', 'potion', 'item');
