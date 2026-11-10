// admin-cli.d.mts — scripts/admin-cli.mjs の型の宣言（TypeScript の試験から読み込むため）。中身の正は admin-cli.mjs。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10

/** 操作の名前ごとの実行。引数は（管理の鍵・位置の引数・--名前 の値・X-Admin-Actor・gameId）。 */
export declare const commands: Record<string, (
  adminKey: string, positional: string[], flags: Record<string, string>, actor: string, gameId: string,
) => Promise<unknown>>;
