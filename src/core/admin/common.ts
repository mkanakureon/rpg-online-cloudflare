// common.ts — 管理の口に共通の確かめ（checkAdmin・checkAdminWrite）と、口のファイルどうしで使う時刻・SQL・応答。
//
// 確かめの順: APP_ENV=local の門（403）→ 管理の鍵の有無（無ければ投げて入口の try/catch で 500）→ 管理の利用制限
// （RATE_LIMITS.admin・IP ごと。正しい鍵でも数え、鍵を確かめる前に 429）→ 管理の鍵（401）→ gameId の形（400）→
// ゲームの登録（404 Unknown game。機能の設定は見ない）→ 書き込みの口は X-Admin-Actor・本文の大きさ（413。src/core/body.ts）・本文の JSON・reason（400）。
// 口のファイル（routes-*.ts）が読み、一覧は routes.ts が組み立てる。正は docs/guides/working/admin-design.md §2・§3。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10
import { MAX_JSON_BODY_BYTES, readJson } from '../body';
import type { Env } from '../env';
import { loadGame } from '../games';
import { requireLocalWrite } from '../guards';
import { error } from '../http';
import { validId } from '../ids';
import { consume, ipSubject } from '../rate-limit';
import { RATE_LIMITS } from '../rate-limit-policy';
import { parseActor, parseReason } from './audit';
import { adminSecret, requireAdmin } from './key';

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
export async function checkAdminWrite(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Written> {
  const access = await checkAdmin(req, env, url, known);
  if (!access.ok) return access;
  const actor = parseActor(req.headers.get('X-Admin-Actor'));
  if (actor === null) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid X-Admin-Actor', 400) };
  const read = await readJson(req, MAX_JSON_BODY_BYTES);
  if (!read.ok) return read;
  const value = read.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, response: error('INVALID_ARGUMENT', 'Object required', 400) };
  }
  const body = value as Record<string, unknown>;
  const reason = parseReason(body.reason);
  if (reason === null) return { ok: false, response: error('INVALID_ARGUMENT', 'reason must be 1..200 characters', 400) };
  return { ok: true, gameId: access.gameId, actor, reason, body };
}

/** サーバーの時刻（UNIX 秒）。管理の口のファイルはここから読む（正は src/core/clock.ts）。 */
export { serverNow } from '../clock';

/** プレイヤーの登録（無ければ 404 Unknown player。プレイヤーを読む口・BAN・値を置く口が使う）。 */
export const playerSql = `SELECT strftime('%Y-%m-%dT%H:%M:%SZ', created_at) AS createdAt FROM game_players WHERE game_id = ? AND player_id = ?`;
/** この要求の監査の行（batch の 1 文目が入ったか）を audit_ref で引く。 */
export const auditByRef = 'SELECT audit_id AS auditId FROM admin_audit_log WHERE audit_ref = ?';
/** UNIX 秒の列を ISO 8601 の UTC（秒まで）にする SQL の式。 */
export const isoColumn = (column: string) => `strftime('%Y-%m-%dT%H:%M:%SZ', ${column}, 'unixepoch')`;
export const unknownKey = () => error('NOT_FOUND', 'Unknown key', 404);
