# 技術設計: Cloudflare Workers + TypeScript

## 1. 基本構成

```text
Mac（先行開発）                      後工程（Phase 3）
CLIモック（Node.js）                Unreal（C++）・Unity（C#）・ブラウザ（TS）
        |                                           |
        +---------------- HTTPS / JSON ------------+
                            |
                    Cloudflare Workers
                      TypeScript API
                            |
         +------------------+---------------------+
         |                  |                     |
        D1             KV / R2           Durable Objects
  SQL・ランキング・セーブ   配信設定・大きなファイル   共有状態・リアルタイム
```

※ 初期PoCは **Workers + D1のみ**。KV/R2/Durable Objectsは機能要求が確定した段階で追加する。

## 2. サービス選定

| サービス | 想定用途 | 設計上の注意 |
| --- | --- | --- |
| Workers | REST API、ルーティング、入力検証、認証 | スコア・通貨などはクライアント申告を信用しない |
| D1 | SQL、ランキング、プレイヤー、投稿、セーブ（本体も 1 行に持つ。64 KiB まで。`docs/guides/working/save-design.md`） | テーブル境界・インデックス・競合制御を設計 |
| KV | マスターデータ、設定、お知らせのキャッシュ | 結果整合性。残高や在庫の原子的更新に使わない |
| R2 | D1 に収まらない大きなセーブ（いまは使わない。`save-design.md` §9）、画像、ユーザー生成コンテンツ | 認可、サイズ制限、保存期間・削除ポリシー |
| Durable Objects | WebSocket、ロビー、ワールドボス状態 | オブジェクト単位の競合制御。規模・料金を検証 |
| Cron Triggers | 日次切替・集計・清掃 | 冪等性、タイムゾーンの明示 |

## 3. APIの基本契約

- ルート：`/v1/...`。将来の破壊的変更は`/v2`。
- 形式：UTF-8の`application/json`。
- 識別：`gameId`、`playerId`、`boardId`は仕様化された文字種・長さのみを受け付ける。
- 日時：サーバー上はUTCのISO 8601、画面表示のみクライアントローカルに変換。
- エラー：`{ "error": { "code": "...", "message": "..." } }`。
- 冪等性：イベントの報酬の受け取りは一意の鍵（プレイヤー・イベント・区切り）で冪等にする（同じ区切りの 2 回目は 200 で 1 回目と同じ本文。見出しは要らない）。自然な鍵の無い状態の更新は`Idempotency-Key`で冪等にする: プレイヤーデータの書き込み（`POST /v1/player-data`）は`Idempotency-Key`が必須で、鍵はプレイヤーごとに書き込みの記録`player_data_writes`の列に入り、同じ鍵と同じ中身の 2 回目は 200 で 1 回目と同じ本文・違う中身は 422 `IDEMPOTENCY_KEY_REUSED`（鍵の形と本文のハッシュは`src/core/idempotency.ts`。`docs/guides/working/player-data-design.md` §6）。消費・購入も同じ考えで足す（`docs/guides/working/event-reward-design.md` §6）。
- 一覧：ページング／件数上限を必須とする。PoCは最大50件。
- 利用制限：ゲストの発行（IP ごと・ゲームごと）とスコアの投稿・セーブの操作・所持品の読み取りとイベントの一覧・報酬の受け取り・プレイヤーデータの読み書き（プレイヤーごと）を D1 の固定窓で数え、上限を超えたら 429 `RATE_LIMITED` と`Retry-After`（秒）。数え方は`src/core/rate-limit.ts`（窓の関数と`consume`）、回数と窓は`src/core/rate-limit-policy.ts`の 1 か所、数は表`rate_limit_counters`（`migrations/0008_rate_limits.sql`）。設計の正は`docs/guides/working/abuse-protection-design.md`。
- セキュリティ：本番はBearer認証やプラットフォーム認証の検証を導入。ゲーム内に管理用APIキーを埋め込まない。

詳細は[API仕様（案）](../../api-contract.md)。

## 4. データ境界

初期はRPG作者単位の**独立Worker・独立D1**を想定する。将来の共有ホストに備えて各テーブルに`game_id`を持たせるが、`gameId`パラメータだけを認証・認可境界とみなしてはいけない。

想定エンティティ:

- `games`: ゲームの設定と公開状態
- `game_modules`: ゲームごとに使う機能（行があればその機能を使う）
- `accounts`: 共通のアカウント（内部の`account_id`。クライアントに返さない。いまはゲストだけ）
- `game_players`: ゲームごとのプレイヤー（公開用の`playerId`と、それを持つ`account_id`。1 つのアカウントは 1 つのゲームに 1 人）
- `ranking_entries`: ゲーム、ボード、プレイヤーごとのスコア
- `saves`: ゲーム、プレイヤー、スロットごとのセーブ（形式の版・本体・チェックサム・リビジョン・消した印）
- `game_configs`: ゲームごとのクライアントの最低の版・最新の版（1 ゲーム 1 行）
- `config_flags`: ゲームごとの機能フラグ（名前と真偽値。クライアントに配るだけで、サーバーの挙動は変えない）
- `config_master_data`: ゲームごとのマスターデータ（キーごとの文字列。1 キー 64 KiB まで。サーバーは中身を解釈しない）
- `announcements`: お知らせの内容、有効期間
- `inventory_items`・`inventory_balances`・`inventory_ledger`: ゲームごとの品目（ID と種類〔通貨か所持品か〕だけ。名前・効果・値段はマスターデータ）・プレイヤーと品目ごとの残高・受領の履歴（増減 1 回で 1 行。`migrations/0009_inventory.sql`。置き場は`src/core/inventory.ts`〔残高の上限と報酬の行の数の上限〕と`src/modules/inventory/`〔所持品と受領の履歴の 2 つの`GET`〕。受領の履歴に書くのは 2 か所で、イベントの受け取り〔`src/modules/events/`〕と管理の増減〔`src/core/ledger.ts`の 1 品目の増減の文〕。履歴の種類の名前〔`source_type`〕は`src/core/ledger.ts`の`LEDGER_SOURCES`の 1 か所。設計の正は`docs/guides/working/event-reward-design.md`）
- `rate_limit_counters`: 利用制限の数（単位の名前・鍵・窓の始まりごとに 1 行。IP はハッシュにして持つ。`docs/guides/working/abuse-protection-design.md` §3）
- `admin_audit_log`: 管理の操作の記録（監査のログ。管理の書き込みの操作 1 回で 1 行。誰が〔`X-Admin-Actor`〕・何を・前と後・理由・時刻と、二重の止めの`Idempotency-Key`。API からは書き換えない・消さない。保持は 365 日。`migrations/0011_admin.sql`。置き場は`src/core/admin/`〔管理の鍵・監査・管理の口。ゲームごとの機能にしない〕。管理の口を呼ぶのはローカルの管理コマンド`scripts/admin-cli.mjs`〔要求の形の関数は`scripts/admin-requests.mjs`〕で、ゲームのクライアント〔CLI モック・UE・Unity・ブラウザ〕には管理の鍵も管理の口も持たせない。トークン・管理の鍵・セーブの本文・IP は入れない。設計の正は`docs/guides/working/admin-design.md`）
- `player_bans`: 止めたプレイヤー（ゲームとプレイヤーごとに 1 行。理由〔管理の人のメモ。プレイヤーには返さない〕・止めた時刻・期限〔無ければずっと〕。行があり期限の前なら、そのプレイヤーのトークンの要求は 403 `PLAYER_BANNED`。解くときは行を消し、記録は`admin_audit_log`に残る。`migrations/0012_player_bans.sql`。引くのは`src/core/bans.ts`〔4 つのモジュールがプレイヤーの利用制限の後に呼ぶ。`requireAuth`は DB を引かないまま〕、書くのは`src/core/admin/`の BAN の口。設計の正は`docs/guides/working/admin-design.md` §4）
- `messages`: 酒場投稿、削除・通報状態
- `events`・`event_rewards`・`event_claims`: ゲームごとのイベント（区切り〔一度きり・デイリー・週間〕・期間・区切りの時差）・イベントごとの報酬（品目と数）・プレイヤー・イベント・区切りごとの受け取り（二重を止める一意の鍵。`migrations/0010_events.sql`。置き場は`src/modules/events/`〔一覧の`GET`と受け取りの`POST`。期間と区切りの関数は`period.ts`〕。期間はサーバーの時刻だけで決め、Cron Triggers は使わない。設計の正は`docs/guides/working/event-reward-design.md`）
- `player_data_keys`・`player_data`・`player_data_writes`: ゲームごとのプレイヤーデータのキーの宣言（キー・書き方〔`add`・`max`・`set`・`flag`〕・値の上限・1 回の増加の上限だけ。名前・説明はマスターデータ）・プレイヤーとキーごとの値（0 以上の整数と最後に変わった時刻。宣言の無いキーは受け付けない）・書き込みの記録（書き込み 1 回で 1 行。二重の止めの`Idempotency-Key`〔プレイヤーごとに一意〕と本文のハッシュ・送り直しに返す応答の写し）。`migrations/0013_player_data.sql`。置き場は`src/core/player-data.ts`〔値の上限・書き方・範囲の確かめ〕と`src/modules/player-data/`〔読む`GET`と書く`POST`。書き込みの記録と値は 1 つの`batch`〕。設計の正は`docs/guides/working/player-data-design.md`）
- `achievements`・`player_achievements`: ゲームごとの実績の宣言（実績の ID・見るキー・閾値だけ。名前・説明・絵はマスターデータ）・プレイヤーと実績ごとの解いた実績（解いた時刻と、解いた書き込みの`write_ref`。主キー〔ゲーム・プレイヤー・実績〕で二重に解かない。値が下がっても消さない）。`migrations/0014_achievements.sql`。解くのはサーバーだけで、`src/modules/player-data/`の書き込みの`batch`の中（書いた後の値が閾値以上の実績）。解いたと申告する口は無い。設計の正は`docs/guides/working/player-data-design.md` §7）
- `event_progress`: プレイヤーごとの達成度（クエスト。Phase 2 の残り）
- `adventurer_profiles`: 公開可能なゴースト用プロフィール

PoCで実際に作るのは`games`（登録だけ。公開状態の欄はまだ無い）と`game_modules`と`accounts`と`game_players`と`ranking_entries`と`saves`と`announcements`と`rate_limit_counters`と`inventory_items`・`inventory_balances`・`inventory_ledger`と`events`・`event_rewards`・`event_claims`と`admin_audit_log`と`player_bans`と`player_data_keys`・`player_data`・`player_data_writes`と`achievements`・`player_achievements`のみ。`accounts`と`game_players`の境目は`docs/guides/working/account-design.md` §2。

## 5. クライアントとの将来の境界

対象は Unreal・Unity・ブラウザの 3 つ（ADR 0002）。どれも同じ HTTP/JSON の API を呼ぶ。下は Unreal の RPG 制作ツールのイベントに、JSON形式のオンラインコマンドを追加する構想:

```json
{
  "command": "online.ranking.submit",
  "params": {
    "boardId": "boss-score",
    "scoreVariable": 120,
    "responseVariable": 121
  }
}
```

イベント実行機構のアダプターがUEのHTTPリクエストを組み立てる。サーバーにはエンジンのクラスやUI（Slate/UMG・Unity の UI など）に依存させない。以下は 3 つのクライアントで共通。通信待ち・失敗・再試行は非同期処理とし、ゲーム進行をフリーズさせない。

- タイムアウト・再試行：安全なGETは再試行可能。POSTには冪等キーを利用。
- スキーマ違反：ゲーム上で扱うエラー変数に落とし込み、例外を隠さない。
- オフライン：ゲーム進行を妨げず、必要なら未送信キューを用意。
- 秘密：クライアントに保存した長期秘密鍵を安全なものとみなさない。

## 6. ローカルから本番への移行

1. **local**：MacでWrangler dev、ローカルD1、CLIモック。
2. **staging**：専用Worker／D1、テスト用アカウント、認証とレート制限、バックアップ検証。
3. **production**：別Worker／D1、秘密情報の管理、監視、障害対応手順、費用アラート。

本リポジトリの`wrangler.jsonc`はローカル動作のためにダミーのD1 IDを置く。本番用として流用しない。ステージング以降は環境ごとに実際のCloudflareリソースを発行する。

## 7. 開発ツール

- TypeScript、Wrangler、D1マイグレーション
- Node.js 22+ でCLIモック（当面はJavaScriptの`.mjs`、必要に応じてTS化）
- GitHubを変更履歴の基点とする
- 実装時はローカル自動テストとステージングのE2Eテストを追加

## 8. 参照

- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/d1/best-practices/local-development/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/