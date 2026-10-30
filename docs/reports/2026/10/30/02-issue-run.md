# Issue の無人実行のまとめ（20261030-102841）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-102841/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #14 共通 API の土台 M1: src/worker.ts を src/core と src/modules に分ける（挙動は変えない） | PASS | 4 | 2026-10-30 10:28〜10:32 | 1 | 1 |  |

## #14 共通 API の土台 M1: src/worker.ts を src/core と src/modules に分ける（挙動は変えない） — PASS

- `c37d7cc refactor: src/worker.ts を src/core と src/modules に分け、M1 の単体の試験 4 本を足す (#14)`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| §2 の表のファイル（`src/core/` の 6 つ・`src/modules/` の 4 つ）があり、git にコミットされている | OK | `git ls-files src` に 10 ファイルが全部ある（コミット c37d7cc） |
| `src/core/` のどのファイルも `src/modules/` を読み込まない | OK | `grep -nE "from\s+['\"][^'\"]*modules" src/core/*.ts` → 当たり無し（exit 1） |
| 型の確かめ（`npm run typecheck`）が通る | OK | `npm run typecheck` → exit 0 |
| テストの入口が `Result: PASS` で、§4 の M1 の 4 本がある・通る | OK | `node scripts/test.mjs` → `Result: PASS 38/38`。JUnit に M1 の 4 本が §4 の名前どおりにある |
| いまの試験が 1 行も変わらずに通る（指定の 3 本を含む） | OK | 既存の 34 本は全部通った（JUnit で 3 本を名前で確かめた）。`test/` の差分は新しい `test/modules.test.ts` だけ |
| 守るファイル・フォルダーを `8284ce2` から変えていない | OK | `git diff --stat 8284ce2 HEAD -- <守るものの一覧>` → 差分無し |

判定は別のエージェント（判定役）が、実行ログ（/tmp/issue14-test.log・/tmp/issue14-tc.log・junit.xml）と差分を読んで行った。6 つとも OK、挙動の違いは無し（エラーの文・ヘッダー・検査の順・SQL・メソッド違いの 404・500 の扱いが同じ）。

### やったこと
- `src/worker.ts` を入口だけに減らした。`src/core/`（env・http・ids・guards・module・router）と `src/modules/`（index・announcements・rankings・rankings/validate）に分け、エラーの文・検査の順・SQL の文はそのまま移した。
- `test/modules.test.ts` に §4 の M1 の L1 の試験 4 本を足した。新しい `.ts` には全部頭書きを付けた。

### コミット
- c37d7cc refactor: src/worker.ts を src/core と src/modules に分け、M1 の単体の試験 4 本を足す (#14)

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `parseScoreSubmission` は `{ ok: true, value } | { ok: false, message }` を返す形にした。これで、いまの 2 つの文（`Object required`・`Invalid ranking payload`）を呼ぶ側でそのまま出せる。違っていたら validate.ts とその呼び出しを直す。
- `parseLimit` は外れたときに `null` を返す形にした。違っていたら同じく validate.ts を直す。
- POST の 403 の門（`requireLocalWrite`）は guards.ts に置き、もとの `IMPORTANT` の注釈もそこへ移した。

### やらなかったこと・断られた操作
- `npm run dev` / `npm run cli:smoke` での通しの確かめはしなかった（観測記録なし。合否には入らない）。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- M1 の試験 1 は、メソッドと pattern の文字列が両方同じときだけルートの重なりとみなす。同じパスに当たる別の正規表現は見つけられない（§4 の書き方は満たしている）。

