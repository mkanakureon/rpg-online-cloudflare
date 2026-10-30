-- 利用制限の数（rate_limit_counters）。設計の正は docs/guides/working/abuse-protection-design.md §3。
-- 単位の名前（scope）・鍵（subject）・窓の始まり（UNIX 秒）ごとに 1 行。IP はハッシュにして subject に入れる（IP をそのまま残さない）。
-- 同じ鍵の古い窓は次の要求で消える（src/core/rate-limit.ts の consume）。IF NOT EXISTS だけなので 2 回当てても壊れない。
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  scope TEXT NOT NULL,           -- 'guest-ip'・'guest-game'・'score'・'saves'（src/core/rate-limit-policy.ts の名前）
  subject TEXT NOT NULL,         -- IP のハッシュ・gameId・'<gameId>:<playerId>'
  window_start INTEGER NOT NULL, -- 窓の始まり（UNIX 秒）
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (scope, subject, window_start)
);
