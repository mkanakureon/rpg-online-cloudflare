# Issue の無人実行のまとめ（20261030-104206）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-104206/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #15 共通 API の土台 M2: ゲームの登録を足し、登録の無いゲームを 404 で断る | PASS | 6 | 2026-10-30 10:42〜10:48 | 1 | 2 | Bash |

## #15 共通 API の土台 M2: ゲームの登録を足し、登録の無いゲームを 404 で断る — PASS

- `6c1f32d feat: ゲームの登録（games）を足し、登録の無いゲームを 404 NOT_FOUND で断る (#15)`
- `d729a93 docs: 登録の無いゲームを 404 NOT_FOUND で断る契約に決め直す (#15)`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0002_games.sql`・`src/core/games.ts`・`test/support/games.ts`・`test/games.test.ts` があり、コミット済み | OK | `git ls-files` で 4 つとも出る（コミット 6c1f32d） |
| 置き換えた 2 本の名前が `test/` と `failure-case-test-plan.md` に無い | OK | `test/failure-input.test.ts` から 2 本を削除。計画の §3 の 2 行と §4 の K1 の `requireTests` を新しい名前にした（d729a93）。grep で旧名 0 件 |
| openapi の `listAnnouncements` に 404 `NOT_FOUND`・api-contract の行を置き換え | OK | 404（`Error`・`x-error-codes: ["NOT_FOUND"]`）を追加。`docs/api-contract.md:32` を「登録の無い`gameId`は404 `NOT_FOUND`…」に置き換え |
| `npm run typecheck` が通る | OK | `tsc --noEmit` exit=0（`issue-15-typecheck.log`） |
| `Result: PASS`・M2 の 9 本・§5 の 3 本・互換の試験・M1 の試験がある・通る | OK | `node scripts/test.mjs` → `Result: PASS 45/45`。check-lib の `requireTests` に 16 個の名前を渡して全部 OK（確認コマンドの `requireTests` の部分だけ回した） |
| failure-input 以外の既存の試験・0001・scripts/・package.json・wrangler.jsonc が 093499a から変わっていない | OK | `git diff --stat 093499a -- <守るファイル>` の出力が空 |

判定は別のエージェント（独立の判定役）が、上のログと差分を読んで 6 項目とも OK にした。

### やったこと
- 契約の設計を先に直した（d729a93）。対象は `docs/api-contract.md`、`docs/guides/working/failure-case-test-plan.md`（§1・§2・§3 の 2 行・§4 の K1・§5 の決めること 1 を「ゲームだけ B・ボードは A」へ）、`docs/guides/working/architecture.md` §4（`games` を追加）、`openapi/rpg-online.v1.json`（`listAnnouncements` の 404、`getRanking` と `submitScore` の 404 の説明文）。
- 実装を足した（6c1f32d）。
  - `migrations/0002_games.sql`: `demo-rpg` を登録する。
  - `src/core/games.ts`: `loadGame` と `requireGame` を置く。登録が無ければ 404 `NOT_FOUND` `Unknown game` を返す。
  - お知らせとランキング（GET と POST）から、入力の形を確かめた後・DB を読み書きする前に `requireGame` を呼ぶ（設計書 §3 の検査の順）。
- 試験を足した。
  - `test/support/games.ts` の `registerGame` と、`test/games.test.ts`（M2 の 9 本）を作った。
  - `test/failure-input.test.ts` は 2 本を消し、ケース 4 の `beforeEach` で `other-rpg` を登録するようにした。
- 観測記録: ローカルの D1 に `npm run db:migrate:local` を当てた（`0002_games.sql ✅`）。`npm run dev` と `npm run cli:smoke` は回せなかった（下の「断られた操作」）。

### コミット
- d729a93 docs: 登録の無いゲームを 404 NOT_FOUND で断る契約に決め直す (#15)
- 6c1f32d feat: ゲームの登録（games）を足し、登録の無いゲームを 404 NOT_FOUND で断る (#15)

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `loadGame` は M2 では `(db, gameId)` だけを受け取り、`{ gameId } | null` を返す形にした。設計書の `known` の引数と `modules` は M3 で足す。違っていたら M3 で `games.ts` の引数を足して直す。
- `registerGame` は M2 では `(db, gameId)` だけにした（機能の引数は M3）。
- `other-rpg` の登録は、ケース 4 の `describe` の `beforeEach` に 1 つだけ置いた。このため Issue が挙げた 3 本のほかに「他のゲームのお知らせは返さない」にも効くが、要求と期待する結果は変わらない。違っていたら、3 本の中で個別に `registerGame` を呼ぶ形に直す。
- openapi は `listAnnouncements` の 200 の説明文も「登録済みのゲームなら」に直した。そのままだと 404 の追加と矛盾するため。

### やらなかったこと・断られた操作
- `npm run dev` をバックグラウンドで起動し `npm run cli:smoke` を回すコマンドは、権限で断られた。そのため開発サーバーでの通しの観測は無い。代わりの根拠は 2 つある: 試験 `今のCLIモックと同じ形の要求を受け付ける` が PASS したこと、ローカルの D1 に 0002 を当てたこと。
- 追跡外の `docs/inspecs/2026/` には触れていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/guides/working/api-schema-design.md:39-41` に、まだ「データが無くても 200 と空の items」とあり、登録の無いゲームの 404 が無い（2026-10-24 時点の事実の表。この Issue の「契約の変わる所」の一覧の外）。

