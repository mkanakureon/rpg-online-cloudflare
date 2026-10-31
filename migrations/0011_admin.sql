-- 管理 O1（監査のログ）。設計の正は docs/guides/working/admin-design.md §5。
-- 管理の書き込みの操作 1 回で 1 行。API からは書き換えない・消さない。ゲームの行を消したときだけ CASCADE で消える
-- （0003〜0010 と同じ理由。ゲームの行だけを消す試験の beforeEach が外部キーで断られないため）。
-- トークン・管理の鍵・セーブの本文・IP は入れない。保持は 365 日（src/core/admin/audit.ts の AUDIT_RETENTION_DAYS。消す仕組みは後で足す）。
-- IF NOT EXISTS だけで、既存の表に列を足す文を使わないので、2 回当てても壊れない。初期データは入れない。
CREATE TABLE IF NOT EXISTS admin_audit_log (
  audit_id INTEGER PRIMARY KEY,                 -- 増える番号（順と続きの鍵）
  audit_ref TEXT NOT NULL UNIQUE,               -- 要求ごとにサーバーが作る（crypto.randomUUID()）。続く文の「この要求の行が入ったか」に使う
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  request_key TEXT,                             -- Idempotency-Key（増減だけ必須）。無い操作は NULL
  request_hash TEXT,                            -- 本文の SHA-256（16 進）。同じ鍵で違う本文を見分ける
  actor TEXT NOT NULL,                          -- X-Admin-Actor（^[a-zA-Z0-9_.@-]{1,64}$。自己申告のラベル）
  action TEXT NOT NULL,                         -- 'player.ban'・'player.unban'・'inventory.adjust'・'ranking.delete'・'item.put'・'event.put'
  target TEXT NOT NULL,                         -- 'player:<id>'・'ranking:<boardId>:<playerId>'・'item:<id>'・'event:<id>'
  before_json TEXT,                             -- 前の状態（JSON。無ければ NULL。4 KiB まで）
  after_json TEXT,                              -- 後の状態（同じ）
  reason TEXT NOT NULL,                         -- 1〜200 文字
  created_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  UNIQUE (game_id, request_key)                 -- SQLite の UNIQUE は NULL どうしを重ならないとみなす（鍵の無い操作は何行でも入る）
);
CREATE INDEX IF NOT EXISTS admin_audit_log_game ON admin_audit_log (game_id, audit_id);
