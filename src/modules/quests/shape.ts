// quests/shape.ts — クエストの一覧の行の形と、達成・受け取り済みの決め方（入出力を持たない関数）。
//
// src/modules/quests/index.ts が、D1 から読んだクエストの宣言・進捗（プレイヤーデータの値）・受け取りの有無・報酬を渡して呼ぶ。
// 達成は進捗が閾値以上か（数の比べだけ）で、一覧と受け取りの判定で同じ比べを使う。進捗は閾値で丸めない（クライアントが丸めて出す）。
// 決まりと形の正は docs/guides/working/quest-design.md §4・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

/** クエストの区切り（表 quests の kind）。Q1 の口が扱うのは once だけ。 */
export type QuestKind = 'once' | 'daily' | 'weekly';

/** 報酬の 1 行（品目と数）。 */
export type Grant = { itemId: string; amount: number };

/** 一覧に出すクエストの宣言と、トークンのプレイヤーの進捗・受け取り（D1 の 1 行）。時刻は UNIX 秒。 */
export type QuestRow = {
  questId: string; kind: QuestKind; startsAt: number; endsAt: number; key: string; threshold: number;
  progress: number; claimed: number;
};

/** 一覧の 1 行（GET /v1/quests の items）。 */
export type QuestItem = {
  questId: string; kind: QuestKind; startsAt: string; endsAt: string; periodKey: string; key: string; threshold: number;
  progress: number; completed: boolean; claimed: boolean; rewards: Grant[];
};

/** 達成（進捗が閾値以上）と、いまの区切りの受け取り済みか。 */
export function questStatus(def: { threshold: number }, progress: number, claimed: boolean): { completed: boolean; claimed: boolean } {
  return { completed: progress >= def.threshold, claimed };
}

/** UNIX 秒を ISO 8601（UTC・秒まで。例 2026-10-31T15:30:00Z）にする。 */
export function isoSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** D1 の 1 行と報酬から一覧の 1 行を作る（Q1 は一度きりだけなので区切りは 'once'・nextResetAt を載せない）。 */
export function questItem(row: QuestRow, periodKey: string, rewards: Grant[]): QuestItem {
  const status = questStatus(row, row.progress, row.claimed === 1);
  return {
    questId: row.questId, kind: row.kind, startsAt: isoSeconds(row.startsAt), endsAt: isoSeconds(row.endsAt), periodKey,
    key: row.key, threshold: row.threshold, progress: row.progress, ...status, rewards,
  };
}
