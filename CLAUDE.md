# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

エージェント向けの規約。**短く保つ。** 理由・経緯・手順はここに書かず、下の「入口」へ置く。
Issue 駆動キット（Node 版）を入れた。入れた版は `.issue-kit/version`。
規約を足したくなったら、先にここの行を1つ減らせないか考える。

## プロジェクト

- Cloudflare 上で動く、エンジンに依存しないモジュール式のゲームバックエンド（OSS を目指す。ADR 0002）。クライアントは Unreal・Unity・ブラウザの 3 つ（`clients/`。Unity・Unreal はソースだけで、専用 PC で人が確かめる）と CLI モック。**ローカル専用の PoC**で、認証はゲストのトークン・利用制限は D1 の固定窓・スコアは値の範囲と回数まで（ゲーム固有の確かめは無い）。設計は `docs/guides/working/architecture.md`、HTTP/JSON の契約は `docs/api-contract.md`（CLI・UE・サーバーで共通の正）。
- Node.js **22.14.0**（`.nvmrc`）・npm **11.6.2**・TypeScript・テストは **vitest**（`@cloudflare/vitest-plugin` で Workers のランタイムの中で回す）。Cloudflare Workers・D1。
- `src/worker.ts` は入口だけで、ルートと SQL は `src/modules/<機能>/`、共通の手伝いは `src/core/`。形の正は `openapi/rpg-online.v1.json`。API を変えたらブラウザの SDK（`clients/browser/`。CLI モック `scripts/cli-mock.mjs` もこれで送る）と Unity・Unreal の層も合わせる。
- ロジックは入出力（HTTP・DB）から外へ出し、ふつうの関数にする（単体の試験で速く確かめるため。design-cycle §2）。

## コマンド

```text
node scripts/test.mjs                              # テスト（npm test も同じ）
node scripts/test.mjs --filter '<テストの名前>'      # 1 本
npm run typecheck                                  # 型の確かめ（src/ と test/）
npm run cf-typegen                                 # wrangler.jsonc・wrangler の版を変えたら worker-configuration.d.ts を作り直す
npm run db:migrate:local && npm run dev            # ローカルの D1 を作って Worker を起動（APP_ENV=local・127.0.0.1:8787）
npm run cli:smoke                                  # 起動中の Worker に CLI モックで通しの確かめ
node scripts/issue-run/doctor.mjs                  # Issue の無人実行の点検
node scripts/issue-run/issue-run.mjs --dry-run     # 対象の Issue を見るだけ（本番はユーザーが別の窓で）
```

合否は最後の `Result:` 行（PASS 0・FAIL 1）。
## 原則（常時）

1. **依頼の目的と範囲で働く。** 範囲内で `git` で戻せる判断は自分で決めて進み、**選んだ結果を1行で書く**（何を選んだか・違っていたらどう戻すか）。取り返しのつかないもの（削除・push・Issue の作成や閉じる等の外への書き込み・起動中のツール〔エディタ・開発サーバーなど〕の停止・worktree の追加削除）だけ先に確認する。
2. **着手した修正は直し切る。発見を自動で仕事にしない。** 新しく気づいたものは、テスト計画 §8 の「ブロッカー」に当たるときだけ直す。当たらないものは「未採用の改善」として報告に1行残す。
3. **現行の挙動はソースと実行結果で確かめる。** 文書と違えば差を示し、どちらを直すか目的から決める。答えが実測で決まるなら、測ってから選ぶ。
4. **合否を感想で上書きしない。** スクリプトの測定結果（`Result:` 行）を使う。出力に合わせてテストや合格条件を変えない。機械で測れない実感・見た目は観測記録として区別し、ユーザーが決める。**合格まで「できた」と言わない**（design-cycle）。
5. **一つの契約は一か所で定義する。** 変えるときは旧文を置き換える（例外を追記しない）。日付つきレポートは記録であって現況ではない。

## 進め方の決まり（キットの共通）

- 人の言葉が要る次の一手（外への書き込み・決めること）は、返答の最後に「『<言い方>』と言ってもらえれば〜します」の形で 1 つ書く。
- 決めることには推しの案を必ず付ける。
- 設計書を了承する前に、別のエージェントに見直させる。
- 実装の Issue を作る前に確認コマンドを 1 回回し、いま落ちる理由が「まだ作っていないから」であること、ツールが作ったファイルが残っていないことを確かめる。確認コマンドは、後ろの行まで偽の状態で回して確かめる。

## 守るもの（変えない）

- **`package.json` と `package-lock.json` は対で動かす。`package-lock.json` を手で直さない**（`npm install` で作り直す）。
- **`migrations/` の既存のファイルを書き換えない。** 直しは新しい番号のマイグレーションで足す。
- **デプロイ・公開をしない**（`wrangler deploy`・`npm publish` など）。本番の設定の値（ID・鍵）をファイルに書かない。**無認証の API をデプロイしない**（`wrangler.jsonc` の D1 ID はダミー）。
- **書き込みの API は `APP_ENV === 'local'` のときだけ通し、ほかは `403 NOT_READY_FOR_PRODUCTION`。** `wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない（`local` を渡すのは `npm run dev` だけ）。
- エラーは `{ "error": { "code", "message" } }`。DB のエラーの中身はクライアントに返さず `INTERNAL_ERROR`（500）にする。SQL は `prepare().bind()` でパラメータにする。
- `node_modules/` `dist/` `coverage/` `.wrangler/` `.issue-run/` と `.env`・`.dev.vars` は編集もコミットもしない。
- **push は明示されたときだけ・force しない。** `git worktree add` / `remove` を勝手に実行しない。
- **セッションは自分の worktree から出ない。** 他のレーンの取り込み・状態の確認・編集は統合セッション（main）の仕事。**main で機能開発をしない**（main はレーン同期・push・文書と、同期の後のテストで落ちたものの修正まで）。

## 入口（作業別に読む。ここから先を CLAUDE.md へ写さない）

| 作業 | 読む |
|---|---|
| **機能・改善を作る**（ゴール → 合格の条件 → 詳しい設計書 → 実装 → テスト → NG を設計か実装かに振り分け → 合格判定） | `.claude/skills/design-cycle/SKILL.md` |
| **テストを回す・結果を読む・テストを書く場所** | `docs/guides/procedures/node-test-procedure.md` |
| **テスト計画**（用語・テストレベル・合格基準・中断基準・欠陥管理。これ1か所が正） | `docs/guides/decisions/test-plan.md` |
| **失敗ケースの試験**（試験の名前の表・実装の束 K1〜K4・決めたこと） | `docs/guides/working/failure-case-test-plan.md` |
| **Issue 駆動の全体**（誰が何をするか・部品・1 件の流れ・どの文書が何の正か）と**再現**（版・ゼロからの手順・点検 `scripts/issue-run/doctor.mjs`） | `docs/guides/working/issue-driven-development.md` |
| **Issue を作る・見る・無人で回す**（会話の中で） | `.claude/skills/github-issue/SKILL.md` |
| **ゴールと合格の条件を決めて Issue に書く**（確認コマンド・守るファイル・例） | `docs/guides/procedures/issue-goal-setting.md` |
| **Issue を無人で進めさせる仕組み**（`scripts/issue-run/issue-run.mjs`・止まらない仕組み・ラベル・準備） | `docs/guides/working/issue-run.md` |
| **worktree のレーン**（レーンの一覧・所有するフォルダー・main の役割・レーンの作り方）・**朝の同期**（「レーン同期して」＝`/lane-sync`・`scripts/issue-run/sync-lanes.mjs`） | `docs/guides/working/worktree-lanes.md` |
| **生成 AI の CLI・MCP を足す・使う**（口はコマンドとファイル・無人の回で MCP を使わない・自作 MCP を作る条件） | `docs/guides/decisions/genai-cli-mcp-policy.md` |
| GitHub（リポジトリの作り方・push・弾かれたとき） | `docs/guides/working/github-repo.md`・スキル `commit` `push` `pr` |
| 文書を書く（設計書・手順書の形）・記録を残す | スキル `document-authoring`・`save-report` |
| TypeScript・JavaScript のファイルの頭書き | スキル `file-header` |

## 置き場

| 置き場所 | 何を置くか | 判定基準 |
|---|---|---|
| `docs/guides/working/` | **作業中に参照する**（仕組み・設計の正）。実装を変えたらここを更新する | いまの実装と合っているか |
| `docs/guides/procedures/` | 手順（作業の順番と通過条件） | 手順として正しいか |
| `docs/guides/manuals/` | 使う人に渡す説明書 | 読んで操作できるか |
| `docs/guides/decisions/` | 方針・決定（変わったらここを更新する正） | いまの決定と合っているか |
| `docs/guides/reading/` | 読み物・参考（**作業中には引かない**） | 読んで分かるか |
| `docs/reports/YYYY/MM/DD/` | その時点の記録（更新しない） | — |
| `docs/inspecs/YYYY/MM/` | **人が書く文書（主に入力）の唯一の置き場**。Claude は読むだけで、書き換えない・作らない。人以外の文書（設計書・Issue・手順書・記録）は全部 Claude Code が `docs/guides/` と `docs/reports/` に書く | 人が置いたとおりか |
| `docs/` のそのほかの文書 | キットを入れる前からある文書。置き場を動かさない | — |

混ぜない。更新され続けるものを `docs/reports/` に置かない。`src/` に `.md` を置かない。`docs/guides/` の直下には README 以外を置かない。