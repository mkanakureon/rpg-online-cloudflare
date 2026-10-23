# テストの実行手順（Node.js＋vitest／node --test）

テストの回し方と結果の読み方。合格基準そのものは `docs/guides/decisions/test-plan.md`。

## 1コマンド

```text
node scripts/test.mjs                              # 全部（npm test も同じ）
node scripts/test.mjs --filter 'スコアがマイナスなら 400'   # テストの名前で絞る（vitest の -t・node --test の --test-name-pattern）
node scripts/test.mjs --file test/rankings.test.ts  # ファイルで絞る
```

Windows でも Mac でも同じに動く（Node.js 22.14.0 で確かめる）。中では、決めた試験の仕組みを、結果を JUnit 形式の XML に書く設定で回している。

## 試験の仕組みを選ぶ（vitest か node --test）

`package.json` の `issueKit` の欄で決める。**欄が無ければ vitest**（`node_modules/vitest/vitest.mjs run`）。

npm のパッケージを使わず Node.js の組み込みの試験（`node:test`）で回すときは、次のように書く。

```json
"issueKit": { "testRunner": "node", "testFiles": "tests/*.test.mjs" }
```

| 欄 | 値 | 意味 |
| --- | --- | --- |
| `testRunner` | `vitest`（既定）か `node` | どちらの仕組みで回すか |
| `testFiles` | 文字列か配列（例 `"tests/*.test.mjs"`） | `node` のときに回すファイル（`node --test` に渡す）。`node` のときは必須。`--file` を付けるとその 1 本だけ回す |

- `node` のときは vitest が要らない。点検（`scripts/issue-run/doctor.mjs`）も vitest を求めず、`testFiles` があるかを見る。
- 名前で絞って 1 本も当たらなかったファイルは、`node --test` が「ファイルの名前の testcase」として XML に書く。それは試験の数に入れない（当たらなければ 0 件で FAIL）。
- 試験の中から `scripts/test.mjs` を呼んでも、外の `node --test` の印（`NODE_TEST_CONTEXT`）は子へ渡さない。

## 結果の読み方

**最後の `Result:` 行だけで読む。**

| 出力 | 終了コード | 意味 | 次 |
| --- | --- | --- | --- |
| `Result: PASS 12/12` | 0 | 合格（飛ばしたテストは数に入れない） | — |
| `Result: FAIL (11/12)` | 1 | テストが落ちた。上に vitest か node --test の失敗の表示 | 欠陥を設計／実装に振り分ける（design-cycle §5） |
| `Result: FAIL (0/0（テストが 0 件）)` | 1 | 名前の書き間違い・テストのファイルが無い・全部飛ばし | `--filter` の名前と、テストのファイルの場所を確かめる |
| `Result: FAIL (結果の XML が無い・…)` | 1 | テストまで行かなかった（設定の誤り・型の誤りで読み込めない など） | 上の vitest か node --test の出力を読む |
| `Result: FAIL (vitest が無い。…)` | 1 | vitest で回す設定（`issueKit` の欄が無い）なのに、`npm install` をしていない・`devDependencies` に vitest が無い | `npm install`（vitest を使わないなら `issueKit` の欄を書く） |

テストの名前と合否の XML は `.issue-run/test-results/junit.xml`（git に入れない）。確認コマンドの `requireTests([...])` はここを読む。

## テストを書く場所

| 何を | どこ |
| --- | --- |
| ふつうの関数のロジック（速い・まずここ） | `test/` か、コードの隣の `*.test.ts`（`vitest.config.ts` の `include` に合わせる） |
| HTTP・DB を通す試験（Cloudflare Workers なら `@cloudflare/vitest-pool-workers`） | 同上。設定は `vitest.config.ts`。分けた環境で動くので、開発用のローカルの DB（`.wrangler/`）とは取り合わない |

- テストの名前（`it('…')` の文）は、確認コマンドの `requireTests` で名指しされることがある。**名前を変えるときは、それを名指ししている Issue や設計書の表も同じときに直す**。
- 名前は「何をすると・どうなる」が分かる日本語でよい（例: `スコアがマイナスなら 400 を返す`）。

## 注意

- 何度も全部を回さず、`--filter` で狭める。全部を回すのは、まとめの確かめのときだけ。
- `wrangler dev` を起動したまま試験を回さない（使うポートや一時ファイルが重なることがある）。
- 手で見た結果を「通った」と書かない。報告には `Result:` 行を使う。
