# Issue の無人実行のまとめ（20261030-174216）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-174216/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #28 cli:smoke が同点のスコアの積み上がりで落ちたままになるのを直す（CLI モックは回すたびに別のボードに投稿する） | PASS | 3 | 2026-10-30 17:42〜17:45 | 1 | 1 | Bash |

## #28 cli:smoke が同点のスコアの積み上がりで落ちたままになるのを直す（CLI モックは回すたびに別のボードに投稿する） — PASS

- `6286955 fix: CLI モックは回すたびに別のボードに投稿する（smokeBoardId(now)・同点のスコアが上位 10 件を埋めても自分の投稿を見つける試験を足す）（Issue #28）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `cli-requests.mjs` が `smokeBoardId(...)` を書き出し、`.d.mts` に型がある | 満たす | `export function smokeBoardId(now = Date.now())`・`export declare function smokeBoardId(now?: number): string;`（判定役が読んで確かめた） |
| `cli-mock.mjs` が `smokeBoardId(...)` でボードを決め、`SMOKE_BOARD_ID` にそのまま投稿しない | 満たす | `const boardId = smokeBoardId(Date.now())`。POST と GET の両方が `/v1/rankings/${boardId}`。`SMOKE_BOARD_ID` はもう読み込んでいない |
| `npm run typecheck` が通る | 満たす | `tsc --noEmit` exit 0（`issue-28-typecheck.log`） |
| `Result: PASS`・新しい試験と `cbdf7bb` の試験の全部がある・通る | 満たす | `node scripts/test.mjs` → `Result: PASS 159/159`。base の試験 158 本と新しい試験 1 本が junit にあり、failures 0（判定役が照らし合わせた） |
| 守るファイル・設定・契約を `cbdf7bb` から変えていない | 満たす | `git diff cbdf7bb --name-only` が出すのは `scripts/cli-mock.mjs`・`scripts/cli-requests.mjs`・`scripts/cli-requests.d.mts`・`test/failure-server.test.ts`・`docs/guides/working/account-design.md` の 5 つだけ |

判定は別のエージェント（読むだけ。確認コマンドは回していない）がした。「満たさない」の条件も、欠陥も無かった。

### やったこと
- `scripts/cli-requests.mjs` に `smokeBoardId(now)` を足した。入出力の無い関数で、`boss-score-<ミリ秒の36進>` の形の ID を返す（約 19 文字。`^[a-zA-Z0-9_-]{1,64}$` に合う）。型は `cli-requests.d.mts` に足した。
- `scripts/cli-mock.mjs` は、回すたびに `smokeBoardId(Date.now())` のボードにスコアを投稿し、同じボードを読むようにした。
- `test/failure-server.test.ts` に試験 `CLIモックの通しは同点のスコアが上位10件を埋めていても自分の投稿を見つける` を足した。
  - 用意: `SMOKE_BOARD_ID` と前の回の `smokeBoardId` のボードに、ほかのプレイヤーの 1200 点の古い行を 12 行ずつ入れる。
  - 確かめ: CLI モックと同じ関数で投稿し、`limit=10` で自分の行が見つかることを見る。決まったボードのままなら上位 10 件が古い行で埋まって見つからない（直す前の落ち方）ことも見る。
- `docs/guides/working/account-design.md` §5 の CLI モックの流れの説明を、新しいボードの決め方に合わせた。
- 観測記録（合否には入れない）: `npm run dev` を起動し、`npm run cli:smoke` を 2 回続けて回した。2 回とも `PASS: local CLI smoke test` で、ボードは `boss-score-mvuq72at` と `boss-score-mvuq72gd`。どちらの回も GET の一覧に自分の行が 1 行出た。

### コミット
- `6286955` fix: CLI モックは回すたびに別のボードに投稿する（smokeBoardId(now)・同点のスコアが上位 10 件を埋めても自分の投稿を見つける試験を足す）（Issue #28）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 印はミリ秒の時刻の 36 進にした（短く、形の決まりに合う）。違っていれば `smokeBoardId` の 1 行を直す。
- 新しい試験は、前の回のボード（`now - 60000`）と今回のボード（`now`）を別にして確かめる形にした。同じ `now` を渡して同じボードに入れる確かめはしていない（Issue では任意）。違っていれば、この試験に足す。
- `account-design.md` の CLI モックの流れの説明を直した（作る物の説明が古くなるため）。違っていれば、その 1 行を `git revert` で戻す。

### やらなかったこと・断られた操作
- **自分で起動した開発サーバーを止められなかった。** `npm run dev`（PID 29780 → node 29798 → workerd 29801。127.0.0.1:8787 で待ち受け中）を止めようとしたが、`kill`・`pkill` は 2 回とも断られた。**いまも起動したまま**なので、ユーザーが止める必要がある。
- ローカルの D1 にたまった行は消していない（Issue の決めごとどおり）。
- `docs/guides/working/failure-case-test-plan.md` の表には新しい試験の行を足していない。この試験の決まりの元は Issue #28 で、そのことを試験のファイルの頭書きに書いた。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 同じミリ秒に 2 回回すと、同じボードになる（実際には起きない）。
- `abuse-protection-design.md` §11 の例の表示 `POST /v1/rankings/boss-score: 429` が、いまのボードの名前と違う（例として書いたもので、動きには関係しない）。

