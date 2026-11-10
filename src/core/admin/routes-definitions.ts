// routes-definitions.ts — 管理の口のうち、品目・イベント・クエストの定義を置く口（item.put・event.put・quest.put）。
//
// 品目の種類の違い・報酬の品目の有無・受け取りのあるイベントとクエストの守り・宣言の数・クエストの見るキーと区切りの宣言は、
// 先に読んで断り、監査の行の文の条件にも入れる（読んでから書くまでの間に変わっても書かない）。クエストの閾値はキーの上限以下（hardening-design.md §3.2）。
// 読み直しても断る理由が無い競合は conflicted の文（common.ts）。
// クエストの定義の口は、デイリー・週間のクエストのキーの区切りの宣言（player_data_key_periods）を同じ batch で入れ・付け替え・消し、
// 数の上限は src/core/quests.ts。付け替えと消すのは、ほかのクエストが参照しない宣言だけ（hardening-design.md §3.3）。
// 正は docs/guides/working/admin-design.md §7 と docs/guides/working/quest-design.md §8。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import type { Database } from '../env';
import { error, json } from '../http';
import { MAX_EVENTS } from '../inventory';
import type { Route } from '../module';
import type { PlayerDataMode } from '../player-data';
import { MAX_QUESTS } from '../quests';
import { isoSeconds } from './audit';
import { auditByRef, checkAdminWrite, conflicted, isoColumn, serverNow, thresholdAboveMax, unknownKey } from './common';
import { type EventDefinition, parseEventDefinition, parseItemKind, parseQuestDefinition, type QuestDefinition } from './parse';

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

// クエストの定義（PUT /v1/admin/quests/{questId}・quest.put）。正は quest-design.md §8
const questKeyState = `SELECT k.mode AS mode, k.max_value AS maxValue,
    (SELECT p.reset_offset_minutes FROM player_data_key_periods p WHERE p.game_id = k.game_id AND p.key = k.key AND p.kind = ?1) AS periodOffset,
    EXISTS (SELECT 1 FROM quests x WHERE x.game_id = k.game_id AND x.key = k.key AND x.kind = ?1 AND x.quest_id <> ?4) AS sharedPeriod
  FROM player_data_keys k WHERE k.game_id = ?2 AND k.key = ?3`;
const questState = `SELECT kind, starts_at AS startsAt, reset_offset_minutes AS offsetMinutes, key,
    EXISTS (SELECT 1 FROM quest_claims c WHERE c.game_id = x.game_id AND c.quest_id = x.quest_id) AS claimed
  FROM quests x WHERE x.game_id = ? AND x.quest_id = ?`;
const questCount = 'SELECT COUNT(*) AS n FROM quests WHERE game_id = ?';
/**
 * 1 文目（監査の行）。前の定義は同じ文の中で読む（無ければ NULL）。報酬の品目が全部あり、キーの宣言があり（閾値がキーの上限以下・区切りのあるクエストは add のキー）、
 * 同じ区切りの宣言が違う時差なら、そのキー・区切りを参照するほかのクエストが無く、受け取りのあるクエストの区切り・始まり・時差・キーを変えず、
 * 新しいクエストなら宣言の数が上限より少ないときだけ入る（時差を付け替えるクエストは自分だけが参照し、受け取りが無い）。
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
    AND EXISTS (SELECT 1 FROM player_data_keys WHERE game_id = ? AND key = ? AND max_value >= ? AND (? = 'once' OR mode = 'add'))
    AND NOT EXISTS (SELECT 1 FROM player_data_key_periods p WHERE p.game_id = ? AND p.key = ? AND p.kind = ? AND p.reset_offset_minutes <> ?
      AND EXISTS (SELECT 1 FROM quests o WHERE o.game_id = p.game_id AND o.key = p.key AND o.kind = p.kind AND o.quest_id <> ?))
    AND NOT EXISTS (SELECT 1 FROM quests x WHERE x.game_id = ? AND x.quest_id = ?
      AND (x.kind <> ? OR x.starts_at <> ? OR x.reset_offset_minutes <> ? OR x.key <> ?)
      AND EXISTS (SELECT 1 FROM quest_claims c WHERE c.game_id = x.game_id AND c.quest_id = x.quest_id))
    AND (EXISTS (SELECT 1 FROM quests WHERE game_id = ? AND quest_id = ?) OR (SELECT COUNT(*) FROM quests WHERE game_id = ?) < ?)`;
// 続く文は、この要求の監査の行が入ったときだけ書く。
// 定義を変えて参照の無くなった区切りの宣言（このクエストの前のキー・区切りで、ほかのクエストが参照せず、新しい定義のキー・区切りでないもの）を、
// 区切りの値から先に消す（値が宣言を外部キーで指す）。quests を書き換える前に、前の定義を読む
const orphanPeriodOf = (table: string) => `EXISTS (SELECT 1 FROM quests q WHERE q.game_id = ?1 AND q.quest_id = ?2
    AND q.game_id = ${table}.game_id AND q.key = ${table}.key AND q.kind = ${table}.kind AND NOT (q.key = ?3 AND q.kind = ?4)
    AND NOT EXISTS (SELECT 1 FROM quests o WHERE o.game_id = q.game_id AND o.key = q.key AND o.kind = q.kind AND o.quest_id <> q.quest_id))
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?5)`;
const deleteOrphanPeriodValues = `DELETE FROM player_data_period_values WHERE ${orphanPeriodOf('player_data_period_values')}`;
const deleteOrphanKeyPeriod = `DELETE FROM player_data_key_periods WHERE ${orphanPeriodOf('player_data_key_periods')}`;
// 区切りの宣言の時差を付け替えるときは、そのキー・区切りの区切りの値を消す（時差が変わると区切りの鍵がずれ、前の値が当たらなくなる）
const deleteRetimedPeriodValues = `DELETE FROM player_data_period_values WHERE game_id = ?1 AND key = ?2 AND kind = ?3
  AND EXISTS (SELECT 1 FROM player_data_key_periods p WHERE p.game_id = ?1 AND p.key = ?2 AND p.kind = ?3 AND p.reset_offset_minutes <> ?4)
  AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?5)`;
// 区切りの宣言は区切りのあるクエストだけ。無ければ入れ、時差が違えば新しい時差に置き換える（同じ時差なら何もしない）
const upsertKeyPeriod = `INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)
  ON CONFLICT (game_id, key, kind) DO UPDATE SET reset_offset_minutes = excluded.reset_offset_minutes, created_at = excluded.created_at
    WHERE player_data_key_periods.reset_offset_minutes <> excluded.reset_offset_minutes`;
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
 * クエストの定義を断る理由。キーの宣言が無い（404 Unknown key）→ 報酬の品目が無い（404 Unknown item）→ 閾値がキーの上限を超える（400）→
 * 区切りのあるクエストで add でないキー・
 * ほかのクエストも参照する区切りの宣言の時差の違い（400）→ 受け取りのあるクエストの区切り・始まり・時差・キーの変更（400）→
 * 新しいクエストで宣言の数が上限（400）。断らなければ null。
 */
async function questRefusal(db: Database, gameId: string, questId: string, def: QuestDefinition): Promise<Response | null> {
  const key = (await db.prepare(questKeyState).bind(def.kind, gameId, def.key, questId)
    .all<{ mode: PlayerDataMode; maxValue: number; periodOffset: number | null; sharedPeriod: number }>()).results[0];
  if (!key) return unknownKey();
  if (!await rewardItemsExist(db, gameId, def)) return error('NOT_FOUND', 'Unknown item', 404);
  if (def.threshold > key.maxValue) return thresholdAboveMax(def.key, key.maxValue);
  if (def.kind !== 'once') {
    if (key.mode !== 'add') return error('INVALID_ARGUMENT', 'daily and weekly quests need an add key', 400);
    // 時差の違う宣言は、ほかのクエストが参照していれば付け替えない（自分だけなら、受け取りの守りの後で付け替える）
    if (key.periodOffset !== null && key.periodOffset !== def.resetOffsetMinutes && key.sharedPeriod === 1) {
      return error('INVALID_ARGUMENT',
        `key ${def.key} already counts ${def.kind} periods with resetOffsetMinutes ${key.periodOffset} for another quest`, 400);
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

export const definitionRoutes: Route[] = [
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
        if (changesClaimedPeriod(current, def)) return lockedEvent();
        return await eventsFull(env.DB, gameId, current) ? tooManyEvents() : conflicted();
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
          JSON.stringify(shown), reason, now, gameId, ...ids, ids.length, gameId, def.key, def.threshold, def.kind, gameId, def.key, def.kind,
          def.resetOffsetMinutes, questId, gameId, questId, def.kind, def.startsAt, def.resetOffsetMinutes, def.key, gameId, questId, gameId,
          MAX_QUESTS),
        env.DB.prepare(deleteOrphanPeriodValues).bind(gameId, questId, def.key, def.kind, ref),
        env.DB.prepare(deleteOrphanKeyPeriod).bind(gameId, questId, def.key, def.kind, ref),
        ...(def.kind === 'once' ? [] : [
          env.DB.prepare(deleteRetimedPeriodValues).bind(gameId, def.key, def.kind, def.resetOffsetMinutes, ref),
          env.DB.prepare(upsertKeyPeriod).bind(gameId, def.key, def.kind, def.resetOffsetMinutes, now, ref),
        ]),
        env.DB.prepare(upsertQuest).bind(gameId, questId, def.kind, def.startsAt, def.endsAt, def.resetOffsetMinutes, def.key, def.threshold,
          ref),
        env.DB.prepare(deleteQuestRewards).bind(gameId, questId, ref),
        ...def.rewards.map((r) => env.DB.prepare(insertQuestReward).bind(gameId, questId, r.itemId, r.amount, ref)),
      ]);
      if (!(await env.DB.prepare(auditByRef).bind(ref).all()).results[0]) {
        // 読んでから書くまでの間に宣言・品目・受け取り・クエストの数が変わった。何も書いていないので、もう一度見分ける
        return await questRefusal(env.DB, gameId, questId, def) ?? conflicted();
      }
      return json({ gameId, questId, ...shown });
    },
  },
];
