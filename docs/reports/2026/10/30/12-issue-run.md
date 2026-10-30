# Issue の無人実行のまとめ（20261030-141022）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-141022/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #24 設定配信 C1: ゲームの設定を読む API（機能フラグ・クライアントの版・ETag と 304）を足す | PASS | 15 | 2026-10-30 14:10〜14:25 | 1 | 2 | Bash |

## #24 設定配信 C1: ゲームの設定を読む API（機能フラグ・クライアントの版・ETag と 304）を足す — PASS

- `7fb0b4e feat: 設定を読む API（GET /v1/config・機能フラグ・クライアントの版・ETag と 304）と 0006・CLI モックの設定を読む流れを足し、機能の一覧と操作の数の試験 3 本を置き換える（Issue #24）`
- `feffccb docs: 設定を読む API（GET /v1/config）の契約をスキーマ・api-contract.md・スキーマの設計書・architecture.md に先に書く（Issue #24）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0006_config.sql`・`src/modules/config/` の `index.ts`・`version.ts`・`etag.ts`・`test/config.test.ts` があり、コミットされている | 満たす | `git ls-files` に 5 つとも出る（コミット 7fb0b4e）。`git status` に出るのは `?? docs/inspecs/2026/` だけ |
| ETag を `crypto.subtle.digest` で作る。GET のルートだけ。`APP_ENV=local` の守りが残る。0006 が既存のゲームに `config` を入れる | 満たす | `etag.ts:11` が `crypto.subtle.digest`。`index.ts` のルートは `method: 'GET'` の 1 つだけ。`src/core/guards.ts` は差分なし。0006 に `INSERT OR IGNORE INTO game_modules … SELECT game_id, 'config' FROM games` |
| CLI モックが設定を読み、`If-None-Match` で 304 を確かめる | 満たす | `scripts/cli-mock.mjs` が `/health` の直後に `configPath()` で読み、`If-None-Match` を付けて読み直し、304 でなければ落ちる。観測記録: `npm run cli:smoke` が `GET /v1/config…: 304 (If-None-Match)` から `PASS: local CLI smoke test` まで通った |
| 置き換えた 3 本が `test/` に無い。`api-schema-design.md` に 9 つの操作の名前が無い | 満たす | `test/*.ts` の `it('…')` 133 個に旧い 3 つの名前は無い。`api-schema-design.md` の `9つの操作を持つ` は 0 件 |
| スキーマに `GET /v1/config` がある。`ErrorCode` は 11 個のまま。`api-contract.md` に設定の節がある | 満たす | `paths['/v1/config'].get` があり、`ErrorCode.enum` は 11 個。`docs/api-contract.md` に `## GET /v1/config?gameId=demo-rpg&clientVersion=…` |
| `npm run typecheck` が通る | 満たす | `issue-24-typecheck.log`: `tsc --noEmit`・exit 0 |
| `Result: PASS`。C1 の 26 本と、`c996348` の試験の全部（置き換えた 3 本を除く）がある | 満たす | `issue-24-test.log`: `Result: PASS 133/133`。C1 の 26 本と base の 107 本（110 から 3 本を引いた数）が全部ある（26 + 107 = 133） |
| 守るファイルを `c996348` から変えていない | 満たす | 守るパスに `git diff --stat c996348 HEAD -- …` を当てると何も出ない。作業ツリーにも変更が無い |

判定は別のエージェントが、私の実行ログ（`issue-24-test.log`・`issue-24-typecheck.log`）と差分（`issue-24-diff.patch`）を読んで行い、8 つとも「満たす」とした。設計書 §3〜§5 との食い違いは無く、§7 より弱い試験も無い、という判定。確認コマンドそのものは回していない。

### やったこと
- 契約を先に直した（設計書 §8 の手続き 1）:
  - `openapi/rpg-online.v1.json` に `getConfig` を足した（200 の `ETag`・`Cache-Control: no-cache`、本文の無い 304、400・404・500）。形は `Version`・`ClientVersion`・`Config`。
  - `docs/api-contract.md` に設定の節を足し、`demo-rpg` が使う機能の一覧に `config` を足した。
  - `api-schema-design.md` の §3 の表・状態とエラーコードの組・S1 の名前（10 個の操作）を直した。
  - `architecture.md` §4 に `game_configs`・`config_flags` を足した。
- 実装:
  - `migrations/0006_config.sql` を足した（設計書 §2 のとおり）。
  - `src/modules/config/` に `version.ts`（`parseVersion`・`compareVersions`・`updateStatus`）・`etag.ts`（`etagOf`・`matchesIfNoneMatch`）・`index.ts`（`GET /v1/config`）を足した。
  - `src/modules/index.ts` の一覧に `config` を足した。
- CLI モック: `cli-requests.mjs` と `.d.mts` に `CLI_CLIENT_VERSION`・`configPath` を足し、`cli-mock.mjs` に「設定を読み、304 を確かめる」流れを足した。
- 試験:
  - `test/config.test.ts` に 21 本を足した。
  - `schema-conformance` に `設定の応答はスキーマに合う` を足し、`failure-server` に CLI の流れの試験を足した。
  - 3 本を置き換え、頭書きの「名前の正」の文を config-design §7 を指す文に置き換えた。
- 観測記録（合否に入れない）: `npm run db:migrate:local` で `0006_config.sql` を当てた。`npm run dev` を起動し、`npm run cli:smoke` は PASS だった（応答は `{"gameId":"demo-rpg","clientVersion":{"minimum":"1.0.0","latest":"1.0.0","update":"none"},"flags":{"demo-flag":true}}`。2 回目は 304）。

### コミット
- feffccb docs: 設定を読む API（GET /v1/config）の契約をスキーマ・api-contract.md・スキーマの設計書・architecture.md に先に書く（Issue #24）
- 7fb0b4e feat: 設定を読む API（GET /v1/config・機能フラグ・クライアントの版・ETag と 304）と 0006・CLI モックの設定を読む流れを足し、機能の一覧と操作の数の試験 3 本を置き換える（Issue #24）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- スキーマで `null` を許す版の欄は `type: ["string","null"]` と `pattern` で書いた（OpenAPI 3.1 の書き方。`test/support/schema-check.ts` は変えてはいけないファイルで、この形なら例外にならない）。違っていればスキーマの `ClientVersion` だけを直す。
- `api-schema-design.md` の S1 の確認コマンドの例にあった旧い名前も、新しい名前に置き換えた（確認コマンドが文書の全文を見るため）。戻すなら feffccb のその 1 行を戻す。
- `info.description` の「応答はどれも content-type…」を「本文のある応答は（304 を除く）」に置き換えた。違っていれば、その 1 文を戻す。
- `schema-conformance` の設定の試験には、§7 の 200・400・404・304 に加えて 500 も入れた（見る範囲を広げただけ）。

### やらなかったこと・断られた操作
- **自分で起動した `npm run dev`（wrangler dev と workerd）を止められなかった。** `pkill` と `kill`（PID 17258・17276・17277）が両方とも断られた。127.0.0.1:8787 で起動したまま残っている可能性がある。ユーザーが止めてほしい。
- `docs/inspecs/2026/`（追跡外）には触れていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `src/core/module.ts` の `GameModule.name` のコメントが `'announcements' | 'rankings' | 'saves'` のままで、`config` が無い（core は変えてはいけない範囲）。
- 数字だけのフラグ名（`123` など）は、JS のオブジェクトでは先に並ぶ。そのため、応答の `flags` が厳密には名前の昇順にならない（`ETag` は決まった値になるので、送り直さない仕組みには影響しない）。名前の形を表の `CHECK` で縛るか、本文の組み立て方を変えるかは別の Issue で決める。
- `scripts/cli-mock.mjs` の頭の英語の 1 行目は、流れの説明が無いまま。

