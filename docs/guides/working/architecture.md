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
- 冪等性：報酬受取や購入など状態更新には`Idempotency-Key`を導入する。
- 一覧：ページング／件数上限を必須とする。PoCは最大50件。
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
- `messages`: 酒場投稿、削除・通報状態
- `events`: 期間限定イベント定義
- `event_progress`: プレイヤーごとの達成度と報酬取得状況
- `adventurer_profiles`: 公開可能なゴースト用プロフィール

PoCで実際に作るのは`games`（登録だけ。公開状態の欄はまだ無い）と`game_modules`と`accounts`と`game_players`と`ranking_entries`と`saves`と`announcements`のみ。`accounts`と`game_players`の境目は`docs/guides/working/account-design.md` §2。

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