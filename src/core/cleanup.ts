// cleanup.ts — 表ごとの保持の日数と、日数を過ぎた行の掃除（N2）。Worker の scheduled の入口（src/worker.ts）が 1 日 1 回呼ぶ。
//
// RETENTION_DAYS には消す 5 つの表だけを載せる。監査のログの日数は src/core/admin/audit.ts の AUDIT_RETENTION_DAYS を読む（写さない）。
// 消さない表: quest_claims・event_claims（主キーが二重の止めの鍵で、消すともう一度受け取れる）と inventory_ledger（残高の増減の証拠で、
// プレイヤーが読む受領の履歴そのもの）。この 3 つは RETENTION_DAYS に行を作らない。
// 消す文は 1 つの表に 1 つの形（DELETE ... WHERE rowid IN (SELECT rowid ... LIMIT ?)。DELETE ... LIMIT は SQLite の作りの旗に頼るので使わない）。
// 表と列の名前は定数から作り、要求の値は入れない。表ごとに別の文で送り（batch にまとめない）、1 つの表で落ちてもほかの表を消す。
// 1 文で CLEANUP_ROWS_PER_STATEMENT 行まで、1 回で CLEANUP_MAX_STATEMENTS 文まで（D1 の Free の 1 回の起動の 50 文の内）。残りは次の日。
// ログは表の名前と消した数だけ（DB のエラーの中身もプレイヤー ID も出さない）。APP_ENV が local でなければ何も消さない。
// core はモジュールを読み込まない。設計の正は docs/guides/working/analytics-design.md §6・§7。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { activityDay } from './activity';
import { AUDIT_RETENTION_DAYS } from './admin/audit';
import type { Database, Env } from './env';

/** 表ごとに行を残す日数（消す表だけ）。 */
export const RETENTION_DAYS = {
  admin_audit_log: AUDIT_RETENTION_DAYS,
  player_data_writes: 30,
  player_data_period_values: 35,
  rate_limit_counters: 1,
  player_activity_days: 400,
} as const;
export type CleanupTable = keyof typeof RETENTION_DAYS;

/** 表ごとの切り目の列（player_activity_days だけ UTC の 'YYYY-MM-DD'、ほかは UNIX 秒）。 */
const CUTOFF_COLUMNS: Record<CleanupTable, string> = {
  admin_audit_log: 'created_at',
  player_data_writes: 'created_at',
  player_data_period_values: 'updated_at',
  rate_limit_counters: 'window_start',
  player_activity_days: 'day',
};

/** 1 つの DELETE が消す行の上限。 */
export const CLEANUP_ROWS_PER_STATEMENT = 1000;
/** 1 回の掃除で送る文の数の上限（D1 の Free の 1 回の起動の 50 文の内）。 */
export const CLEANUP_MAX_STATEMENTS = 40;
/** 掃除の Cron の式（UTC の 18:30・日本の 3:30。wrangler.jsonc の triggers.crons と同じ値。試験で一致を見る）。 */
export const CLEANUP_CRON = '30 18 * * *';

const DAY_SECONDS = 86400;

/** その表の切り目。これより古い（小さい）行を消す。player_activity_days は日付の文字列、ほかは UNIX 秒。 */
export function cutoffFor(table: CleanupTable, nowSeconds: number): number | string {
  const cutoff = nowSeconds - RETENTION_DAYS[table] * DAY_SECONDS;
  return table === 'player_activity_days' ? activityDay(cutoff) : cutoff;
}

/** 表ごとの消す文と、そのバインド（切り目・行の数の上限の 2 つ）。表の順は RETENTION_DAYS の順。 */
export function cleanupStatements(
  nowSeconds: number, rowsPerStatement = CLEANUP_ROWS_PER_STATEMENT,
): Array<{ table: CleanupTable; sql: string; binds: [number | string, number] }> {
  return (Object.keys(RETENTION_DAYS) as CleanupTable[]).map((table) => ({
    table,
    sql: `DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${CUTOFF_COLUMNS[table]} < ? LIMIT ?)`,
    binds: [cutoffFor(table, nowSeconds), rowsPerStatement],
  }));
}

export type CleanupResult = { deleted: Partial<Record<CleanupTable, number>>; failed: CleanupTable[]; statements: number };

/** D1 の run() の結果の消した行の数（meta.changes）。読めなければ 0。 */
function changesOf(result: unknown): number {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === 'number' ? changes : 0;
}

/**
 * 表ごとに日数を過ぎた行を消し、消した数を返す。消した数が上限と同じなら同じ表をもう一度、少なければ次の表へ。
 * 文の数が上限に届いたら止める（残りは次の回）。落ちた表は表の名前だけを console.error に出して次の表へ。
 */
export async function runCleanup(
  db: Database, nowSeconds: number,
  limits: { rowsPerStatement?: number; maxStatements?: number } = {},
): Promise<CleanupResult> {
  const rowsPerStatement = limits.rowsPerStatement ?? CLEANUP_ROWS_PER_STATEMENT;
  const maxStatements = limits.maxStatements ?? CLEANUP_MAX_STATEMENTS;
  const result: CleanupResult = { deleted: {}, failed: [], statements: 0 };
  for (const { table, sql, binds } of cleanupStatements(nowSeconds, rowsPerStatement)) {
    let deleted = 0;
    while (result.statements < maxStatements) {
      result.statements += 1;
      let changes: number;
      try {
        changes = changesOf(await db.prepare(sql).bind(...binds).run());
      } catch {
        // DB のエラーの中身は出さない（行の中身を含むことがある）
        console.error('cleanup failed', table);
        result.failed.push(table);
        break;
      }
      deleted += changes;
      if (changes < rowsPerStatement) break;
    }
    result.deleted[table] = deleted;
    if (result.statements >= maxStatements) break;
  }
  return result;
}

/** scheduled の中身。APP_ENV が local でなければ何も消さず、止めたことだけをログに出す。 */
export async function runScheduled(env: Env, nowSeconds: number): Promise<CleanupResult | null> {
  // IMPORTANT: 本番の設定では消さない（守りを外すときにユーザーが決める。analytics-design.md §9）
  if (env.APP_ENV !== 'local') {
    console.log('cleanup skipped: APP_ENV is not local');
    return null;
  }
  const result = await runCleanup(env.DB, nowSeconds);
  console.log('cleanup deleted', JSON.stringify(result.deleted));
  return result;
}
