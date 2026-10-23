---
description: Use when the user asks to sync the git worktree lanes with main (morning integration). Triggers on "レーン同期して", "レーン同期", "朝の同期", "レーンを同期して", "各レーンをmainに入れて", "/lane-sync".
---

# レーン同期 Skill（統合セッション = main）

各レーン（worktree のブランチ）を main に入れ、その main を各レーンに入れる。**ふつうは朝に 1 回、main の worktree から。**

起動語は **「レーン同期して」**。「朝の同期」「レーンを同期」も同じ。

> レーンの一覧・所有するフォルダー・main の役割・レーンの作り方は
> [`docs/guides/working/worktree-lanes.md`](../../../docs/guides/working/worktree-lanes.md)。
> このスキルは手順だけ。

## 前提（守るもの）

- **main の worktree で動く。** レーンのセッションからは実行しない（セッションは自分の worktree から出ない）。
- **`git worktree add` / `remove` はしない。** レーンを作る・消すのは人（`worktree-lanes.md` の「レーンを作る」）。
- **レーンの worktree が汚れていたら、そのレーンは触らない。** レーンの未コミットはレーンのセッションの仕事。勝手にコミットも stash もしない。
- **ほかのレーンで動いている開発サーバー（`wrangler dev` など）を止めない。**
- push はしない（同期はローカルの merge だけ。GitHub へ送るのはユーザーが「pushして」と言ったとき＝`/push`）。

## 手順

### 1. main の未コミットを片づける

```text
git status --short
git diff
```

- **追跡ファイルの変更があれば、中身を見てコミットする**（commit スキルの規則。`package.json` と `package-lock.json` は対で）。スクリプトは main が汚れていると止まる。
- **未追跡ファイルは中身を見て決める。** 0 バイトの空ファイル・生成物・秘密情報はコミットしない。残したものは報告に書く。
- 削除はしない。不要そうなものは「残っている」と報告するだけ。

### 2. スクリプトを回す

```text
node scripts/issue-run/sync-lanes.mjs              # 本番
node scripts/issue-run/sync-lanes.mjs --dry-run    # 迷ったらまず（git を書き換えない）
```

やること（順番はスクリプトの契約。ここで変えない）:

1. レーン → main（`git merge --no-edit <lane>`。衝突は `--abort` して FAIL）
2. main → レーン（各 worktree で `git merge --ff-only main`）
3. 取り込んだ差分から、レーン側で次に要る作業（`npm install` / `テスト`）を `next` 列に出す

### 3. 報告

**合否は最後の `Result:` 行だけで読む。** 表や散文から「同期できた」と書かない。

```text
Result: PASS  2 レーンすべて 53a32c6
Result: FAIL  1/2 レーン未同期
```

報告に入れるもの:

- `Result:` 行と、レーンごとの表（before / lane->main / main->lane / after / next）
- `next=npm install` のレーンがあれば「そのレーンのセッションが作業前に `npm install` を回す」と書く
- `next=テスト` のレーンがあれば「そのレーンのセッションが作業前に `node scripts/test.mjs` を回す」と書く
- 手順 1 でコミットしたもの・コミットせず残したもの
- 自分で決めたこと 1 行（何を選んだか・違っていたらどう戻すか。例: 「ff で入れた。戻すなら各 worktree で `git reset --hard <before>`」）

## FAIL のとき

| 出力 | 意味 | どうする |
|---|---|---|
| `Result: FAIL  main の worktree ではない` | main 以外のフォルダーから叩いた | main の worktree から叩く |
| `Result: FAIL  main dirty` | main に追跡ファイルの未コミット変更 | 手順 1 に戻る |
| `Result: FAIL  レーンの worktree が見つからない` | レーンをまだ作っていない | `worktree-lanes.md` の「レーンを作る」（作るのは人） |
| `SKIP(dirty)` | そのレーンの worktree が汚れている | 触らない。報告に書く。レーンのセッションがコミットしたら再実行 |
| `CONFLICT` | レーン → main で衝突（abort 済み） | main で手でマージして解く。**`package-lock.json` の衝突は手で混ぜない**（どちらかを採ってから `npm install` で作り直す）。解けたら再実行 |
| `main->lane FAIL` | ff できなかった | 1 の後は起きないはず。worktree の状態を `git status` で見て報告 |

「緑にするためだけの緩和」（`--force`・`reset --hard` でレーンを捨てる等）はしない。

## やらないこと

- レーンの worktree で作業しない・レーンの未コミットに触らない
- 同期の後のテストはこのスキルの外（頼まれたら main で `node scripts/test.mjs` を回し、落ちたものは main で直してコミットし、もう一度このスキルでレーンへ流す）
- レーンのテストはレーンのセッションが回す。ここで回さない
