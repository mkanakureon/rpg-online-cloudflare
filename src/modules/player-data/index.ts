// player-data/index.ts — プレイヤーデータのモジュール（GET /v1/player-data の読み取りと POST /v1/player-data の書き込み）。
//
// どちらも APP_ENV=local の門 → トークン → プレイヤーの利用制限（2 つの口を合わせて RATE_LIMITS.playerData。429）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 口ごとの確かめ の順
// （src/core/access.ts の checkPlayerAccess）。プレイヤーはトークンの p だけで決まる（本文・問い合わせの playerId を読まない）。
// 書き込みは Idempotency-Key が必須（形は src/core/idempotency.ts。管理の口のコードは読み込まない）。宣言の無いキーは 404、
// 書き方の範囲の外は 400（src/core/player-data.ts の checkChange）で、どちらも何も書かない。書き込みの記録・値・応答の写しを
// 1 つの batch で書き、記録の一意の鍵（ゲーム・プレイヤー・鍵）で二重を止める。2 回目は 200 で 1 回目と同じ本文。時刻はサーバーの時刻だけ。
// 実績は同じ batch の中でサーバーが解く（書いた後の値が閾値以上で、まだ解いていない実績。主キーで二重に解かない。値が下がっても消さない）。
// 解いたと申告する口は作らず、本文の申告の欄も読まない。POST の unlocked はこの書き込みで解いた実績、GET の achievements は解いた実績の全部。
// 区切りを宣言した add のキー（player_data_key_periods）は、同じ batch で区切りごとの値（player_data_period_values）も足す。区切りの鍵は
// src/core/period.ts の periodKey にサーバーの時刻を渡して決める。区切りの宣言は add のキーがある書き込みのときだけ読む。クエストのモジュールが読むだけで、応答の形は変えない。
// 順と SQL の正は docs/guides/working/player-data-design.md §4〜§7 と docs/guides/working/quest-design.md §6（区切りごとの値）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { checkPlayerAccess } from '../../core/access';
import { MAX_JSON_BODY_BYTES, readJson } from '../../core/body';
import type { Database, Env } from '../../core/env';
import { error, json } from '../../core/http';
import { parseIdempotencyKey } from '../../core/idempotency';
import type { GameModule } from '../../core/module';
import { isoSeconds, periodKey } from '../../core/period';
import { checkChange, type PlayerDataKey, type PlayerDataMode } from '../../core/player-data';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import { parseChanges, writeRequestHash, type Change } from './parse';
import { serverNow } from '../../core/clock';

type ValueRow = { key: string; mode: PlayerDataMode; value: number; updatedAt: number };
type WriteRow = { writeRef: string; requestHash: string; resultJson: string | null };
type WrittenValue = { key: string; value: number };
type UnlockedRow = { achievementId: string; unlockedAt: number };
type KeyPeriod = { key: string; kind: 'daily' | 'weekly'; offsetMinutes: number };

const path = /^\/v1\/player-data$/;

const valuesOf = `SELECT d.key AS key, k.mode AS mode, d.value AS value, d.updated_at AS updatedAt FROM player_data d
  JOIN player_data_keys k ON k.game_id = d.game_id AND k.key = d.key
  WHERE d.game_id = ? AND d.player_id = ? ORDER BY d.key`;
const achievementsOf = `SELECT achievement_id AS achievementId, unlocked_at AS unlockedAt FROM player_achievements
  WHERE game_id = ? AND player_id = ? ORDER BY achievement_id`;
const writeByKey = `SELECT write_ref AS writeRef, request_hash AS requestHash, result_json AS resultJson FROM player_data_writes
  WHERE game_id = ? AND player_id = ? AND request_key = ?`;

// §6 の batch の文。D1 の ?NNN（番号つきの引数）は要確認なので、? を順に bind する（中身は §6 と同じ）。
// 1 つの文の引数は D1 の上限（100）の内に収める: 共通の値は FROM の中で 1 回だけ bind し、add の変更ごとの条件は 3 つ（キー・値・上限）
/** 1. 書き込みの記録。add の書いた後の値がどれも上限の内のときだけ。同じプレイヤーの同じ鍵があれば何もしない。 */
function insertWriteSql(addCount: number): string {
  const conds = Array.from({ length: addCount },
    () => 'COALESCE((SELECT value FROM player_data WHERE game_id = w.g AND player_id = w.p AND key = ?), 0) + ? <= ?');
  return `INSERT INTO player_data_writes (write_ref, game_id, player_id, request_key, request_hash, created_at)
  SELECT w.ref, w.g, w.p, w.k, w.h, w.t FROM (SELECT ? AS ref, ? AS g, ? AS p, ? AS k, ? AS h, ? AS t) w
  WHERE ${conds.length ? conds.join(' AND ') : '1'}
  ON CONFLICT (game_id, player_id, request_key) DO NOTHING`;
}
/** 2. 値（変更ごとに 1 文。この要求の記録が入ったときだけ）。書き方で ON CONFLICT の中身が変わる。 */
const updateByMode: Record<PlayerDataMode, string> = {
  add: 'value = player_data.value + excluded.value, updated_at = excluded.updated_at',
  max: 'value = excluded.value, updated_at = excluded.updated_at WHERE excluded.value > player_data.value',
  set: 'value = excluded.value, updated_at = excluded.updated_at',
  flag: 'value = excluded.value, updated_at = excluded.updated_at WHERE excluded.value > player_data.value',
};
function upsertValueSql(mode: PlayerDataMode): string {
  return `INSERT INTO player_data (game_id, player_id, key, value, updated_at)
  SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM player_data_writes WHERE write_ref = ?)
  ON CONFLICT (game_id, player_id, key) DO UPDATE SET ${updateByMode[mode]}`;
}
/** 2b. 区切りごとの値（区切りを宣言した add のキーの変更ごと・区切りの種類ごとに 1 文。この要求の記録が入ったときだけ。バインドは 8）。 */
const addPeriodValueSql = `INSERT INTO player_data_period_values (game_id, player_id, key, kind, period_key, value, updated_at)
  SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM player_data_writes WHERE write_ref = ?)
  ON CONFLICT (game_id, player_id, key, kind, period_key) DO UPDATE SET
    value = player_data_period_values.value + excluded.value, updated_at = excluded.updated_at`;
/** 3. 実績（この要求の記録が入ったときだけ。書いた後の値が閾値以上で、まだ解いていない実績。§7）。 */
const unlockSql = `INSERT INTO player_achievements (game_id, player_id, achievement_id, unlocked_at, write_ref)
  SELECT a.game_id, w.p, a.achievement_id, w.t, w.ref FROM (SELECT ? AS g, ? AS p, ? AS t, ? AS ref) w
  JOIN achievements a ON a.game_id = w.g
  JOIN player_data v ON v.game_id = a.game_id AND v.player_id = w.p AND v.key = a.key
  WHERE v.value >= a.threshold AND EXISTS (SELECT 1 FROM player_data_writes WHERE write_ref = w.ref)
  ON CONFLICT (game_id, player_id, achievement_id) DO NOTHING`;
/** 4. 応答の写し（この要求の記録に、送ったキーの書いた後の値と、この書き込みで解いた実績を入れる）。 */
function saveResultSql(keyCount: number): string {
  return `UPDATE player_data_writes SET result_json = json_object(
    'values', json((SELECT json_group_array(json_object('key', key, 'value', value)) FROM
      (SELECT key, value FROM player_data WHERE game_id = ? AND player_id = ? AND key IN (${Array(keyCount).fill('?').join(', ')}) ORDER BY key))),
    'unlocked', json((SELECT json_group_array(json_object('achievementId', achievement_id, 'unlockedAt', unlocked_at)) FROM
      (SELECT achievement_id, unlocked_at FROM player_achievements WHERE write_ref = ? ORDER BY achievement_id))))
  WHERE write_ref = ?`;
}

/** 送ったキーの宣言を読む。 */
async function loadKeys(db: Database, gameId: string, keys: readonly string[]): Promise<Map<string, PlayerDataKey>> {
  const rows = await db.prepare(`SELECT key, mode, max_value AS maxValue, max_delta AS maxDelta FROM player_data_keys
    WHERE game_id = ? AND key IN (${keys.map(() => '?').join(', ')})`).bind(gameId, ...keys).all<PlayerDataKey>();
  return new Map(rows.results.map((r) => [r.key, r]));
}

/** 送った変更に add のキーがあるか（区切りの宣言を読むかどうか）。 */
export function hasAddKey(changes: readonly Change[], defs: Map<string, PlayerDataKey>): boolean {
  return changes.some((c) => defs.get(c.key)?.mode === 'add');
}

/** 送ったキーのうち、区切りで数える宣言（add のキーだけが持つ）を読む。 */
async function loadKeyPeriods(db: Database, gameId: string, keys: readonly string[]): Promise<KeyPeriod[]> {
  const rows = await db.prepare(`SELECT key, kind, reset_offset_minutes AS offsetMinutes FROM player_data_key_periods
    WHERE game_id = ? AND key IN (${keys.map(() => '?').join(', ')}) ORDER BY key, kind`).bind(gameId, ...keys).all<KeyPeriod>();
  return rows.results;
}

/** 解いた実績の行を応答の形（実績の ID の昇順・時刻は ISO 8601）にする。 */
function unlockedOf(rows: readonly UnlockedRow[]) {
  return [...rows].sort((a, b) => (a.achievementId < b.achievementId ? -1 : a.achievementId > b.achievementId ? 1 : 0))
    .map((r) => ({ achievementId: r.achievementId, unlockedAt: isoSeconds(r.unlockedAt) }));
}

/** 書き込みの batch の文を組み立てる（§6 の文 1〜4 と、quest-design.md §6 の文 2b）。 */
function writeStatements(db: Database, w: { ref: string; gameId: string; playerId: string; key: string; hash: string; now: number },
  changes: readonly Change[], defs: Map<string, PlayerDataKey>, periods: readonly KeyPeriod[]) {
  const adds = changes.filter((c) => defs.get(c.key)!.mode === 'add');
  // 区切りで数えるのは add のキーだけ（max・set・flag のキーに宣言があっても数えない）
  const periodAdds = adds.flatMap((c) => periods.filter((p) => p.key === c.key).map((p) => ({ change: c, period: p })));
  return [
    db.prepare(insertWriteSql(adds.length)).bind(w.ref, w.gameId, w.playerId, w.key, w.hash, w.now,
      ...adds.flatMap((c) => [c.key, c.value, defs.get(c.key)!.maxValue])),
    ...changes.map((c) => db.prepare(upsertValueSql(defs.get(c.key)!.mode))
      .bind(w.gameId, w.playerId, c.key, c.value, w.now, w.ref)),
    ...periodAdds.map(({ change, period }) => db.prepare(addPeriodValueSql).bind(w.gameId, w.playerId, change.key, period.kind,
      periodKey(period.kind, w.now, period.offsetMinutes), change.value, w.now, w.ref)),
    db.prepare(unlockSql).bind(w.gameId, w.playerId, w.now, w.ref),
    db.prepare(saveResultSql(changes.length)).bind(w.gameId, w.playerId, ...changes.map((c) => c.key), w.ref, w.ref),
  ];
}

export const playerData: GameModule = {
  name: 'player-data',
  routes: [
    {
      method: 'GET',
      pattern: path,
      async handle(req, env, _match, url, known) {
        const access = await checkPlayerAccess(req, env, url, RATE_LIMITS.playerData, { name: playerData.name, known });
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const rows = (await env.DB.prepare(valuesOf).bind(gameId, claims.playerId).all<ValueRow>()).results;
        const values = rows.map((r) => ({ key: r.key, mode: r.mode, value: r.value, updatedAt: isoSeconds(r.updatedAt) }));
        const unlocked = (await env.DB.prepare(achievementsOf).bind(gameId, claims.playerId).all<UnlockedRow>()).results;
        return json({ gameId, values, achievements: unlockedOf(unlocked) });
      },
    },
    {
      method: 'POST',
      pattern: path,
      async handle(req, env, _match, url, known) {
        const access = await checkPlayerAccess(req, env, url, RATE_LIMITS.playerData, { name: playerData.name, known });
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const playerId = claims.playerId;
        const key = parseIdempotencyKey(req.headers.get('Idempotency-Key'));
        if (key === null) return error('INVALID_ARGUMENT', 'Invalid Idempotency-Key', 400);
        const body = await readJson(req, MAX_JSON_BODY_BYTES);
        if (!body.ok) return body.response;
        const parsed = parseChanges(body.value);
        if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
        const changes = parsed.value;
        const defs = await loadKeys(env.DB, gameId, changes.map((c) => c.key));
        // 宣言の無いキーが 1 つでもあれば、ほかのキーも書かない
        if (changes.some((c) => !defs.has(c.key))) return error('NOT_FOUND', 'Unknown key', 404);
        const outside = changes.find((c) => !checkChange(defs.get(c.key)!, c.value));
        if (outside) return error('INVALID_ARGUMENT', `value is out of range for key ${outside.key}`, 400);
        // 区切りの宣言は add のキーだけが持つので、add のキーがある書き込みのときだけ読む（hardening-design §3.6）
        const periods = hasAddKey(changes, defs) ? await loadKeyPeriods(env.DB, gameId, changes.map((c) => c.key)) : [];
        const hash = await writeRequestHash(gameId, changes);
        const ref = crypto.randomUUID();
        await env.DB.batch(writeStatements(env.DB, { ref, gameId, playerId, key, hash, now: serverNow() }, changes, defs, periods));
        // この要求の行か、前の要求の行（二重）を読み直す
        const row = (await env.DB.prepare(writeByKey).bind(gameId, playerId, key).all<WriteRow>()).results[0];
        // 行が無い: 文 1 の add の上限の条件で止まった（何も書いていない）
        if (!row) return error('PLAYER_DATA_LIMIT_EXCEEDED', 'Write would exceed the player data limit', 409);
        if (row.writeRef !== ref && row.requestHash !== hash) {
          return error('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for a different request', 422);
        }
        if (row.resultJson === null) throw new Error('Player data write has no result');
        // 実績の欄が入る前（0014 の前）の記録の写しには unlocked が無い。その書き込みで解いた実績は無いので空にする
        const result = JSON.parse(row.resultJson) as { values: WrittenValue[]; unlocked?: UnlockedRow[] };
        const values = result.values
          .map((v) => ({ key: v.key, value: v.value }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        return json({ gameId, writeId: row.writeRef, values, unlocked: unlockedOf(result.unlocked ?? []) });
      },
    },
  ],
};
