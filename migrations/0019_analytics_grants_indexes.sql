-- 0019_analytics_grants_indexes.sql — 管理の配った量の集計（GET /v1/admin/analytics/grants）が、ゲームと日の範囲（UNIX 秒）で
-- 受領の履歴（inventory_ledger）と受け取りの行（quest_claims）を読むための索引だけを足す。
-- 表は足さず、既存の表の形も変えない。設計の正は docs/guides/working/analytics-design.md §3・§5。IF NOT EXISTS だけなので 2 回当てても壊れない。
CREATE INDEX IF NOT EXISTS inventory_ledger_game_created ON inventory_ledger (game_id, created_at);
CREATE INDEX IF NOT EXISTS quest_claims_game_claimed ON quest_claims (game_id, claimed_at);
