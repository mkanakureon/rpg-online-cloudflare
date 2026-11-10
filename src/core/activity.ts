// activity.ts — 「遊んだ」の印（表 player_activity_days・migrations/0017_player_activity.sql）を書く所。
//
// activityDay は入出力の無い関数で、サーバーの時刻の UTC の日付（src/core/period.ts の periodKey('daily', now, 0)）。
// consumeForPlayer は、トークンの要る 6 つの口（saves・rankings の投稿・inventory・events・player-data・quests）が consume の代わりに
// 呼ぶ 1 回で、利用制限の 2 文（src/core/rate-limit.ts の counterStatements。SQL はそちらだけ）の後に遊んだ行の 1 文を足した
// 1 つの batch で流す（往復は増えない）。鍵は今と同じ '<gameId>:<playerId>'、断る・通すは consume と同じ（limitedResponse）。
// 429 で断る要求も、後で BAN で断る要求も遊んだに数える（数えてから断る）。登録の無いゲームのトークンは数えない。記録の文が落ちると batch ごと戻り、500 INTERNAL_ERROR。
// ゲストの発行（src/core/accounts.ts）は自分の batch に is_new = 1 の行を書く。core はモジュールを読み込まない。
// 設計の正は docs/guides/working/analytics-design.md §3・§4。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import type { Database } from './env';
import { periodKey } from './period';
import { counterStatements, limitedResponse } from './rate-limit';
import type { RateLimitRule } from './rate-limit-policy';
import type { TokenClaims } from './token';
import { serverNow } from './clock';

/** その時刻（UNIX 秒）の遊んだ日の鍵。UTC の 'YYYY-MM-DD'（時差を入れない）。 */
export function activityDay(nowSeconds: number): string {
  return periodKey('daily', nowSeconds, 0);
}

/**
 * 遊んだ行を書く文（バインドは gameId・day・playerId・gameId の 4 つ）。その日 2 回目からは主キーで入らない。
 * 登録の無いゲームのトークンでは書かない（数えるのはゲームの登録を確かめる前なので、外部キーで落として 404 を 500 にしないため）。
 */
export const recordActivitySql = `INSERT OR IGNORE INTO player_activity_days (game_id, day, player_id)
  SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM games WHERE game_id = ?)`;

/** トークンのプレイヤーで 1 回数え、その日の遊んだ行を残す。上限までなら null、超えたら 429 RATE_LIMITED（consume と同じ）。 */
export async function consumeForPlayer(
  db: Database, rule: RateLimitRule, claims: TokenClaims, nowSeconds = serverNow(),
): Promise<Response | null> {
  const [counted] = await db.batch([
    ...counterStatements(db, rule, `${claims.gameId}:${claims.playerId}`, nowSeconds),
    db.prepare(recordActivitySql).bind(claims.gameId, activityDay(nowSeconds), claims.playerId, claims.gameId),
  ]);
  return limitedResponse(counted, rule, nowSeconds);
}
