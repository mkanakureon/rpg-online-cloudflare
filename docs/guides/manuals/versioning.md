# 版の決まりと、新しい版へ上げる手順

この説明書は、このリポジトリをフォークして自分の Cloudflare に置いた作者（`docs/guides/manuals/deploy.md` と同じ読み手）に向けて、API・スキーマ・マイグレーション・クライアントの層の版の決まりと、上流の新しい版を取り込むときの順を書きます。
決まりの元は `docs/guides/working/distribution-design.md` §8.3（§12 の 11）です。

## 前提

- `docs/guides/manuals/deploy.md` の手順が済み、staging と production がある。
- 上流のこのリポジトリの新しい版を、自分のフォークに取り込める（git の merge など）。

## 版の決まり

| もの | いまの版 | 決まり |
| --- | --- | --- |
| API の版（URL の頭） | `/v1` | 足すだけの変更（欄・操作・エラーコード）は `/v1` のまま。欄を消す・意味を変える変更は `/v2` の道を足して `/v1` と並べ、`/v1` を決めた期間残す。`/v2` を作るのは、壊す変更が要るときだけ（`docs/api-contract.md` の「`/v1/` の中では、欄は足すだけ」） |
| スキーマの版（`openapi/rpg-online.v1.json` の `info.version`） | `1.0.0` | semver（`大.中.小`）で付ける。足すだけの変更なら小さい位を上げる。`/v2` を足すときは新しいファイル（`rpg-online.v2.json`）にする |
| マイグレーション（`migrations/`） | 番号の付いたファイル | 既存のファイルを書き換えず、新しい番号のファイルで足すだけ。足す前に、旧クライアントの要求が通ることを互換の試験 `旧CLIはスキーマ変更後のAPIでもランキングを送って読める`・`今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`）の形で見る |
| クライアントの層の版 | 下の表 | 3 つのクライアントの層を同じ版で揃える |

クライアントの層の版:

| クライアントの層 | 版の置き場 | いまの版 |
| --- | --- | --- |
| Unity | `clients/unity/package.json` の `version` | 0.1.0 |
| Unreal | `clients/unreal/RpgOnlineClient/RpgOnlineClient.uplugin` の `VersionName` | 0.1.0 |
| ブラウザの SDK | 版の欄はまだ無い（配布の束 P7 で足す） | — |

- Unity と Unreal の層は、いまは同じ版です。試験 `UnityとUnrealのクライアント層の版は同じで版の説明書の表と一致する` が、2 つの版が同じで、この表の版と同じことを見ます。版を上げるときは、2 つのファイルとこの表を同じコミットで直します。

## 手順（上流の新しい版を自分の環境へ入れる）

### 1. 変わったものを見る

1. 上流の新しい版を自分のフォークに取り込みます。
2. `migrations/` に新しい番号のファイルが増えたか、`openapi/rpg-online.v1.json` の `info.version` がどう変わったか、`/v2` の道が足されたかを見ます。
3. 手元で確かめます: `npm run db:migrate:local` の後に `npm run typecheck` と `npm test` が通ること。

### 2. staging に入れる（マイグレーションを先に、Worker を後に）

1. **先にマイグレーションを流します。**

   ```bash
   npx wrangler d1 migrations apply DB --env staging --remote
   ```

2. **後で Worker をデプロイします。**

   ```bash
   npx wrangler deploy --env staging
   ```

- この順にするのは、新しい Worker が新しい表や列を読むためです。マイグレーションは足すだけなので、古い Worker は新しい表があっても動きます。逆の順だと、新しい Worker が無い表を読んで 500 `INTERNAL_ERROR` になります。
- 大きな変更の前には、`docs/guides/manuals/backup-restore.md` の手順 1 で戻す印を控えます。

### 3. production に入れる

staging で「確かめ方」が済んでから、同じ順に流します。

```bash
npx wrangler d1 migrations apply DB --env production --remote
npx wrangler deploy --env production
```

### 4. クライアントを上げる

- 足すだけの変更（`/v1` のまま）なら、古いクライアントはそのまま動きます。新しい欄や操作を使うときだけ、クライアントの層を新しい版に上げます。
- `/v2` が足されたときは、`/v1` が残っている間に、ゲームのクライアントを `/v2` に移します。

## 確かめ方

| 確かめ | どうするか |
| --- | --- |
| マイグレーションが全部流れた | `npx wrangler d1 migrations list DB --env staging --remote` で、まだ流していないものが無い |
| 古いクライアントが動く | 前の版のクライアント（CLI モック `npm run cli:smoke` など）で、読み取りの口が通る（P6 の前は書き込みが 403。`deploy.md` の冒頭） |
| 版がそろっている | `npm test` の `UnityとUnrealのクライアント層の版は同じで版の説明書の表と一致する` が通る |

## 困ったとき

| 起きたこと | 見るところ |
| --- | --- |
| デプロイの後に 500 `INTERNAL_ERROR` が増えた | マイグレーションを先に流したかを見る。流していなければ `wrangler d1 migrations apply` を流す |
| 古いクライアントが 400 や 404 になる | 上流が `/v1` の欄を消していないかを見る（決まりでは消さない）。消していたら上流の不具合として報告する |
| マイグレーションを書き換えたくなった | 書き換えません。すでに流した D1 には届きません。直しは新しい番号のファイルで足す |
| 戻したい | `backup-restore.md` の手順 3 で、控えた印へ戻し、前の版の Worker をデプロイし直す |
