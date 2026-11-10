// routes-player-data.ts — 管理の口のうち、プレイヤーデータのキーと実績の宣言・値を置く口・実績の取り消し。
//
// 値のあるキーの書き方・宣言の数・解いた人のいる実績のキーは、先に読んで断り、監査の行の文の条件にも入れる。
// 値を置く口は実績を判定せず、区切りの値を新しい値で頭打ちにする（下げるだけ）。
// 正は docs/guides/working/player-data-design.md §8 と docs/guides/working/quest-design.md §8。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import type { Database } from '../env';
import { error, json } from '../http';
import type { Route } from '../module';
import { MAX_PLAYER_DATA_KEYS, type PlayerDataMode } from '../player-data';
import { auditByRef, checkAdminWrite, isoColumn, playerSql, serverNow, unknownKey } from './common';
import { parseAchievement, parsePlayerDataKey, parsePlayerDataValue } from './parse';

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
  if (!(await db.prepare(playerSql).bind(gameId, playerId).all()).results[0]) return error('NOT_FOUND', 'Unknown player', 404);
  const def = (await db.prepare(dataKeyMax).bind(gameId, key).all<{ maxValue: number }>()).results[0];
  if (!def) return unknownKey();
  return value > def.maxValue ? error('INVALID_ARGUMENT', `value must be 0..${def.maxValue} for key ${key}`, 400) : null;
}

export const playerDataRoutes: Route[] = [
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
];
