# Issue の無人実行のまとめ（20261030-115807）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-115807/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #19 アカウント A2: スコアの投稿にトークンを要るようにし、CLI モックをゲストの発行からの流れに変える | PASS | 8 | 2026-10-30 11:58〜12:05 | 1 | 3 | Bash |

## #19 アカウント A2: スコアの投稿にトークンを要るようにし、CLI モックをゲストの発行からの流れに変える — PASS

- `8fd9528 docs: README の試作対象 API にゲストの発行とトークンが要ることを書く（アカウント A2・Issue #19）`
- `e31ce3e feat: スコアの投稿にトークンを要るようにし、CLI モックをゲストの発行からの流れに変える（アカウント A2・Issue #19）`
- `de69005 docs: スコアの投稿にトークンが要る契約を先に書く（アカウント A2・Issue #19）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `src/core/auth.ts`・`test/support/auth.ts`・`test/auth.test.ts` があり、git にコミットされている | 満たす | e31ce3e で追加（`git log --name-status`） |
| CLI モックがゲストを発行し `Authorization` を付けて送る。`guards.ts` の `APP_ENV=local` の守りが残る | 満たす | `scripts/cli-mock.mjs` が `/v1/accounts/guest` → `authHeaders(guest.token)` で POST。`src/core/guards.ts` は d430727 から差分なし |
| 置き換える試験 `…5つのエラーコードと一致する` が `test/` と `api-schema-design.md` に残っていない | 満たす | grep で 0 件 |
| openapi の `ErrorCode` に 3 つ・`securitySchemes.bearerToken`、`api-contract.md` に `Authorization` と 3 つ、failure-case-test-plan の「認証の設計で決める」を置き換え | 満たす | de69005。grep で「認証の設計で決める」0 件 |
| `npm run typecheck` が通る | 満たす | `typecheck exit=0`（issue-19-typecheck.log） |
| テストの入口が `Result: PASS`・A2 の 7 本・K3 の 5 本・互換と見出しだけ直した既存の試験が通る | 満たす | `node scripts/test.mjs` → `Result: PASS 75/75`（issue-19-test.log）。requireTests の 20 個の名前が JUnit に 1 件ずつあり通過 |
| マイグレーション・お知らせ・guards.ts・token.ts・A1 の試験・wrangler.jsonc・package.json を d430727 から変えていない | 満たす | `git diff --stat d430727 HEAD -- <それら>` が空 |

判定は別のエージェント（判定役）が差分・ログ・JUnit を読んで行い、7 行とも「満たす」、「先に決めておくこと」への違反なし、§5 の検査の順どおりと判定した。

### やったこと
- 契約を先に直した: `docs/api-contract.md`（Authorization・検査の順・8 つのコード・末尾の行の置き換え）、`openapi/rpg-online.v1.json`（ErrorCode に 3 つ・`securitySchemes.bearerToken`・`submitScore` に `security`・401・403 に `PERMISSION_DENIED`）、`api-schema-design.md` §3・§4（S1 の名前を 8 つに）、`failure-case-test-plan.md` §3・§4（K3 のコードと確認コマンドの案を A2 と範囲の外に分けた）。
- `src/core/auth.ts`（`requireAuth`・`requireSamePlayer`）を足し、`src/modules/rankings/index.ts` で §5 の順（守り → 認証 → JSON → 形 → なりすまし → requireGame）に呼ぶ。
- `test/support/auth.ts`（`tokenFor`・`bearer`・`bearerForBody`）。既存の POST の手伝い 5 ファイルと直書き 1 か所に `Authorization` の見出しだけを足した。
- `test/auth.test.ts` に A2 の 5 本と K3 の 5 本。`test/schema-conformance.test.ts` に `認証のエラーの応答はスキーマに合う`・`…8つのエラーコードと一致する`、エラーの組の試験に 3 行。
- CLI モック: `guestRequest()`・`authHeaders()`（`.d.mts` に型）、`cli-mock.mjs` をゲストの発行からの流れに。応答の表示で `token` を `[redacted]` に伏せる。`今のCLIモックと同じ形の要求を受け付ける` は名前と期待を変えず中身をこの流れに。
- README の試作対象 API の表を現況に直した（判定役の指摘。この Issue で変えた API の説明なので範囲の中）。

### コミット
- de69005 docs: スコアの投稿にトークンが要る契約を先に書く（アカウント A2・Issue #19）
- e31ce3e feat: スコアの投稿にトークンを要るようにし、CLI モックをゲストの発行からの流れに変える（アカウント A2・Issue #19）
- 8fd9528 docs: README の試作対象 API にゲストの発行とトークンが要ることを書く（アカウント A2・Issue #19）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 試験の手伝いは `bearerForBody(body)` で本文から ID を取り、`validId` に合わない欄ごとに `demo-rpg`・`p1` に置き換える（両方まとめてでなく欄ごと）。違えば `test/support/auth.ts` の `tokenFor` を直すだけ。
- `requireAuth` は鍵が無いとき `accounts.ts` と同じく投げて入口の 500 にする（応答を自前で作らない）。戻すなら auth.ts で `error('INTERNAL_ERROR', …)` を返す形に。
- `docs/api-contract.md` 冒頭の「認証が未実装」と openapi の `info.description` を「ゲストのトークンだけ・ログイン等は未実装」に書き換えた（契約の現況に合わせるため）。違えば de69005 の該当行を戻す。

### やらなかったこと・断られた操作
- `npm run dev` と `npm run cli:smoke` の観測: 開発サーバーを起動するコマンドが権限で断られた（`npm run db:migrate:local` は「No migrations to apply」で通った）。cli:smoke の観測記録は無い。ユーザーが別の窓で `npm run dev` → `npm run cli:smoke` を回して確かめる。
- 送信 ID・連投の制限（範囲の外）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 鍵が無い（`tokenSecret` が null）ときにスコアの投稿が 500 になる道を確かめる試験が無い（設計書 §6 の表の外）。

