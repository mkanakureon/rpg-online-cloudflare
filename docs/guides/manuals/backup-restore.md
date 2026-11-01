# D1 のバックアップと復元（Time Travel・書き出し・復元演習）

この説明書は、自分の Cloudflare に Worker と D1 を置いた作者（`docs/guides/manuals/deploy.md` と同じ読み手）に向けた手順書です。
このリポジトリには、バックアップや復元のコードはありません。D1 の Time Travel（いつも有効）と `wrangler` のコマンドで行います（`docs/guides/working/analytics-design.md` §8）。

> **先に読む:** `wrangler d1 time-travel restore` は、**いまの D1 の中身を、指定した時点の中身で上書きする壊す操作**です。
> 戻した時点より後の書き込み（セーブ・スコア・受け取り）は全部消えます。production で流す前に、必ず staging で復元演習を済ませてください。

本物の D1 の ID・アカウント名・書き出したファイルは、自分の手元と Cloudflare にだけ置き、Issue・チャット・このリポジトリへの PR に書かないでください。

## 前提

- `docs/guides/manuals/deploy.md` の手順 1〜3 が済み、staging（と production）の D1 があり、マイグレーションを流してある。
- `npx wrangler login` でログインできる。コマンドはフォークした手元のリポジトリで流す（`wrangler.jsonc` の `env` を読むため）。
- 下の例の D1 の名前は `my-game-staging`（`deploy.md` の例）です。自分の名前に置き換えてください。名前の代わりに結び付けの名前 `DB` と `--env staging` でも指せます。

| 道具 | 何をするか | 残る長さ |
| --- | --- | --- |
| Time Travel（`wrangler d1 time-travel info`・`restore`） | 過去の時点に D1 を戻す。印（bookmark）か時刻で時点を指す | 30 日（Paid）／7 日（Free）と `analytics-design.md` §8 に控えた。いまの日数は**要確認**（公式: https://developers.cloudflare.com/d1/reference/time-travel/ ） |
| 書き出し（`wrangler d1 export --remote`） | D1 の中身を `.sql` のファイルに取る | 自分で消すまで。Time Travel の日数より古い時点に戻すための写し |

## 手順

### 1. 戻す印（bookmark）を控える

大きな変更（マイグレーション・新しい版の Worker のデプロイ・管理の口での一括の増減）の前に、いまの時点の印を控えます。

```bash
npx wrangler d1 time-travel info my-game-staging --env staging
```

- 出力に出る印（bookmark）を、手元のメモ（パスワードの管理の道具など）に、日時と「何の前か」と一緒に残します。
- 過去の時刻の印を知りたいときは `--timestamp` に UNIX 秒か RFC3339 の時刻を渡します（例: `--timestamp 2026-11-01T09:00:00Z`）。
- このコマンドはリモートの D1 だけに効きます（ヘルプに「This command acts on remote D1 Databases」とある。wrangler 4.152.0 で確かめた）。

### 2. Time Travel の日数より長く残す写しを取る

Time Travel で戻せるのは決まった日数の内だけです。それより古い時点を残したいときは、書き出して手元か自分の保管場所に置きます。

```bash
npx wrangler d1 export my-game-staging --env staging --remote --output ./my-game-staging-20261101.sql
```

- **`--remote` を付けます。** 付けないと手元の D1（`.wrangler/`）の中身を書き出します（ヘルプの `--local`・`--remote`）。
- `--output` は要ります。ファイル名に日付を入れると、どの時点の写しか分かります。
- 書き出したファイルには**プレイヤーのデータ**（セーブ・プレイヤー ID・スコア）が入ります。このリポジトリ（git）に入れず、見られる人を限った場所に置きます。
- 表だけ・中身だけを取る旗（`--table`・`--no-schema`・`--no-data`）もあります。
- 書き出しの間に D1 への要求が待たされるか・大きな D1 での時間は**要確認**です。人の少ない時間に流してください。
- R2 への書き出しの自動化は、このリポジトリにはありません（`analytics-design.md` §16）。

### 3. 復元する（上書きする壊す操作）

```bash
npx wrangler d1 time-travel restore my-game-staging --env staging --bookmark <手順 1 で控えた印>
```

- 印の代わりに `--timestamp <時刻>` でも指せます（ヘルプの説明は「within the last 30 days」）。
- **いまの中身は上書きされます。** 戻した時点より後に入った行は消えます。流す前に、手順 1 でいまの時点の印も控えておくと、復元そのものを取り消せます（その印へもう一度 `restore` する）。
- 流す前に確認を聞かれるか・復元の間に Worker の要求がどうなるかは**要確認**です。遊ぶ人の少ない時間に流し、復元の前後でお知らせを出してください。
- Time Travel の日数より古い時点に戻すときは、手順 2 の写しを新しい D1 に流し込みます（`npx wrangler d1 execute <新しい D1> --remote --file ./my-game-staging-20261101.sql`）。いまの D1 を置き換える手順（`wrangler.jsonc` の `database_id` の付け替え）は**要確認**です。

### 4. 復元演習（staging で）

本番で困る前に、staging で一度流して、自分の手順が戻せることを確かめます（`docs/guides/decisions/operations-security.md` の 8 の復元演習）。

1. staging で、いまの時点の印を控えます。

   ```bash
   npx wrangler d1 time-travel info my-game-staging --env staging
   ```

2. 演習の行を 1 つ足します（お知らせの表。P6 の前は書き込みの口が 403 なので、`wrangler d1 execute` で足す）。

   ```bash
   npx wrangler d1 execute my-game-staging --env staging --remote --command "INSERT INTO announcements (id, game_id, title, body) VALUES ('restore-drill', 'demo-rpg', 'restore drill', 'restore drill')"
   ```

3. 足した行が見えることを確かめます。

   ```bash
   npx wrangler d1 execute my-game-staging --env staging --remote --command "SELECT id FROM announcements WHERE id = 'restore-drill'"
   ```

4. 手順 1 で控えた印へ戻します。

   ```bash
   npx wrangler d1 time-travel restore my-game-staging --env staging --bookmark <1 で控えた印>
   ```

5. 3 と同じ `SELECT` をもう一度流し、**足した行が消えた**（行が 0）ことを見ます。staging の Worker の `GET /v1/announcements?gameId=demo-rpg` にも `restore-drill` が出ないことを見ます。
6. 演習の日時・使った印・結果を手元の運用のメモに残します。

- 手元の D1（`npm run dev` の `.wrangler/`）で同じ演習ができるかは**要確認**です。いまの `wrangler` のヘルプでは、Time Travel のコマンドはリモートの D1 だけに効くと書かれています。演習は staging で行ってください。
- production では演習しません。

## 確かめ方

| 確かめ | どうするか |
| --- | --- |
| 印を取れる | 手順 1 のコマンドが印を出す |
| 写しを取れる | 手順 2 の `.sql` のファイルができ、`CREATE TABLE` と自分の表の名前が入っている |
| 戻せる | 手順 4 の 5 で、足した行が消えている |
| 日数 | Cloudflare のダッシュボードと公式（上の表の URL）で、自分のプランの Time Travel の日数を見る（**要確認**） |

## 困ったとき

| 起きたこと | 見るところ |
| --- | --- |
| 手元の D1 の中身が書き出された・手元の D1 が見つからないと言われる | `--remote` と `--env staging` を付けたかを見る |
| 印が古すぎると言われる | Time Travel の日数を過ぎています。手順 2 の写しから戻す（手順 3 の最後） |
| 戻しすぎて必要な書き込みが消えた | 復元の前に控えた「いまの時点の印」へもう一度 `restore` する |
| 演習の行が消えない | `restore` の `--bookmark` が、行を足す前の印かを見る。staging と production を取り違えていないかを `--env` で見る |
| ログインを求められる | `npx wrangler login` を流す（ブラウザが開く） |
