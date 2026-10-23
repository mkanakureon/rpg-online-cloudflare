---
description: Use when the user asks to create, write, list, check, or run GitHub Issues for unattended Claude runs. Triggers on "イッシュを作って", "Issueを作って", "Issueにして", "Issueを書いて", "イッシュを実行して", "Issueを回して", "issue-run", "無人で進めて", "claude-run を付けて", "/github-issue".
---

# GitHub Issue Skill（作る・確かめる・無人で回す）

Issue は「どの文書のどこを、どの合格の条件まで」の札。設計は Issue に書かずリポジトリの文書に書く（CLAUDE.md 原則5）。
**書き方の正は `docs/guides/procedures/issue-goal-setting.md`、仕組みの正は `docs/guides/working/issue-run.md`。** ここは手順だけ。ルールを書き足さない。

## 前提（毎回）

- `gh auth status` が通る・`git remote get-url origin` が GitHub を指す（`gh` が見つからないときは `node scripts/issue-run/doctor.mjs` で場所を確かめる）。どちらかが無ければ止めて `docs/guides/working/github-repo.md` を示す。
- **Issue を作る・ラベルを付ける・閉じるのは外向きの操作。** ユーザーが「作って」と言ったときだけ。下書きまでは自分で進めてよい。

## A. Issue を作る（「イッシュを作って」）

1. **大きさを決める**（issue-goal-setting.md 1 章）。大きいもの（新しい機能・仕組みの変更）は「設計書を書く Issue」と「実装する Issue」の 2 つに分け、2 つ目の `## 前提` に 1 つ目を書く。方針が決まっていないものは Issue にしない（先に `docs/guides/decisions/` に決める）。
2. **元の文書を確かめる。** 指すパスと節が実在すること。無ければ先に設計書を書く（`design-cycle`）か、設計書を書く Issue にする。
3. **ゴールを 1 文**（誰が・何を見て・どう判断するか）。
4. **合格の条件**: 機械で測れるものだけ。箇条書きの 1 行ずつが確認コマンドのどこかで確かめられること。見た目・使い心地は「やらないこと」へ。
5. **確認コマンド**（```js・ES モジュール）: ふつうは `scripts/issue-run/check-lib.mjs` を読み込んで、`runTests()`・`requireTests([...])`・その Issue だけの確かめを書き、最後に `done()`。書き方は issue-goal-setting.md 4 章:
   - 変えさせないファイルは `// 守る: <パス>` の行に書く（パスが確認コマンドに出てくれば、git が管理しているものは自動で守られる）。**直させるファイルは変数を通して指す**（そのまま書くと自動で守られて直せない）。作業で直す所のあるファイルは守らない
   - フォルダーごと変えさせないなら `gitClean(['<フォルダー>/'])`
   - 落ちる所は `check(条件, '理由')` で出し、止めずに後ろの行まで見て、最後に `done()`
6. **確認コマンドを自分で 1 回回して、いま落ちる（まだできていない）ことと、落ちる理由が「まだ作っていないから」であることを見る。** 最初から通るならゴールが書けていない。確認コマンド自身の誤りで落ちるなら直す（元のリポジトリの #10・#38・#11 はこれで回を使い切った）。後ろの行も、偽の状態（作ったことにした状態）で回して確かめる。回すときは作業場所の直下で `node --input-type=module < 下書き.mjs`。
7. 本文を `.issue-run/drafts/<題>.md` に書き、ユーザーに見せる（ひな形 `.github/ISSUE_TEMPLATE/claude-run.md` の欄どおり）。
8. 「作って」と言われていれば作る:
   ```text
   gh issue create --title "<題>" --body-file .issue-run/drafts/<題>.md --label claude-run
   ```
   ラベル `claude-run` がまだ無いと失敗する。そのときは `gh label create claude-run --color 1d76db --description "Claude に無人で進めさせてよい"` を先に（issue-run.mjs も最初の実行で作る）。
9. 作った直後の Issue は `gh issue list` に出ないことがある（数十秒待つ）。`node scripts/issue-run/issue-run.mjs --issue <番号> --dry-run` で、合格の条件の行数・確認コマンド「あり」・守るファイルが期待どおりかを見て、URL と一緒に報告する。

## B. Issue を見る（「イッシュを見て」「一覧」）

```text
gh issue list --label claude-run --state open
gh issue view <番号> --comments
```

`claude-done` は合格して確認待ち、`claude-failed` は理由がコメントにある（直し方は issue-goal-setting.md 8 章）。

## C. 無人で回す（「イッシュを実行して」）

`scripts/issue-run/issue-run.mjs` は Issue ごとに新しい `claude -p` を起動し、1 件 30 分〜数時間かかる。**この会話の中では回さない。**

1. `node scripts/issue-run/issue-run.mjs --dry-run` を回し、対象・条件・守るファイルを報告する。
2. 本番はユーザーが別のターミナルで起動するよう、コマンドを渡す:
   ```text
   node scripts/issue-run/issue-run.mjs                 # 札の付いた Issue を全部、順に
   node scripts/issue-run/issue-run.mjs --issue 12      # 1 件だけ
   ```
   作業場所には、ほかの作業をしていない worktree を選ぶ（無人の回のコミットと混ざらないように）。
3. 終わったら `docs/reports/YYYY/MM/DD/NN-issue-run.md` と各 Issue のコメントを読み、結果を報告する（閉じる・push はユーザー）。
4. 合格しなかったものは、理由ごとの直し方（issue-goal-setting.md 8 章）を示す。ユーザーが「閉じて」「出し直して」と言ったら、決まった形のコメント（「合格（claude-done）を確認して閉じる（YYYY-MM-DD ユーザー指示）」・「## 対応（日時）」）を付けてから閉じる／`claude-failed` を外す。

## やらないこと

- Issue に設計を書く（文書へのリンクにする）。
- 確認コマンドの無い Issue に `claude-run` を付ける（起動しない・`claude-failed` になる）。
- 見つけた改善を自動で Issue にする（原則2。報告に書き、ユーザーが選ぶ）。
