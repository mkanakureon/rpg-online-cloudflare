// bans.ts — 止めた印（表 player_bans）が効いているかの判定と、トークンのプレイヤーが止められていれば 403 にする確かめ。
//
// requireAuth（auth.ts）は DB を引かないまま変えない。止めた印はここで引き、6 つのモジュール（rankings・saves・inventory・
// events・player-data・quests）とトークンの更新（src/core/accounts.ts）がプレイヤーの利用制限（consume）の直後に呼ぶ
// （本文の形の誤り・トークンの無い要求は DB を引く前に断る順を変えない）。
// 鍵はトークンの g・p（偽れない）。止めた人への応答は 403 PLAYER_BANNED `Player is banned` だけで、理由・期限は返さない。
// 印を書くのは管理の口（src/core/admin/routes.ts）。正は docs/guides/working/admin-design.md §4。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import type { Env } from './env';
import { error } from './http';
import type { TokenClaims } from './token';

export const banSql = 'SELECT expires_at AS expiresAt FROM player_bans WHERE game_id = ? AND player_id = ?';

/** 止めた印が now（UNIX 秒）で効いているか。期限が無ければずっと、あれば期限の時刻より前だけ効く。 */
export function isBanActive(row: { expiresAt: number | null }, now: number): boolean {
  return row.expiresAt === null || now < row.expiresAt;
}

/** トークンのプレイヤーが止められていれば 403 PLAYER_BANNED、ほかは null。 */
export async function requireNotBanned(env: Env, claims: TokenClaims, now = Math.floor(Date.now() / 1000)): Promise<Response | null> {
  const rows = await env.DB.prepare(banSql).bind(claims.gameId, claims.playerId).all<{ expiresAt: number | null }>();
  const row = rows.results[0];
  if (row && isBanActive(row, now)) return error('PLAYER_BANNED', 'Player is banned', 403);
  return null;
}
