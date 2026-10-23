# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

UE製RPG制作ツールに追加するオンライン機能のバックエンド試作（Cloudflare Workers + D1 / TypeScript）。**ローカル専用PoC**であり、認証・レート制限・不正対策は未実装。開発はMacで先行し、Node.jsのCLIモックを唯一の初期クライアントとする（UE統合は後工程。経緯は `docs/adr/0001-mac-first-cli.md`）。

## コマンド（Node.js 22+）

```bash
npm install
npm run db:migrate:local   # migrations/ をローカルD1（.wrangler/ 配下）に適用
npm run dev                # wrangler dev --local, APP_ENV=local で http://127.0.0.1:8787
npm run cli:smoke          # 別ターミナルで。起動中のWorkerに対するE2Eスモークテスト
npm run typecheck          # tsc --noEmit（src/**/*.ts のみ対象）
```

- 接続先変更: `API_BASE_URL=http://127.0.0.1:8787 npm run cli:smoke`
- ユニットテスト基盤・lintは未導入。検証は `typecheck` と `cli:smoke` の2つ。

## アーキテクチャ

- `src/worker.ts` 1ファイルにルーティング・入力検証・D1アクセスを集約。外部依存なし（`@cloudflare/workers-types` も使わず、D1の型 `Statement`/`Database` を自前で最小定義している）。
- `scripts/cli-mock.mjs` は将来のUE C++ HTTPクライアントの代替。API変更時はここも合わせて更新し、スモークテストが通ることを確認する。
- `migrations/` がD1スキーマとシードデータ（`demo-rpg` のお知らせ）。スキーマ変更は既存ファイルを編集せず、新しい連番ファイルを追加する。
- `docs/api-contract.md` がCLI／UE／サーバー共通のHTTP/JSON契約。エンドポイントやエラーコードを変えたら契約も更新する。サーバーにUE固有の依存を持ち込まない。

## 守るべき不変条件

- **書き込み系APIは `env.APP_ENV === 'local'` のときだけ許可**し、それ以外は `403 NOT_READY_FOR_PRODUCTION`。`wrangler.jsonc` の既定は `APP_ENV=disabled`、`npm run dev` だけが `local` を渡す。この安全側の既定を崩さないこと。
- `wrangler.jsonc` のD1 IDはダミー。無認証APIのデプロイ（`wrangler deploy`）は行わない。
- エラー形式は `{ "error": { "code", "message" } }`。DBエラーの詳細はクライアントに返さず、`INTERNAL_ERROR`（500）にまとめる。
- ID（`gameId`/`playerId`/`boardId`）は `^[a-zA-Z0-9_-]{1,64}$`、一覧は最大50件。SQLは必ず `prepare().bind()` でパラメータ化する。
- ランキングはプレイヤーごとに最高スコアのみ保持（`ON CONFLICT ... MAX(...)`）、並びは score DESC → updated_at ASC → player_id ASC。
- `gameId` は認可境界ではない。将来の認証設計は `docs/04-operations-security.md` に従う。
