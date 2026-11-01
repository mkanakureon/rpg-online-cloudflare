// routes.ts — 管理の口（/v1/admin/...）のルートの一覧 adminRoutes と、どの口でも同じ確かめ checkAdmin。
//
// 確かめの順: APP_ENV=local の門（403）→ 管理の鍵の有無（無ければ投げて入口の try/catch で 500）→ 管理の利用制限
// （RATE_LIMITS.admin・IP ごと。正しい鍵でも数え、鍵を確かめる前に 429）→ 管理の鍵（401）→ gameId の形（400）→
// ゲームの登録（404 Unknown game。機能の設定は見ない）→ 書き込みの口は X-Admin-Actor・本文の JSON・reason（400）→ 口ごとの確かめ。管理はゲームごとの機能にせず、機能のモジュールを
// 読み込まない（表を SQL で読み書きするだけ）。どのプレイヤーのトークンも読まない。読み取りの口は監査に残さない。
// 書き込みの口（BAN・BAN を解く・所持品と通貨の増減・スコアを消す・品目とイベントとクエストの定義・プレイヤーデータのキーと実績の宣言・値を置く・
// 実績の取り消し）は、監査の行を 1 文目にし、続く文は「この要求の監査の行が入ったとき」だけ書く 1 つの batch で書く（片方だけ残らない）。増減の続く文と受領の履歴の種類の名前は src/core/ledger.ts。
// 品目の種類の違い・報酬の品目の有無・受け取りのあるイベントとクエストの守り・値のあるキーの書き方・宣言の数・解いた人のいる実績のキー・
// クエストの見るキーと区切りの宣言は、先に読んで断り、監査の行の文の条件にも入れる（読んでから書くまでの間に変わっても書かない）。
// クエストの定義の口は、デイリー・週間のクエストのキーの区切りの宣言（player_data_key_periods）を同じ batch で入れ、数の上限は src/core/quests.ts。
// プレイヤーデータの値を置く口は実績を判定せず、区切りの値を新しい値で頭打ちにする（下げるだけ）。
// 増減は Idempotency-Key が必須で（形は src/core/idempotency.ts）、鍵と中身のハッシュを監査の行の列に入れて二重を止める（同じ中身は 200 で 1 回目と同じ本文・違う中身は 422）。
// ルートの一覧はルーター（src/core/router.ts）がゲストの発行の後・機能のルートの前に当てる。形の正は openapi/rpg-online-admin.v1.json、
// 挙動の説明の正は docs/api-contract.md の「管理の API」、設計の正は docs/guides/working/admin-design.md §2・§4〜§7
// （プレイヤーデータの 4 つの口とプレイヤーを読む口の playerData は docs/guides/working/player-data-design.md §8、
// クエストの定義の口・プレイヤーを読む口の questClaims・値を置く口の区切りの値の頭打ちは docs/guides/working/quest-design.md §8、
// 集計の口 /v1/admin/analytics/players と配った量の口 /v1/admin/analytics/grants〔数だけでプレイヤー ID を返さない。関数と SQL は
// src/core/analytics.ts〕は docs/guides/working/analytics-design.md §5）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { activityDay } from '../activity';
import {
  cohortRetentionSql, dailyActivitySql, fillDays, grantsSql, parseAnalyticsRange, questClaimsSql, rangeSeconds, shapeCohorts, shapeGrants,
  type CohortRow, type DailyRow, type GrantRow, type QuestClaimCountRow,
} from '../analytics';
import { isBanActive } from '../bans';
import type { Database, Env } from '../env';
import { loadGame } from '../games';
import { requireLocalWrite } from '../guards';
import { error, json } from '../http';
import { validId } from '../ids';
import { parseIdempotencyKey } from '../idempotency';
import { MAX_EVENTS, MAX_ITEM_AMOUNT } from '../inventory';
import { adjustStatements, LEDGER_SOURCES } from '../ledger';
import type { Route } from '../module';
import { MAX_PLAYER_DATA_KEYS, type PlayerDataMode } from '../player-data';
import { MAX_QUESTS } from '../quests';
import { consume, ipSubject } from '../rate-limit';
import { RATE_LIMITS } from '../rate-limit-policy';
import { isoSeconds, listAuditSql, parseActor, parseReason, requestHash, shapeAuditRow, type AuditRow } from './audit';
import { adminSecret, requireAdmin } from './key';
import {
  parseAchievement, parseAdjustment, parseAuditQuery, parseEventDefinition, parseExpiresAt, parseItemKind, parsePlayerDataKey, parsePlayerDataValue,
  parseQuestDefinition, PLAYER_HISTORY_ROWS, PLAYER_QUEST_CLAIM_ROWS, type EventDefinition, type QuestDefinition,
} from './parse';

type Checked = { ok: true; gameId: string } | { ok: false; response: Response };

/** どの管理の口でも同じ確かめ。通ればゲームの ID。 */
export async function checkAdmin(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const secret = adminSecret(env);
  // 鍵の名前・値はメッセージに入れない。入口の try/catch が 500 INTERNAL_ERROR にする
  if (!secret) throw new Error('Admin key is not configured');
  // 鍵の当て推量を IP ごとの回数で抑える（鍵の確かめの前。正しい鍵でも数える）
  const limited = await consume(env.DB, RATE_LIMITS.admin, await ipSubject(req));
  if (limited) return { ok: false, response: limited };
  const denied = await requireAdmin(req, secret);
  if (denied) return { ok: false, response: denied };
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (!await loadGame(env.DB, gameId, known)) return { ok: false, response: error('NOT_FOUND', 'Unknown game', 404) };
  return { ok: true, gameId };
}

type Written = { ok: true; gameId: string; actor: string; reason: string; body: Record<string, unknown> } | { ok: false; response: Response };

/** 書き込みの口の確かめ（checkAdmin → X-Admin-Actor → 本文の JSON → reason）。通ればゲームの ID・actor・reason・本文。 */
async function checkAdminWrite(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Written> {
  const access = await checkAdmin(req, env, url, known);
  if (!access.ok) return access;
  const actor = parseActor(req.headers.get('X-Admin-Actor'));
  if (actor === null) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid X-Admin-Actor', 400) };
  let value: unknown;
  try { value = await req.json(); }
  catch { return { ok: false, response: error('INVALID_JSON', 'Request body must be JSON', 400) }; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, response: error('INVALID_ARGUMENT', 'Object required', 400) };
  }
  const body = value as Record<string, unknown>;
  const reason = parseReason(body.reason);
  if (reason === null) return { ok: false, response: error('INVALID_ARGUMENT', 'reason must be 1..200 characters', 400) };
  return { ok: true, gameId: access.gameId, actor, reason, body };
}

/** サーバーの時刻（UNIX 秒）。 */
function serverNow(): number {
  return Math.floor(Date.now() / 1000);
}

const player = `SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS createdAt FROM game_players WHERE game_id = ? AND player_id = ?`;
const balances = `SELECT b.item_id AS itemId, i.kind AS kind, b.amount AS amount FROM inventory_balances b
  JOIN inventory_items i ON i.game_id = b.game_id AND i.item_id = b.item_id
  WHERE b.game_id = ? AND b.player_id = ? ORDER BY b.item_id`;
const history = `SELECT entry_id AS entryId, item_id AS itemId, delta, source_type AS sourceType, source_id AS sourceId,
    created_at AS createdAt FROM inventory_ledger WHERE game_id = ? AND player_id = ? ORDER BY entry_id DESC LIMIT ?`;
// セーブの本文（data）とチェックサムは読まない
const saves = `SELECT slot_id AS slotId, revision, size, deleted, updated_at AS updatedAt FROM saves
  WHERE game_id = ? AND player_id = ? ORDER BY slot_id`;
const rankings = `SELECT board_id AS boardId, score, display_name AS displayName FROM ranking_entries
  WHERE game_id = ? AND player_id = ? ORDER BY board_id`;
// プレイヤーデータ（値と解いた実績。機能の設定は見ない）
const playerDataValues = `SELECT d.key AS key, k.mode AS mode, d.value AS value, d.updated_at AS updatedAt FROM player_data d
  JOIN player_data_keys k ON k.game_id = d.game_id AND k.key = d.key
  WHERE d.game_id = ? AND d.player_id = ? ORDER BY d.key`;
const playerAchievements = `SELECT achievement_id AS achievementId, unlocked_at AS unlockedAt, write_ref AS writeId FROM player_achievements
  WHERE game_id = ? AND player_id = ? ORDER BY achievement_id`;
// クエストの受け取り（新しい順。同じ秒の受け取りは入れた順の後ろを先に）
const playerQuestClaims = `SELECT quest_id AS questId, period_key AS periodKey, claim_id AS claimId, claimed_at AS claimedAt FROM quest_claims
  WHERE game_id = ? AND player_id = ? ORDER BY claimed_at DESC, rowid DESC LIMIT ?`;

const ban = 'SELECT reason, banned_at AS bannedAt, expires_at AS expiresAt FROM player_bans WHERE game_id = ? AND player_id = ?';
// 監査の行（1 文目）。前の状態は同じ文の中で止めた印から作る（無ければ NULL）
const insertBanAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  VALUES (?, ?, ?, ?, ?, (SELECT json_object('reason', reason, 'expiresAt',
      CASE WHEN expires_at IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%SZ', expires_at, 'unixepoch') END)
    FROM player_bans WHERE game_id = ? AND player_id = ?), ?, ?, ?)`;
// 続く文は、この要求の監査の行が入ったときだけ書く
const upsertBan = `INSERT INTO player_bans (game_id, player_id, reason, banned_at, expires_at)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, player_id) DO UPDATE SET
    reason = excluded.reason, banned_at = excluded.banned_at, expires_at = excluded.expires_at`;
const deleteBan = `DELETE FROM player_bans WHERE game_id = ? AND player_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

type BanRow = { reason: string; bannedAt: number; expiresAt: number | null };
type PlayerDataRow = { key: string; mode: PlayerDataMode; value: number; updatedAt: number };
type PlayerAchievementRow = { achievementId: string; unlockedAt: number; writeId: string };
type QuestClaimRow = { questId: string; periodKey: string; claimId: string; claimedAt: number };
type HistoryRow = { entryId: number; itemId: string; delta: number; sourceType: string; sourceId: string; createdAt: number };
type SaveRow = { slotId: string; revision: number; size: number; deleted: number; updatedAt: string };

const banPath = /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/ban$/;

// 増減の 1 文目（監査の行）。品目とプレイヤーがあり、増減の後が 0 以上・上限以下のときだけ。同じゲームの同じ Idempotency-Key があれば何もしない。
// 前と後の残高は同じ文の中で読む（json_object）。続く文は src/core/ledger.ts の adjustStatements
const insertAdjustAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, request_key, request_hash, actor, action, target,
    before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, ?, ?, 'inventory.adjust', 'player:' || ?,
         json_object('itemId', ?, 'amount', cur), json_object('itemId', ?, 'amount', cur + ?), ?, ?
  FROM (SELECT COALESCE((SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?), 0) AS cur)
  WHERE cur + ? BETWEEN 0 AND ?
    AND EXISTS (SELECT 1 FROM inventory_items WHERE game_id = ? AND item_id = ?)
    AND EXISTS (SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?)
  ON CONFLICT (game_id, request_key) DO NOTHING`;
// batch の後に引く: この要求の行か、同じ鍵の前の要求の行
const auditByKey = `SELECT audit_ref AS ref, request_hash AS hash, after_json AS afterJson, audit_id AS auditId FROM admin_audit_log
  WHERE game_id = ? AND request_key = ?`;
// 行が無いときの見分け（品目・プレイヤーの有無といまの残高）
const adjustDiagnosis = `SELECT (SELECT 1 FROM inventory_items WHERE game_id = ? AND item_id = ?) AS item,
    (SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?) AS player,
    COALESCE((SELECT amount FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?), 0) AS cur`;

// スコアを消す 1 文目（監査の行。前は消す行のスコアと表示名。行があるときだけ入る）と 2 文目
const insertRankingAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'ranking.delete', ?, json_object('score', score, 'displayName', display_name), NULL, ?, ?
  FROM ranking_entries WHERE game_id = ? AND board_id = ? AND player_id = ?`;
const deleteRanking = `DELETE FROM ranking_entries WHERE game_id = ? AND board_id = ? AND player_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;
const auditByRef = 'SELECT audit_id AS auditId FROM admin_audit_log WHERE audit_ref = ?';

type KeyRow = { ref: string; hash: string; afterJson: string; auditId: number };

// 品目の定義（item.put）。1 文目は監査の行で、前は同じ文の中で読んだ種類（無ければ NULL）。種類の違う品目があれば入らない
const itemKind = 'SELECT kind FROM inventory_items WHERE game_id = ? AND item_id = ?';
const insertItemAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'item.put', ?, (SELECT json_object('kind', kind) FROM inventory_items WHERE game_id = ? AND item_id = ?), ?, ?, ?
  WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE game_id = ? AND item_id = ? AND kind <> ?)`;
// 同じ種類の品目があれば何もしない
const insertItem = `INSERT INTO inventory_items (game_id, item_id, kind)
  SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, item_id) DO NOTHING`;

// イベントの定義（event.put）
const isoColumn = (column: string) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${column}, 'unixepoch')`;
const eventState = `SELECT kind, starts_at AS startsAt, reset_offset_minutes AS offsetMinutes,
    EXISTS (SELECT 1 FROM event_claims c WHERE c.game_id = e.game_id AND c.event_id = e.event_id) AS claimed
  FROM events e WHERE e.game_id = ? AND e.event_id = ?`;
const eventCount = 'SELECT COUNT(*) AS n FROM events WHERE game_id = ?';
/** 報酬の品目のうち、そのゲームにあるものの数を数える文（品目の数だけ ? を並べる）。 */
const knownItems = (n: number) =>
  `SELECT COUNT(*) AS n FROM inventory_items WHERE game_id = ? AND item_id IN (${Array(n).fill('?').join(', ')})`;
/**
 * 1 文目（監査の行）。前の定義は同じ文の中で読む（無ければ NULL）。報酬の品目が全部あり、受け取りのあるイベントの区切り・始まり・時差を変えず、
 * 新しいイベントなら宣言の数が上限（MAX_EVENTS）より少ないときだけ入る。
 */
const insertEventAudit = (n: number) => `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'event.put', ?,
    (SELECT json_object('kind', kind, 'startsAt', ${isoColumn('starts_at')}, 'endsAt', ${isoColumn('ends_at')},
        'resetOffsetMinutes', reset_offset_minutes,
        'rewards', json((SELECT json_group_array(json_object('itemId', item_id, 'amount', amount))
          FROM (SELECT item_id, amount FROM event_rewards WHERE game_id = ? AND event_id = ? ORDER BY item_id))))
      FROM events WHERE game_id = ? AND event_id = ?),
    ?, ?, ?
  WHERE (${knownItems(n)}) = ?
    AND NOT EXISTS (SELECT 1 FROM events e WHERE e.game_id = ? AND e.event_id = ?
      AND (e.kind <> ? OR e.starts_at <> ? OR e.reset_offset_minutes <> ?)
      AND EXISTS (SELECT 1 FROM event_claims c WHERE c.game_id = e.game_id AND c.event_id = e.event_id))
    AND (EXISTS (SELECT 1 FROM events WHERE game_id = ? AND event_id = ?) OR (SELECT COUNT(*) FROM events WHERE game_id = ?) < ?)`;
// 続く文は、この要求の監査の行が入ったときだけ書く
const upsertEvent = `INSERT INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes)
  SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, event_id) DO UPDATE SET
    kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at, reset_offset_minutes = excluded.reset_offset_minutes`;
const deleteRewards = `DELETE FROM event_rewards WHERE game_id = ? AND event_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;
const insertReward = `INSERT INTO event_rewards (game_id, event_id, item_id, amount)
  SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

type EventState = { kind: string; startsAt: number; offsetMinutes: number; claimed: number };

/** 受け取りのあるイベントで、区切り・始まり・時差のどれかを変えようとしているか。 */
function changesClaimedPeriod(state: EventState | undefined, def: EventDefinition): boolean {
  return !!state && state.claimed === 1
    && (state.kind !== def.kind || state.startsAt !== def.startsAt || state.offsetMinutes !== def.resetOffsetMinutes);
}

const tooManyEvents = () => error('INVALID_ARGUMENT', `A game can declare at most ${MAX_EVENTS} events`, 400);

/** 新しいイベントで、宣言の数が上限に届いているか（あるイベントの置き換えは数えない）。 */
async function eventsFull(db: Database, gameId: string, state: EventState | undefined): Promise<boolean> {
  if (state) return false;
  const count = (await db.prepare(eventCount).bind(gameId).all<{ n: number }>()).results[0]?.n ?? 0;
  return count >= MAX_EVENTS;
}

/** 報酬の品目が全部そのゲームにあるか。 */
async function rewardItemsExist(db: Database, gameId: string, def: EventDefinition): Promise<boolean> {
  const ids = def.rewards.map((r) => r.itemId);
  const row = (await db.prepare(knownItems(ids.length)).bind(gameId, ...ids).all<{ n: number }>()).results[0];
  return row?.n === ids.length;
}

/** 応答と監査の後の状態に使う定義（時刻は ISO 8601 の UTC の秒まで）。 */
function shownDefinition(def: EventDefinition) {
  return { kind: def.kind, startsAt: isoSeconds(def.startsAt), endsAt: isoSeconds(def.endsAt),
    resetOffsetMinutes: def.resetOffsetMinutes, rewards: def.rewards };
}

// プレイヤーデータのキーの宣言（player-data-key.put）。前の宣言は同じ文の中で読む（無ければ NULL）。値の行があるキーの書き方を変えず、
// 新しいキーなら宣言の数が上限より少ないときだけ入る
const dataKeyState = `SELECT k.mode AS mode, EXISTS (SELECT 1 FROM player_data d WHERE d.game_id = k.game_id AND d.key = k.key) AS used
  FROM player_data_keys k WHERE k.game_id = ? AND k.key = ?`;
const dataKeyCount = 'SELECT COUNT(*) AS n FROM player_data_keys WHERE game_id = ?';
const insertDataKeyAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'player-data-key.put', ?,
    (SELECT json_object('mode', mode, 'maxValue', max_value, 'maxDelta', max_delta) FROM player_data_keys WHERE game_id = ? AND key = ?),
    ?, ?, ?
  WHERE NOT EXISTS (SELECT 1 FROM player_data_keys k WHERE k.game_id = ? AND k.key = ? AND k.mode <> ?
      AND EXISTS (SELECT 1 FROM player_data d WHERE d.game_id = k.game_id AND d.key = k.key))
    AND (EXISTS (SELECT 1 FROM player_data_keys WHERE game_id = ? AND key = ?)
      OR (SELECT COUNT(*) FROM player_data_keys WHERE game_id = ?) < ?)`;
const upsertDataKey = `INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, key) DO UPDATE SET mode = excluded.mode, max_value = excluded.max_value, max_delta = excluded.max_delta`;

// 実績の宣言（achievement.put）。キーの宣言があり、解いた人のいる実績のキーを変えないときだけ入る
const dataKeyMax = 'SELECT max_value AS maxValue FROM player_data_keys WHERE game_id = ? AND key = ?';
const achievementState = `SELECT a.key AS key,
    EXISTS (SELECT 1 FROM player_achievements p WHERE p.game_id = a.game_id AND p.achievement_id = a.achievement_id) AS unlocked
  FROM achievements a WHERE a.game_id = ? AND a.achievement_id = ?`;
const insertAchievementAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'achievement.put', ?,
    (SELECT json_object('key', key, 'threshold', threshold) FROM achievements WHERE game_id = ? AND achievement_id = ?), ?, ?, ?
  WHERE EXISTS (SELECT 1 FROM player_data_keys WHERE game_id = ? AND key = ?)
    AND NOT EXISTS (SELECT 1 FROM achievements a WHERE a.game_id = ? AND a.achievement_id = ? AND a.key <> ?
      AND EXISTS (SELECT 1 FROM player_achievements p WHERE p.game_id = a.game_id AND p.achievement_id = a.achievement_id))`;
const upsertAchievement = `INSERT INTO achievements (game_id, achievement_id, key, threshold)
  SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, achievement_id) DO UPDATE SET key = excluded.key, threshold = excluded.threshold`;

// 値を置く（player-data.set）。前の値は同じ文の中で読む（行が無ければ NULL）。プレイヤーとキーがあり、値がキーの上限以下のときだけ入る。
// 実績の文は書かない（解かない・取り消さない）
const insertDataSetAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'player-data.set', 'player:' || ?,
    (SELECT json_object('key', key, 'value', value) FROM player_data WHERE game_id = ? AND player_id = ? AND key = ?), ?, ?, ?
  WHERE EXISTS (SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?)
    AND EXISTS (SELECT 1 FROM player_data_keys WHERE game_id = ? AND key = ? AND max_value >= ?)`;
const upsertDataValue = `INSERT INTO player_data (game_id, player_id, key, value, updated_at)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, player_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;
// 区切りの値（デイリー・週間のクエストの進捗）を新しい値で頭打ちにする。下げるだけで上げない（上げた分がどの区切りの分か決まらない）。
// 監査の前と後は合計の値のまま（区切りの値は合計から決まる写し。quest-design.md §8。バインドは 6）
const capPeriodValues = `UPDATE player_data_period_values SET value = MIN(value, ?), updated_at = ?
  WHERE game_id = ? AND player_id = ? AND key = ? AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

// 実績の取り消し（achievement.revoke）。1 文目は解いた行があるときだけ入る（前は消す行）
const insertRevokeAudit = `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'achievement.revoke', 'player:' || ?,
    json_object('achievementId', achievement_id, 'unlockedAt', ${isoColumn('unlocked_at')}), NULL, ?, ?
  FROM player_achievements WHERE game_id = ? AND player_id = ? AND achievement_id = ?`;
const deleteUnlocked = `DELETE FROM player_achievements WHERE game_id = ? AND player_id = ? AND achievement_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

type DataKeyState = { mode: PlayerDataMode; used: number };

const lockedMode = () => error('INVALID_ARGUMENT', 'mode of a key with values cannot be changed', 400);
const tooManyKeys = () => error('INVALID_ARGUMENT', `A game can declare at most ${MAX_PLAYER_DATA_KEYS} keys`, 400);
const lockedAchievementKey = () => error('INVALID_ARGUMENT', 'key of an unlocked achievement cannot be changed', 400);
const unknownKey = () => error('NOT_FOUND', 'Unknown key', 404);

/** キーの宣言を断る理由（値のある書き方の変更・宣言の数）。断らなければ null。 */
async function dataKeyRefusal(db: Database, gameId: string, key: string, mode: PlayerDataMode): Promise<Response | null> {
  const state = (await db.prepare(dataKeyState).bind(gameId, key).all<DataKeyState>()).results[0];
  if (state) return state.used === 1 && state.mode !== mode ? lockedMode() : null;
  const count = (await db.prepare(dataKeyCount).bind(gameId).all<{ n: number }>()).results[0]?.n ?? 0;
  return count >= MAX_PLAYER_DATA_KEYS ? tooManyKeys() : null;
}

/** 実績の宣言を断る理由（キーの宣言が無い・解いた人のいる実績のキーの変更）。断らなければ null。 */
async function achievementRefusal(db: Database, gameId: string, achievementId: string, key: string): Promise<Response | null> {
  if (!(await db.prepare(dataKeyMax).bind(gameId, key).all()).results[0]) return unknownKey();
  const state = (await db.prepare(achievementState).bind(gameId, achievementId).all<{ key: string; unlocked: number }>()).results[0];
  return state && state.unlocked === 1 && state.key !== key ? lockedAchievementKey() : null;
}

/** 値を置くのを断る理由（プレイヤー・キーが無い・キーの上限を超える）。断らなければ null。 */
async function dataSetRefusal(db: Database, gameId: string, playerId: string, key: string, value: number): Promise<Response | null> {
  if (!(await db.prepare(player).bind(gameId, playerId).all()).results[0]) return error('NOT_FOUND', 'Unknown player', 404);
  const def = (await db.prepare(dataKeyMax).bind(gameId, key).all<{ maxValue: number }>()).results[0];
  if (!def) return unknownKey();
  return value > def.maxValue ? error('INVALID_ARGUMENT', `value must be 0..${def.maxValue} for key ${key}`, 400) : null;
}

// クエストの定義（PUT /v1/admin/quests/{questId}・quest.put）。正は quest-design.md §8
const questKeyState = `SELECT k.mode AS mode,
    (SELECT p.reset_offset_minutes FROM player_data_key_periods p WHERE p.game_id = k.game_id AND p.key = k.key AND p.kind = ?) AS periodOffset
  FROM player_data_keys k WHERE k.game_id = ? AND k.key = ?`;
const questState = `SELECT kind, starts_at AS startsAt, reset_offset_minutes AS offsetMinutes, key,
    EXISTS (SELECT 1 FROM quest_claims c WHERE c.game_id = x.game_id AND c.quest_id = x.quest_id) AS claimed
  FROM quests x WHERE x.game_id = ? AND x.quest_id = ?`;
const questCount = 'SELECT COUNT(*) AS n FROM quests WHERE game_id = ?';
/**
 * 1 文目（監査の行）。前の定義は同じ文の中で読む（無ければ NULL）。報酬の品目が全部あり、キーの宣言があり（区切りのあるクエストは add のキー）、
 * 同じ区切りの宣言が違う時差でなく、受け取りのあるクエストの区切り・始まり・時差・キーを変えず、新しいクエストなら宣言の数が上限より少ないときだけ入る。
 */
const insertQuestAudit = (n: number) => `INSERT INTO admin_audit_log (audit_ref, game_id, actor, action, target, before_json, after_json, reason, created_at)
  SELECT ?, ?, ?, 'quest.put', ?,
    (SELECT json_object('kind', kind, 'startsAt', ${isoColumn('starts_at')}, 'endsAt', ${isoColumn('ends_at')},
        'resetOffsetMinutes', reset_offset_minutes, 'key', key, 'threshold', threshold,
        'rewards', json((SELECT json_group_array(json_object('itemId', item_id, 'amount', amount))
          FROM (SELECT item_id, amount FROM quest_rewards WHERE game_id = ? AND quest_id = ? ORDER BY item_id))))
      FROM quests WHERE game_id = ? AND quest_id = ?),
    ?, ?, ?
  WHERE (${knownItems(n)}) = ?
    AND EXISTS (SELECT 1 FROM player_data_keys WHERE game_id = ? AND key = ? AND (? = 'once' OR mode = 'add'))
    AND NOT EXISTS (SELECT 1 FROM player_data_key_periods WHERE game_id = ? AND key = ? AND kind = ? AND reset_offset_minutes <> ?)
    AND NOT EXISTS (SELECT 1 FROM quests x WHERE x.game_id = ? AND x.quest_id = ?
      AND (x.kind <> ? OR x.starts_at <> ? OR x.reset_offset_minutes <> ? OR x.key <> ?)
      AND EXISTS (SELECT 1 FROM quest_claims c WHERE c.game_id = x.game_id AND c.quest_id = x.quest_id))
    AND (EXISTS (SELECT 1 FROM quests WHERE game_id = ? AND quest_id = ?) OR (SELECT COUNT(*) FROM quests WHERE game_id = ?) < ?)`;
// 続く文は、この要求の監査の行が入ったときだけ書く。区切りの宣言は区切りのあるクエストだけ（同じ時差の宣言があれば何もしない）
const insertKeyPeriod = `INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, key, kind) DO NOTHING`;
const upsertQuest = `INSERT INTO quests (game_id, quest_id, kind, starts_at, ends_at, reset_offset_minutes, key, threshold)
  SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, quest_id) DO UPDATE SET
    kind = excluded.kind, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
    reset_offset_minutes = excluded.reset_offset_minutes, key = excluded.key, threshold = excluded.threshold`;
const deleteQuestRewards = `DELETE FROM quest_rewards WHERE game_id = ? AND quest_id = ?
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;
const insertQuestReward = `INSERT INTO quest_rewards (game_id, quest_id, item_id, amount)
  SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)`;

type QuestState = { kind: string; startsAt: number; offsetMinutes: number; key: string; claimed: number };

const lockedQuest = () =>
  error('INVALID_ARGUMENT', 'A claimed quest cannot change kind, startsAt, resetOffsetMinutes or key', 400);

/**
 * クエストの定義を断る理由。キーの宣言が無い（404 Unknown key）→ 報酬の品目が無い（404 Unknown item）→ 区切りのあるクエストで add でないキー・
 * 同じ区切りの宣言の時差の違い（400）→ 受け取りのあるクエストの区切り・始まり・時差・キーの変更（400）→ 新しいクエストで宣言の数が上限（400）。
 * 断らなければ null。
 */
async function questRefusal(db: Database, gameId: string, questId: string, def: QuestDefinition): Promise<Response | null> {
  const key = (await db.prepare(questKeyState).bind(def.kind, gameId, def.key).all<{ mode: PlayerDataMode; periodOffset: number | null }>())
    .results[0];
  if (!key) return unknownKey();
  if (!await rewardItemsExist(db, gameId, def)) return error('NOT_FOUND', 'Unknown item', 404);
  if (def.kind !== 'once') {
    if (key.mode !== 'add') return error('INVALID_ARGUMENT', 'daily and weekly quests need an add key', 400);
    if (key.periodOffset !== null && key.periodOffset !== def.resetOffsetMinutes) {
      return error('INVALID_ARGUMENT', `key ${def.key} already counts ${def.kind} periods with resetOffsetMinutes ${key.periodOffset}`, 400);
    }
  }
  const state = (await db.prepare(questState).bind(gameId, questId).all<QuestState>()).results[0];
  if (state) {
    return state.claimed === 1 && (state.kind !== def.kind || state.startsAt !== def.startsAt
      || state.offsetMinutes !== def.resetOffsetMinutes || state.key !== def.key) ? lockedQuest() : null;
  }
  const count = (await db.prepare(questCount).bind(gameId).all<{ n: number }>()).results[0]?.n ?? 0;
  return count >= MAX_QUESTS ? error('INVALID_ARGUMENT', `A game can declare at most ${MAX_QUESTS} quests`, 400) : null;
}

/** 応答と監査の後の状態に使うクエストの定義（時刻は ISO 8601 の UTC の秒まで）。 */
function shownQuest(def: QuestDefinition) {
  return { ...shownDefinition(def), key: def.key, threshold: def.threshold };
}

const lockedEvent = () => error('INVALID_ARGUMENT', 'A claimed event cannot change kind, startsAt or resetOffsetMinutes', 400);
const changedKind = () => error('INVALID_ARGUMENT', 'Item kind cannot be changed', 400);

export const adminRoutes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const playerId = match[1];
      const found = await env.DB.prepare(player).bind(gameId, playerId).all<{ createdAt: string }>();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const [banned, b, h, s, r, dv, da, qc] = await Promise.all([
        env.DB.prepare(ban).bind(gameId, playerId).all<BanRow>(),
        env.DB.prepare(balances).bind(gameId, playerId).all<{ itemId: string; kind: string; amount: number }>(),
        env.DB.prepare(history).bind(gameId, playerId, PLAYER_HISTORY_ROWS).all<HistoryRow>(),
        env.DB.prepare(saves).bind(gameId, playerId).all<SaveRow>(),
        env.DB.prepare(rankings).bind(gameId, playerId).all<{ boardId: string; score: number; displayName: string }>(),
        env.DB.prepare(playerDataValues).bind(gameId, playerId).all<PlayerDataRow>(),
        env.DB.prepare(playerAchievements).bind(gameId, playerId).all<PlayerAchievementRow>(),
        env.DB.prepare(playerQuestClaims).bind(gameId, playerId, PLAYER_QUEST_CLAIM_ROWS).all<QuestClaimRow>(),
      ]);
      // 止めた印は効いているものだけ載せる（止めていなければ欄ごと載せない）
      const active = banned.results.find((row) => isBanActive(row, serverNow()));
      return json({
        gameId, playerId, createdAt: found.results[0].createdAt,
        ...(active ? { ban: { reason: active.reason, bannedAt: isoSeconds(active.bannedAt),
          expiresAt: active.expiresAt === null ? null : isoSeconds(active.expiresAt) } } : {}),
        balances: b.results,
        history: h.results.map((row) => ({ ...row, createdAt: isoSeconds(row.createdAt) })),
        saves: s.results.map((row) => ({ ...row, deleted: row.deleted === 1 })),
        rankings: r.results,
        playerData: {
          values: dv.results.map((row) => ({ key: row.key, mode: row.mode, value: row.value, updatedAt: isoSeconds(row.updatedAt) })),
          achievements: da.results.map((row) => ({ achievementId: row.achievementId, unlockedAt: isoSeconds(row.unlockedAt), writeId: row.writeId })),
        },
        questClaims: qc.results.map((row) => ({ ...row, claimedAt: isoSeconds(row.claimedAt) })),
      });
    },
  },
  {
    method: 'PUT',
    pattern: banPath,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const playerId = match[1];
      const now = serverNow();
      const expires = parseExpiresAt(body.expiresAt, now);
      if (!expires.ok) return error('INVALID_ARGUMENT', expires.message, 400);
      const found = await env.DB.prepare(player).bind(gameId, playerId).all();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const expiresAt = expires.value === null ? null : isoSeconds(expires.value);
      const ref = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(insertBanAudit).bind(ref, gameId, actor, 'player.ban', `player:${playerId}`, gameId, playerId,
          JSON.stringify({ reason, expiresAt }), reason, now),
        env.DB.prepare(upsertBan).bind(gameId, playerId, reason, now, expires.value, ref),
      ]);
      return json({ gameId, playerId, bannedAt: isoSeconds(now), expiresAt });
    },
  },
  {
    method: 'DELETE',
    pattern: banPath,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason } = access;
      const playerId = match[1];
      const found = await env.DB.prepare(player).bind(gameId, playerId).all();
      if (!found.results[0]) return error('NOT_FOUND', 'Unknown player', 404);
      const ref = crypto.randomUUID();
      // 印が無くても監査の行は残し、200 を返す（同じ結果）
      await env.DB.batch([
        env.DB.prepare(insertBanAudit).bind(ref, gameId, actor, 'player.unban', `player:${playerId}`, gameId, playerId,
          null, reason, serverNow()),
        env.DB.prepare(deleteBan).bind(gameId, playerId, ref),
      ]);
      return json({ gameId, playerId, banned: false });
    },
  },
  {
    method: 'POST',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/inventory$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const playerId = match[1];
      const key = parseIdempotencyKey(req.headers.get('Idempotency-Key'));
      if (key === null) return error('INVALID_ARGUMENT', 'Invalid Idempotency-Key', 400);
      const parsed = parseAdjustment(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const { itemId, delta } = parsed.value;
      const hash = await requestHash({ action: 'inventory.adjust', gameId, playerId, itemId, delta, reason });
      const ref = crypto.randomUUID();
      const now = serverNow();
      await env.DB.batch([
        env.DB.prepare(insertAdjustAudit).bind(ref, gameId, key, hash, actor, playerId, itemId, itemId, delta, reason, now,
          gameId, playerId, itemId, delta, MAX_ITEM_AMOUNT, gameId, itemId, gameId, playerId),
        ...adjustStatements(env.DB, { gameId, playerId, itemId, delta, sourceType: LEDGER_SOURCES.admin, sourceId: ref, now }),
      ]);
      const row = (await env.DB.prepare(auditByKey).bind(gameId, key).all<KeyRow>()).results[0];
      if (row) {
        // この要求の行か、同じ中身の前の要求（二重）。どちらも監査の行から同じ本文を作る
        if (row.ref !== ref && row.hash !== hash) {
          return error('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for a different request', 422);
        }
        const after = JSON.parse(row.afterJson) as { amount: number };
        return json({ gameId, playerId, itemId, delta, amount: after.amount, auditId: row.auditId });
      }
      // 何も書いていない。品目・プレイヤー（404）→ 残高の下限（409）→ 上限（409）の順で見分ける
      const found = (await env.DB.prepare(adjustDiagnosis).bind(gameId, itemId, gameId, playerId, gameId, playerId, itemId)
        .all<{ item: number | null; player: number | null; cur: number }>()).results[0];
      if (!found || found.item === null) return error('NOT_FOUND', 'Unknown item', 404);
      if (found.player === null) return error('NOT_FOUND', 'Unknown player', 404);
      const next = found.cur + delta;
      // 0 以上・上限以下なら、batch と読み直しの間に別の修正で残高が動いた。増減の向きで決める（同じ鍵で流し直せる）
      const insufficient = next < 0 || (next <= MAX_ITEM_AMOUNT && delta < 0);
      return insufficient
        ? error('INSUFFICIENT_BALANCE', 'Adjustment would make the balance negative', 409)
        : error('INVENTORY_LIMIT_EXCEEDED', 'Adjustment would exceed the inventory limit', 409);
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/admin\/rankings\/([a-zA-Z0-9_-]{1,64})\/entries\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason } = access;
      const [, boardId, playerId] = match;
      const ref = crypto.randomUUID();
      // ランキングの行だけを見る（game_players に無いプレイヤーの行も消せる）
      await env.DB.batch([
        env.DB.prepare(insertRankingAudit).bind(ref, gameId, actor, `ranking:${boardId}:${playerId}`, reason, serverNow(),
          gameId, boardId, playerId),
        env.DB.prepare(deleteRanking).bind(gameId, boardId, playerId, ref),
      ]);
      const written = (await env.DB.prepare(auditByRef).bind(ref).all<{ auditId: number }>()).results[0];
      if (!written) return error('NOT_FOUND', 'Unknown ranking entry', 404);
      return json({ gameId, boardId, playerId, deleted: true, auditId: written.auditId });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/admin\/items\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const itemId = match[1];
      const kind = parseItemKind(body.kind);
      if (kind === null) return error('INVALID_ARGUMENT', 'kind must be currency or item', 400);
      // 種類は後から変えない（残高と報酬が種類を前提にしている）。同じ種類なら何も変えず、監査の行は残す
      const current = (await env.DB.prepare(itemKind).bind(gameId, itemId).all<{ kind: string }>()).results[0];
      if (current && current.kind !== kind) return changedKind();
      const ref = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(insertItemAudit).bind(ref, gameId, actor, `item:${itemId}`, gameId, itemId, JSON.stringify({ kind }), reason,
          serverNow(), gameId, itemId, kind),
        env.DB.prepare(insertItem).bind(gameId, itemId, kind, ref),
      ]);
      // 読んでから書くまでの間に別の種類で入った
      if (!(await env.DB.prepare(auditByRef).bind(ref).all()).results[0]) return changedKind();
      return json({ gameId, itemId, kind });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/admin\/events\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const eventId = match[1];
      const parsed = parseEventDefinition(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const def = parsed.value;
      if (!await rewardItemsExist(env.DB, gameId, def)) return error('NOT_FOUND', 'Unknown item', 404);
      const state = (await env.DB.prepare(eventState).bind(gameId, eventId).all<EventState>()).results[0];
      if (changesClaimedPeriod(state, def)) return lockedEvent();
      if (await eventsFull(env.DB, gameId, state)) return tooManyEvents();
      const ids = def.rewards.map((r) => r.itemId);
      const shown = shownDefinition(def);
      const ref = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(insertEventAudit(ids.length)).bind(ref, gameId, actor, `event:${eventId}`, gameId, eventId, gameId, eventId,
          JSON.stringify(shown), reason, serverNow(), gameId, ...ids, ids.length, gameId, eventId, def.kind, def.startsAt,
          def.resetOffsetMinutes, gameId, eventId, gameId, MAX_EVENTS),
        env.DB.prepare(upsertEvent).bind(gameId, eventId, def.kind, def.startsAt, def.endsAt, def.resetOffsetMinutes, ref),
        env.DB.prepare(deleteRewards).bind(gameId, eventId, ref),
        ...def.rewards.map((r) => env.DB.prepare(insertReward).bind(gameId, eventId, r.itemId, r.amount, ref)),
      ]);
      if (!(await env.DB.prepare(auditByRef).bind(ref).all()).results[0]) {
        // 読んでから書くまでの間に品目・受け取り・イベントの数が変わった。何も書いていないので、もう一度見分ける
        if (!await rewardItemsExist(env.DB, gameId, def)) return error('NOT_FOUND', 'Unknown item', 404);
        const current = (await env.DB.prepare(eventState).bind(gameId, eventId).all<EventState>()).results[0];
        return await eventsFull(env.DB, gameId, current) ? tooManyEvents() : lockedEvent();
      }
      return json({ gameId, eventId, ...shown });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/admin\/quests\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const questId = match[1];
      const parsed = parseQuestDefinition(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const def = parsed.value;
      const refused = await questRefusal(env.DB, gameId, questId, def);
      if (refused) return refused;
      const ids = def.rewards.map((r) => r.itemId);
      const shown = shownQuest(def);
      const ref = crypto.randomUUID();
      const now = serverNow();
      await env.DB.batch([
        env.DB.prepare(insertQuestAudit(ids.length)).bind(ref, gameId, actor, `quest:${questId}`, gameId, questId, gameId, questId,
          JSON.stringify(shown), reason, now, gameId, ...ids, ids.length, gameId, def.key, def.kind, gameId, def.key, def.kind,
          def.resetOffsetMinutes, gameId, questId, def.kind, def.startsAt, def.resetOffsetMinutes, def.key, gameId, questId, gameId,
          MAX_QUESTS),
        ...(def.kind === 'once' ? [] : [env.DB.prepare(insertKeyPeriod).bind(gameId, def.key, def.kind, def.resetOffsetMinutes, now, ref)]),
        env.DB.prepare(upsertQuest).bind(gameId, questId, def.kind, def.startsAt, def.endsAt, def.resetOffsetMinutes, def.key, def.threshold,
          ref),
        env.DB.prepare(deleteQuestRewards).bind(gameId, questId, ref),
        ...def.rewards.map((r) => env.DB.prepare(insertQuestReward).bind(gameId, questId, r.itemId, r.amount, ref)),
      ]);
      if (!(await env.DB.prepare(auditByRef).bind(ref).all()).results[0]) {
        // 読んでから書くまでの間に宣言・品目・受け取り・クエストの数が変わった。何も書いていないので、もう一度見分ける
        return await questRefusal(env.DB, gameId, questId, def) ?? lockedQuest();
      }
      return json({ gameId, questId, ...shown });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/admin\/player-data\/keys\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const key = match[1];
      const parsed = parsePlayerDataKey(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const def = parsed.value;
      const refused = await dataKeyRefusal(env.DB, gameId, key, def.mode);
      if (refused) return refused;
      const ref = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(insertDataKeyAudit).bind(ref, gameId, actor, `player-data-key:${key}`, gameId, key, JSON.stringify(def), reason,
          serverNow(), gameId, key, def.mode, gameId, key, gameId, MAX_PLAYER_DATA_KEYS),
        env.DB.prepare(upsertDataKey).bind(gameId, key, def.mode, def.maxValue, def.maxDelta, ref),
      ]);
      if (!(await env.DB.prepare(auditByRef).bind(ref).all()).results[0]) {
        // 読んでから書くまでの間に値が書かれたか、宣言が増えた。何も書いていないので、もう一度見分ける
        return await dataKeyRefusal(env.DB, gameId, key, def.mode) ?? tooManyKeys();
      }
      return json({ gameId, key, ...def });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/admin\/achievements\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const achievementId = match[1];
      const parsed = parseAchievement(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const { key, threshold } = parsed.value;
      const refused = await achievementRefusal(env.DB, gameId, achievementId, key);
      if (refused) return refused;
      const ref = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(insertAchievementAudit).bind(ref, gameId, actor, `achievement:${achievementId}`, gameId, achievementId,
          JSON.stringify({ key, threshold }), reason, serverNow(), gameId, key, gameId, achievementId, key),
        env.DB.prepare(upsertAchievement).bind(gameId, achievementId, key, threshold, ref),
      ]);
      if (!(await env.DB.prepare(auditByRef).bind(ref).all()).results[0]) {
        return await achievementRefusal(env.DB, gameId, achievementId, key) ?? lockedAchievementKey();
      }
      return json({ gameId, achievementId, key, threshold });
    },
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/player-data\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason, body } = access;
      const [, playerId, key] = match;
      const parsed = parsePlayerDataValue(body);
      if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
      const value = parsed.value;
      const refused = await dataSetRefusal(env.DB, gameId, playerId, key, value);
      if (refused) return refused;
      const ref = crypto.randomUUID();
      const now = serverNow();
      await env.DB.batch([
        env.DB.prepare(insertDataSetAudit).bind(ref, gameId, actor, playerId, gameId, playerId, key, JSON.stringify({ key, value }), reason, now,
          gameId, playerId, gameId, key, value),
        env.DB.prepare(upsertDataValue).bind(gameId, playerId, key, value, now, ref),
        env.DB.prepare(capPeriodValues).bind(value, now, gameId, playerId, key, ref),
      ]);
      const written = (await env.DB.prepare(auditByRef).bind(ref).all<{ auditId: number }>()).results[0];
      if (!written) {
        // 読んでから書くまでの間に宣言の上限が下がった。何も書いていないので、もう一度見分ける
        return await dataSetRefusal(env.DB, gameId, playerId, key, value) ?? error('INVALID_ARGUMENT', 'value is out of range', 400);
      }
      return json({ gameId, playerId, key, value, auditId: written.auditId });
    },
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/admin\/players\/([a-zA-Z0-9_-]{1,64})\/achievements\/([a-zA-Z0-9_-]{1,64})$/,
    async handle(req, env, match, url, known) {
      const access = await checkAdminWrite(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId, actor, reason } = access;
      const [, playerId, achievementId] = match;
      const ref = crypto.randomUUID();
      // 解いた行だけを見る（無ければ監査の行も入らない）
      await env.DB.batch([
        env.DB.prepare(insertRevokeAudit).bind(ref, gameId, actor, playerId, reason, serverNow(), gameId, playerId, achievementId),
        env.DB.prepare(deleteUnlocked).bind(gameId, playerId, achievementId, ref),
      ]);
      const written = (await env.DB.prepare(auditByRef).bind(ref).all<{ auditId: number }>()).results[0];
      if (!written) return error('NOT_FOUND', 'Unknown achievement', 404);
      return json({ gameId, playerId, achievementId, revoked: true, auditId: written.auditId });
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/audit$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const query = parseAuditQuery(url);
      if (!query.ok) return error('INVALID_ARGUMENT', query.message, 400);
      const { limit, before } = query.value;
      const rows = await env.DB.prepare(listAuditSql).bind(gameId, before, before, limit + 1).all<AuditRow>();
      const page = rows.results.slice(0, limit);
      const items = page.map(shapeAuditRow);
      const more = rows.results.length > limit;
      return json(more ? { gameId, items, nextBefore: page[page.length - 1].auditId } : { gameId, items });
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/analytics\/players$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const now = serverNow();
      const range = parseAnalyticsRange(url, now);
      if (!range.ok) return error('INVALID_ARGUMENT', range.message, 400);
      const { from, to } = range.value;
      const [daily, cohorts] = await Promise.all([
        env.DB.prepare(dailyActivitySql).bind(gameId, from, to).all<DailyRow>(),
        env.DB.prepare(cohortRetentionSql).bind(gameId, from, to).all<CohortRow>(),
      ]);
      // 数と日付だけ（playerId・行ごとの時刻を入れない）
      return json({
        gameId, from, to, timezone: 'UTC', serverTime: isoSeconds(now),
        days: fillDays(from, to, daily.results),
        cohorts: shapeCohorts(cohorts.results, activityDay(now)),
      });
    },
  },
  {
    method: 'GET',
    pattern: /^\/v1\/admin\/analytics\/grants$/,
    async handle(req, env, _match, url, known) {
      const access = await checkAdmin(req, env, url, known);
      if (!access.ok) return access.response;
      const { gameId } = access;
      const now = serverNow();
      const range = parseAnalyticsRange(url, now);
      if (!range.ok) return error('INVALID_ARGUMENT', range.message, 400);
      const { from, to } = range.value;
      const { start, end } = rangeSeconds(range.value);
      const [grants, claims] = await Promise.all([
        env.DB.prepare(grantsSql).bind(gameId, start, end).all<GrantRow>(),
        env.DB.prepare(questClaimsSql).bind(gameId, start, end).all<QuestClaimCountRow>(),
      ]);
      // 数と日付と品目・クエストの ID だけ（playerId・行ごとの時刻を入れない）
      return json({ gameId, from, to, timezone: 'UTC', serverTime: isoSeconds(now), ...shapeGrants(grants.results, claims.results) });
    },
  },
];
