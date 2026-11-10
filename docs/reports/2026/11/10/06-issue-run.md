# Issue の無人実行のまとめ（20261110-222022）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-222022/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #72 G2: 仕分けの試験の残りと batch の文の数の試験を足し、試験のスキーマの確かめに type の配列と minItems を見せる（挙動を変えない。堅めの設計書の G2） | PASS | 2 | 2026-11-10 22:20〜22:22 | 1 | 1 |  |

## #72 G2: 仕分けの試験の残りと batch の文の数の試験を足し、試験のスキーマの確かめに type の配列と minItems を見せる（挙動を変えない。堅めの設計書の G2） — PASS

- `ee40bda test: ヘルスチェックはDBが壊れていても読まずに200を返す試験を足す（#72。G2 の残りの 1 本。決定 B のいまの挙動）`

### 結果: 合格

足したのは試験 `ヘルスチェックはDBが壊れていても読まずに200を返す` の 1 本で、全体は `Result: PASS 441/441` です。base（`f0e56c9`）から変えたのは `test/hardening.test.ts` だけで、行を足しただけです（19 行。消した行は 0）。合否は別のエージェントがログと差分を読んで判定し、どの条件も合格でした。

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 公開のスキーマの変更は `PlayerDataWrite.changes` の `minItems: 1` だけ | 合格 | `minItems: 1` は 1 回目の回で base に入っている。`git diff f0e56c9 --stat` に openapi は出ない |
| スキーマの突き合わせの試験のファイルから消したのは準備の行だけで、`beforeEach` がほかの表も消す | 合格 | このファイルは base から変えていない。`beforeEach` に消す表を足したのは 1 回目の回（`16c50a2`）で、base に入っている |
| `APP_ENV=local` の守りが残っている | 合格 | `src/core/guards.ts` に `APP_ENV !== 'local'` がある。`src/` に差は無い |
| 型の確かめが通る | 合格 | `npm run typecheck` は exit 0（`g2b-typecheck.log`） |
| テストの入口が PASS で、新しい 11 本と base の 440 本がある | 合格 | `node scripts/test.mjs` の結果は `Result: PASS 441/441`（`g2b-full-test.log`）。`junit.xml` に 11 本の名前がそろっていて、失敗は 0。441 本は base の 440 本に新しい 1 本を足した数 |
| base から変えてはいけないものを変えていない（`test/hardening.test.ts` は試験を足すだけ） | 合格 | 差は `test/hardening.test.ts` の追加 19 行だけで、消した行は 0 |

### やったこと

- `test/hardening.test.ts` に次の 3 つを足した。
  - 偽の DB `brokenDB`: `prepare` を呼ぶと D1 のエラーに似た例外を投げ、呼ばれた回数も数える。
  - 試験 `ヘルスチェックはDBが壊れていても読まずに200を返す`: 既定の環境とローカルの環境の 2 つで `GET /health` を送り、次の 4 つを見る。
    - 状態が 200
    - `cache-control` が `no-store`
    - 本文が `{status:'ok',service:'rpg-online-backend'}`
    - `prepare` が一度も呼ばれていない
  - ファイルの頭書き: 「2026-11-10 の決定 B でここに置いた」という 1 行。
- 先に `--filter` でこの 1 本だけを回し（`PASS 1/1`）、そのあと全体と型の確かめを回した。

### コミット

- `ee40bda` test: ヘルスチェックはDBが壊れていても読まずに200を返す試験を足す（#72。G2 の残りの 1 本。決定 B のいまの挙動）

### 選んだこと（自分で決めた点・違っていたときの戻し方）

- **試験は `test/hardening.test.ts` の「G2 入口の 500 と 400（§7 の #12・#18・#19）」の始めに置いた。** 違っていたら、`it` をほかのファイルへ移せば戻せる。
- **ファイルの頭書きの古い記述（「ヘルスチェックの試験はここに置いていない」）は消さなかった。** 合格の条件が、このファイルの行を消すことを禁じているため。代わりに、その次の行に経緯を 1 行足した。

### やらなかったこと・断られた操作

- ありません。断られた操作もありません。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）

- `test/hardening.test.ts` の頭書きの 5〜6 行目は、もう古い（ヘルスチェックの試験を「ここに置いていない」と書いている）。行を消すのが禁じられた回が終わったら、次の 1 行と一緒にまとめて直せる。
- `docs/guides/working/api-schema-design.md` の「検証関数が見る語」の一覧に、`minItems` と `type` の配列が載っていない（1 回目の回で報告済み）。

