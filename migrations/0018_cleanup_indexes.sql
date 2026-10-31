-- 0018_cleanup_indexes.sql — 掃除（src/core/cleanup.ts の runCleanup）が時刻の列で古い行を探すための索引だけを足す。
-- 表は足さず、既存の表の形も変えない。player_activity_days の day の索引は 0017 で作った。
-- 受け取りの行（quest_claims・event_claims）と受領の履歴（inventory_ledger）は消さないので、ここでは索引を足さない。
-- 設計の正は docs/guides/working/analytics-design.md §3・§6。IF NOT EXISTS だけなので 2 回当てても壊れない。
CREATE INDEX IF NOT EXISTS admin_audit_log_created ON admin_audit_log (created_at);
CREATE INDEX IF NOT EXISTS player_data_writes_created ON player_data_writes (created_at);
CREATE INDEX IF NOT EXISTS player_data_period_values_updated ON player_data_period_values (updated_at);
CREATE INDEX IF NOT EXISTS rate_limit_counters_window ON rate_limit_counters (window_start);
