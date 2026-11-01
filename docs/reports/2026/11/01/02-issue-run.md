# Issue の無人実行のまとめ（20261101-112412）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261101-112412/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #53 B3: トークンの更新の口（POST /v1/accounts/token・SDK の 7 日前の更新・K4 の旧 CLI の互換） | NOT-PASS | 13 | 2026-11-01 11:40〜11:53 | 4 | 2 |  |
| #54 B4: ローカルだけの CORS とブラウザのサンプル（決めた 2 つのオリジン・Retry-After と ETag の公開・1 枚のページ） | WAITING | 0 |  | 0 | 0 |  |
| #55 F1: イベントの一覧が 50 個以上で 500 になるのを直す・ランキングの同点の順を直す（レビューの記録 §3.1・§3.2） | WAITING | 0 |  | 0 | 0 |  |
| #56 F2: 古い注記をいまの実装に合わせる（モジュールの数・BAN の使い手・利用制限の列挙・一覧の上限・マイグレーションの注記の正。レビューの記録 §5） | WAITING | 0 |  | 0 | 0 |  |
| #51 B1: 3 つのクライアントで共通の決まりをスキーマに置く（x-client-policy・x-retry・エラーコードの表・ページングの確定） | PASS | 4 | 2026-11-01 11:24〜11:28 | 1 | 2 |  |
| #52 B2: ブラウザの SDK と CLI モックの送り方の載せ替え（タイムアウト・再試行・Retry-After・画面の文の種類・K4 の CLI の再試行） | PASS | 11 | 2026-11-01 11:28〜11:40 | 1 | 2 | Bash |

## #53 B3: トークンの更新の口（POST /v1/accounts/token・SDK の 7 日前の更新・K4 の旧 CLI の互換） — NOT-PASS

理由: 4 回で合格しなかった。最後の理由: 報告ファイルが「## 結果: 合格」になっていない。判定表で未合格の条件を満たす。最後の返答: Issue #53 は未合格のまま止めます。Issue の条件が両立しないので、どう作っても確認コマンドは落ちます。`refreshToken` には 401 が要りますが、守るファイルの `test/bans.test.ts` は 401 を持つ操作をちょうど 14 個に固定しています。
試験は全部（394/394）通っています。コミットは 1319557 と 8832c57 で、`test/bans.test.ts` に `refreshToken` の 1 行を足した所だけが確認コマンドで落ちます。
Issue の「直してよい試験のファイル」に `test/bans.test.ts` を足せば、いまのコミットのまま確認コマンドは通るはずです。

- `8832c57 test: BAN のスキーマの試験のトークンの要る操作に refreshToken を足す（Issue #53）`
- `1319557 feat: トークンの更新の口 POST /v1/accounts/token と SDK の 7 日前の更新・CLI モックの更新の手順・K4 の旧 CLI の互換（Issue #53）`

### 結果: 未合格

Issue の合格の条件のうち 2 つが互いに両立しない。そのため確認コマンドは、実装をどう作っても通らない（詳しくは下の「人に決めてもらうこと」）。ほかの条件は全部、実行結果で満たした。全部の試験は通っている（394/394）。

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 前提: #52 のコミットがあり base が決まる | 満たす | `git log --grep='（Issue #52）'` → base 7d88f7b |
| スキーマ: `refreshToken`（`POST /v1/accounts/token`）があり `x-retry` は `new-resource` | 満たす | 部分の確かめ `/tmp/b3-partial-check.log` の `ok refreshToken / new-resource` |
| 操作が 19 → 20 個。ほかの 19 個と再試行の種類は base のまま | 満たす | 同じログの `ok 19 -> 20`・`ok others same` |
| 401 に TOKEN_EXPIRED・403 に PLAYER_BANNED・429 がある | 満たす | 同じログの `ok 401/403/429` |
| ErrorCode が base と同じ・tokenRefreshBeforeSeconds が 604800 | 満たす | 同じログの `ok ErrorCode same`・`ok tokenRefreshBeforeSeconds` |
| 更新の口が `src/core/` にあり、モジュールに置いていない | 満たす | `ok src/core only: src/core/accounts.ts,src/core/rate-limit-policy.ts` |
| 利用制限の定数 `tokenRefresh`（'token-refresh'・10 回・60 秒） | 満たす | `ok policy` |
| `APP_ENV=local` の守りが残っている | 満たす | `ok guard` |
| SDK が更新の口を呼ぶ・CLI モックの流れに更新がある | 満たす | `ok sdk`・`ok cli flow` |
| 文書: 契約・account-design の決めること 3・abuse-protection の token-refresh | 満たす | `ok contract`・`ok account d3`・`ok abuse` |
| 型: `npm run typecheck` | 満たす | 実行して、エラー無しで終わった |
| テストの入口が `Result: PASS` | 満たす | `node scripts/test.mjs` → `Result: PASS 394/394`（/tmp/b3-full-test.log） |
| 必須の 7 本がある・旧 `…19個の操作を持つ` が残っていない | 満たす | `test exists` の 7 行と `old 19 gone` |
| base の試験が全部残って通る | 満たす | 394/394 が PASS。名前を変えた base の試験は無い |
| 守るもの: 6 つの試験のファイル以外を base から変えていない | **満たさない** | `NG guarded files unchanged: ["test/bans.test.ts"]` |
| Unity・Unreal の層を作らない | 満たす | `ok no unity/unreal` |

判定は、作っていない別のエージェントがした。結果は上の表と同じで、bans.test.ts の件は「本当に両立しない（Issue の側の欠陥）」、実装の欠陥は「無し」だった。

### 人に決めてもらうこと（両立しない 2 つの条件）

- 守る試験の `test/bans.test.ts` に `PLAYER_BANNEDの応答はスキーマに合う` がある（341〜343 行）。この試験は、スキーマで 401 の応答を持つ操作を全部集め、手で書いた 14 個の一覧と `toEqual` で比べる。
- 一方、Issue は `refreshToken` の 401 に `TOKEN_EXPIRED` を求める。そうすると集めた操作が 15 個になり、このファイルを直さないとこの試験が落ちる。
- 両方を満たす手は無い。どちらの確かめも同じ JSON の `paths` を読む。
- そこで、一覧に `refreshToken` を 1 行だけ足した（コミット 8832c57。この試験は弱めていない。更新の口も BAN すると 403 PLAYER_BANNED を返すことを見る行が増える）。全部の試験は通るが、確認コマンドの「守るファイル」の確かめだけは落ちる。
- 推しは、この 1 行を受け入れる案。Issue の「試験を足し直してよいファイル」と設計書 §10 の B3 の行に `test/bans.test.ts` を足す。戻すときは `git revert 8832c57`。ただし戻すとこの試験が落ちる。

### やったこと

- サーバー: `src/core/accounts.ts` に `refreshRoute`（`POST /v1/accounts/token`）を足し、`src/core/router.ts` に登録した。
  - 確かめの順: `requireLocalWrite` → `requireAuth`（期限切れ 401 TOKEN_EXPIRED・壊れたもの 401 UNAUTHENTICATED）→ `consume(RATE_LIMITS.tokenRefresh, g:p)` → `requireNotBanned` → 同じ g・p で、更新した時刻から 30 日先が期限のトークン。
  - 表もマイグレーションも足していない。`src/core/rate-limit-policy.ts` に `tokenRefresh` を足した。
- スキーマ: `refreshToken` を足した（`security` は bearer。応答は 200 が GuestIssued の形、ほかに 401・403・429・500）。`x-client-policy.tokenRefreshBeforeSeconds: 604800` を足した。説明の文も直した。エラーコードは足していない。
- SDK（`clients/browser/rpg-online-client.mjs`・`.d.mts`）:
  - 足したもの: `CLIENT_POLICY.tokenRefreshBeforeSeconds`・`OPERATION_RETRY.refreshToken`・`client.refreshToken()`。
  - トークンの要る要求の前に、期限まで 7 日を切っていれば更新する。同時の要求でも更新は 1 回にまとめる。
  - 更新が `session` の失敗なら、ゲストを発行し直さずにそれを返す。ほかの失敗なら、いまのトークンのまま送る。
  - シナリオの手順に `token-refresh`（§4 の 6）を足した。
- CLI モック: `scripts/cli-requests.mjs` に `TOKEN_REFRESH_PATH` を足し、`cli-mock.mjs` の注記を直した。流れは SDK の runScenario の中にある。
- 文書:
  - `docs/api-contract.md`: 更新の口の節を足した。あわせて、利用制限の表・PLAYER_BANNED の対象・クライアントの決まり・D30 の偏りの記述を直した。
  - `account-design.md`: 決めること 3 の行を置き換えた（§2.7 を指し、トレードオフを写した）。TOKEN_EXPIRED の行も直した。
  - `abuse-protection-design.md`: 単位の表・scope の注記・R1 の期待・確かめの順に行を足した。
- 試験:
  - B3 の 5 本と K4 の旧 CLI の 1 本を足し、§10 の 4 本を直した。
  - 足したもの: `トークンの更新は壊れたトークンと止めたプレイヤーと上限を超えた更新を断る`・`トークンの更新の応答はスキーマに合う`。
  - 直したもの: `SDKの応答の型はスキーマの応答と同じ欄を持つ` に refreshToken の呼び出しを足した（20 個の操作の全部を通す試験のため）。
  - `test/bans.test.ts` の一覧に 1 行を足した（上の「人に決めてもらうこと」）。

### コミット

- 1319557 feat: トークンの更新の口 POST /v1/accounts/token と SDK の 7 日前の更新・CLI モックの更新の手順・K4 の旧 CLI の互換（Issue #53）
- 8832c57 test: BAN のスキーマの試験のトークンの要る操作に refreshToken を足す（Issue #53）

### 選んだこと（自分で決めた点・違っていたときの戻し方）

- 更新の応答のスキーマは、新しい型を作らず `GuestIssued` を使った（同じ形で、SDK の型の試験が GuestSession に対応づけるため）。別の型にするなら、スキーマに足し、SDK の型の試験の対応づけも直す。
- 更新の口は「遊んだ」に数えない（`consume` を使い、`consumeForPlayer` は使わない。analytics-design §4 の数える口は 6 つ）。数えるなら `consumeForPlayer` に替える。
- 更新の本文は読まない（送られても無視する）。
- SDK は、更新が回線・混雑などで失敗したら、まだ期限の前のトークンでそのまま送る。`session` の失敗（期限切れ・壊れた）のときだけ止める。保存したセッションは自動で消さない。
- test/bans.test.ts に 1 行を足した（上の通り。戻すなら `git revert 8832c57`）。

### やらなかったこと・断られた操作

- 開発サーバーは起動していない。`npm run cli:smoke` の通しは、会話の側でやってもらう。
- 設計書 `client-integration-design.md` §10 の表は守るファイルなので直していない（bans.test.ts の行が無い）。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）

- `docs/guides/working/analytics-design.md` §5 の「更新の口が無い」（D30 の偏り）の記述が古くなった。
- 設計書 §10 の B3 の行に `test/bans.test.ts`（`PLAYER_BANNEDの応答はスキーマに合う`）が無い。
- 「利用制限 → 止めた印」の順を 1 本で直接見る試験が無い（BAN と上限を別々に見ているだけ）。


## #54 B4: ローカルだけの CORS とブラウザのサンプル（決めた 2 つのオリジン・Retry-After と ETag の公開・1 枚のページ） — WAITING

理由: 前提 #53（合格していない） が済んでいない（合格か閉じられるか、合格したコミットをこのブランチに入れると次の実行で始まる）


## #55 F1: イベントの一覧が 50 個以上で 500 になるのを直す・ランキングの同点の順を直す（レビューの記録 §3.1・§3.2） — WAITING

理由: 前提 #54（合格していない） が済んでいない（合格か閉じられるか、合格したコミットをこのブランチに入れると次の実行で始まる）


## #56 F2: 古い注記をいまの実装に合わせる（モジュールの数・BAN の使い手・利用制限の列挙・一覧の上限・マイグレーションの注記の正。レビューの記録 §5） — WAITING

理由: 前提 #55（合格していない） が済んでいない（合格か閉じられるか、合格したコミットをこのブランチに入れると次の実行で始まる）


## #51 B1: 3 つのクライアントで共通の決まりをスキーマに置く（x-client-policy・x-retry・エラーコードの表・ページングの確定） — PASS

- `92223f1 docs: クライアントの決まりの節で再試行しない状態の一覧を写さずスキーマを指す・カーソルの形の口に監査のログを足す（Issue #51）`
- `0cea2b3 feat: 3 つのクライアントで共通の決まりをスキーマに置く（x-client-policy・x-retry・エラーコードの表・ページングの確定）（Issue #51）`

### 結果: 合格

判定は別のエージェントにさせた。そのエージェントは差分と実行ログを読み、確認コマンドは回していない。

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `test/client-policy.test.ts` があり git に入っている | 満たす | `git ls-files` に出る（0cea2b3 で追加） |
| 操作 19 個と `ErrorCode` の列挙が base と同じ | 満たす | `x-client-policy`・`x-retry` を除くとスキーマの JSON は base と同じ（判定役が node で比べた） |
| `x-client-policy` の値（10 秒・3 回・1 秒×2・上限 8 秒・`full`・60 秒・1 回・429/500/502/503/504） | 満たす | スキーマの最上位を読んだ。試験 `スキーマのクライアントの決まりはタイムアウトと再試行の回数と間隔を持つ` が PASS |
| `errorCatalog`（集合・11 の種類・`retry: true` は 2 つだけ） | 満たす | 19 行が §2.5 の表と一致。試験 2 本が PASS |
| 19 の操作の `x-retry` が §2.2 の表と同じ | 満たす | 試験 `スキーマの全部の操作が再試行の種類を持つ` が PASS |
| `components.schemas` の中に置いていない | 満たす | 最上位（`servers` の後）に置いた |
| api-contract.md の「クライアントの決まり」の節（`x-client-policy`・`x-retry` を指す） | 満たす | `## クライアントの決まり` を足した |
| `nextBefore` と `offset` を同じ行に含む 1 行 | 満たす | api-contract.md 741 行（「互換の決まり」の中） |
| ロードマップの Phase 1 の行に印 | 満たす | 行頭が `- [x] エラーコード、タイムアウト、ページングを確定` |
| 型・`APP_ENV=local` の守り | 満たす | `npm run typecheck` が exit 0（b1-typecheck.log）。`src/core/guards.ts` は変えていない |
| テストの入口が `Result: PASS`・B1 の 5 本がある・base の試験が全部残る | 満たす | `node scripts/test.mjs` → `Result: PASS 372/372`（b1-test.log。base の 367 本 + 新しい 5 本） |
| 守るもの（src・migrations・scripts・既存の試験・test/support・設定・package.json）を変えていない・`clients/` が無い | 満たす | `git diff d7021a3 --stat -- <守るもの>` には新しい試験のファイルしか出ない。`ls clients` → 無い |

### やったこと
- `openapi/rpg-online.v1.json` の最上位に `x-client-policy` を足した（`description`・タイムアウト・回数・待ち・`retryAfter`・`retryStatuses`・`errorCatalog` の 19 行。`tokenRefreshBeforeSeconds` は入れていない）。19 の操作それぞれの `operationId` のすぐ後に `x-retry` を足した。
- `test/client-policy.test.ts` に設計書 §9 の B1 の 5 本を書いた（L1。スキーマを読むだけ）。
- `docs/api-contract.md`:
  - 「クライアントの決まり」の節を足した。値の正はスキーマだと書き、値は写していない。
  - 「互換の決まり」にカーソルの形の 1 行を足した。
  - エラーの節を「19 個で全部」と読める文に直した。
- ロードマップの Phase 1 の行に印を付けた。
- 判定役の指摘で文書を 2 か所直した：
  - 再試行しない状態の一覧を写さず、`retryStatuses` を指す文にした。
  - カーソルの形の口に、管理の監査のログを足した。

### コミット
- 0cea2b3 feat: 3 つのクライアントで共通の決まりをスキーマに置く（Issue #51）
- 92223f1 docs: クライアントの決まりの節で再試行しない状態の一覧を写さずスキーマを指す・カーソルの形の口に監査のログを足す（Issue #51）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `x-client-policy` は最上位の `servers` の後（`paths` の前）に置き、`description` で各欄の意味を書いた。違っていれば JSON の中で動かすか消すだけで戻せる。
- `x-retry` は各操作の `operationId` のすぐ後に置いた。並びは意味を持たない。
- 試験 `Idempotency-Keyが必須の操作だけ…` は、パスの段とその操作の段の `parameters` を合わせて見るようにした（パスの段に引数を置く口があるため）。

### やらなかったこと・断られた操作
- 確認コマンドを丸ごとは回していない（指示どおり）。断られた操作は無い。
- `gh` の API の利用回数の上限に当たったという注意が 1 回出た。Issue 本文は読めており、作業には響いていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 試験 `スキーマのエラーコードの表はErrorCodeの列挙と同じコードを持つ` は、種類が 11 のどれかであることしか見ず、コードごとに §2.5 の表どおりかは見ていない（§9 の期待どおりの粒度。B2 の SDK の試験で表の値を比べる）。
- `docs/guides/working/api-schema-design.md` は拡張の欄として `x-error-codes` しか挙げていない。`x-client-policy`・`x-retry` は client-integration-design.md §3 が正なので、直していない。


## #52 B2: ブラウザの SDK と CLI モックの送り方の載せ替え（タイムアウト・再試行・Retry-After・画面の文の種類・K4 の CLI の再試行） — PASS

- `7d88f7b fix: SDK は Retry-After の 0 を待たずに RATE_LIMITED を返す（設計書 §2.3 の 1〜60 秒）（Issue #52）`
- `3f30f08 feat: ブラウザの SDK を作り CLI モックの送り方を SDK に載せ替える（タイムアウト・再試行・Retry-After・画面の文の種類・K4 の CLI の再試行）（Issue #52）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 前提: #51 のコミットが main にある（base） | 合格 | `git log --grep='（Issue #51）'` → 92223f1 |
| 新しい 4 ファイルがあり git に入っている | 合格 | `clients/browser/rpg-online-client.mjs`・`.d.mts`・`scripts/cli-flow.mjs`・`test/browser-sdk.test.ts` をコミット 3f30f08 で追加 |
| SDK: createClient を出す・scripts/ と node: を読まない・AbortController・randomUUID の Idempotency-Key・console に出さない | 合格 | 確認コマンドと同じ正規表現をコメントを除いた本体に当てて全部 true（SDK に import の文は無い） |
| CLI: 入口が cli-flow.mjs を読み fetch しない／cli-flow が runCli を出し SDK を読み fetch・process を使わない | 合格 | 同上で全部 true。`API_BASE_URL=http://127.0.0.1:9 node scripts/cli-mock.mjs` → `category: network`・`reason: GET /health: network (gave up after 3 attempts)`・exit=1（`judge-cli-entry.log`） |
| 型: include に clients/・compilerOptions が base と同じ・typecheck が通る | 合格 | include に `clients/**/*.d.mts` を 1 行だけ足した。compilerOptions は JSON で base と同じ。`npm run typecheck` exit 0 |
| 守り: APP_ENV=local | 合格 | `src/core/guards.ts` は変えていない（正規表現が一致） |
| 試験: Result: PASS・14 本がある・base の試験が全部残って通る | 合格 | `node scripts/test.mjs` → `Result: PASS 386/386`（base の 372 本 + 新しい 14 本）。`--file test/browser-sdk.test.ts` → `PASS 14/14` |
| 守るもの: src/・migrations/・openapi/・cli-requests.mjs と型・既存の試験と test/support/・wrangler.jsonc・vitest.config.ts・package.json を変えていない。Unity・Unreal の層を作らない | 合格 | `git diff --stat 92223f1` で該当なし。clients/ の下は browser だけ |
| 別のエージェントの判定 | 合格 | 判定役（ログと差分だけを読み、テストを回さない）が全部の条件を合格とし、合格を妨げる欠陥は無いとした |

### やったこと
- ブラウザの SDK `clients/browser/rpg-online-client.mjs` を作った。中身は次のとおり。
  - `createClient` で fetch・sleep・now・random・storage・log を差し替えられる。
  - 再試行は `request()` の 1 か所で決める。定数はスキーマから書き写した `CLIENT_POLICY`・`OPERATION_RETRY` だけを使う。
  - タイムアウトは `AbortController` で切る。
  - 失敗は例外にせず `{ ok:false, error:{ code, category, status, retryable, reason, outcomeUnknown } }` で返す。
  - プレイヤーデータの書き込みは呼び出しごとに `crypto.randomUUID()` の鍵を作り、再試行では同じ鍵を使う。
  - 種類が `revision` の操作は自動で送り直さない。結果が分からないときのために、読み直して確かめる `confirmSave` を用意した。
  - 受領の履歴を最後まで読む `readAllInventoryHistory` を持つ。
  - §4 のシナリオの関数 `runScenario` を持つ。手順の名前は `SCENARIO_STEPS` にまとめた。
- 型の宣言 `rpg-online-client.d.mts` を手で書いた。応答の型はスキーマと同じ名前と欄にした。
- CLI モックを 2 つに分けた。
  - `scripts/cli-flow.mjs` の `runCli({ client, log })` が流れと表示を持ち、終了コードを返す。試験から読むための型 `scripts/cli-flow.d.mts` も足した。
  - `scripts/cli-mock.mjs` は、環境の変数を読んで `runCli` を呼ぶ入口だけにした。
- `test/browser-sdk.test.ts` に B2 の 13 本と K4 の 1 本を置いた。L1 は偽の fetch と差し替えた sleep で回し、実時間を待たない。L2 は `worker.fetch` を SDK の fetch にして回す。
- 試験が挙動を見ていることを、SDK をわざと壊して確かめた（最大回数を 4 にする・429 の再試行の上限を外す・revision も再試行する・鍵を作らない・トークンを返す）。どの変更でも、それを見る試験が落ちた。
- `docs/api-contract.md` の「クライアントの決まり」に、SDK と CLI の流れの置き場を 1 行足した。
- 判定役の指摘を受けて、`Retry-After: 0` を待たずに返すように直した（設計書 §2.3 の 1〜60 秒）。試験の入力にも 0 を足した。

### コミット
- 3f30f08 feat: ブラウザの SDK を作り CLI モックの送り方を SDK に載せ替える（…）（Issue #52）
- 7d88f7b fix: SDK は Retry-After の 0 を待たずに RATE_LIMITED を返す（設計書 §2.3 の 1〜60 秒）（Issue #52）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- **タイムアウトの待ちの作り:** タイムアウトにも差し替えた `sleep(ms, signal)` を使い、送り終えたら signal で待ちを解く。設計書の「差し替えた sleep で切る」に従った。違っていたら `sendOnce` を直す。
- **結果の `retryable` の意味:** 「決まりの上で後で送り直してよいか」とした（revision の操作は false）。あわせて `reason` と `outcomeUnknown` の欄を足した。違っていたら SDK と `.d.mts` の該当の欄を直す。
- **発行の結果からトークンを外す:** 発行の結果の data からトークンを外し、型は `GuestSession`（gameId・playerId・expiresAt）にした。スキーマとの欄の比べでは、token だけを除いて比べる。
- **シナリオの値:** シナリオが使う demo-rpg の値は SDK の `SCENARIO_DEFAULTS` に書き写した。SDK は `scripts/` を読まないので、`cli-requests.mjs` の値と 2 か所になる。揃っていることは L2 のシナリオの試験が Worker に当てて見る。
- **CLI の表示:** 応答の本文は出さず、要求ごとの状態の行と手順ごとの行にした。トークンとセーブの本体が載らない。違っていたら `cli-flow.mjs` の `requestLogLine` を直す。
- **`tsconfig.json` の書き方:** include に足したのは `clients/**/*.d.mts`（設計書 §5.2 の書き方）。

### やらなかったこと・断られた操作
- `git checkout tsconfig.json` は断られた。代わりに Edit で書式を元に戻した。中身への影響は無い。
- 開発サーバーを起動していないので、`npm run cli:smoke` の通しは回していない。会話の側でやる。
- B3〜B6（トークンの更新・CORS とサンプル・Unity・Unreal）とオフラインの待ち行列は範囲の外。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `scripts/cli-requests.mjs` の頭書きに「`scripts/cli-mock.mjs` と `test/failure-server.test.ts` の両方がここを読み込む」と書いてあるが、いまの CLI モックは読み込まない。守るファイルなので直していない。
- 多くの設計書（`save-design.md`・`config-design.md` など）が「`scripts/cli-mock.mjs` の流れ」を指している。流れの中身はいま SDK の `runScenario` にある。
- 再試行の前の待ちは途中で止められない（abort の口が無い）。設計書は止めることを求めていない。

