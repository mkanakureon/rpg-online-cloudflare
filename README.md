# Game Online Backend (Cloudflare / TypeScript)

Cloudflare 上で動く、エンジンに依存しないモジュール式のゲームバックエンドの試作リポジトリです。RPG に限らず、OSS として公開することを目指します（[ADR 0002](docs/adr/0002-engine-agnostic-game-backend.md)）。対象のクライアントは **Unreal・Unity・ブラウザ** の 3 つです。

> **開発方針:** 先に **MacでCloudflare Workers（TypeScript）＋CLIモック** を開発・検証する。3 つのクライアントの層（`clients/`）はソースまで作ってあり、Unity・Unreal の動きは専用の PC で人が確かめる（Phase 3 の残り）。
>
> **状態:** ローカル専用の PoC。認証はゲストのトークン、利用制限は D1 の固定窓、スコアの確かめは値の範囲と回数までです。**書き込みの API は `APP_ENV=local` のときだけ通り、それ以外の環境ではいまは 403 `NOT_READY_FOR_PRODUCTION` を返します**（下の「いまの制限」）。本番への公開はまだできません。

## 設計資料

- [機能検討書](docs/guides/decisions/feature-study.md)：優先機能・利用場面・取捨選択
- [技術設計](docs/guides/working/architecture.md)：API・Cloudflareサービス・データ境界・クライアントとの境界
- [開発計画](docs/guides/decisions/roadmap.md)：サーバー先行／CLIモックの段階的検証
- [運用とセキュリティ](docs/guides/decisions/operations-security.md)：公開前に必須の対策
- [ADR 0001](docs/adr/0001-mac-first-cli.md)：3台構成とCLI先行の意思決定
- [ADR 0002](docs/adr/0002-engine-agnostic-game-backend.md)：エンジンに依存しないゲームバックエンドへの方針の変更
- [ADR 0003](docs/adr/0003-distribution-license-support.md)：配布の形（ゲーム別独立デプロイ）・ライセンス（MIT）・サポートの範囲
- [配布／OSS 公開の設計書](docs/guides/working/distribution-design.md)：守りを外す道筋・デプロイの手順・実装の束
- [API仕様（案）](docs/api-contract.md)：HTTP/JSONの契約

## Macでローカル動作確認（Node.js 22+）

```bash
npm install
npm run db:migrate:local
npm run dev
```

別ターミナルで:

```bash
npm run cli:smoke
npm run typecheck
```

- Workerのローカル既定URL: `http://127.0.0.1:8787`
- `API_BASE_URL=http://127.0.0.1:8787 npm run cli:smoke` で接続先変更
- ローカルD1のデータは `.wrangler/` 以下に保存され、Gitには含めません。
- `wrangler.jsonc` のD1 IDは**ローカル専用のダミー**です。本番デプロイには実際のD1 IDと環境分離・認証実装が必要です。
- この試作は安全側の設定として`APP_ENV=disabled`を既定にしています。`npm run dev`はローカル起動時だけ`--var APP_ENV:local`を与えるため、スコア投稿ができます。**無認証APIのデプロイは行わないでください。**

## API

口の一覧と挙動の説明の正は [API仕様](docs/api-contract.md)、形の正はスキーマ（ゲームのクライアントの口は `openapi/rpg-online.v1.json`、管理の口は `openapi/rpg-online-admin.v1.json`）です。機能ごとのまとめ:

| 機能 | 主な口 | トークン |
| --- | --- | --- |
| ヘルスチェック | `GET /health` | 要らない |
| アカウント（ゲスト） | `POST /v1/accounts/guest`・`POST /v1/accounts/token` | 発行は要らない |
| お知らせ | `GET /v1/announcements` | 要らない |
| ランキング | `GET`・`POST /v1/rankings/boss-score` | 投稿だけ要る |
| セーブ | `GET`・`PUT`・`DELETE /v1/saves/{slotId}`・`GET /v1/saves` | 要る |
| 所持品 | `GET /v1/inventory`・`GET /v1/inventory/history` | 要る |
| イベント | `GET /v1/events`・`POST /v1/events/{eventId}/claim` | 要る |
| プレイヤーデータ・実績 | `GET`・`POST /v1/player-data` | 要る |
| クエスト | `GET /v1/quests`・`POST /v1/quests/{questId}/claim` | 要る |
| 設定配信 | `GET /v1/config`・`GET /v1/config/master/{key}` | 要らない |
| 管理（運営の人だけ） | `/v1/admin/...`（`node scripts/admin-cli.mjs` から呼ぶ） | 管理の鍵 |

`npm run cli:smoke` が CLI モック（ブラウザの SDK `clients/browser/` で送る）で、ヘルスチェック・設定配信・マスターデータ・お知らせ・ゲストの発行・トークンの取り替え・ランキング・セーブ・イベントの受け取り・プレイヤーデータ・クエストを順に呼び（手順の名前は `clients/browser/rpg-online-client.mjs` の `SCENARIO_STEPS`）、応答を確かめます。サーバーの本番の仕様を保証するものではありません。

## いまの制限

- **ゲストは本人確認ではありません。** ゲストのトークンは「同じ端末から続けて遊ぶ」ための印で、その人が誰かを確かめません。
- **スコアは改ざんできます。** サーバーが見るのは値の範囲と送る回数までで、ゲームの中で本当に取れたスコアかは確かめません。賞品のあるランキングや大会のような、**競争の強い機能には使わないでください。**
- **いまは書き込みが 403 です。** 書き込みの API（ゲストの発行・スコアの投稿・セーブ・受け取りなど）とトークンの要る読み取り、管理の API は、`APP_ENV=local` のとき（`npm run dev`）だけ通り、それ以外の環境では 403 `NOT_READY_FOR_PRODUCTION` を返します。既定の `wrangler.jsonc` は `APP_ENV=disabled` です。この守りを外す道筋は[配布／OSS 公開の設計書](docs/guides/working/distribution-design.md) §3 にあり、外すかどうかはまだ決めていません。

## 想定する実機分担

| PC | 担当 |
| --- | --- |
| Mac（余剰機） | TypeScript / Workers / D1 / CLIモック / APIテスト・ドキュメント（後でブラウザのクライアントも） |
| Windows PC A | Unreal Engine RPG制作ツール（`clients/unreal/` のプラグインを入れて確かめる） |
| Windows PC B | Unity開発（`clients/unity/` の包みを入れて確かめる） |

サーバー側にエンジン固有の依存を持たせず、HTTP/JSON契約を共通境界とします。各クライアントの開発時点でもサーバーAPIの変更を最小化する方針です。

## Macでこのリポジトリを取得する

GitHubにリポジトリは作成済みです。Macからクローンして使用します。

```bash
git clone https://github.com/mkanakureon/rpg-online-cloudflare.git
cd rpg-online-cloudflare
npm install
npm run db:migrate:local
npm run dev
```

別ターミナルから `npm run cli:smoke` と `npm run typecheck` を実行します。

## クライアント

Unreal（C++。`clients/unreal/`）・Unity（C#。`clients/unity/`）・ブラウザ（JavaScript。`clients/browser/`）のクライアントの層が、同じ API を呼びます。タイムアウト・再試行・エラーの分け方は、スキーマの `x-client-policy` に揃えています。詳細は[技術設計](docs/guides/working/architecture.md)。

## ライセンス

[MIT License](LICENSE) です。著作権の表示と許諾の文を残せば、使う・直す・配る・売ることができます。

配るもの（Worker のコードと `clients/` のクライアントの層）に第三者の包みは入りません。`package.json` は `dependencies` を持たず、`devDependencies`（wrangler・vitest など）は開発の道具で、配るものに含みません。

## サポートの範囲

- **無保証です**（MIT のとおり）。動作・安全・データの保全を約束しません。
- Issue で受けるのは、**このリポジトリの最新の版で再現できる不具合だけ**です。再現の手順を書いてください。
- 利用者の Cloudflare の設定・**料金**・データの復元は扱いません。
- 応答の期限は約束しません。対応する版は最新の 1 つだけです。

## 公式ドキュメント

- [Workers / Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 ローカル開発](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 マイグレーション](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Cloudflare 料金](https://developers.cloudflare.com/workers/platform/pricing/)