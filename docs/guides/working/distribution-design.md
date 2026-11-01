# 配布／OSS 公開の設計書

`roadmap.md`（`docs/guides/decisions/roadmap.md`）Phase 4「配布／OSS 公開」の設計書。
`APP_ENV` の守りを外す道筋、利用者が自分の Cloudflare にデプロイする手順、管理画面・設定画面・サンプルゲーム、ライセンス・リポジトリの名前・サポートの範囲、Fab の規約、利用上限・コスト・バージョン移行の説明、npm の包みの公開、実装の束を決める。
これまでの設計書が「Phase 4 へ送る」とした項目（§1.3）も、ここで受ける。
**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/`・`clients/`・説明書・`LICENSE`・管理画面・サンプルゲームは次の Issue）。
**この設計書と、ここから作る束は、デプロイも公開もしない。** 守りを外すかどうかと、いつ外すかは**ユーザーが決める**。この設計書では条件と手順の案と推しまでを書く。

用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。
契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`・`openapi/rpg-online-admin.v1.json`（形）。いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

ユーザー（このリポジトリの持ち主）が、この設計書を読んで **「どの束をどの順で回せば、ゲーム作者が自分の Cloudflare にこのバックエンドをデプロイして使える形になるか」と「守りを外すために、あと何が足りず、自分が何を決めればよいか」** が分かり、守りを外すかどうかを決められる。
開発者（とその代わりに動く無人の Claude）は、§9 の試験の名前を `requireTests` に渡して P1〜P5 の実装の Issue を順に回せる。P6（守りを外す）と P7（npm の包みの公開の準備）は、ユーザーが決めた後にしか回さない。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§12 に決めること（案と推しつき）、§14 に範囲の外、§13 に実装の束がある | 機械（Issue #59 の確認コマンド） |
| 元にした文書・説明書・仕組み・扱うことの語が出てくる。前の Phase（Phase 3 の残りの人の確かめ）に触れている | 機械（同上） |
| 名前の中の数や機能の一覧で挙動が変わりうる試験と、守りを外すと置き換わる試験に、名前で触れている（§10・§11） | 機械（同上） |
| 名前に `NOT_READY_FOR_PRODUCTION` を持ついまの試験の数を書いている（§11） | 機械（同上） |
| §9 の試験の名前の表の束は `P1`・`P2`… だけ・名前に重複が無い・いまの `test/` の名前と重ならない | 機械（同上） |
| §13 に束ごとの確認コマンドの案があり、`requireTests` と `gitClean(…, { base })` を使う | 機械（同上） |
| 指している `docs/`・`scripts/`・`openapi/`・`clients/` のパスが実在する（これから作る `docs/guides/manuals/` の下と ADR 0003 は除く） | 機械（同上） |
| §3 の条件の表が `src/` と試験のいまの挙動に合う | AI の判定（作っていない判定役が、表とソース・試験を並べて見る） |
| 読みやすさ・守りを外すかどうか | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§13 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 人が見る行（§9 の H7・H8）と人がする外への操作（§13 の「人の操作」）は、機械の合否と分けて、ユーザーが観測の記録で決める（`CLAUDE.md` 原則 4）。
- P1〜P5 は `APP_ENV === 'local'` のときだけ書き込みを通す守りを外さない。どの束もデプロイしない・公開しない（`CLAUDE.md` の「守るもの」）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

### 1.1 元の文書

- ADR 0001（`docs/adr/0001-mac-first-cli.md`）・ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`）: Mac と CLI モックが先・エンジンに依存しないサーバー・作者ごとに独立の Worker と D1。
- `roadmap.md`: Phase 3 の 5 行（印はまだ付いていない）・Phase 4 の 5 行・後で。
- `docs/guides/decisions/operations-security.md`: 公開前の必須要件 1〜10・料金は公式を指す・ログと監視。
- `docs/guides/working/architecture.md` §6: local・staging・production の分け方。`wrangler.jsonc` のダミーの D1 ID を本番に流用しない。
- `account-design.md` §10・`admin-design.md` §10・§14・`analytics-design.md` §8・§13・§15・`client-integration-design.md` §6・§11・§13・`abuse-protection-design.md`。
- `docs/api-contract.md`・`openapi/rpg-online.v1.json`・`openapi/rpg-online-admin.v1.json`・`wrangler.jsonc`・`README.md`・`CLAUDE.md`（守るもの）・`package.json`・`src/core/guards.ts`。
- `docs/guides/procedures/unity-client-check.md`・`docs/guides/procedures/unreal-client-check.md`（H2〜H6 の手順）。
- 人が書いた構想 `docs/inspecs/2026/10/`（読むだけ）: 「Phase 5：外部ゲーム作者への提供」は**作者自身の Cloudflare にデプロイする形で、サーバー本体・管理 UI・CLI・SDK を配布**し、共有ホスティングは需要を見てから。「ゲーム別独立デプロイ」を基本の運用にする。構想の「Phase 5」がこのリポジトリの `roadmap.md` の Phase 4 に当たる。

### 1.2 いまの挙動（2026-11-01 の main `856c0b3` で確かめた）

| 所 | いま |
| --- | --- |
| 守り | `src/core/guards.ts` の `requireLocalWrite` が `APP_ENV !== 'local'` なら 403 `NOT_READY_FOR_PRODUCTION`。書き込みの口・トークンの要る読み取り・管理の口（読み取りも）が呼ぶ。お知らせ・ランキング・設定の読み取りは守りの外（`設定はトークンが無くても本番の設定でも読める`） |
| `wrangler.jsonc` | `vars.APP_ENV` は `disabled`。D1 の ID は `00000000-0000-0000-0000-000000000000`（ダミー）・`database_name` は `rpg-online-local`。`triggers.crons` は `30 18 * * *`。環境（`env`）・静的な資産（`assets`）・`observability` の欄は無い |
| 秘密 | `AUTH_TOKEN_SECRET`（トークンの署名。32 文字以上。無くて `local` ならローカルの公開された鍵に戻る・`src/core/token.ts` の `tokenSecret`）・`ADMIN_API_KEY`（管理の鍵。32 文字以上。`APP_ENV` を見ず既定の鍵を持たない・`src/core/admin/key.ts`）。どちらも本番は `wrangler secret put` で入れる前提（`src/core/env.ts` の頭書き）。`.dev.vars` は `.gitignore` に入っている |
| CORS | `src/core/cors.ts`。`APP_ENV=local` のときだけ、`http://127.0.0.1:5173`・`http://localhost:5173` に返す。許す見出しは `Authorization`・`Content-Type`・`Idempotency-Key`・`If-None-Match`（`X-Admin-Actor` は無い）。メソッドは GET・POST・PUT・DELETE |
| `scheduled` | `APP_ENV !== 'local'` なら何も消さない（`scheduledは本番の設定では何も消さない`） |
| 管理の人 | `X-Admin-Actor` は自己申告のラベル（`src/core/admin/audit.ts`）。管理の鍵は Worker ごとに 1 つ |
| クライアントの版 | Unity の `clients/unity/package.json` が `0.1.0`、Unreal の `.uplugin` の `VersionName` が `0.1.0`。ブラウザの SDK（`clients/browser/rpg-online-client.mjs`）は版の欄を持たない。スキーマの `info.version` は `1.0.0` |
| 依存の包み | `package.json` は `private: true`・`dependencies` が無く `devDependencies` だけ（`@cloudflare/vitest-plugin`・`typescript`・`vitest`・`wrangler`）。Worker の成果物に第三者の包みは入らない。`package-lock.json` の `license` の欄には MIT のほか Apache-2.0・MPL-2.0・LGPL-3.0-or-later（`sharp` の `libvips`。`wrangler` の下）などがある |
| 説明書 | `docs/guides/manuals/` はまだ無い。`LICENSE` は無い。`README.md` にライセンスの節は無い |
| `wrangler` | 4.152.0。手元の `node_modules/wrangler/config-schema.json` に `env`・`assets`・`observability`・`Access`（`dev.aud` と `ctx.access.getIdentity()` の模造の説明）の定義がある。`deploy` の旗に「Compile a project and run checks without actually uploading the Worker」と書かれた `--dry-run` がある（ヘルプの本文は `cli.js` で読んだ。2026-11-01 の無人の回では `wrangler deploy --help` を含むコマンドも設定で断られた） |

### 1.3 これまでの設計書が「Phase 4 へ送る」とした項目

| 送った所 | 項目 | この設計書のどこで受けるか |
| --- | --- | --- |
| `admin-design.md` §10 | 管理の鍵の取り替えの手順・監査のログの保持と掃除・`X-Admin-Actor` の自己申告か Cloudflare Access か | §3.2・§5.3・§12 の 3 |
| `admin-design.md` §14 | 管理画面（ブラウザ）・管理の鍵をブラウザのセッションに置かない | §5・§12 の 4 |
| `analytics-design.md` §8 | `docs/guides/manuals/` の `backup-restore.md`・`cost-alerts.md` | §8・P3 |
| `analytics-design.md` §13・§15 | `scheduled` の門（守りを外すとき一緒に決める）・利用上限とコストの見積もりの材料・管理画面での集計の表示 | §3.4・§8.2・§5 |
| `client-integration-design.md` §11・§13 | npm の包みの公開と SDK の版・本番の CORS のオリジン・サンプルゲーム・端末をまたぐ引き継ぎ | §9 の P7・§4.5・§6・§14 |
| `client-integration-design.md` §6 | Unity・Unreal の包みの形（要確認） | §7（Fab）・§8.3（版） |
| `account-design.md` §10 | `APP_ENV` の守りを外す条件 1〜5 | §3 |

## 2. 全体の形（何を配るか）

構想と ADR 0002 のとおり、**作者ごとに独立の Worker と D1**（ゲーム別独立デプロイ）を配布の基本にする。共有ホスティング（1 つの Worker に多くの作者）は範囲の外（§14）。

| 配るもの | 置き場 | 利用者がすること |
| --- | --- | --- |
| サーバー本体（Worker と D1 のマイグレーション） | このリポジトリ（`src/`・`migrations/`） | フォークか写しを取り、自分の Cloudflare にデプロイ（§4） |
| 管理コマンド | `scripts/admin-cli.mjs` | 自分の Worker に管理の鍵で当てる |
| 管理画面・設定画面 | `clients/browser/admin/`（P4 で作る） | ローカルで開く（§5） |
| SDK | `clients/browser/`・`clients/unity/`・`clients/unreal/` | ゲームに組み込む（ソースの写し。§9 の P7 で npm を決める） |
| サンプルゲーム | `clients/browser/sample-game/`（P5 で作る） | ローカルで開いて動きを見る（§6） |
| 説明書 | `docs/guides/manuals/`（P2・P3 で作る） | 読んで操作する |

## 3. `APP_ENV` の守りを外す道筋（いちばん大事）

**外すかどうか・いつ外すかはユーザーが決める。** この節は、条件の表・いま満たしているか・足りないものを埋める束・外すときの手順の案と推しまで。外す束（P6）は、ユーザーが決めた後にしか回さず、その束の Issue はユーザーが決めるまで作らない。

### 3.1 `account-design.md` §10 の条件 1〜5

| 条件 | いま | 足りないもの | 埋める束 |
| --- | --- | --- | --- |
| 1. トークンの無い・期限切れ・署名の誤り・なりすましの書き込みが断られる | 満たしている（`test/auth.test.ts` の `トークンが無い書き込みは401を返す`・`期限切れのトークンは401を返す`・`署名の正しくないトークンは401を返す`・`他のプレイヤーになりすました書き込みを弾く`） | — | — |
| 2. 連投の制限・送信 ID・ゲストの発行の利用制限 | 満たしている（`abuse-protection-design.md` の R1・R2。D1 の固定窓） | — | — |
| 3. スコアの自己申告をどこまで信じるかを決め、ゲストが本人確認でないことを公開の説明に書く | 決めてある（値の範囲と回数まで）。公開の説明は無い | `README.md` に「ゲストは本人確認でない・スコアは改ざんできる」を書く | P1 |
| 4. 秘密を `wrangler secret put` で渡す手順・鍵が無い環境で 500・環境ごとに D1 と鍵を分ける | 鍵が無いと通らないのは試験がある（`鍵はAUTH_TOKEN_SECRETを使いローカルでだけ既定の鍵に戻る`・`管理の鍵の無い環境では管理の口がINTERNAL_ERRORの500を返す`）。手順と環境の分け方は無い | デプロイの説明書（§4） | P2 |
| 5. 守りを外した後の試験の置き換えを設計してある | この設計書の §11 で設計した | 置き換えそのもの | P6 |

### 3.2 `admin-design.md` §10 の追加の条件

| 条件 | いま | 足りないもの | 埋める束 |
| --- | --- | --- | --- |
| 管理の鍵を `wrangler secret put` で入れる手順と取り替えの手順 | 無い | デプロイの説明書の「秘密」の節 | P2 |
| 監査のログの保持（365 日）と消す仕組み | 仕組みはある（`analytics-design.md` §6）。`local` でしか消さない | `scheduled` の門を、守りを外すと同時に開ける（§3.4） | P6 |
| `X-Admin-Actor` の自己申告を受け入れるか、Cloudflare Access で人を確かめるか | 自己申告 | §12 の 3 で決める（推し: 本番は Cloudflare Access の後ろに置き、ローカルは自己申告のまま） | P6（**要確認**を解いてから） |

### 3.3 `operations-security.md` の公開前の必須要件 1〜10

| 要件 | いま | 足りないもの | 埋める束 |
| --- | --- | --- | --- |
| 1. 本人確認 | ゲストだけ。Steam などは無い（`client-integration-design.md` §8 で境目だけ） | ゲストは本人確認でないと公開の説明に書く。外部の認証は範囲の外 | P1（説明） |
| 2. 認可 | 満たしている（トークンのプレイヤーとゲームを確かめる。`playerId` の申告で他人を読めない） | — | — |
| 3. 不正対策 | 一部（値の範囲と回数・管理でスコアを消す・BAN） | 「競争の強い機能には使わない」を公開の説明に書く | P1（説明） |
| 4. レート制限 | 満たしている（IP・プレイヤー・ゲーム・口ごと。掲示板は無い） | — | — |
| 5. 操作の原子性 | 満たしている（受け取りの一意の鍵・`Idempotency-Key`・`batch`） | — | — |
| 6. プライバシー | 一部（保持の日数は決めた。掃除は `local` でしか動かない） | `scheduled` の門・説明書に保持の日数 | P3・P6 |
| 7. 秘密情報 | 一部（`.dev.vars` は git に入らない。本番の手順が無い） | `wrangler secret put` の手順 | P2 |
| 8. データ保持 | 一部（D1 の Time Travel がいつも有効。手順が無い） | `backup-restore.md`（復元演習を含む） | P3 |
| 9. 配布責任 | 無い | `cost-alerts.md` と利用上限・コストの説明 | P3 |
| 10. 環境分離 | 無い（`wrangler.jsonc` は local だけ） | staging・production の分け方（§4.1） | P2 |

### 3.4 守りを外す手順の案（P6 の中身）

推しの守りの新しい決まり（§12 の 1）: **`APP_ENV` が `local`・`staging`・`production` のどれかなら通し、それ以外（既定の `disabled` を含む）は今のまま 403 `NOT_READY_FOR_PRODUCTION`。** `staging`・`production` は `AUTH_TOKEN_SECRET`・`ADMIN_API_KEY` が無ければ今のまま 500（ローカルの鍵に戻らない）。

- `wrangler.jsonc` の既定 `APP_ENV=disabled` は残す。デプロイの説明書の環境の設定（§4.1）でだけ `staging`・`production` を渡す。既定のまま `wrangler deploy` した Worker は今と同じく書き込みを断る（うっかりの公開を止める網が残る）。
- `scheduled` の掃除は `local`・`staging`・`production` で動かし、`disabled` では今のまま消さない。
- 本番の CORS のオリジンは §4.5。
- 管理の人の確かめは §5.3（Cloudflare Access。**要確認**を解いてから）。

`CLAUDE.md` の「守るもの」の 2 行の置き換え（P6 の中で、ユーザーが守りを外すと決めた後。同じコミットで旧文を置き換える。`CLAUDE.md` 原則 5）:

| いまの行 | 置き換えの案 |
| --- | --- |
| **デプロイ・公開をしない**（…）。本番の設定の値（ID・鍵）をファイルに書かない。**無認証の API をデプロイしない**（`wrangler.jsonc` の D1 ID はダミー） | **このリポジトリのスクリプトと無人の回はデプロイ・公開をしない**（デプロイは利用者が説明書の手順で自分の Cloudflare にする）。本番の設定の値（ID・鍵・通知の宛先）をファイルに書かない（`wrangler.jsonc` の D1 ID はダミーのまま） |
| **書き込みの API は `APP_ENV === 'local'` のときだけ通し、ほかは `403 NOT_READY_FOR_PRODUCTION`。** `wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない | **書き込みの API は `APP_ENV` が `local`・`staging`・`production` のときだけ通し、ほかは `403 NOT_READY_FOR_PRODUCTION`。** `staging`・`production` はトークンと管理の鍵を確かめたときだけ通す。`wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない |

同じ P6 で置き換える文書: `operations-security.md` の冒頭の「現状」と必須要件の満たした印・`docs/api-contract.md` の冒頭の「書込み系APIは公開用に使用しない」と `NOT_READY_FOR_PRODUCTION` の説明と「CORS」の節・`README.md` の「いまは書き込みが 403」の注意・`openapi/rpg-online.v1.json` の `info.description` の「ローカル専用の PoC」・`account-design.md` §10 と `admin-design.md` §10 の「この設計では外さない」を、この節を指す文に。

## 4. 利用者が自分の Cloudflare にデプロイする手順（P2）

手順書は `docs/guides/manuals/deploy.md`（使う人に渡す説明書の置き場は `docs/guides/manuals/`。`CLAUDE.md` の置き場の表）。**冒頭に「いまは書き込みの口が全部 403 `NOT_READY_FOR_PRODUCTION`。読み取り（お知らせ・ランキング・設定）だけが動く。守りを外すのは P6 の後」と書く**（§12 の 2 の推し）。

### 4.1 環境の分け方（local・staging・production）

- **推し（§12 の 5）: このリポジトリの `wrangler.jsonc` は local のまま変えない。** 説明書に、利用者が自分のフォークの `wrangler.jsonc` に足す `env.staging`・`env.production` の手本（JSONC）を載せる。手本の値は:
  - `name`: 環境ごとに別の Worker の名前（例: `<作者のゲーム>-staging`）
  - `vars.APP_ENV`: P6 の前は `disabled`、P6 の後は `staging`・`production`
  - `d1_databases`: 環境ごとに別の `database_name`、`database_id` は `00000000-0000-0000-0000-000000000000`（利用者が `wrangler d1 create` の出力で置き換える）、`migrations_dir` は `migrations`
  - `triggers.crons`: 上の階と同じ値（`env` の中は上の階の `triggers` を引き継がないかは**要確認**。引き継がないなら手本に書く）
- 本番の ID は利用者のフォークにだけ入る。このリポジトリには入れない（`CLAUDE.md` の「本番の設定の値をファイルに書かない」）。D1 の ID は秘密ではないが、ダミーとの取り違えを防ぐため、手本はダミーのまま。
- 機械の確かめ（P2）: 試験が説明書の手本の JSONC を読み、2 つの環境の `database_name` が別・`database_id` がダミー・`APP_ENV` が `local` でない・`migrations_dir` が `migrations`・`crons` が `wrangler.jsonc` と同じ、を見る。

### 4.2 秘密

- `wrangler secret put AUTH_TOKEN_SECRET --env staging`・`wrangler secret put ADMIN_API_KEY --env staging`（production も同じ）。値は 32 文字以上の乱数（作り方の例: `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"`）。
- 環境ごとに別の値。鍵をファイル・チャット・Issue に書かない。
- 取り替え: `AUTH_TOKEN_SECRET` を入れ直すと、前の鍵のトークンは 401 になり全員がゲストを発行し直す（`AUTH_TOKEN_SECRETを変えると前の鍵のトークンは401になる`）。`ADMIN_API_KEY` を入れ直すと、管理コマンドの鍵を同時に変える。
- 機械の確かめ（P2）: 説明書が 2 つの秘密の名前を `src/core/env.ts` の `Env` の型と同じ集合で挙げることを試験が見る。

### 4.3 リモートの D1 のマイグレーション

- `wrangler d1 create <名前>` → 出力の ID を自分の `wrangler.jsonc` に → `wrangler d1 migrations apply DB --env staging --remote`。
- staging で `npm run cli:smoke` に当たる通しを先に流してから production（P6 の後。P6 の前は読み取りだけ）。
- 既存のマイグレーションを書き換えない。足すだけ（§8.3）。

### 4.4 デプロイの手順の正しさを、デプロイせずにどこまで機械で確かめるか

| 確かめ | 無人の回 | 理由 |
| --- | --- | --- |
| 説明書の手本の JSONC の中身（§4.1）・秘密の名前（§4.2）・コマンドの名前が `package.json` の `scripts` と食い違わない | できる（P2 の試験が文字列で読む） | ファイルを読むだけ |
| `wrangler deploy --dry-run`（アップロードせずに組み立てと確かめだけ。手元の `wrangler` 4.152.0 のヘルプの文で確かめた） | **しない** | 名前が `deploy` のコマンドは無人の回の設定で断られる（2026-11-01 にヘルプの表示でも断られた）。`CLAUDE.md` の「デプロイしない」の字面にも当たる。ログインが要るか・`--env` の手本の確かめになるかは**要確認** |
| `wrangler deploy --dry-run --env staging` を人が会話の側で流す | 人（H8 の一部） | アップロードしないので「デプロイしない」の趣旨には当たらないと読めるが、当たるかは**ユーザーが決める**（§12 の 6） |
| 実際のデプロイ・`--remote` のマイグレーション・秘密の投入 | しない | 人がする外への操作（§13） |

### 4.5 本番の CORS のオリジン

- **推し（§12 の 7）: `CORS_ORIGINS` という `vars` を足し（カンマで区切ったオリジンの一覧）、`staging`・`production` ではその一覧だけに CORS を返す。`local` は今の 2 つのまま。空なら何も返さない。ワイルドカードは使わない。** 値は利用者が自分の `wrangler.jsonc` の環境ごとに書く（自分のゲームのページのオリジン）。
- 守りを外す前は意味が無い（書き込みが 403）ので P6 で作る。

## 5. 管理画面・設定画面（P4）

### 5.1 置き場と作り方

- **推し（§12 の 4）: ビルドの要らないページ `clients/browser/admin/`（`index.html` と、管理の口を呼ぶ小さな `.mjs`）。ローカルで開くだけ。** ブラウザのサンプルと同じく `clients/browser/` で `python3 -m http.server 5173 --bind 127.0.0.1` を起動して `http://127.0.0.1:5173/admin/` を開く（CORS のオリジンは今の 2 つのまま）。Worker は配らない（`wrangler.jsonc` の `assets` を足さない）。
- 送り方はブラウザの SDK（`clients/browser/rpg-online-client.mjs`）の再試行と同じ決まり（スキーマの `x-client-policy`）を使う。管理の口の一覧は `openapi/rpg-online-admin.v1.json` の 15 個の操作で、P4 の試験がページの操作の一覧とスキーマの `operationId` の集合を比べる。
- 管理画面の中身: プレイヤーを読む・BAN と解除・所持品の増減・スコアを消す・監査のログ・集計（DAU と継続・配布の量）。集計の小さい数を伏せる（k 匿名）かは、ローカルだけなので P4 では伏せない（`analytics-design.md` §16）。
- **設定画面:** 管理画面の中の「定義」のタブ。品目・イベント・プレイヤーデータの鍵・実績・クエストの定義の `PUT`（いまの管理の口）と、ゲームの設定（`GET /v1/games/{gameId}/config`）の読むだけの表示。機能フラグ・マスターデータ・ゲームの版を書き換える管理の口は今は無く、P4 でも足さない（§14）。
- CORS: 管理の口がブラウザから呼べるよう、`src/core/cors.ts` の許す見出しに `X-Admin-Actor` を足す（`local` のときだけ。メソッドは今の 4 つで足りる）。

### 5.2 管理の鍵をブラウザに置かない形

- **ローカル（P4）:** 管理の鍵は人が画面の入力欄に貼り、ページの変数（メモリ）にだけ持つ。`localStorage`・`sessionStorage`・クッキー・URL に書かない。ページを閉じると消える。ローカルの鍵は `.dev.vars` の値で、本番の鍵ではない。P4 の試験がページのソースにそれらの保存の口の名前が無いことを見る。
- **本番（P6 の後）:** 管理画面をブラウザから本番に当てる形は P4 で作らない。本番の管理は管理コマンド（`scripts/admin-cli.mjs`）で、鍵は人の端末の環境変数。ブラウザで本番を管理する形は §5.3 で決める。

### 5.3 管理の人の確かめ（Cloudflare Access）

- **推し（§12 の 3）: 本番でブラウザの管理画面を使うなら、Worker の静的な資産で `/admin/` に出し、Cloudflare Access の後ろに置く。Worker は Access の確かめ（JWT の `aud` と発行元）を通った人の ID を監査の `actor` にし、ブラウザは管理の鍵を持たない。** 管理コマンドは今のまま管理の鍵で、`X-Admin-Actor` は自己申告のラベルとして受け入れる（Worker ごとに管理の人が少数の前提）。
- **要確認:** Workers の静的な資産で一部の道だけを Access の後ろに置く形・Worker の中で Access の JWT を確かめる形（手元の `wrangler` の設定の定義に `Access` の欄と `ctx.access.getIdentity()` の模造の説明がある。公式で確かめていない）・Access の無料の範囲（料金の額は書かない）。
- この形は P6 の後に回す（守りを外す前は本番の管理の口が 403）。**要確認**が解けなければ、本番はブラウザの管理画面を使わず管理コマンドだけ、を選ぶ（範囲が小さく戻せる）。

## 6. サンプルゲーム（P5）

- **推し（§12 の 8）: ビルドの要らない 1 枚のページの小さなゲーム `clients/browser/sample-game/`。** ブラウザの SDK を読み込み、ゲストの発行・セーブ・スコアの投稿とランキング・イベントの受け取り・クエストの進捗を、遊びの流れの中で使う。ゲームのルール（スコアの決め方）はページの側に持ち、サーバーは見ない（ADR 0002）。
- H1 のサンプル（`clients/browser/sample/index.html`）との関係: サンプルは「シナリオを押して結果の表を見る」確かめの道具のまま残す。サンプルゲームは「作者がまねる組み込みの手本」。シナリオの関数は SDK のものを使い、ページに写さない。
- トークンはサンプルゲームの中で `localStorage` に持つ（遊び直しで同じプレイヤーに戻るため。手本としてそう書き、管理の鍵の決まり §5.2 とは別だと説明する）。
- 開き方はサンプルと同じ（`python3 -m http.server`。`http://127.0.0.1:5173/sample-game/`）。動きを見るのは人（H7）。

## 7. ライセンス・リポジトリの名前・サポートの範囲・Fab

### 7.1 ライセンス

- **推し（§12 の 9）: MIT**（`roadmap.md`）。`LICENSE` をリポジトリ直下に置き、`README.md` に「ライセンス」の節。
- 依存の包みとの矛盾の確かめ: Worker の成果物と `clients/` に第三者の包みのコードを入れない（`package.json` に `dependencies` が無く、`devDependencies` は配るものに入らない）。`package-lock.json` には LGPL-3.0-or-later・MPL-2.0 の包みがある（開発の道具の下）が、配らないので MIT と矛盾しない。P1 の試験が「`package.json` に `dependencies` が無い」ことと「`clients/` の下に `node_modules` が無い」ことを見張る。Unity の包みの依存（`com.unity.modules.*`）はエンジンの組み込みで再配布しない。
- 決めた結果は ADR 0003（`docs/adr/` の次の番号。配布の形・ライセンス・サポートの範囲）に残す（§12 の 10）。

### 7.2 リポジトリの名前

- 今の名前 `rpg-online-cloudflare` は、ADR 0002 の目的（エンジンに依存しないゲームバックエンド）より狭い。案を ADR 0003 に挙げ、**名前を変えるのは外への操作なので、ユーザーがする**（GitHub の設定）。名前を変えた後のこのリポジトリの中の文字列（`package.json` の `name`・`wrangler.jsonc` の `name`・スキーマの `title`・Unity の包みの名前）を直すのは、別の束（そのとき Issue を作る）。

### 7.3 サポートの範囲

- **推し: 「無保証（MIT のとおり）・Issue で受けるのは再現できる不具合だけ・利用者の Cloudflare の設定・料金・データの復元はサポートしない・応答の期限を約束しない」**を `README.md` の「サポートの範囲」の節に書く（P1）。対応する版は最新の 1 つだけ。

### 7.4 Fab の規約（確かめるのは人）

Fab の規約は**要確認**（この設計書では読んでいない）。人が確かめる項目の一覧:

| 項目 | 何を確かめるか |
| --- | --- |
| OSS のコードを含む製品 | MIT で公開しているコードを Fab で売ってよいか・ライセンスの表記の決まり |
| 外のサービスに依存する製品 | 利用者の Cloudflare のアカウントと料金が要ることを、どこにどう書くか |
| 製品の形 | コードのプラグインの出し方・対応する UE の版・プラットフォームの欄 |
| サポートと返金 | 出品者に求められるサポートの約束（§7.3 と食い違わないか） |
| 生成 AI で作ったコード | 申告の要否 |

境目: RPG 制作ツールのアドオンとして Fab に出すなら、**出すのは Unreal の層（`clients/unreal/` のプラグインとイベントコマンドの橋渡し）だけ**で、サーバーは MIT の OSS としてこのリポジトリから利用者が取ってデプロイする（§4）。サーバーを Fab の製品に含めない。Unity の Asset Store は範囲の外（§14）。

## 8. 利用上限・コスト・バージョン移行の説明（P3）

説明書は `docs/guides/manuals/` に置く: `backup-restore.md`・`cost-alerts.md`・`limits-and-costs.md`・`versioning.md`。

### 8.1 バックアップと費用アラート

`analytics-design.md` §8 の表のとおり（コードにしない）。`backup-restore.md` に `wrangler d1 time-travel info`・`wrangler d1 export --remote`・`wrangler d1 time-travel restore`（上書きする壊す操作）と復元演習、`cost-alerts.md` に予算のアラートと使用量の通知の作り方と、通知の宛先をファイルに書かないこと。細部（通知の種類・ローカルの D1 での演習）は**要確認**のまま書き、利用者の画面で確かめるよう案内する。

### 8.2 利用上限とコスト

- 料金の数字は書かず、公式（`operations-security.md` の 4 つの URL）を指す。
- 見積もりの材料（`analytics-design.md` §6・§15）: 保持の日数（監査 365 日・プレイヤーデータの書き込み 30 日・区切りの値 35 日・利用制限の数 1 日・遊んだ日 400 日）、消さない 3 つの表（`quest_claims`・`event_claims`・`inventory_ledger`）は受け取りと増減の数だけ増える、`player_activity_days` の行の数は DAU × 400 日。P3 の試験が、説明書の日数を `src/core/cleanup.ts` の `RETENTION_DAYS` と `AUDIT_RETENTION_DAYS` から読んだ値と比べる。
- 利用上限: D1 の 1 データベースの容量と逐次の処理（構想の文書に 2026-10 時点の数がある。数は**要確認**で、説明書には公式を指す）・利用制限の回数（`src/core/rate-limit-policy.ts` の表を指す。写さない）・`scheduled` の 1 回の文の数の上限。

### 8.3 バージョン移行

| もの | 決まり（推し。§12 の 11） |
| --- | --- |
| API の版 | 足すだけの変更（欄・操作・エラーコード）は `/v1` のまま。欄を消す・意味を変える変更は `/v2` の道を足し、`/v1` を決めた期間残す。`/v2` を作るのは要る変更が出たとき |
| スキーマの版 | `info.version` を semver で。足すだけなら小の位、`/v2` なら新しいファイル（`rpg-online.v2.json`） |
| マイグレーション | 既存のファイルを書き換えず、新しい番号で足す（`CLAUDE.md`）。足す前に、旧クライアントの要求が通ることを互換の試験（`旧CLIはスキーマ変更後のAPIでもランキングを送って読める`・`今のCLIモックと同じ形の要求を受け付ける` の形）で見る。利用者は新しい版を取ったら `wrangler d1 migrations apply DB --remote` を先に、Worker を後に |
| クライアントの層の版 | Unity の `package.json` の `version` と Unreal の `.uplugin` の `VersionName` とブラウザの SDK を同じ版（今は `0.1.0`）で揃える。ブラウザの SDK の版の欄は P7 で足す。P3 の試験が Unity と Unreal の版が同じで、`versioning.md` の表の版と同じことを見る |

## 9. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は新しい `test/distribution.test.ts`（P1〜P3 の文書とファイルの試験。L1）・`test/admin-page.test.ts`（P4）・`test/sample-game.test.ts`（P5）・P6 は今のファイルの置き換え（§11）。文書の中身を見る試験は、`test/raw-imports.d.ts` の形でファイルを文字列として読む。

| 束 | 試験の名前 | レベル | 見ること |
| --- | --- | --- | --- |
| P1 | `LICENSEはMITの全文と著作者の行を持つ` | L1 | `LICENSE` |
| P1 | `READMEはライセンスとサポートの範囲とゲストが本人確認でないことを書く` | L1 | `README.md` の節 |
| P1 | `配る成果物に第三者の包みが入らずpackage.jsonにdependenciesが無い` | L1 | `package.json`・`clients/` |
| P1 | `ADR 0003は配布の形とライセンスとサポートの範囲を決める` | L1 | ADR 0003 の見出し |
| P2 | `デプロイの説明書の環境の手本はstagingとproductionで別のD1を持ちAPP_ENVがlocalでない` | L1 | §4.1 |
| P2 | `デプロイの説明書の環境の手本はcronがwranglerの設定と同じでD1のIDがダミー` | L1 | §4.1 |
| P2 | `デプロイの説明書は秘密の名前をEnvの型と同じ集合で挙げる` | L1 | §4.2 |
| P2 | `デプロイの説明書は冒頭でいまは書き込みが403だと書く` | L1 | §4 の冒頭 |
| P2 | `デプロイの説明書が使うnpmのコマンドはpackage.jsonのscriptsにある` | L1 | §4.4 |
| P3 | `利用上限の説明書の保持の日数は掃除の定数と一致する` | L1 | §8.2 |
| P3 | `運用の説明書は料金の額を書かず公式の価格表を指す` | L1 | §8.2（`$` や円の数を持たない） |
| P3 | `バックアップの説明書は復元が上書きする操作だと書き復元演習の手順を持つ` | L1 | §8.1 |
| P3 | `費用アラートの説明書は通知の宛先をファイルに書かないと書く` | L1 | §8.1 |
| P3 | `UnityとUnrealのクライアント層の版は同じで版の説明書の表と一致する` | L1 | §8.3 |
| P4 | `管理画面はスキーマの全部の管理の操作を呼べる` | L1 | §5.1 |
| P4 | `管理画面は管理の鍵をlocalStorageとsessionStorageとクッキーとURLに置かない` | L1 | §5.2 |
| P4 | `管理画面は送り方にブラウザのSDKの再試行の決まりを使う` | L1 | §5.1 |
| P4 | `ローカルでは管理の口の事前確認にX-Admin-Actorを許す` | L2 | §5.1 の CORS |
| P4 | `ローカルでない環境では管理の口の事前確認にもCORSの見出しを返さない` | L2 | 同上 |
| P5 | `サンプルゲームはSDKを読み込みゲストの発行とセーブとスコアの投稿を呼ぶ` | L1 | §6 |
| P5 | `サンプルゲームはシナリオの関数をページに写さない` | L1 | §6 |
| P6 | `本番の設定では鍵があればゲストを発行できる` | L2 | §3.4 |
| P6 | `本番の設定でもトークンの無い書き込みはUNAUTHENTICATEDの401を返す` | L2 | §3.4 |
| P6 | `本番の設定でAUTH_TOKEN_SECRETが無ければ書き込みはINTERNAL_ERRORの500を返す` | L2 | §3.4 |
| P6 | `本番の設定では管理の鍵で管理の口を使え監査に残る` | L2 | §3.4 |
| P6 | `本番の設定ではCORS_ORIGINSのオリジンにだけCORSの見出しを返す` | L2 | §4.5 |
| P6 | `scheduledは本番の設定で保持の日数を過ぎた行を消す` | L2 | §3.4 |
| P6 | `scheduledは既定の設定では何も消さない` | L2 | §3.4 |
| P6 | `既定の設定ではAPP_ENVがlocalとstagingとproductionのどれでもない書き込みを403で断る` | L2 | §3.4 |
| P7 | `ブラウザのSDKの版はUnityとUnrealのクライアント層の版と同じ` | L1 | §8.3 |

P6 の置き換え（§11）で名前を変える 13 本は、上の表に入れず §11 の表に持つ。

人が見るもの（L3。機械の合否と分ける。`requireTests` に入れない）:

| 印 | 見ること | 束 |
| --- | --- | --- |
| H7 | サンプルゲームを開いて遊び、セーブ・ランキング・イベントの受け取りが画面に出る。Worker を止めても固まらない | P5 |
| H8 | 管理画面を開いて BAN・増減・定義の `PUT` が通り、監査のログに残る。鍵を入れ直さないと再読み込みの後は使えない | P4 |

## 10. 挙動が変わりうる既存の試験と、直す手続き

名前の中の数や機能の一覧で挙動が変わりうる既存の試験。変えるときは `docs/guides/decisions/test-plan.md` §11 のとおり、設計（この節）を先に直してから試験を直す。黙って弱めない。

| 既存の試験 | 変わる束 | 変わり方 |
| --- | --- | --- |
| `スキーマのファイルはOpenAPI 3.1で20個の操作を持つ` | — | どの束もゲームのクライアントの操作を足さない（管理画面はいまの管理の口だけを呼ぶ）。変わらない。`/v2` を作るときは新しいファイルで、この試験は `/v1` のファイルを見続ける |
| `スキーマのErrorCodeの列挙は19個のエラーコードと一致する` | — | どの束もエラーコードを足さない（P6 も今の `NOT_READY_FOR_PRODUCTION`・`UNAUTHENTICATED`・`INTERNAL_ERROR` を使う）。変わらない |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない` | — | 管理画面とサンプルゲームは Worker のルートを足さない（静的な資産を Worker で配る形は §5.3 の後で、そのときはモジュールにせずルーターの前で答える）。変わらない |
| `ローカルではブラウザの事前確認にCORSの見出しを返す` | P4 | 許す見出しに `X-Admin-Actor` が増える。期待の一覧に 1 つ足す。名前は変えない |
| `ローカルでない環境と決めていないオリジンにはCORSの見出しを返さない` | P6 | `staging`・`production` で `CORS_ORIGINS` のオリジンには返すようになる。期待の環境を `disabled` に絞り、本番の側は P6 の新しい試験が見る。名前は変えない |
| `wranglerの設定のcronは掃除の定数と同じでAPP_ENVの既定は変わらない` | — | `wrangler.jsonc` を変えないので変わらない（P6 でも既定は `disabled`） |
| `鍵はAUTH_TOKEN_SECRETを使いローカルでだけ既定の鍵に戻る` | — | 変わらない（`staging`・`production` でもローカルの鍵に戻らない） |

## 11. 守りを外すと置き換わる試験

名前に `NOT_READY_FOR_PRODUCTION` を持ついまの試験は **13 本**（2026-11-01 の `test/` で数えた）。どれも `APP_ENV` を `disabled`（一部は `production` も）にして 403 を見る。P6 の新しい決まり（§3.4）では `disabled` は今のまま断るので、**中身は `disabled` の分を残し、名前の「本番の設定では」を「既定の設定では」に置き換える**。`production` を渡している分は、P6 の新しい試験（§9）の側へ移す。弱めない（`test-plan.md` §11）。

| いまの試験 | P6 での置き換え |
| --- | --- |
| `本番の設定では利用制限より先にNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定では利用制限より先にNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではゲストの発行もNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではゲストの発行もNOT_READY_FOR_PRODUCTIONの403を返す`（`production` の分は `本番の設定では鍵があればゲストを発行できる` へ） |
| `本番の設定ではセーブの読み書きもNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではセーブの読み書きもNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではセーブの一覧と削除もNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではセーブの一覧と削除もNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定では所持品の読み取りにNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定では所持品の読み取りにNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではイベントの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではイベントの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではプレイヤーデータの読み書きにNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではプレイヤーデータの読み書きにNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではプレイヤーデータの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではプレイヤーデータの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではクエストの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではクエストの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定ではクエストの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定ではクエストの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` |
| `本番の設定では登録の無いゲームへの投稿もNOT_READY_FOR_PRODUCTIONの403を返す` | `既定の設定では登録の無いゲームへの投稿もNOT_READY_FOR_PRODUCTIONの403を返す` |
| `管理の集計は管理の鍵が無いと401で本番の設定ではNOT_READY_FOR_PRODUCTIONの403を返す` | `管理の集計は管理の鍵が無いと401で既定の設定ではNOT_READY_FOR_PRODUCTIONの403を返す` |

名前に `NOT_READY_FOR_PRODUCTION` を持たないが、守りを外すと置き換わる試験:

| いまの試験 | P6 での置き換え |
| --- | --- |
| `認証が入っても本番でない環境の無認証の書き込みは403のまま` | 中身（`disabled` で 403）を残し `既定の設定ではAPP_ENVがlocalとstagingとproductionのどれでもない書き込みを403で断る` に。無認証の書き込みが本番で 401 になることは `本番の設定でもトークンの無い書き込みはUNAUTHENTICATEDの401を返す` が見る |
| `scheduledは本番の設定では何も消さない` | `scheduledは既定の設定では何も消さない` と `scheduledは本番の設定で保持の日数を過ぎた行を消す` に分ける |
| `トークンの更新はAPP_ENVがlocalでなければ403を返す` | 名前と中身を `disabled` に絞る形に直す（P6 の Issue で名前を決める） |

守りの外で読めるもの（変わらない）: `設定はトークンが無くても本番の設定でも読める` は守りの外の読み取りを見る試験で、P6 の後もそのまま通る（`staging`・`production` でも読める）。

## 12. 決めること

ADR 0001・ADR 0002 と、これまでの 13 の設計書の決定は前提で、ここに戻さない。推しの案で §2〜§11 を書いた。違う案にするときは、該当する節と §9 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 守りを外す順と、外した後の守りの形 | A: **条件を満たす束（P1〜P5）を先に回し、最後に守りを外す束（P6）をユーザーの判断で回す。外した後も `disabled`（既定）は 403 のまま、`local`・`staging`・`production` だけ通す**。B: 守りを外さずに配布の手順だけ書いて止める。C: `APP_ENV` を見るのをやめ、トークンと鍵だけで守る | **A**。既定のまま配った Worker が書き込みを断る網が残り、うっかりのデプロイで無防備にならない。B は Phase 4 の「デプロイできる手順」に届かない（書き込みが全部 403 の Worker しか作れない）。C は既定の設定でも書き込みが通り、ダミーの D1 ID のまま配る誤りを止められない |
| 2 | 守りを外す前に書くデプロイの説明書の冒頭 | A: **「いまは書き込みが 403」と冒頭に書く**。B: 守りを外すまで説明書を書かない | **A**。手順（環境・秘密・マイグレーション）は守りと無関係に正しく、先に書いて機械で確かめられる。冒頭の 1 文は P6 で置き換える |
| 3 | 管理の人の確かめ | A: 管理の鍵だけ（`X-Admin-Actor` の自己申告を受け入れる）。B: **ローカルと管理コマンドは鍵と自己申告のまま。本番でブラウザの管理画面を使うなら Cloudflare Access の後ろに置き、Access の ID を監査の actor にする（要確認を解いてから）**。C: 人ごとの管理の鍵（`admin_keys`） | **B**。ブラウザに管理の鍵を置かずに済み、監査の「誰が」が確かになる。Worker ごとに管理の人が少数なので、管理コマンドの自己申告は受け入れる。**要確認**が解けなければ A（本番はブラウザを使わない）に戻す。C は鍵の発行と取り消しの口がもう 1 つ要る |
| 4 | 管理画面と設定画面の置き場と配り方 | A: **ビルドの要らないページ（`clients/browser/admin/`）をローカルで開くだけ。設定画面は管理画面の「定義」のタブ**。B: Worker の静的な資産で配る（**要確認**）。C: 別のページの置き場（Pages など） | **A**。`wrangler.jsonc` を変えず、CORS のオリジンも今のまま。B は §5.3 の Access と組で P6 の後に足せる。C は配る先がもう 1 つ増える |
| 5 | 環境の分け方 | A: **このリポジトリの `wrangler.jsonc` は local のまま。説明書に `env.staging`・`env.production` の手本を載せ、利用者が自分のフォークに足す**。B: このリポジトリの `wrangler.jsonc` に `env` を足す（ID はダミー）。C: 利用者が別の設定のファイルを作り `--config` で渡す | **A**。`wrangler.jsonc` と `wranglerの設定のcronは掃除の定数と同じでAPP_ENVの既定は変わらない` を変えず、手本は P2 の試験で見張れる。B はダミーの ID の環境がこのリポジトリから `--env production` でデプロイできる形になる。C は `.gitignore` と `package.json` の `scripts` が増える |
| 6 | `wrangler deploy --dry-run` を手順の確かめに使うか | A: **無人の回では使わない。人が会話の側で流すかは、ユーザーが決める**。B: 無人の回で使う | **A**。無人の回の設定が `deploy` の名前のコマンドを断る。ログインの要否が**要確認** |
| 7 | 本番の CORS のオリジン | A: **`vars` の `CORS_ORIGINS`（環境ごと・カンマ区切り・ワイルドカード無し）を P6 で足す**。B: `src/core/cors.ts` の定数に書く。C: 本番では CORS を返さない（ブラウザのゲームは同じオリジンから） | **A**。作者ごとにゲームのページのオリジンが違い、コードを変えずに設定で渡せる。B は作者がコードを直すことになる。C はブラウザのゲームを別のオリジンに置けない |
| 8 | サンプルゲームの置き場と形 | A: **`clients/browser/sample-game/` のビルドの要らない 1 枚のページ。SDK を読み込む**。B: Unity か Unreal のサンプルのプロジェクト。C: サンプルのページ（H1）を広げる | **A**。Mac の無人の回で中身を機械で見られ、パッケージを足さない。B は専用 PC でしか見られず、ソースの量が大きい。C は確かめの道具と手本が混ざる |
| 9 | ライセンス | A: **MIT**。B: Apache-2.0（特許の条項がある）。C: 公開しない | **A**（`roadmap.md`）。ゲームの組み込みで扱いが一番軽い。配るものに第三者の包みが入らないので依存の包みのライセンスと矛盾しない（§7.1） |
| 10 | 決めた結果の残し場所 | A: **ADR 0003（配布の形・ライセンス・サポートの範囲）**。B: `docs/guides/decisions/` の新しい文書 | **A**。後から覆りにくい「なぜ」の決定で、ADR 0001・0002 と並ぶ。運用で変わる細部（料金の公式の URL など）は `operations-security.md` のまま |
| 11 | バージョン移行 | A: **足すだけは `/v1` のまま・壊す変更は `/v2` を足して並べる・スキーマは semver・マイグレーションは足すだけ・3 つのクライアントの層は同じ版**。B: 変更のたびに `/v` を上げる。C: 版を付けない | **A**。今の互換の試験（旧 CLI）の形のまま足せる。B は利用者のクライアントの直しが増える。C は利用者が取った版と説明書を合わせられない |
| 12 | npm の包みの公開と SDK の版 | A: **当面は公開しない（ソースの写し）。公開するなら P7 で `clients/browser/` に包みの `package.json` と版の欄を足し、公開（`npm publish`）はユーザーがする**。B: P1 と一緒に公開する | **A**。Phase 3 の人の確かめが済まないうちに版を約束しない。`CLAUDE.md` の「公開をしない」が続く |
| 13 | Phase 3 の残り（人の確かめ H1〜H6）との順 | A: **P1〜P3（文書と LICENSE）は H1〜H6 と並べて進める。P4・P5（ブラウザのページ）は H1 の後。P6（守りを外す）は H1〜H6 が全部済み、`roadmap.md` の Phase 3 に印が付いた後**。B: H1〜H6 を全部 Phase 4 の前提にする。C: H1〜H6 を見ずに進める | **A**。P1〜P3 はクライアントの動きに頼らない。P4・P5 は H1 で確かめた SDK とサンプルの上に作る。守りを外すのは 3 つのクライアントが本当に動くと分かってから |
| 14 | パッケージの追加 | A: **どの束も足さない**。B: 管理画面に UI の部品のライブラリを足す | **A**。ビルドの要らないページと Node.js の標準で足りる。足すなら、その束の Issue で何を・なぜかを書いて決め、`package.json` と `package-lock.json` を対で動かす |

## 13. 実装の束

束は 1 つの実装の Issue に当たる。印は `P1`・`P2`…（ほかの印 `K`・`S`・`M`・`A`・`V`・`C`・`R`・`E`・`O`・`U`・`Q`・`N`・`B`・`F` はこれまでの設計書で使っている）。

| 束 | 中身 | 前の束 | 変えるもの | 無人の回で機械が見る | 人が見る・人がする外への操作 |
| --- | --- | --- | --- | --- | --- |
| P1 | `LICENSE`（MIT）・ADR 0003・`README.md` の「ライセンス」「サポートの範囲」「ゲストは本人確認でない」「いまは書き込みが 403」の節 | — | `LICENSE`・`docs/adr/`・`README.md`・`test/` | §9 の P1 の 4 本 | 著作者の名前の確かめ（ユーザー）。リポジトリの名前を変えるなら GitHub の設定（ユーザー） |
| P2 | デプロイの説明書 `docs/guides/manuals/deploy.md`（環境の手本・秘密・リモートのマイグレーション・本番の CORS は P6 の後と書く） | P1 | `docs/guides/manuals/`・`test/` | §9 の P2 の 5 本 | 自分の Cloudflare の staging で手順を流す（デプロイ・`--remote`・`wrangler secret put`。ユーザー） |
| P3 | 運用の説明書 `backup-restore.md`・`cost-alerts.md`・`limits-and-costs.md`・`versioning.md` | P2 | `docs/guides/manuals/`・`test/` | §9 の P3 の 5 本 | ダッシュボードで予算のアラートを作る・復元演習（ユーザー） |
| P4 | 管理画面・設定画面（`clients/browser/admin/`）と CORS の `X-Admin-Actor` | P1・H1 | `clients/`・`src/core/cors.ts`・`test/`・`docs/api-contract.md`（CORS の節） | §9 の P4 の 5 本 | H8 |
| P5 | サンプルゲーム（`clients/browser/sample-game/`） | P4・H1 | `clients/`・`test/` | §9 の P5 の 2 本 | H7 |
| P6 | **守りを外す（ユーザーが決めた後にしか回さない。その Issue はユーザーが決めるまで作らない）**: §3.4 の新しい守り・`CORS_ORIGINS`・`scheduled` の門・§11 の置き換え・`CLAUDE.md` の 2 行と文書の置き換え・説明書の冒頭の置き換え・Cloudflare Access（要確認が解けたら） | P1〜P5・H1〜H6 | `src/`・`test/`・`openapi/`・`docs/`・`CLAUDE.md` | §9 の P6 の 8 本と §11 の 13 本の新しい名前 | 本番へのデプロイと秘密の投入・Access の設定（ユーザー） |
| P7 | npm の包みの準備（ユーザーが公開を決めた後）: `clients/browser/` に包みの欄・SDK の版の欄 | P6 | `clients/`・`test/` | §9 の P7 の 1 本 | `npm publish`（ユーザー） |

- P1〜P5 は `src/core/guards.ts` と `wrangler.jsonc` と `migrations/` を変えない。どの束も `package.json` の依存を変えない（`package.json` の `scripts` も P1〜P5 では変えない）。
- どの束もデプロイ・公開をしない。開発サーバーは無人の回で起動しない（通しの確かめはその回の後に会話の側で）。
- 人の確かめ（H7・H8）と人の操作は束の合格の条件に「ユーザーの最終判定」として書き、機械の確認コマンドには入れない。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。`base` はその Issue を作った時点の main のコミット。

P1:

```js
import { runTests, requireTests, mustExist, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
mustExist(['LICENSE']);
runTests();
requireTests([
  'LICENSEはMITの全文と著作者の行を持つ',
  'READMEはライセンスとサポートの範囲とゲストが本人確認でないことを書く',
  '配る成果物に第三者の包みが入らずpackage.jsonにdependenciesが無い',
  'ADR 0003は配布の形とライセンスとサポートの範囲を決める',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'clients/', 'wrangler.jsonc', 'package.json', 'package-lock.json'], { base });
done();
```

P2:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  'デプロイの説明書の環境の手本はstagingとproductionで別のD1を持ちAPP_ENVがlocalでない',
  'デプロイの説明書の環境の手本はcronがwranglerの設定と同じでD1のIDがダミー',
  'デプロイの説明書は秘密の名前をEnvの型と同じ集合で挙げる',
  'デプロイの説明書は冒頭でいまは書き込みが403だと書く',
  'デプロイの説明書が使うnpmのコマンドはpackage.jsonのscriptsにある',
  'wranglerの設定のcronは掃除の定数と同じでAPP_ENVの既定は変わらない',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'clients/', 'wrangler.jsonc', 'package.json'], { base });
done();
```

P3:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  '利用上限の説明書の保持の日数は掃除の定数と一致する',
  '運用の説明書は料金の額を書かず公式の価格表を指す',
  'バックアップの説明書は復元が上書きする操作だと書き復元演習の手順を持つ',
  '費用アラートの説明書は通知の宛先をファイルに書かないと書く',
  'UnityとUnrealのクライアント層の版は同じで版の説明書の表と一致する',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'clients/', 'wrangler.jsonc', 'package.json'], { base });
done();
```

P4:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  '管理画面はスキーマの全部の管理の操作を呼べる',
  '管理画面は管理の鍵をlocalStorageとsessionStorageとクッキーとURLに置かない',
  '管理画面は送り方にブラウザのSDKの再試行の決まりを使う',
  'ローカルでは管理の口の事前確認にX-Admin-Actorを許す',
  'ローカルでない環境では管理の口の事前確認にもCORSの見出しを返さない',
  'ローカルではブラウザの事前確認にCORSの見出しを返す',
  'ローカルでない環境と決めていないオリジンにはCORSの見出しを返さない',
  'スキーマのファイルはOpenAPI 3.1で20個の操作を持つ',
]);
gitClean(['src/core/guards.ts', 'migrations/', 'openapi/', 'wrangler.jsonc', 'package.json'], { base });
done();
```

P5:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  'サンプルゲームはSDKを読み込みゲストの発行とセーブとスコアの投稿を呼ぶ',
  'サンプルゲームはシナリオの関数をページに写さない',
  'ブラウザのサンプルはSDKを読み込みシナリオの関数を呼ぶ',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'wrangler.jsonc', 'package.json'], { base });
done();
```

P6（ユーザーが守りを外すと決めた後にだけ Issue を作る）:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  '本番の設定では鍵があればゲストを発行できる',
  '本番の設定でもトークンの無い書き込みはUNAUTHENTICATEDの401を返す',
  '本番の設定でAUTH_TOKEN_SECRETが無ければ書き込みはINTERNAL_ERRORの500を返す',
  '本番の設定では管理の鍵で管理の口を使え監査に残る',
  '本番の設定ではCORS_ORIGINSのオリジンにだけCORSの見出しを返す',
  'scheduledは本番の設定で保持の日数を過ぎた行を消す',
  'scheduledは既定の設定では何も消さない',
  '既定の設定ではAPP_ENVがlocalとstagingとproductionのどれでもない書き込みを403で断る',
  '既定の設定では利用制限より先にNOT_READY_FOR_PRODUCTIONの403を返す',
  '既定の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す',
  '設定はトークンが無くても本番の設定でも読める',
  // §11 の表の残りの 11 本の新しい名前もここに並べる
]);
gitClean(['migrations/', 'wrangler.jsonc', 'package.json', 'package-lock.json'], { base });
done();
```

P7 は公開を決めたときに、P6 と同じ形で書く。

## 14. 範囲の外

| 範囲の外 | いつ・どこで |
| --- | --- |
| 共有ホスティング（1 つの Worker に多くの作者・マルチテナント） | 需要を見てから（構想の文書）。今の `games` の表と `game_modules` は 1 つの Worker に複数のゲームを置けるが、作者の間の分け方は決めていない |
| 端末をまたぐ引き継ぎ・ログイン | `account-design.md` §11（引き継ぎの秘密か外部 ID）。Phase 4 では作らない |
| Steam などの外部の認証 | `client-integration-design.md` §8 |
| 機能フラグ・マスターデータ・ゲームの版を書き換える管理の口 | 要る運営が出たとき。今はマイグレーションで入れる（`config-design.md`） |
| Unity の Asset Store への出品 | Fab と同じ項目を人が確かめてから |
| 料金の額・無料の範囲の数 | 書かない（`operations-security.md`）。公式を指す |
| 実際のデプロイ・`--remote` の操作・秘密の投入・ダッシュボードの設定・`npm publish`・リポジトリの名前の変更 | 人がする外への操作。このリポジトリのスクリプトと無人の回ではしない |
| Workers Logs などの外のログ・監視・メンテナンスモード | `operations-security.md` のログ・監視の節と一緒に。`observability` の設定の中身は**要確認** |
| R2 への長期のバックアップの自動化 | `analytics-design.md` §16 |
| 集計の小さい数を伏せる（k 匿名） | 管理画面を本番で人に見せるとき（`analytics-design.md` §16） |

## 15. 指示の表

| Issue #59 の指示 | どこで答えるか |
| --- | --- |
| ロードマップの Phase 4 の 5 行が対象 | §4（デプロイの手順）・§5・§6（管理画面・設定画面・サンプルゲーム）・§7（ライセンス・リポジトリの名前・サポートの範囲・Fab）・§8（利用上限・コスト・バージョン移行） |
| これまでの設計書が「Phase 4 へ送る」とした項目も受ける | §1.3 |
| 守りを外す道筋（外すかどうかはユーザーが決める・条件の表・必須要件 1〜10 の表・試験の置き換え・`CLAUDE.md` の 2 行） | §3・§11・§12 の 1・§13 の P6 |
| 環境の分け方・ダミーの D1 ID・秘密・リモートのマイグレーション・本番の CORS・手順書の置き場・dry-run（要確認・「デプロイしない」に当たるか） | §4・§12 の 5〜7 |
| 管理画面・設定画面・サンプルゲーム（置き場・作り方・鍵をブラウザに置かない・Cloudflare Access・管理の API・SDK との関係） | §5・§6・§12 の 3・4・8 |
| ライセンス（MIT）・残し場所・`LICENSE` と `README.md` の束・リポジトリの名前はユーザー | §7・§12 の 9・10・§13 の P1 |
| Fab の規約（確かめる項目の一覧と境目） | §7.4 |
| 利用上限・コスト・バージョン移行（§15 の材料・料金の数字を書かない・`/v2`・スキーマ・マイグレーション・クライアントの層の版） | §8・§12 の 11 |
| npm の包みの公開と SDK の版 | §12 の 12・§13 の P7 |
| Phase 3 の残り（H1〜H6）を前提にするか並べるか | §12 の 13・§13 の前の束の欄 |
| 実装の束の順と確かめ方（機械と人を分ける・守りを外す束はユーザーが決めた後だけ） | §13 |
| 決めることに必ず入れるもの（守りを外す順・環境・管理の人・管理画面と CORS・サンプルゲーム・ライセンス・バージョン移行・束の印・パッケージ） | §12 の 1〜14 |
| 開発サーバーを起動しない | この設計書の回では起動していない。§13 の各束も無人の回では起動しない |
