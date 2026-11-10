// audit.ts — 監査のログ（表 admin_audit_log）の保持の期間・読む文・応答の 1 行の形。入出力を持たない。
//
// 監査の行は管理の書き込みの操作 1 回で 1 行（書く口は BAN・BAN を解く・所持品と通貨の増減・スコアを消す・品目とイベントの定義・
// プレイヤーデータのキーと実績の宣言・値を置く・実績の取り消し）。
// 読み取りの口は監査に残さない。書き込みの口の共通の確かめ（X-Admin-Actor の parseActor・本文の reason の parseReason）と、
// 増減の二重の止めの中身のハッシュ requestHash（鍵とハッシュは監査の行の列に入る）もここに置く。鍵の形 IDEMPOTENCY_KEY_PATTERN・
// parseIdempotencyKey とハッシュの sha256Hex は src/core/idempotency.ts（プレイヤーデータのモジュールも読む）。
// before_json・after_json は保存した JSON を読み直して返す。トークン・管理の鍵・セーブの本文・IP は入れない。
// 表は migrations/0011_admin.sql、形と決まりの正は docs/guides/working/admin-design.md §5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { sha256Hex } from '../idempotency';

/** 監査の行を残す日数（operations-security.md の 6。src/core/cleanup.ts の掃除が、この日数を過ぎた行を消す）。 */
export const AUDIT_RETENTION_DAYS = 365;

/** X-Admin-Actor の形（自己申告のラベル。そのまま監査の actor に残す）。 */
export const ACTOR_PATTERN = /^[a-zA-Z0-9_.@-]{1,64}$/;
/** 本文の reason の長さ（UTF-16 の単位で数える）。 */
export const MAX_REASON_LENGTH = 200;

/** X-Admin-Actor の値を確かめる。外れ（無い・形の誤り）は null。 */
export function parseActor(raw: string | null): string | null {
  return raw !== null && ACTOR_PATTERN.test(raw) ? raw : null;
}

/** 本文の reason を確かめる。1〜MAX_REASON_LENGTH 文字の文字列で、空白だけでなければその値。外れは null。 */
export function parseReason(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_REASON_LENGTH || value.trim() === '') return null;
  return value;
}

/** request_hash に入れる中身（actor は入れない。同じ修正を別の人が流し直しても二重にしない）。 */
export type HashedRequest = { action: string; gameId: string; playerId: string; itemId: string; delta: number; reason: string };

/** 中身を決まった順（action・gameId・playerId・itemId・delta・reason）の JSON にして SHA-256（16 進）にする。 */
export async function requestHash(r: HashedRequest): Promise<string> {
  // 欄を書いた順に並べ直す（呼ぶ側の object の欄の順に左右されない）
  return sha256Hex(JSON.stringify({ action: r.action, gameId: r.gameId, playerId: r.playerId, itemId: r.itemId, delta: r.delta, reason: r.reason }));
}

/** before が無ければ（NULL）全部から。続きがあるかを知るために limit + 1 行を引く。 */
export const listAuditSql = `SELECT audit_id AS auditId, actor, action, target, before_json AS beforeJson, after_json AS afterJson,
    reason, created_at AS createdAt FROM admin_audit_log
  WHERE game_id = ? AND (? IS NULL OR audit_id < ?)
  ORDER BY audit_id DESC LIMIT ?`;

export type AuditRow = {
  auditId: number; actor: string; action: string; target: string;
  beforeJson: string | null; afterJson: string | null; reason: string; createdAt: number;
};
export type AuditEntry = {
  auditId: number; actor: string; action: string; target: string;
  before: unknown; after: unknown; reason: string; createdAt: string;
};

/** UNIX 秒を ISO 8601 の UTC（秒まで。`2026-10-31T01:02:03Z`）に直す。 */
export function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** 表の 1 行を応答の 1 行にする（前と後は JSON を読み直す。NULL は null）。 */
export function shapeAuditRow(row: AuditRow): AuditEntry {
  return {
    auditId: row.auditId, actor: row.actor, action: row.action, target: row.target,
    before: row.beforeJson === null ? null : JSON.parse(row.beforeJson),
    after: row.afterJson === null ? null : JSON.parse(row.afterJson),
    reason: row.reason, createdAt: isoSeconds(row.createdAt),
  };
}
