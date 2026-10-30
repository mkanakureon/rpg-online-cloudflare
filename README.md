# Game Online Backend (Cloudflare / TypeScript)

Cloudflare 上で動く、エンジンに依存しないモジュール式のゲームバックエンドの試作リポジトリです。RPG に限らず、OSS として公開することを目指します（[ADR 0002](docs/adr/0002-engine-agnostic-game-backend.md)）。対象のクライアントは **Unreal・Unity・ブラウザ** の 3 つです。

> **開発方針:** 先に **MacでCloudflare Workers（TypeScript）＋CLIモック** を開発・検証する。3 つのクライアントへの統合は後工程（Phase 3）。別のWindows PCで進めるUnreal／Unityの作業を止めない。
>
> **状態:** 設計検討＋ローカル専用の最小API試作。**認証、レート制限、不正対策が未実装のため、本番公開不可。**

## 設計資料

- [機能検討書](docs/guides/decisions/feature-study.md)：優先機能・利用場面・取捨選択
- [技術設計](docs/guides/working/architecture.md)：API・Cloudflareサービス・データ境界・クライアントとの境界
- [開発計画](docs/guides/decisions/roadmap.md)：サーバー先行／CLIモックの段階的検証
- [運用とセキュリティ](docs/guides/decisions/operations-security.md)：公開前に必須の対策
- [ADR 0001](docs/adr/0001-mac-first-cli.md)：3台構成とCLI先行の意思決定
- [ADR 0002](docs/adr/0002-engine-agnostic-game-backend.md)：エンジンに依存しないゲームバックエンドへの方針の変更
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

## 試作対象API

| HTTP | パス | 内容 |
| --- | --- | --- |
| GET | `/health` | ヘルスチェック |
| GET | `/v1/announcements?gameId=demo-rpg` | サンプルお知らせ取得 |
| GET | `/v1/rankings/boss-score?gameId=demo-rpg` | スコアランキング取得 |
| POST | `/v1/accounts/guest` | ローカル専用ゲスト発行（プレイヤー ID とトークンを返す） |
| POST | `/v1/rankings/boss-score` | ローカル専用スコア投稿（`Authorization: Bearer <token>` が要る） |

`npm run cli:smoke` がこれらを呼び出し、応答と上位ランキングへの反映を検証します。サーバーの本番仕様を保証するものではありません。

## 想定する実機分担

| PC | 担当 |
| --- | --- |
| Mac（余剰機） | TypeScript / Workers / D1 / CLIモック / APIテスト・ドキュメント（後でブラウザのクライアントも） |
| Windows PC A | Unreal Engine RPG制作ツール（後でHTTP/JSONを接続） |
| Windows PC B | Unity開発（後でHTTP/JSONを接続） |

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

## 将来の接続

Unreal（C++）・Unity（C#）・ブラウザ（TypeScript）のHTTPクライアントが、同じAPIを呼び出す。APIの型・レスポンス形式は初期に確定し（`openapi/rpg-online.v1.json`）、それまではCLIモックを3つのクライアントの代替として使う。詳細は[技術設計](docs/guides/working/architecture.md)。

## 公式ドキュメント

- [Workers / Wrangler設定](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1 ローカル開発](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 マイグレーション](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Cloudflare 料金](https://developers.cloudflare.com/workers/platform/pricing/)