// player-data/index.ts — プレイヤーデータのモジュール（GET /v1/player-data の読み取りと POST /v1/player-data の書き込み）。
//
// どちらも APP_ENV=local の門 → トークン → プレイヤーの利用制限（2 つの口を合わせて RATE_LIMITS.playerData。429）→
// 止めた印（403 PLAYER_BANNED）→ gameId の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 口ごとの確かめ の順
// （イベントの checkAccess と同じ形）。プレイヤーはトークンの p だけで決まる（本文・問い合わせの playerId を読まない）。
// 書き込みは Idempotency-Key が必須（形は src/core/idempotency.ts。src/core/admin/ は読み込まない）。宣言の無いキーは 404、
// 書き方の範囲の外は 400（src/core/player-data.ts の checkChange）で、どちらも何も書かない。書き込みの記録・値・応答の写しを
// 1 つの batch で書き、記録の一意の鍵（ゲーム・プレイヤー・鍵）で二重を止める。2 回目は 200 で 1 回目と同じ本文。時刻はサーバーの時刻だけ。
// 順と SQL の正は docs/guides/working/player-data-design.md §4〜§6。実績（achievements・unlocked）は U2 で足す。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { requireAuth } from '../../core/auth';
import { requireNotBanned } from '../../core/bans';
import type { Database, Env } from '../../core/env';
import { requireGame } from '../../core/games';
import { requireLocalWrite } from '../../core/guards';
import { error, json } from '../../core/http';
import { parseIdempotencyKey } from '../../core/idempotency';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';
import { checkChange, type PlayerDataKey, type PlayerDataMode } from '../../core/player-data';
import { consume } from '../../core/rate-limit';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import type { TokenClaims } from '../../core/token';
import { parseChanges, writeRequestHash, type Change } from './parse';

type ValueRow = { key: string; mode: PlayerDataMode; value: number; updatedAt: number };
type WriteRow = { writeRef: string; requestHash: string; resultJson: string | null };
type WrittenValue = { key: string; value: number };

const path = /^\/v1\/player-data$/;

const valuesOf = `SELECT d.key AS key, k.mode AS mode, d.value AS value, d.updated_at AS updatedAt FROM player_data d
  JOIN player_data_keys k ON k.game_id = d.game_id AND k.key = d.key
  WHERE d.game_id = ? AND d.player_id = ? ORDER BY d.key`;
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
/** 4. 応答の写し（この要求の記録に、送ったキーの書いた後の値を入れる。3 の実績は U2）。 */
function saveResultSql(keyCount: number): string {
  return `UPDATE player_data_writes SET result_json = json_object(
    'values', json((SELECT json_group_array(json_object('key', key, 'value', value)) FROM
      (SELECT key, value FROM player_data WHERE game_id = ? AND player_id = ? AND key IN (${Array(keyCount).fill('?').join(', ')}) ORDER BY key))))
  WHERE write_ref = ?`;
}

type Checked = { ok: true; claims: TokenClaims; gameId: string } | { ok: false; response: Response };

/** 2 つの口で同じ確かめ（門 → トークン → プレイヤーの利用制限 → 止めた印 → gameId → トークンのゲーム → ゲームの登録と機能の設定）。 */
async function checkAccess(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const auth = await requireAuth(req, env);
  if (!auth.ok) return auth;
  // 読み書きを合わせて、トークンのプレイヤーで数える（偽れない鍵）
  const limited = await consume(env.DB, RATE_LIMITS.playerData, `${auth.claims.gameId}:${auth.claims.playerId}`);
  if (limited) return { ok: false, response: limited };
  // 止めたプレイヤーは利用制限で数えた後に断る（理由・期限は返さない）
  const banned = await requireNotBanned(env, auth.claims);
  if (banned) return { ok: false, response: banned };
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (auth.claims.gameId !== gameId) {
    return { ok: false, response: error('PERMISSION_DENIED', 'Token does not match game', 403) };
  }
  const unknown = await requireGame(env, gameId, playerData.name, known);
  if (unknown) return { ok: false, response: unknown };
  return { ok: true, claims: auth.claims, gameId };
}

/** サーバーの時刻（UNIX 秒）。本文・見出しの時刻は読まない。 */
function serverNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** UNIX 秒を ISO 8601 の UTC（秒まで）に直す。 */
function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 送ったキーの宣言を読む。 */
async function loadKeys(db: Database, gameId: string, keys: readonly string[]): Promise<Map<string, PlayerDataKey>> {
  const rows = await db.prepare(`SELECT key, mode, max_value AS maxValue, max_delta AS maxDelta FROM player_data_keys
    WHERE game_id = ? AND key IN (${keys.map(() => '?').join(', ')})`).bind(gameId, ...keys).all<PlayerDataKey>();
  return new Map(rows.results.map((r) => [r.key, r]));
}

/** 書き込みの batch の文を組み立てる（§6 の文 1・2・4）。 */
function writeStatements(db: Database, w: { ref: string; gameId: string; playerId: string; key: string; hash: string; now: number },
  changes: readonly Change[], defs: Map<string, PlayerDataKey>) {
  const adds = changes.filter((c) => defs.get(c.key)!.mode === 'add');
  return [
    db.prepare(insertWriteSql(adds.length)).bind(w.ref, w.gameId, w.playerId, w.key, w.hash, w.now,
      ...adds.flatMap((c) => [c.key, c.value, defs.get(c.key)!.maxValue])),
    ...changes.map((c) => db.prepare(upsertValueSql(defs.get(c.key)!.mode))
      .bind(w.gameId, w.playerId, c.key, c.value, w.now, w.ref)),
    db.prepare(saveResultSql(changes.length)).bind(w.gameId, w.playerId, ...changes.map((c) => c.key), w.ref),
  ];
}

export const playerData: GameModule = {
  name: 'player-data',
  routes: [
    {
      method: 'GET',
      pattern: path,
      async handle(req, env, _match, url, known) {
        const access = await checkAccess(req, env, url, known);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const rows = (await env.DB.prepare(valuesOf).bind(gameId, claims.playerId).all<ValueRow>()).results;
        const values = rows.map((r) => ({ key: r.key, mode: r.mode, value: r.value, updatedAt: isoSeconds(r.updatedAt) }));
        return json({ gameId, values });
      },
    },
    {
      method: 'POST',
      pattern: path,
      async handle(req, env, _match, url, known) {
        const access = await checkAccess(req, env, url, known);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const playerId = claims.playerId;
        const key = parseIdempotencyKey(req.headers.get('Idempotency-Key'));
        if (key === null) return error('INVALID_ARGUMENT', 'Invalid Idempotency-Key', 400);
        let body: unknown;
        try { body = await req.json(); }
        catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
        const parsed = parseChanges(body);
        if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
        const changes = parsed.value;
        const defs = await loadKeys(env.DB, gameId, changes.map((c) => c.key));
        // 宣言の無いキーが 1 つでもあれば、ほかのキーも書かない
        if (changes.some((c) => !defs.has(c.key))) return error('NOT_FOUND', 'Unknown key', 404);
        const outside = changes.find((c) => !checkChange(defs.get(c.key)!, c.value));
        if (outside) return error('INVALID_ARGUMENT', `value is out of range for key ${outside.key}`, 400);
        const hash = await writeRequestHash(gameId, changes);
        const ref = crypto.randomUUID();
        await env.DB.batch(writeStatements(env.DB, { ref, gameId, playerId, key, hash, now: serverNow() }, changes, defs));
        // この要求の行か、前の要求の行（二重）を読み直す
        const row = (await env.DB.prepare(writeByKey).bind(gameId, playerId, key).all<WriteRow>()).results[0];
        // 行が無い: 文 1 の add の上限の条件で止まった（何も書いていない）
        if (!row) return error('PLAYER_DATA_LIMIT_EXCEEDED', 'Write would exceed the player data limit', 409);
        if (row.writeRef !== ref && row.requestHash !== hash) {
          return error('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used for a different request', 422);
        }
        if (row.resultJson === null) throw new Error('Player data write has no result');
        const values = (JSON.parse(row.resultJson) as { values: WrittenValue[] }).values
          .map((v) => ({ key: v.key, value: v.value }))
          .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        return json({ gameId, writeId: row.writeRef, values });
      },
    },
  ],
};
