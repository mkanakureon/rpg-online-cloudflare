// player-data.ts — プレイヤーデータの値の上限・キーの書き方の名前・1 つの変更の範囲の確かめ（定数と入出力の無い関数の 1 か所）。
//
// プレイヤーデータのモジュール（src/modules/player-data/）と管理の口（src/core/admin/）の両方が読むので core に置く。
// MAX_PLAYER_DATA_KEYS は管理のキーの宣言の口が確かめる（1 ゲームの宣言の数。1 プレイヤーの値の行の数の上限にもなる）。
// MAX_PLAYER_DATA_VALUE は migrations/0013_player_data.sql の player_data_keys.max_value と player_data.value の CHECK にも
// 書いている（2 か所。片方だけ変えない）。書き方の意味と範囲の正は docs/guides/working/player-data-design.md §3・§5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

/** 1 キーの値の上限（スコア・所持品の上限と同じ。桁あふれの止め）。 */
export const MAX_PLAYER_DATA_VALUE = 1_000_000_000;

/** 1 ゲームで宣言できるキーの数（管理の宣言の口が超える新しいキーを 400 で断る）。 */
export const MAX_PLAYER_DATA_KEYS = 200;

/** キーの書き方（表 player_data_keys の mode）。add・max は統計値、set・flag は進行状態。 */
export const PLAYER_DATA_MODES = ['add', 'max', 'set', 'flag'] as const;
export type PlayerDataMode = (typeof PLAYER_DATA_MODES)[number];

/** キーの宣言（表 player_data_keys の 1 行）。maxDelta は add のときだけ値がある。 */
export type PlayerDataKey = { key: string; mode: PlayerDataMode; maxValue: number; maxDelta: number | null };

/**
 * 送った value が宣言の書き方の範囲の内か（外れは 400）。add は 1〜maxDelta（減らせない）、max・set は 0〜maxValue、flag は 1 だけ。
 * add の書いた後の値が上限を超えるか（409）は、いまの値で決まるのでここでは見ない（書き込みの batch の条件で見る）。
 */
export function checkChange(def: Pick<PlayerDataKey, 'mode' | 'maxValue' | 'maxDelta'>, value: number): boolean {
  if (!Number.isSafeInteger(value)) return false;
  switch (def.mode) {
    case 'add': return def.maxDelta !== null && value >= 1 && value <= def.maxDelta;
    case 'max':
    case 'set': return value >= 0 && value <= def.maxValue;
    case 'flag': return value === 1;
    default: return false;
  }
}
