# worktree のレーン — 決まりと作り方（常設）

**作業を「レーン」（worktree のブランチ）に分け、各レーンのセッション（人・会話の Claude・無人の Claude）は自分のフォルダーの中だけで作業し、main への取り込みとレーンへの配りは統合セッション（main）が「レーン同期して」で行う。** この文書はレーンの決まりの正。同期の手順はスキル `.claude/skills/lane-sync/SKILL.md`、本体は `scripts/issue-run/sync-lanes.mjs`。

> [!TIP]
> **初めて読む方へ**: worktree は、同じリポジトリを別のフォルダーにもう 1 つ展開したもの（`git worktree add`）。フォルダーごとに別のブランチを開いておけるので、人と AI、あるいは AI どうしが**同じファイルを同時に書き換えて壊す**ことを避けられる。レーンは「どのフォルダー（＝どのブランチ）で、どのファイルを担当するか」の決まりのこと。

## 1. レーンの一覧

**まだ作っていない。** 作ったらこの表に書く（作るのは人。2 章）。

| フォルダー | ブランチ | レーン | 独占するパス |
|---|---|---|---|
| `<リポジトリ>` | `main` | **統合** | 機能開発はしない。レーン同期・push・文書・CLAUDE.md と、同期の後のテストで落ちたものの修正（main でコミットしてレーンへ流す） |
| （未定） | （未定） | （未定） | （未定） |

### 所有を決めるときの目安

- **衝突は「機能」でなく「ファイル」で起きる。** 境界はフォルダーとモジュールで引く。
- **`package.json`・`package-lock.json`・`migrations/` は共有。** 触った側が当日中に main へ流す。抱え込まない。`package-lock.json` の衝突は手で混ぜない。
- **マイグレーションの番号は main で決める。** 2 つのレーンが同じ番号の `migrations/NNNN_*.sql` を作ると、片方が当たらない。

## 2. レーンを作る（人がやる）

Claude は `git worktree add` / `remove` を実行しない（CLAUDE.md）。作るのは人。

```text
cd <リポジトリ>
git worktree add ../<リポジトリ>-<名前> -b feat/<名前>     # 例: ../app-auth  -b feat/auth
cd ../<リポジトリ>-<名前>
npm install                                   # node_modules/ は worktree ごとに別
node scripts/issue-run/doctor.mjs             # そろっているかの点検
```

- **フォルダー名は `<リポジトリ>-<名前>`。** 隣の worktree と取り違えないよう、名前は重ねない。
- **`node_modules/` と `.wrangler/` は worktree ごとに別。** 作った直後は `npm install` が要る。
- 作ったら 1 章の表に書き、CLAUDE.md の入口から辿れるようにする。
- 常設の worktree を消して作り直さない。別のブランチは既存の worktree で `checkout` する。

## 3. 日々の回し方

| いつ | どこで | 何をする |
|---|---|---|
| 朝 | main | **「レーン同期して」**（`sync-lanes.mjs`）。レーン → main（merge）→ main → レーン（ff-only）。合否は最後の `Result:` 行。`next=npm install` のレーンは先に `npm install`、`next=テスト` のレーンは作業前に `node scripts/test.mjs` |
| 日中 | 各レーン | **自分の worktree から出ない。** 他のレーンの `git status`・取り込み・編集は main の仕事 |
| 日中 | 各レーン | 無人の回（issue-run）は、人が作業していないレーンを選んで起動する（無人の回のコミットと混ざらないように） |
| 夕方 | 各レーン | 自分のブランチにコミット。共有のもの（`package.json`・`migrations/`）を触った日は当日中に main へ |
| いつも | — | **長寿命ブランチを作らない。** レーンと main の差は 1〜3 コミットに保つ |

## 4. やってはいけないこと

| ❌ | なぜ |
|---|---|
| セッションが自分の worktree から出る（他のレーンの取り込み・状態の確認・編集） | 他のセッションから見ると、ブランチが勝手に動いたことになる（元のリポジトリの実例）。**最重要** |
| `git worktree add` / `remove` を勝手に実行する | 作る前に人が確認する |
| `package-lock.json` の衝突を手で混ぜて解く | 壊れても気づきにくい。どちらかを採ってから `npm install` で作り直す |
| 同期で「緑にするためだけ」に `--force`・`reset --hard` でレーンを捨てる | レーンの作業が消える |

## 5. 関連

| | |
|---|---|
| 同期の手順 | `.claude/skills/lane-sync/SKILL.md`（「レーン同期して」） |
| 同期の本体 | `scripts/issue-run/sync-lanes.mjs` |
| 無人実行と worktree | `docs/guides/working/issue-run.md`（作業場所の選び方・同時に動かす） |
| 全体 | `docs/guides/working/issue-driven-development.md` |
