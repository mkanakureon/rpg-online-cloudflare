// version.ts — クライアントの版の形の検証・比べ方・更新の要否（ふつうの関数。入出力を持たない）。
//
// 形は ^\d{1,9}(\.\d{1,9}){0,2}$（1・1.2・1.2.3）。区切りごとに数として比べ、足りない区切りは 0 とみなす。
// src/modules/config/index.ts が問い合わせの clientVersion と表の版（game_configs）に使う。
// 決まりの正は docs/guides/working/config-design.md §5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

export type UpdateStatus = 'none' | 'available' | 'required' | 'unknown';

const versionPattern = /^\d{1,9}(\.\d{1,9}){0,2}$/;

/** 版の文字列を数の配列にする。形が外れていれば null。 */
export function parseVersion(text: unknown): number[] | null {
  if (typeof text !== 'string' || !versionPattern.test(text)) return null;
  return text.split('.').map(Number);
}

/** a が b より新しければ正・同じなら 0・古ければ負。足りない区切りは 0。 */
export function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/** クライアントの版を最低の版・最新の版と比べる。版が無ければ unknown、決まりが無ければ none。 */
export function updateStatus(
  client: readonly number[] | null, min: readonly number[] | null, latest: readonly number[] | null,
): UpdateStatus {
  if (client === null) return 'unknown';
  if (min !== null && compareVersions(client, min) < 0) return 'required';
  if (latest !== null && compareVersions(client, latest) < 0) return 'available';
  return 'none';
}
