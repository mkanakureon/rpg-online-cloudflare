# GitHub リポジトリ（`origin`）の運用

このプロジェクトの `origin` は GitHub に置く。Issue の無人実行（`issue-run.md`）・PR・push はこれを前提にする。

## 0. 守ること

| | 理由 |
|---|---|
| **push はユーザーが指示したときだけ**（`/push`） | 外向きで取り消しにくい |
| **`--force` を打たない** | 履歴の書き換えは GitHub にも効く。別件として相談する |
| **100MB を超えるファイルを add しない** | GitHub が拒否する。履歴に入れてから消すのは大仕事 |
| **秘密の値（`.env`・`.dev.vars`・API キー）を add しない** | private でも、履歴に入ると消しにくい |

## 1. 最初の 1 回（リポジトリを作る）

GitHub にリポジトリを作るのは外向きの操作。Claude はユーザーの了承を得てから打つ。

```text
gh auth login                          # gh が無ければ先に入れる（Windows: winget install --id GitHub.cli -e ／ Mac: brew install gh）
git init -b main                       # まだ git でなければ
git add -A
git commit -m "chore: 初期コミット"
gh repo create <アカウント>/<名前> --private --source . --remote origin --push
```

できたら `git remote get-url origin` が GitHub を指す。`issue-run.mjs` はここからリポジトリ名を読む。

## 2. push する

```text
git status --porcelain            # 空になるまで commit する（未コミットは送られない）
git push origin main
git ls-remote origin refs/heads/main   # 合否はこれと
git rev-parse main                     # これの SHA が一致すること
```

push の散文（`Writing objects` など）で判断しない。大きい差分が HTTP 408 で切られたときは push スキルの小分けの手順。

## 3. 弾かれたとき

| 出たもの | 意味 | やること |
|---|---|---|
| `this exceeds GitHub's file size limit of 100.00 MB` | 100MB 超を add した | そのファイルを `.gitignore` に足して commit をやり直す |
| `Authentication failed` | 認証 | `gh auth status` |
| `HTTP 408` / `RPC failed` | 送信が大きい | push スキルの小分け |
| `rejected (fetch first)` | GitHub 側に無いコミットがある | 止めて調べる。**force しない** |

## 4. 関連

| | |
|---|---|
| push・PR・commit | `.claude/skills/push`・`pr`・`commit` |
| Issue を作る・回す | `.claude/skills/github-issue`・`docs/guides/working/issue-run.md` |
