---
description: Use when the user asks to commit changes, stage files, or create a git commit. Triggers on "コミットして", "commit", "変更をコミット".
---

# コミット Skill（Node.js＋TypeScript 用）

`git add` → `git commit` を一貫したルールで実行する。
このプロジェクトは Node.js＋TypeScript（テストは vitest）。生成物は `.gitignore` 済み。

## トリガー

| ユーザーの表現 | 動作 |
|---|---|
| "コミットして" | **今回の依頼で変更・作成したファイル**をステージしてコミット。他タスクの未コミットや自分が作っていないファイルは含めず、残っていることを報告する |
| "全部コミットして" | 未追跡を含む全変更（生成物・秘密情報は除く）。自分が作っていないファイルは中身を確かめてから |
| "変更をコミットして" | 同上 |
| "ドキュメントだけコミットして" | `docs/` のみステージしてコミット |
| "コードだけコミットして" | コードのみ（`src/`・`scripts/`・テスト・`migrations/` など）。ディレクトリ名だけで分類しない |

## 手順

1. `git status` で変更ファイルを確認
2. `git diff --stat` で変更内容の概要を把握
3. 直近コミット（`git log --oneline -5`）を見てメッセージスタイルを確認
4. ステージするファイルを決定（下記ルール参照）
5. コミットメッセージを作成
6. `git commit` を実行
7. `git status` / `git log --oneline -1` で成功を確認

## ステージするファイルのルール

**含める:**
- 作成・編集したファイル（`src/` `scripts/` `migrations/` `docs/` `.claude/skills/` テスト 等）
- 依存を変えたときは `package.json` と `package-lock.json` を**必ず一緒に**（片方だけにしない。`package-lock.json` を手で直さない）

**含めない（絶対に）:**
- `.env` / `.env.*` / `.dev.vars` / `**/credentials.*` / `**/*.pem` / `**/*.key`
- 生成物（`.gitignore` 済みだが念のため確認）: `node_modules/` `dist/` `coverage/` `.wrangler/` `.issue-run/`
- `.claude/settings.local.json`（ローカル設定）

> コミット前に `git status --short` の中に `node_modules/`・`.wrangler/`・`.issue-run/`・`.env` が無いことを確認する（混入は 0 件が正常）。

## コミットメッセージのルール

### プレフィックス

| プレフィックス | 使う場面 |
|---|---|
| `feat:` | 新機能の追加 |
| `fix:` | バグ修正 |
| `test:` | テストだけの追加・修正 |
| `docs:` | ドキュメントのみの変更 |
| `refactor:` | 動作を変えないコード整理 |
| `chore:` | ビルド・設定・パッケージ・スクリプト等のメンテナンス |

### フォーマット

```
{プレフィックス}: {日本語の説明}
```

- 説明は**日本語**で書く
- 複数の変更がある場合は `・` で区切る
- 長い場合は主要な変更を先頭に、残りを `・` でつなぐ
- Issue の作業なら末尾に `（Issue #N）`

### 例

```
feat: ランキングの取得にページ送りを足す・件数の上限を 100 にする
fix: スコアがマイナスでも登録できる不具合を修正（Issue #3）
test: スコア投稿の異常系の試験を追加
chore: vitest を足し npm test をテストの入口につなぐ
```

## プレコミットフック

- 現状プレコミットフックは**未設定**。
- 将来フックが設定されチェックが失敗した場合は `--no-verify` を使わず、原因を修正してから再コミットする。

## 確かめ（任意・推奨）

コードを変更した場合、可能なら型とテストが通ることを確認してからコミットする:

```text
npm run typecheck                       # package.json にあれば
node scripts/test.mjs --filter '<変えた所のテスト>'   # Result: PASS を見る
```

## Claude の一言（必須）

コミットメッセージの末尾に、今回の作業についての**Claude Code の感想・振り返り**を1〜3行加える。

- 作業内容を振り返った**正直な感想**を書く
- **たわいない・ゆるい**トーンでOK。堅苦しくしない
- 日本語で書く
- `---` で本文と区切る

## Co-Author

必ず以下を末尾に付与する（Claude の一言の後）。モデル名は実際に使用中のモデルに合わせる。

```
Co-Authored-By: Claude {モデル名} <noreply@anthropic.com>
```

### 完成形イメージ

```
feat: ランキングの取得にページ送りを足す

---
D1 のクエリに LIMIT と OFFSET を足すだけで済んだ。境目の件数を試験で押さえたので安心。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```
