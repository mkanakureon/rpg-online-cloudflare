-- セーブ（saves）。設計の正は docs/guides/working/save-design.md §2。
-- サーバーは data を解釈しない。player_id はトークンの p で、game_players への外部キーは付けない
-- （requireAuth は DB を引かないので、行の無いプレイヤーのトークンで書くと外部キーの失敗が 500 になるため。ranking_entries と同じ）。
-- games(game_id) の ON DELETE CASCADE は 0003・0004 と同じ理由（ゲームの行だけを消す試験の beforeEach が外部キーで断られないため）。
-- deleted は消した印（墓石）。V2 の削除で使う列だが V1 で作る（消してもリビジョンを 1 に戻さないため）。
CREATE TABLE IF NOT EXISTS saves (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                     -- game_players.player_id（トークンの p）。外部キーは付けない
  slot_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  format_version INTEGER NOT NULL,
  data TEXT NOT NULL,
  checksum TEXT NOT NULL,
  size INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),  -- 1 は消した印（墓石）。V2 の削除で使う
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (game_id, player_id, slot_id)
);
-- それまでに登録したゲームは saves を使う設定にする（0003 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'saves' FROM games;
