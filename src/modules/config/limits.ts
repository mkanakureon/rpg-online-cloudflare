// limits.ts — 設定配信の上限の定数（マスターデータの 1 キーの大きさ）。
//
// 同じ数を migrations/0007_config_master_data.sql の config_master_data.data の CHECK にも書いている（2 か所。片方だけ変えない）。
// test/config-master.test.ts が、この数ちょうどは表に入り 1 バイト多いと断られることで、2 か所が同じことを見る。
// 決まりの正は docs/guides/working/config-design.md §2・§10 の決めること 3。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** マスターデータの 1 キーの data の上限（UTF-8 のバイト数。64 KiB）。 */
export const MAX_MASTER_DATA_BYTES = 65_536;
