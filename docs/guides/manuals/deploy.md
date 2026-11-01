# 自分の Cloudflare にデプロイする（staging・production）

> **いまの制限（先に読む）:** いまの版では、`APP_ENV` が `local` でない Worker の書き込みの口（ゲストの発行・スコアの投稿・セーブ・受け取りなど）とトークンの要る読み取り・管理の口は、全部 **403 `NOT_READY_FOR_PRODUCTION`** を返します。
> デプロイしても動くのは、トークンの要らない読み取り（お知らせ・ランキング・設定）だけです。
> この守りを外すのは、配布の束 **P6** の後です（`docs/guides/working/distribution-design.md` §3.4）。P6 の後に、この冒頭と手本の `APP_ENV` を書き換えます。

この説明書は、このリポジトリをフォークし、**自分のゲームのために自分の Cloudflare のアカウントへ** Worker と D1 を置く作者に向けた手順書です。
ゲームごとに Worker と D1 を 1 組ずつ持ちます（ゲーム別独立デプロイ。`docs/adr/0003-distribution-license-support.md`）。
本物の ID・鍵・アカウント名・URL は、自分のフォークと Cloudflare にだけ置き、Issue・チャット・このリポジトリへの PR に書かないでください。

## 前提

- Node.js 22・npm が入っていて、フォークした手元で `npm install` が済んでいる（`wrangler` はリポジトリの `node_modules` のものを `npx wrangler …` で使う）。
- ローカルの確かめが通る: `npm run db:migrate:local`・`npm run dev` の後に別の窓で `npm run cli:smoke` が PASS、`npm run typecheck` と `npm test` が通る（`README.md` の「Macでローカル動作確認」）。
- 自分の Cloudflare のアカウントがあり、`npx wrangler login` でログインできる。
- 環境は 3 つに分ける。

| 環境 | 何に使うか | Worker の名前（例） | D1 の名前（例） | `APP_ENV` |
| --- | --- | --- | --- | --- |
| local | 手元の開発（`npm run dev`） | （`wrangler.jsonc` の上の階のまま） | `rpg-online-local` | `local`（`npm run dev` だけが渡す） |
| staging | 本番の前の確かめ | `my-game-staging` | `my-game-staging` | P6 の前は `disabled` |
| production | 遊ぶ人に公開 | `my-game-production` | `my-game-production` | P6 の前は `disabled` |

`my-game` は自分のゲームの名前に置き換えてください。

## 手順

### 1. 環境の手本を自分の `wrangler.jsonc` に足す

自分のフォークの `wrangler.jsonc` の、いちばん外の `{ }` の中に、次の `env` を足します（上の階の `name`・`main`・`triggers`・`vars`・`d1_databases` は local のために残す）。

```jsonc
{
  "env": {
    "staging": {
      // Worker の名前は環境ごとに別にする
      "name": "my-game-staging",
      // vars は上の階から引き継がれないので、環境ごとに書く。P6 の前は disabled（local にしない）
      "vars": {
        "APP_ENV": "disabled"
      },
      // d1_databases も引き継がれない。database_id は手順 3 の wrangler d1 create の出力で置き換える
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-game-staging",
          "database_id": "00000000-0000-0000-0000-000000000000",
          "migrations_dir": "migrations"
        }
      ],
      // 上の階と同じ値を書く（引き継がれるが、手本では明示する）
      "triggers": {
        "crons": ["30 18 * * *"]
      }
    },
    "production": {
      "name": "my-game-production",
      "vars": {
        "APP_ENV": "disabled"
      },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "my-game-production",
          "database_id": "00000000-0000-0000-0000-000000000000",
          "migrations_dir": "migrations"
        }
      ],
      "triggers": {
        "crons": ["30 18 * * *"]
      }
    }
  }
}
```

- **`binding` は `DB` のまま**にします（コードが `env.DB` を読む）。`migrations_dir` も `migrations` のままにします。
- **`database_id` の `00000000-…` はダミー**です。手順 3 で自分の ID に置き換えるまで、デプロイしないでください。
- **`vars` と `d1_databases` は上の階から引き継がれません。** 環境ごとに書きます（`node_modules/wrangler/config-schema.json` のそれぞれの説明に「not automatically inherited」とある。wrangler 4.152.0 で確かめた）。
- **`triggers` は上の階から引き継がれます**（同じファイルで `triggers` が「上の階から引き継ぐ欄」の `EnvironmentInheritable` に入っている）。ただ、手本では値をはっきりさせるため、上の階の `triggers.crons`（`"30 18 * * *"`。毎日 UTC 18:30 の掃除）と同じ値を書いています。上の階の値を変えたら、ここも合わせてください。
- `APP_ENV` を `local` にしないでください。`local` は手元の開発のためだけの値で、トークンの鍵が無いときに公開の既定の鍵へ戻ります（`src/core/token.ts` の `tokenSecret`）。

### 2. 秘密を入れる（`AUTH_TOKEN_SECRET`・`ADMIN_API_KEY`）

Worker が使う秘密は 2 つです（`src/core/env.ts` の `Env` の型）。

| 名前 | 何の鍵か | 無いとき |
| --- | --- | --- |
| `AUTH_TOKEN_SECRET` | プレイヤーのトークンの署名（`src/core/token.ts`） | P6 の後、`local` でない環境の書き込みが 500 `INTERNAL_ERROR`（P6 の前は先に 403） |
| `ADMIN_API_KEY` | 管理の口の鍵（`src/core/admin/key.ts`） | 管理の口が 500 `INTERNAL_ERROR`（P6 の前は管理の口が全部先に 403） |

1. 値を作ります。どちらも **32 文字以上の乱数**にします（短いと使われません）。1 つの値ごとに 1 回流します。

   ```bash
   node -e "console.log(crypto.randomBytes(32).toString('base64url'))"
   ```

2. 環境ごとに入れます。**値はコマンドの引数に書きません。** 次のコマンドを流すと `Enter a secret value:` と聞かれるので、そこに貼り付けます。

   ```bash
   npx wrangler secret put AUTH_TOKEN_SECRET --env staging
   npx wrangler secret put ADMIN_API_KEY --env staging
   npx wrangler secret put AUTH_TOKEN_SECRET --env production
   npx wrangler secret put ADMIN_API_KEY --env production
   ```

- **staging と production には別の値**を入れます（staging の鍵が漏れても production のトークンを作れないように）。4 つとも別の値です。
- 値をファイル（`wrangler.jsonc`・ソース・`.dev.vars` を git に入れること）・チャット・Issue に書かないでください。手元に残すならパスワードの管理の道具に入れます。
- **取り替えたとき:**
  - `AUTH_TOKEN_SECRET` を入れ直すと、前の鍵で作ったトークンは全部 **401 `UNAUTHENTICATED`** になります。遊ぶ人のクライアントはゲストを発行し直すことになります。
  - `ADMIN_API_KEY` を入れ直すと、管理コマンド（`node scripts/admin-cli.mjs`）に渡す鍵（環境変数 `ADMIN_API_KEY`）も同時に新しい値に変えます。前の鍵では管理の口が 401 になります。

### 3. リモートの D1 を作り、マイグレーションを流す

staging で先に全部を確かめてから、production に進みます。

1. D1 を作ります。

   ```bash
   npx wrangler d1 create my-game-staging
   ```

2. 出力に出る `database_id` を、自分の `wrangler.jsonc` の `env.staging.d1_databases` の `database_id` に写します（ダミーの `00000000-…` を置き換える）。D1 の ID は秘密ではありませんが、自分のフォークにだけ置きます。
3. マイグレーションを流します。適用の前に確認を聞かれます。

   ```bash
   npx wrangler d1 migrations apply DB --env staging --remote
   ```

4. production も同じ順に流します（`npx wrangler d1 create my-game-production` → `env.production` の `database_id` に写す → `npx wrangler d1 migrations apply DB --env production --remote`）。

- `migrations/` の既存のファイルを書き換えないでください。直しは新しい番号のファイルで足します（すでに流した D1 には、書き換えが届きません）。
- `--remote` を付けないと、手元の D1（`.wrangler/`）に流れます。

### 4. デプロイする

```bash
npx wrangler deploy --env staging
```

staging で手順の「確かめ方」が済んでから、`npx wrangler deploy --env production` を流します。

### 5. 本番の CORS

いまの版は、ブラウザの CORS の見出しを **`local` のときだけ**、決めたローカルのオリジンにだけ返します（`src/core/cors.ts`）。staging・production では返しません。
ブラウザのゲームを別のオリジンに置くための `CORS_ORIGINS`（環境ごとの `vars`。カンマ区切りのオリジンの一覧・ワイルドカード無し）は、**P6 で足す予定**です。それまでは手本に `CORS_ORIGINS` を書いても使われません。

## 確かめ方

| 確かめ | どうするか |
| --- | --- |
| 設定の組み立て（アップロードしない） | `npx wrangler deploy --dry-run --env staging`。アップロードせずに組み立てと設定の確かめだけをします。ログインが要るか・`--env` の手本の誤りをどこまで見つけるかは**要確認**です。このリポジトリの開発では、無人の回では流さず、人が会話の側で流すかをユーザーが決めます（`distribution-design.md` §12 の 6） |
| 生きているか | staging の Worker の URL の `GET /health` が 200 を返す |
| 読み取り | `GET /v1/announcements?gameId=demo-rpg` と `GET /v1/config?gameId=demo-rpg` が 200 を返す |
| 書き込みの守り | `POST /v1/accounts/guest` が 403 `NOT_READY_FOR_PRODUCTION` を返す（P6 の前は、これが正しい結果） |
| 通しの確かめ | P6 の後に、`API_BASE_URL=<staging の URL> npm run cli:smoke` が PASS になる。P6 の前は書き込みが 403 なので、ゲストの発行の手順で止まる |
| 掃除の Cron | Cloudflare のダッシュボードの Worker の「Triggers」に `30 18 * * *` が出る（P6 の前は `APP_ENV` が `local` でないので何も消さない） |

## 困ったとき

| 起きたこと | 見るところ |
| --- | --- |
| 書き込みが全部 403 `NOT_READY_FOR_PRODUCTION` | いまの版の正しい結果です（冒頭）。P6 の後まで待ちます。`APP_ENV` を `local` にして回避しないでください |
| 書き込みや管理の口が 500 `INTERNAL_ERROR`（P6 の後） | その環境に `AUTH_TOKEN_SECRET`・`ADMIN_API_KEY` が入っていない、または 32 文字より短い。手順 2 を `--env` を付けて流し直す |
| 前は通ったトークンが 401 `UNAUTHENTICATED` | `AUTH_TOKEN_SECRET` を取り替えた後です。ゲストを発行し直します |
| マイグレーションが別の D1 に流れた・見つからない | `--env staging`（か `--env production`）と `--remote` を付けたか、`database_id` をダミーのままにしていないかを見る |
| `env.staging` に D1 や `APP_ENV` が無いと言われる | `vars`・`d1_databases` は上の階から引き継がれません。手順 1 の手本のとおり環境ごとに書く |
| Cron が動かない | `triggers.crons` を見る。手本のとおり環境の中にも同じ値を書く |
