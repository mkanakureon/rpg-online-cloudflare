// common.ts — 管理の口に共通の確かめ（checkAdmin・checkAdminWrite）と、口のファイルどうしで使う時刻・SQL・応答。
//
// 確かめの順: APP_ENV=local の門（403）→ 管理の鍵の有無とトークンの鍵の有無（IP の鍵付きのハッシュに要る。無ければ投げて入口の
// try/catch で 500）→ 管理の鍵 → 外れなら IP ごとに外れを数え（RATE_LIMITS.admin。上限を超えたら 429・ほかは 401）、正しければ
// 管理の鍵ごとに数える（RATE_LIMITS.adminKey。上限を超えたら 429）→ gameId の形（400）→
// ゲームの登録（404 Unknown game。機能の設定は見ない）→ 書き込みの口は X-Admin-Actor・本文の大きさ（413。src/core/body.ts）・本文の JSON・reason（400）。
// 読み直しても断る理由の無い競合は、どの口も conflicted の 1 つの文（400）。
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

/** 正しい鍵の要求を数える単位（RATE_LIMITS.adminKey）の subject。管理の鍵は Worker に 1 つなので 1 つの値。 */
export const ADMIN_KEY_SUBJECT = 'admin-key';

type Checked = { ok: true; gameId: string } | { ok: false; response: Response };

/** どの管理の口でも同じ確かめ。通ればゲームの ID。 */
export async function checkAdmin(req: Request, env: Env, url: URL, known: readonly string[]): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const secret = adminSecret(env);
  // 鍵の名前・値はメッセージに入れない。入口の try/catch が 500 INTERNAL_ERROR にする
  if (!secret) throw new Error('Admin key is not configured');
  // IP の鍵付きのハッシュはトークンの鍵から作るので、鍵の正否より先に作る（トークンの鍵が無ければ正しい鍵でも 500）
  const ip = await ipSubject(req, env);
  const denied = await requireAdmin(req, secret);
  if (denied) {
    // 鍵の当て推量は、外れだけを IP ごと（見出しが無ければ no-ip）に数えて抑える。正しい鍵の要求はこの数に入れない
    const limited = await consume(env.DB, RATE_LIMITS.admin, ip);
    return { ok: false, response: limited ?? denied };
  }
  // 正しい鍵の要求は、外れとは別の単位（管理の鍵ごとに 1 つ）で数える。鍵の無い人の外れで塞がれない
  const limited = await consume(env.DB, RATE_LIMITS.adminKey, ADMIN_KEY_SUBJECT);
  if (limited) return { ok: false, response: limited };
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
/** 実績・クエストの閾値がキーの上限を超える（解けない・達成できない）。 */
export const thresholdAboveMax = (key: string, maxValue: number) =>
  error('INVALID_ARGUMENT', `threshold must be at most ${maxValue}, the maxValue of key ${key}`, 400);
/**
 * 書き込みの口で、batch の 1 文目（監査の行）が入らず、読み直しても断る理由が見つからないときの 400 の文（同時の変更とぶつかった。
 * もう一度送る。どの口も同じ文。正は docs/api-contract.md の管理の API と hardening-design.md §3.5）。
 */
export const CONFLICT_MESSAGE = 'Conflicted with a concurrent change; send the request again';
export const conflicted = () => error('INVALID_ARGUMENT', CONFLICT_MESSAGE, 400);
