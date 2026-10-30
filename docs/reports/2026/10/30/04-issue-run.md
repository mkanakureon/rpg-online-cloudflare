# Issue の無人実行のまとめ（20261030-105843）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-105843/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #16 共通 API の土台 M3: ゲームごとの機能の設定を足し、使わない機能への要求を 404 で断る | PASS | 5 | 2026-10-30 10:58〜11:04 | 1 | 1 | Bash |

## #16 共通 API の土台 M3: ゲームごとの機能の設定を足し、使わない機能への要求を 404 で断る — PASS

- `ba486c4 feat: ゲームごとの機能の設定（game_modules）を足し、使わない機能への要求を 404 NOT_FOUND で断る (#16)`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0003_game_modules.sql`・`test/game-modules.test.ts` があり、コミットされている | OK | コミット ba486c4 に入っている。`git ls-files` で両方とも出る |
| `src/core/games.ts` に `enabledModules` があり、`src/modules` を読み込まない | OK | `src/core/games.ts:14` にある。import は `./env` と `./http` だけ |
| api-contract に「機能を使わない」、architecture §4 に `game_modules` | OK | `docs/api-contract.md:32`・`docs/guides/working/architecture.md:53,62` |
| `npm run typecheck` が通る | OK | `issue16-typecheck.log` が `typecheck_exit=0` |
| テストが `Result: PASS` で、指定の 12 本があり、通る | OK | `node scripts/test.mjs` → `Result: PASS 51/51`。junit.xml は failures 0・skipped 0 で、12 本とも testcase にある |
| 既存の試験・0001・0002・scripts/・package.json・wrangler.jsonc を 6dbb24a から変えていない | OK | `git diff --stat 6dbb24a HEAD -- <守るパス>` で出るのは、新規の試験のファイルと手伝いの `test/support/games.ts` だけ（どちらも守るパスではない） |

判定は、実装していない別のエージェントがログと差分を読んでつけた（6 つとも OK）。

### やったこと
- `migrations/0003_game_modules.sql` を足した。`game_modules` の表を作り、もう登録してあるゲームは両方の機能を使う設定にする。
- `src/core/games.ts` を直した。
  - `enabledModules` を足した。
  - `loadGame` を LEFT JOIN で 1 回引く形にした。
  - `requireGame` が登録に加えて機能の設定も見るようにした。使わない機能は 404 `NOT_FOUND`（`Feature not enabled for this game`）にする。
- `src/core/router.ts` が一覧の name から既知の名前を作り、`Route.handle` の 5 番目の引数 `known` で渡すようにした（`src/core/module.ts`）。2 つのモジュールは、それを `requireGame` に渡す。
- `test/support/games.ts` の `registerGame` に、機能の引数を足した（既定は `['announcements','rankings']`）。
- `test/game-modules.test.ts` に M3 の 6 本を足した。
- 文書を直した。
  - `docs/api-contract.md` の 1 行を置き換えた。
  - `docs/guides/working/architecture.md` §4 に `game_modules` を足した。
  - `openapi/rpg-online.v1.json` の 3 つの操作の 404 の説明文を直した。`ErrorCode` と `x-error-codes` は変えていない。
- 観測記録（合否には入れない）:
  - `npm run db:migrate:local` で `0003_game_modules.sql` が ✅ になった。
  - `npm run dev` を起動して `npm run cli:smoke` を回すと `PASS: local CLI smoke test` になった（demo-rpg のお知らせ・投稿・ランキングがどれも 200）。

### コミット
- ba486c4 feat: ゲームごとの機能の設定（game_modules）を足し、使わない機能への要求を 404 NOT_FOUND で断る (#16)

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `0003` の外部キーに `ON DELETE CASCADE` を付けた。
  - 理由: `test/games.test.ts`（変えてはいけない）の beforeEach は `games` だけを消す。`registerGame` が既定で `game_modules` の行も入れるようになったので、CASCADE が無いと外部キーで断られる。
  - 戻し方: まだ main にしか無いので、0003 を CASCADE 無しに書き直せば戻る。ただしそのときは、games.test.ts の消し方を変える必要がある。
- 既知の機能の名前は、ルーターが一覧（`createRouter(modules)`）から作り、`handle` の 5 番目の引数で渡す。`requireGame` も 4 番目の引数 `known` を取る形にした。
  - 理由: core が modules を読み込まず、モジュールが index を読み込まない（循環を作らない）ようにするため。
  - 戻し方: 渡す道を変えるなら、`module.ts`・`router.ts`・2 つのモジュールを直す。

### やらなかったこと・断られた操作
- smoke の後、自分で起動した `wrangler dev`（PID 95867・95870）を `kill` で止めようとしたが、断られた。**127.0.0.1:8787 で開発サーバーが動いたままになっている。** 手で止めてほしい。
- 設計書 `core-foundation-design.md` は守るファイルなので、直していない（下の改善を参照）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 設計書の §2・§3 を実装に合わせて直す（`handle`・`requireGame` の `known` の引数、0003 の `ON DELETE CASCADE`、§4 の「この順で消す」の説明）。
- 2 つの 404 は message でしか区別されない。なのに、`Unknown game` の message を確かめる試験が 1 本も無い。

