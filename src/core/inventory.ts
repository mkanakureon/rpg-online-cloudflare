// inventory.ts — 所持品の残高の上限・品目の種類の名前・1 イベントの報酬の行の数の上限・1 ゲームのイベントの宣言の数の上限（定数の 1 か所）。
//
// 所持品（src/modules/inventory/）とイベント（E2 の src/modules/events/）の両方のモジュールと、管理の口（src/core/admin/。
// 増減と、品目・イベントの定義の確かめ）が読む。モジュールどうしは読み込まず、core は modules を読み込まないので core に置く。
// MAX_ITEM_AMOUNT は migrations/0009_inventory.sql の inventory_balances.amount の CHECK にも書いている（2 か所。片方だけ変えない）。
// MAX_REWARD_LINES は openapi/rpg-online.v1.json の EventReward の配列と openapi/rpg-online-admin.v1.json の報酬の配列の maxItems にも
// 書いている。決まりの正は docs/guides/working/event-reward-design.md §2・§3 と docs/guides/working/admin-design.md §7。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30

/** 1 品目の残高の上限（スコアの上限と同じ。桁あふれの止め）。 */
export const MAX_ITEM_AMOUNT = 1_000_000_000;

/** 品目の種類（表 inventory_items の kind）。通貨か所持品か。 */
export const ITEM_KINDS = ['currency', 'item'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** 1 イベントの報酬の行（品目）の数の上限。 */
export const MAX_REWARD_LINES = 10;

/** 1 ゲームで宣言できるイベントの数（MAX_QUESTS と揃える。管理のイベントの定義の口が新しいイベントで超えるなら 400）。 */
export const MAX_EVENTS = 200;
