// routes.ts — 管理の口（/v1/admin/...）のルートの一覧 adminRoutes を、口の種類ごとのファイルから組み立てる。
//
// 確かめの順: APP_ENV=local の門（403）→ 管理の鍵とトークンの鍵の有無（無ければ投げて入口の try/catch で 500）→ 管理の鍵
// （外れは IP ごとに外れだけを数え、上限を超えたら 429・ほかは 401。正しい鍵は管理の鍵ごとに数え、上限を超えたら 429）→ gameId の形（400）→
// ゲームの登録（404 Unknown game。機能の設定は見ない）→ 書き込みの口は X-Admin-Actor・本文の JSON・reason（400）→ 口ごとの確かめ。管理はゲームごとの機能にせず、機能のモジュールを
// 読み込まない（表を SQL で読み書きするだけ）。どのプレイヤーのトークンも読まない。読み取りの口は監査に残さない。
// 書き込みの口（BAN・BAN を解く・所持品と通貨の増減・スコアを消す・品目とイベントとクエストの定義・プレイヤーデータのキーと実績の宣言・値を置く・
// 実績の取り消し）は、監査の行を 1 文目にし、続く文は「この要求の監査の行が入ったとき」だけ書く 1 つの batch で書く（片方だけ残らない）。増減の続く文と受領の履歴の種類の名前は src/core/ledger.ts。
// 品目の種類の違い・報酬の品目の有無・受け取りのあるイベントとクエストの守り・値のあるキーの書き方・宣言の数・解いた人のいる実績のキー・
// クエストの見るキーと区切りの宣言は、先に読んで断り、監査の行の文の条件にも入れる（読んでから書くまでの間に変わっても書かない）。
// クエストの定義の口は、デイリー・週間のクエストのキーの区切りの宣言（player_data_key_periods）を同じ batch で入れ・付け替え・消し、数の上限は src/core/quests.ts。
// プレイヤーデータの値を置く口は実績を判定せず、区切りの値を新しい値で頭打ちにする（下げるだけ）。
// 増減は Idempotency-Key が必須で（形は src/core/idempotency.ts）、鍵と中身のハッシュを監査の行の列に入れて二重を止める（同じ中身は 200 で 1 回目と同じ本文・違う中身は 422）。
// ルートの一覧はルーター（src/core/router.ts）がゲストの発行の後・機能のルートの前に当てる。形の正は openapi/rpg-online-admin.v1.json、
// 挙動の説明の正は docs/api-contract.md の「管理の API」、設計の正は docs/guides/working/admin-design.md §2・§4〜§7
// （プレイヤーデータの 4 つの口とプレイヤーを読む口の playerData は docs/guides/working/player-data-design.md §8、
// クエストの定義の口・プレイヤーを読む口の questClaims・値を置く口の区切りの値の頭打ちは docs/guides/working/quest-design.md §8、
// 集計の口 /v1/admin/analytics/players と配った量の口 /v1/admin/analytics/grants〔数だけでプレイヤー ID を返さない。関数と SQL は
// src/core/analytics.ts〕は docs/guides/working/analytics-design.md §5）。
//
// 口の種類ごとのファイル: プレイヤーを読む・BAN・増減・スコアを消す（routes-players.ts）・品目とイベントとクエストの定義
// （routes-definitions.ts）・プレイヤーデータのキーと実績と値（routes-player-data.ts）・監査と集計（routes-reports.ts）。
// どの口でも同じ確かめ checkAdmin・checkAdminWrite は common.ts。並びの順は前の 1 ファイルのときと同じ。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31（分けたのは 2026-11-10）
import type { Route } from '../module';
import { definitionRoutes } from './routes-definitions';
import { playerDataRoutes } from './routes-player-data';
import { playerRoutes } from './routes-players';
import { reportRoutes } from './routes-reports';

export { checkAdmin } from './common';

export const adminRoutes: Route[] = [...playerRoutes, ...definitionRoutes, ...playerDataRoutes, ...reportRoutes];
