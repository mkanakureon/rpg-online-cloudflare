# Issue の無人実行のまとめ（20261030-143646）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-143646/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #25 設定配信 C2: マスターデータを読む API（キーごと・64 KiB・ETag と 304）を足す | PASS | 8 | 2026-10-30 14:37〜14:45 | 1 | 2 |  |

## #25 設定配信 C2: マスターデータを読む API（キーごと・64 KiB・ETag と 304）を足す — PASS

- `5b166c3 feat: マスターデータを読む API（GET /v1/config/master/{key}・キーごとの ETag と 304・64 KiB）と 0007・設定の masterData・CLI モックのマスターデータを読む流れを足し、操作の数の試験を 11 個に置き換える（Issue #25）`
- `795ab08 docs: マスターデータを読む API（GET /v1/config/master/{key}）と設定の masterData の契約をスキーマ・api-contract.md・スキーマの設計書・architecture.md に先に書く（Issue #25）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0007_config_master_data.sql`・`src/modules/config/limits.ts`・`test/config-master.test.ts` があり、コミットされている | 満たす | 3 つともコミット 5b166c3 に入っている。`git status` で追跡外なのは `docs/inspecs/2026/` だけ |
| 上限が表の `CHECK` と定数で 64 KiB。読むルートがある。GET のルートだけ。`APP_ENV=local` の守りが残る | 満たす | 表は `CHECK (length(CAST(data AS BLOB)) <= 65536)`、定数は `MAX_MASTER_DATA_BYTES = 65_536`。`src/modules/config/index.ts` のルートは 2 つとも `method: 'GET'`（`/^\/v1\/config\/master\/…$/` を含む）。`src/core/` は d5a44db から差分なし |
| CLI モックが設定に載ったマスターデータを読む | 満たす | `scripts/cli-mock.mjs` が `masterDataPath`（`/v1/config/master/…`）で最初のキーを読み、`size` と比べる。試験 `CLIモックと同じ流れで設定に載ったマスターデータを読める` が通った |
| 置き換える試験 `…10個の操作を持つ` が `test/` と `api-schema-design.md` に残っていない | 満たす | どちらも grep で 0 件。名前は `…11個の操作を持つ` に置き換えた |
| スキーマに `GET /v1/config/master/{key}` があり、`ErrorCode` は 11 個のまま。`api-contract.md` にマスターデータの節があり、`architecture.md` §4 に `config_master_data` がある | 満たす | node でスキーマを読んで確かめた（`paths['/v1/config/master/{key}'].get` があり、`ErrorCode` は 11 個）。`docs/api-contract.md` に `## GET /v1/config/master/{key}?gameId=…`、`architecture.md` §4 に `config_master_data` がある。契約のコミット 795ab08 は、実装のコミットより先に置いた |
| `npm run typecheck` が通る | 満たす | `issue-25-typecheck.log` は `typecheck exit=0` |
| `Result: PASS` で、C2 の 11 本と d5a44db の試験の全部（置き換える 1 本を除く）がある・通る | 満たす | `issue-25-test.log` は `Result: PASS 143/143`。必須の名前は 143 本で、ソースと JUnit の両方に欠けが 0 件（d5a44db の 133 本 − 置き換えた 1 本 + C2 の 11 本） |
| 既存のマイグレーション・core・ほかのモジュール・`src/modules/index.ts`・手を入れない試験・`wrangler.jsonc`・`package.json` を変えていない | 満たす | 守るパスに `git diff --stat d5a44db HEAD -- …` を当てても何も出ない |

判定は別のエージェントがした。私の実行ログ（`issue-25-test.log`・`issue-25-typecheck.log`）と差分（`issue-25-diff.patch`）を読み、8 つの条件をどれも「満たす」とし、全体を「合格」と判定した。判定役は確認コマンドを回していない。

### やったこと
- 契約を先に直した（設計書 §8 の手続き 1。コミット 795ab08）:
  - `openapi/rpg-online.v1.json` に操作 `getMasterData` を足した。中身は 200（`ETag`・`no-cache`）・本文の無い 304・400・404・500。形として `MasterData` と `MasterDataEntry` を足し、`Config.masterData` も足した（必須にしない）。
  - `docs/api-contract.md` にマスターデータの節を足し、設定の節に `masterData` の説明を足した。
  - `api-schema-design.md` の §3 の表とエラーコードの組、§4 の S1 の名前（11 個）を直した。
  - `architecture.md` §4 に `config_master_data` を足した。
- 実装（コミット 5b166c3）:
  - `0007_config_master_data.sql` と `limits.ts` を足した。
  - `config/index.ts` に `GET /v1/config/master/{key}` を足した。検査の順・メッセージ・`ETag` と 304 は設計書 §3 のとおり。
  - `GET /v1/config` に `masterData`（キーの昇順・UTF-8 のバイト数）を足した。
- CLI モック:
  - `cli-requests.mjs` と `.d.mts` に `masterDataPath`・`utf8Bytes` を足した。
  - `cli-mock.mjs` に、マスターデータを読んで `size` と比べる流れを足した。
  - 頭書きの 1 行目を、流れが分かる文に直した（Issue が許している）。
- 試験:
  - `test/config-master.test.ts` に 8 本を置いた。
  - `schema-conformance` に `マスターデータの応答はスキーマに合う` を足し、操作の数の 1 本を置き換えた。
  - `failure-server` に CLI の流れの試験を足した。
- 観測記録（合否には入れない）:
  - `npm run db:migrate:local` で `0007` が当たった。
  - 127.0.0.1:8787 では、前の回（#24）の `wrangler dev`（workerd PID 17279）がまだ動いていた。止められないので、新しくは起動しなかった。その開発サーバーは新しいコードを読み直していた（`Master data not found` が返る）。
  - `npm run cli:smoke` は PASS。ただし demo-rpg にマスターデータが無いので、マスターデータの流れは `masterData: none (…skipped)` を通っただけ。
  - そこで、ローカルの D1 に `wrangler d1 execute --local` で demo-rpg の `items` を一時的に入れて、もう一度回した。結果は `masterData:[{"key":"items","size":23}]`、`GET /v1/config/master/items?gameId=demo-rpg: 200 {"key":"items","size":23}`、`PASS`。その後、入れた行を消した。

### コミット
- 795ab08 docs: マスターデータを読む API（GET /v1/config/master/{key}）と設定の masterData の契約をスキーマ・api-contract.md・スキーマの設計書・architecture.md に先に書く（Issue #25）
- 5b166c3 feat: マスターデータを読む API（GET /v1/config/master/{key}・キーごとの ETag と 304・64 KiB）と 0007・設定の masterData・CLI モックのマスターデータを読む流れを足し、操作の数の試験を 11 個に置き換える（Issue #25）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- **0007 で demo-rpg に `items` の手本を入れなかった。** 守るファイルの `test/config.test.ts`（121 行・188 行）は、demo-rpg と空のゲームの設定の応答の全体を `toEqual` で比べている。手本を入れたり `masterData: []` を返したりすると落ちる。設計書 §11 の「C1 は toMatchObject」という前提は事実と違った。戻し方: C1 の試験を `toMatchObject` に直す Issue の後で、新しい番号のマイグレーションで手本を入れる。
- **`masterData` は、マスターデータが 1 つも無いゲームでは欄ごと載せない**（理由は上と同じ。スキーマでは必須にしていない）。戻し方: `index.ts` の `...(masterData.length > 0 ? … : {})` を常に載せる形にし、契約の 1 文を直す。
- §7 の C2 の試験は、demo-rpg の代わりに専用のゲーム（`cfg-master`・`cli-master`・`schema-master` など）を使った。
- 契約の例で、`items` の大きさを 23 にした。設計書は 24 と書いているが、`{"potion":{"price":50}}` の実際のバイト数は 23。例のゲーム名は `my-rpg` にした（demo-rpg はマスターデータを持たないため）。
- CLI モックは、`masterData` が無いゲームでは「skipped」と出して先へ進む。

### やらなかったこと・断られた操作
- 前の回の `wrangler dev`（workerd PID 17279。127.0.0.1:8787）は、自分が起動したものではないので止めていない。まだ動いている。
- `docs/inspecs/2026/`（追跡外）には触れていない。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `config-design.md`（守るファイル）が実装と食い違っている。§2 の demo-rpg の `items` の INSERT、§3 と §7 の `size: 24`（正しくは 23）と「demo-rpg の items」の入力、§11 の「toMatchObject」の注。次の文書の Issue で実装に合わせるのが推し。
- demo-rpg にマスターデータが無いので、`npm run cli:smoke` を素のまま回すと、マスターデータの流れを通らない。直すなら、C1 の試験の比べ方を `toMatchObject` に直したうえで、新しいマイグレーションで手本を入れる（別の Issue）。

