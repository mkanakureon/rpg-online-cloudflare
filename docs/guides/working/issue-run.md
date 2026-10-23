# Issue を無人の Claude に進めさせる（issue-run）

GitHub Issue に札を付けておくと、`scripts/issue-run/issue-run.mjs` が1件ずつ新しい Claude Code（`claude -p`・auto mode）を起動し、**Issue の合格の条件を満たすまで**設計・実装・テストを回させる。人が作業していない作業場所（worktree）を選んで起動し、終わったら確認する。Windows でも Mac でも、Node.js だけで動く。

決まりの正は、Issue 駆動キットの `shared/spec/issue-run-spec.md`（Unity 版の `issue-run.ps1` と同じ決まり）。入れた版は `.issue-kit/version`。

## 考え方

- **設計の正はリポジトリの文書。** Issue は「どの文書のどこを、どの合格の条件まで」の札。設計そのものを Issue に書かない（CLAUDE.md 原則5）。
- **合格の条件と確認コマンドが必須。** どちらかが無い Issue は起動しない。公式も「決まった判定が一番強い」「一番の失敗は早すぎる勝利宣言」としている。
- **判定に使うファイルは変えさせない。** 確認コマンドに出てくるリポジトリのファイル（テストのファイル・確認の手伝い等）は、開始時の中身から変わっていたら合格にしない。
- **決定待ちで止まらない。** 書いていない決定は Claude が「git で戻せて範囲が小さいほう」を選び、選んだことと戻し方を報告に書く（CLAUDE.md 原則1）。
- **コミットまで。** push と Issue を閉じるのは、確認したユーザーがやる。

## 止まらない仕組み

| 止まる原因 | 塞ぎ方（どこで） |
|---|---|
| Claude が区切りで返答を終える（`-p` はそこで終わる） | **Stop hook**（`.claude/issue-run/stop-hook.mjs`）。報告ファイルが「## 結果: 合格」・判定に使うファイルが開始時のまま、の2つがそろうまで返答を終えさせない（押し返しは合計30回）。終わったら、スクリプトが確認コマンドを **1 回だけ**回し、落ちていれば出力を付けて同じ会話を `--resume` で再開する（最大 `--max-rounds` 回） |
| 確認の画面が出る | CLI の `--permission-prompts none`。確認は出ずに断られ、エラーが Claude に返るだけ |
| 質問する | `--disallowed-tools AskUserQuestion` と deny |
| 承認の要る操作（削除・プロセス停止・push・Issue への書き込み・直下の CLAUDE.md と `.claude/` の書き換え・履歴の書き換え・デプロイ） | 設定の **deny** で必ず断る。指示文にも代わりのやり方を書いてある。CLAUDE.md と `.claude/` の deny は `Edit(//{{REPO}}/CLAUDE.md)` の**絶対パス**で書き、スクリプトが `{{REPO}}` を作業場所の POSIX 形（Windows の `C:\work\app` は `c/work/app`、Mac の `/Users/me/app` は `Users/me/app`）に置き換える。裸の `CLAUDE.md`・`.claude/**` は**どの深さにも**効き、作る物の中の CLAUDE.md やスキルまで断る（元のリポジトリで 5 回落ちた） |
| コマンドが10分で時間切れ | 設定の env `BASH_MAX_TIMEOUT_MS`（90分） |
| 実行中に Claude Code が更新される | 設定の env `DISABLE_AUTOUPDATER` |
| 認証切れ・利用上限 | 起動前の点検で止める・上限は待ってやり直す |
| 設定が読まれていない（`-p` は壊れた設定を黙って無視する） | 起動前の点検で、Stop hook が呼ばれたことと deny が効いたことを実際に確かめる |
| PC のスリープ | **Mac** は動いている間だけ `caffeinate` で止める。**Windows** は Node だけでは止められないので、電源につないで「電源とスリープ」で眠らない設定にしておく（点検が知らせる） |
| 人が同じ作業場所で作業している | 無人の回のコミットと混ざる。起動の前に、人が作業していない worktree を選ぶ |

設定は `.claude/issue-run/settings.json`（`--settings` で渡す。対話のセッションには効かない。権限は狭めるだけで広げない。`PowerShell(…)` の行は Windows の Claude Code の道具を断るためのもの）。

それでも残るもの: 1回の上限（`--round-minutes` 90分）×回数（`--max-rounds` 4）で合格しなければ `claude-failed` にして次の Issue へ進む。ネットが切れると、数分で 4 回を使い切ることがある（元のリポジトリの実例。まだ仕組みで塞いでいない）。

## ラベル

| ラベル | 付ける人 | 意味 |
|---|---|---|
| `claude-run` | ユーザー（書き込みの権限のある人） | やってよい。**ひな形からは付かない。** 本文を読んでから人が付ける（公開のリポジトリでは、だれでもひな形から Issue を作れるため） |
| `claude-working` | スクリプト | 実行中 |
| `claude-done` | スクリプト | 合格した。確認して閉じる |
| （前提待ち） | スクリプト | ラベルは付けない。「## 前提」の Issue が済むまで始めず、まとめに WAITING と出る |
| `claude-failed` | スクリプト | 合格の条件か確認コマンドが無い・回数切れ・異常終了。理由はコメント。直して外すと再び対象になる |

ラベルは最初の実行で自動で作られる。

**拾うのは、作った人に書き込みの権限（write・maintain・admin）がある Issue だけ。** `claude-run` が付いていても、権限の無い人が作った Issue は外し、対象の一覧の行に番号と理由を出す。前提の確かめも、権限のある人が書いた結果のコメントだけを数える（仕様 1.2）。

## 準備（最初の1回）

1. **Node.js 22.14.0・npm 11.4.2・GitHub CLI（`gh`）を入れる。**
   ```text
   Windows: winget install --id OpenJS.NodeJS.22 --version 22.14.0 -e ／ winget install --id GitHub.cli -e
   Mac:     Node.js 22.14.0 を公式の配布か版を選べる道具で ／ brew install gh
   どちらも: npm install -g npm@11.4.2 ／ gh auth login
   ```
2. git と GitHub のリポジトリ（`origin`）を用意する（`docs/guides/working/github-repo.md`）。
3. 無人の `claude -p` は対話のログインと別に認証が切れることがある（元のリポジトリで `OAuth session expired` で落ちた）。`claude setup-token` で長期のトークンを作り、環境変数 `CLAUDE_CODE_OAUTH_TOKEN` に入れる（Windows はユーザーの環境変数、Mac は `~/.zshrc` などに `export`）。新しいターミナルを開いてから使う。
4. 点検: `node scripts/issue-run/doctor.mjs`。NG が 0 になるまで直す。
5. 試し: `node scripts/issue-run/issue-run.mjs --dry-run` で、対象の Issue・合格の条件の行数・守るファイル・渡す指示文を見る。

## 起動

```text
node scripts/issue-run/issue-run.mjs                    # 札の付いた Issue を全部、順に
node scripts/issue-run/issue-run.mjs --issue 12         # 1件だけ
node scripts/issue-run/issue-run.mjs --work-dir ../app-auth   # 作業場所を指定
```

| 引数 | 既定 | 意味 |
|---|---|---|
| `--repo` | `origin` から | `owner/name` |
| `--round-minutes` | 90 | 1回の起動の上限。超えたら打ち切って、同じ会話を再開する |
| `--max-rounds` | 4 | 再開の回数の上限。超えたら `claude-failed` |
| `--max-issues` | 20 | 1回に回す件数の上限 |
| `--limit-wait-minutes` / `--max-limit-waits` | 30 / 16 | 利用上限に当たったら待ってやり直す（回数に数えない） |
| `--model` | `claude-opus-5-5` | 無人の回に使うモデル |
| `--work-dir` | （選ぶ） | 作業場所の worktree。指定すると選ぶ画面を出さない |
| `--dry-run` | — | Claude を起動せず、対象・条件・守るファイル・指示文だけ出す |

- **作業場所は起動するときに選ぶ。** 窓から起動すると worktree の一覧が出るので、番号で選ぶ（Enter なら起動したフォルダー。worktree が 1 つならそのまま）。
- **worktree ごとに 1 本ずつ、同時に動かせる。** 同じ Issue を取り合ったら両方とも譲る。
- **worktree の `node_modules/` は別。** 新しい worktree では先に `npm install` を済ませておく。worktree を作るのはユーザー（CLAUDE.md）。

## 動いている間に見るもの

`claude -p` は終わるまで窓に何も出さない。進み具合は、逐次書かれる会話の記録 `~/.claude/projects/<プロジェクト>/<セッションID>.jsonl` の最新のものを見る（ツールの呼び出しが並ぶ）。セッション ID は `.issue-run/logs/<日時>/` の各回の JSON にも出る。

## 終わった後に見るもの

読み方と、合格しなかったときの直し方は `docs/guides/procedures/issue-goal-setting.md` の 8 章。

1. `docs/reports/YYYY/MM/DD/NN-issue-run.md` — 合格しなかった → 合格した、の順のまとめ
2. 各 Issue のコメント — 1 行目に結果・**かかった分と開始〜終了の時刻**（分の単位。例 `6 分（2026-10-22 09:36〜09:42）`。始まりは「実行中」の札を付けた直後、終わりは合否が決まった時。起動前の点検は含まない）・回数・コミットの数・作業場所・`HEAD`。続いて合格の条件ごとの判定表・やったこと・コミット・**選んだこと（Claude が自分で決めた点と戻し方）**・やらなかったこと・未採用の改善
3. 合格したものは確認して閉じ、push する
4. 中身のログは `.issue-run/logs/<日時>/`（確認コマンドの写しは `issue-<番号>-check.mjs`、回した出力は `issue-<番号>-check<回>.txt`）

## Issue の書き方

**`docs/guides/procedures/issue-goal-setting.md` が正。** ここには書かない。ひな形は `.github/ISSUE_TEMPLATE/claude-run.md`。会話の中で作るなら `github-issue` スキル。

## 部品

| ファイル | 役目 |
|---|---|
| `scripts/issue-run/issue-run.mjs` | 起動・再開・確認コマンド・ラベルとコメント・点検・まとめ |
| `scripts/issue-run/lib.mjs`・`proc.mjs` | 本文の読み方・指紋・コメントの形（lib）と、子のプロセスの起動（proc。Windows と Mac で同じに動かす） |
| `scripts/issue-run/check-lib.mjs` | 確認コマンドから使う手伝い（`runTests`・`requireTests`・`gitClean`・`done` など） |
| `scripts/issue-run/doctor.mjs` | 点検（道具・ログイン・origin・ラベル・部品・設定・vitest・眠らせない） |
| `scripts/test.mjs` | 確認コマンドが呼ぶテストの入口（`Result:` 行・0 件は FAIL） |
| `.claude/issue-run/prompt.md` | 渡す指示文（Claude の振る舞いを変えたいときはここ） |
| `.claude/issue-run/settings.json` | `--settings` で渡す設定（deny・Stop hook・env） |
| `.claude/issue-run/stop-hook.mjs` | 合格するまで返答を終えさせない |
