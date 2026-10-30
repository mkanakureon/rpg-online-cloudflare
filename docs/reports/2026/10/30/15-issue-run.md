# Issue の無人実行のまとめ（20261030-171434）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-171434/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #27 利用制限 R1: D1 の固定窓の利用制限をゲストの発行とスコアの投稿に掛ける（429・Retry-After） | PASS | 12 | 2026-10-30 17:15〜17:27 | 1 | 2 | Bash |

## #27 利用制限 R1: D1 の固定窓の利用制限をゲストの発行とスコアの投稿に掛ける（429・Retry-After） — PASS

- `5cc9d82 feat: 利用制限 R1 を足す（D1 の固定窓の rate_limit_counters・ゲストの発行は IP とゲームごと・スコアの投稿はプレイヤーごと・429 RATE_LIMITED と Retry-After・CLI モックは 429 で retry-after を出す・試験 R1 の 14 本と K3 の 2 本・S1 の名前を 12 個に置き換え）（Issue #27）`
- `d9358a2 docs: 利用制限 R1 の契約を直す（ErrorCode に RATE_LIMITED・ゲストの発行とスコアの投稿に 429 と Retry-After・api-contract の利用制限の節・S1 の名前を 12 個に・architecture に rate_limit_counters・K3 の入力を表に入れてから 1 回送る形に）（Issue #27）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0008_rate_limits.sql`・`src/core/rate-limit.ts`・`src/core/rate-limit-policy.ts`・`test/rate-limits.test.ts` があり、コミットされている | 合格 | `git ls-files` に 4 つとも出る（コミット 5cc9d82） |
| `APP_ENV=local` の守りが残っている | 合格 | `src/core/guards.ts:12` `if (env.APP_ENV !== 'local')`。`git diff 77c2bd3 -- src/core/guards.ts` は差分なし |
| スキーマの `ErrorCode` に `RATE_LIMITED`、ゲストの発行とスコアの投稿に 429。旧名の試験が `test/` と `api-schema-design.md` に無い | 合格 | `openapi/rpg-online.v1.json` の enum に追加済み。`issueGuest`・`submitScore` に 429（`Retry-After` は必須の見出し・`x-error-codes: [RATE_LIMITED]`）。`11個のエラーコード` を grep すると、`test/` と `api-schema-design.md` で 0 件 |
| `api-contract.md` に `RATE_LIMITED`・`Retry-After` があり、「レート制限・不正対策が未実装」を置き換えた。`architecture.md` に `rate_limit_counters` | 合格 | grep の件数は RATE_LIMITED 5・Retry-After 5・旧文 0。architecture は 3 件 |
| CLI モックが 429 のとき `Retry-After` を出す | 合格 | `scripts/cli-mock.mjs` の `call()`。観測した出力は `POST /v1/accounts/guest: 429 {...} retry-after=2` |
| `npm run typecheck` が通る | 合格 | `typecheck exit=0`（/tmp/r27/run.log） |
| テストの入口が PASS で、R1 の 14 本・K3 の 2 本・base の全部（置き換えた 1 本を除く）がある・通る | 合格 | `node scripts/test.mjs` → `Result: PASS 158/158`。junit を読む確かめ（/tmp/r27/names.mjs）は `required 161 base 143 bad 0` |
| セーブ・設定・お知らせ・guards・既存のマイグレーション・wrangler.jsonc・vitest.config.ts・package.json を変えていない | 合格 | これらに守るファイル 4 つを足して `git diff --stat 77c2bd3 -- …` を回すと、出力は空 |

判定は別のエージェントに任せた。ログと差分を読ませ、確認コマンドは回させていない。8 条件とも合格、ブロッカーは無し。

### やったこと
- 契約のコミットを先に置いた（d9358a2）。中身は次のとおり。
  - openapi: `ErrorCode` に `RATE_LIMITED`。ゲストの発行とスコアの投稿に 429 と `Retry-After` の見出し。info の説明。
  - `docs/api-contract.md`: 冒頭の文を置き換え。2 つの口の確かめの順に利用制限を入れ、「利用制限」の節を足した。
  - `api-schema-design.md`: S1 の名前を 12 個に、§3 の表に 429 の行。
  - `architecture.md`: `rate_limit_counters` と利用制限の置き場。
  - `failure-case-test-plan.md`: K3 の 2 本の入力を、設計書 §7 の形（上限まで数えた行を表に入れてから 1 回送る）と `Idempotency-Key` に置き換えた。
- 実装と試験のコミット（5cc9d82）。中身は次のとおり。
  - 表 `0008_rate_limits.sql`。
  - `src/core/rate-limit.ts`: `windowStart`・`retryAfterSeconds`・`decide`・`ipSubject`・`consume`。
  - `src/core/rate-limit-policy.ts`: 定数。
  - `src/core/http.ts`: `error` と `json` に見出しの引数。
  - ゲストの発行（IP の制限は本文を読む前、ゲームの制限は登録の後）とスコアの投稿に組み込んだ。
  - `test/support/rate-limits.ts`: `resetRateLimits`・`fillRateLimit`。
  - `test/rate-limits.test.ts`: R1 の 11 本と K3 の 2 本。
  - schema-conformance: 12 個の名前に置き換え。`エラーの応答は…` に 429 の行を足し、`429の応答はスキーマに合う` を新設。
  - failure-server: `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない`。
  - 書き込みを呼ぶ 7 ファイルの `beforeEach` に `resetRateLimits` を足した（開始状態だけ）。
  - CLI モックは 429 のとき `retry-after=<秒>` を出す。
- 観測記録（合否には入れない）。
  - `npm run db:migrate:local`: 0008 を当てられた。
  - `npm run dev`: 起動して `/health` が 200。
  - `npm run cli:smoke`: 失敗。ゲストの発行・スコアの投稿は 200 だったが、`Submitted score not found in top 10` で落ちた。前の回のローカルの D1 に同点 1200 の行が 10 件以上たまっていて、新しい行が上位 10 件に入らないため。利用制限とは関係ない。
  - curl でゲストを続けて発行すると 9 回目から 429（Retry-After: 2）。CLI モックの表示は `POST /v1/accounts/guest: 429 {"error":{"code":"RATE_LIMITED",...}} retry-after=2`。

### コミット
- d9358a2 docs: 利用制限 R1 の契約を直す（Issue #27）
- 5cc9d82 feat: 利用制限 R1 を足す（Issue #27）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- スコアの投稿のプレイヤーの制限を、設計書 §3 の「トークンの後・JSON の前」でなく「本文の形の検証の後・なりすましの確かめの前」に置いた。理由は base の試験 `形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す` で、壊れた DB を渡して 400 を待つため、形の外れで DB を引けない。順は `docs/api-contract.md` に書いた。戻すときは `src/modules/rankings/index.ts` の `consume` を `requireAuth` の直後へ移し、その試験の扱いを決め直す。
- `consume` は数えて、超えたら 429 の応答を返す形にした（`Response | null`。ほかの守りの関数と同じ形。R2 の確認コマンドの `consume(` の検査にも合う）。戻すときは関数 1 つの中で済む。
- `429の応答はスキーマに合う` は、設計書 §7 の「スキーマの 2 本は test/schema-conformance.test.ts」に従ってそこへ置いた。

### やらなかったこと・断られた操作
- 自分で起動した `npm run dev`（wrangler dev。npm 26960・wrangler 26978/26979・workerd 26983/26984）を止められなかった。`pkill -f "wrangler dev"` と `kill 26960 26978 26979` を出したが、どちらも断られた。127.0.0.1:8787 で起動したまま残っている。止める必要がある。
- `docs/inspecs/2026/`（追跡外）は触っていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/guides/working/abuse-protection-design.md` §3 の検査の順の表は、まだスコアの制限を JSON の前に置いている（この Issue では守るファイル）。実装と api-contract に合わせて直す。
- `docs/guides/working/account-design.md` §3・§5 の検査の順に、利用制限の段が入っていない（`src/modules/rankings/index.ts` の頭書きは §5 を順の正として指している）。
- `save-design.md`・`config-design.md` に `…11個のエラーコードと一致する` の名前が残っている（その束の記録としての記述）。
- IP のハッシュに塩が無い。IPv4 は空間が小さく、総当たりで戻せる。設計書どおりにしたが、公開前に鍵付きのハッシュ（HMAC）を考える。
- ローカルの D1 に同点のスコアがたまると `npm run cli:smoke` が上位 10 件の確かめで落ちる。利用制限とは関係ない。
- `CLAUDE.md` の「認証・レート制限・不正対策は未実装」は、守りを外すときに直す（設計書 §9。この Issue では変えない）。

