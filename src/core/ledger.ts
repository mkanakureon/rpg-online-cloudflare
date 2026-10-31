// ledger.ts — 受領の履歴（表 inventory_ledger）の種類の名前 LEDGER_SOURCES と、1 品目の増減の文（履歴と残高）。
//
// inventory_ledger に書く所は 3 つ: イベントの受け取り（src/modules/events/。報酬の中身を event_rewards から SQL の中で読む 3 文で、
// 種類の名前だけここから読む）・クエストの受け取り（src/modules/quests/。quest_rewards から読む 3 文で、同じく種類の名前だけ読む。
// 受け取りの文はここへ移さない。quest-design.md §6）と、管理の増減（src/core/admin/。ここの文）。種類の名前（source_type）はこの 1 か所にだけ書く。
// 増減の文は監査の行（admin_audit_log。1 文目は管理の口が作る）の後ろに並べる前提で、どれも「source_id の監査の行
// （audit_ref）が入ったとき」だけ書く。残高の 0 未満・上限超えの守りは監査の行の文の条件で、表の CHECK は最後の守り。
// 0 になった残高の行は消す（0 の行を作らない決まりのまま）。正は docs/guides/working/admin-design.md §6。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import type { Database, Statement } from './env';

/** 受領の履歴の種類の名前（inventory_ledger.source_type）。 */
export const LEDGER_SOURCES = { eventClaim: 'event-claim', questClaim: 'quest-claim', admin: 'admin' } as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[keyof typeof LEDGER_SOURCES];

export type Adjustment = {
  gameId: string; playerId: string; itemId: string; delta: number;
  sourceType: LedgerSource; sourceId: string; now: number;
};

// 続く文の条件（この要求の監査の行が入ったか）
const written = 'EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = ?)';
// 2. 受領の履歴
const insertLedger = `INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
  SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${written}`;
// 3. 残高の行があれば増減
const updateBalance = `UPDATE inventory_balances SET amount = amount + ?, updated_at = ?
  WHERE game_id = ? AND player_id = ? AND item_id = ? AND ${written}`;
// 4. 残高の行が無く、付与なら作る（3 で行があれば何もしない）
const insertBalance = `INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at)
  SELECT ?, ?, ?, ?, ? WHERE ? > 0 AND ${written}
    AND NOT EXISTS (SELECT 1 FROM inventory_balances WHERE game_id = ? AND player_id = ? AND item_id = ?)`;
// 5. 0 になった行を消す
const deleteEmpty = `DELETE FROM inventory_balances
  WHERE game_id = ? AND player_id = ? AND item_id = ? AND amount = 0 AND ${written}`;

/** 1 品目の増減の文（履歴・残高の増減・残高の行を作る・0 の行を消す）。監査の行の文の後ろに同じ batch で並べる。 */
export function adjustStatements(db: Database, a: Adjustment): Statement[] {
  const { gameId: g, playerId: p, itemId: i, delta, sourceType, sourceId: ref, now } = a;
  return [
    db.prepare(insertLedger).bind(g, p, i, delta, sourceType, ref, now, ref),
    db.prepare(updateBalance).bind(delta, now, g, p, i, ref),
    db.prepare(insertBalance).bind(g, p, i, delta, now, delta, ref, g, p, i),
    db.prepare(deleteEmpty).bind(g, p, i, ref),
  ];
}
