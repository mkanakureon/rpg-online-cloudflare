# Issue の無人実行のまとめ（20261110-194223）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-194223/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #69 T1: 挙動を変えない片付け（本文を読む前の確かめを core に 1 つ・手伝いの写しをまとめる・管理の口のファイルを分ける）とルートとスキーマの突き合わせの試験 1 本 | PASS | 6 | 2026-11-10 19:42〜19:49 | 1 | 1 |  |
| #70 公開の前の堅めの設計書（際限なく増えるもの・管理の定義どうしの整合・トークンの失効・試験の穴。11/10 のレビューと未採用の改善の仕分けの残り） | PASS | 12 | 2026-11-10 19:49〜20:01 | 1 | 3 |  |

## #69 T1: 挙動を変えない片付け（本文を読む前の確かめを core に 1 つ・手伝いの写しをまとめる・管理の口のファイルを分ける）とルートとスキーマの突き合わせの試験 1 本 — PASS

- `02b215f refactor: 本文を読む前の確かめを core に 1 つ・手伝いの写しをまとめ・管理の口のファイルを分け、ルートとスキーマの突き合わせの試験を足す（#69）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 5 つのモジュールに checkAccess の写しが無く、core の門・トークン・BAN を順に呼ぶ関数を読み込む | 満たす | 確認コマンドの 1 の部分を node で回した: `checkAccess []`、5 ファイルとも直の呼び出し false・`src/core/access.ts` を読み込む true |
| isoSeconds・positiveInteger の定義が src/core/ に 1 つずつ | 満たす | 同じ部分の実行で `src/core/period.ts`・`src/core/query.ts` だけ |
| crypto.subtle.digest が src/core/ の 2 ファイルまで | 満たす | `src/core/hash.ts`・`src/core/admin/key.ts` だけ |
| routes.ts が 300 行まで・admin のどのファイルも 400 行まで・adminRoutes を出したまま | 満たす | `wc -l`: routes.ts 34 行、最大は routes-definitions.ts の 268 行。`export const adminRoutes` あり |
| APP_ENV=local の守りが残り、core がモジュールを読み込まない | 満たす | guards.ts は変えていない。core から modules への import は 0 件 |
| npm run typecheck が通る | 満たす | `tsc --noEmit` がエラー無しで終わった |
| node scripts/test.mjs が PASS・新しい 1 本がある・base の 421 本が全部通る | 満たす | `Result: PASS 422/422`。新しい 1 本は `--filter` で単独に回し `PASS 1/1` |
| base から契約・クライアント・試験・文書・設定を変えていない | 満たす | 守るパスに対する `git diff --stat caf40ae` は空。足した試験のファイルは新しい 1 つだけ |
| 判定役の見直し | 満たす | 別のエージェントが差分とログを読んで全部 PASS と判定した。SQL の文 66 個と bind 67 個が元と一致し、ルートの並びと確かめの順・エラーも元と同じだった |

ユーザーの最終判定（機械では見ない）: 分け方の読みやすさ。

### やったこと
- `src/core/access.ts` に `checkPlayerAccess(req, env, url, rule, feature?)` を作った。saves・inventory・events・player-data・quests の `checkAccess` を消し、これを呼ぶようにした。セーブは機能の設定を後で見るので `feature` を渡さない（元の順のまま）。
- `src/core/hash.ts` に `sha256Hex` を作った。`idempotency.ts` と `saves/checksum.ts` はここから名前を出し直し、`rate-limit.ts` と `config/etag.ts` はこれを呼ぶ。
- `src/core/query.ts` に `positiveInteger` を作り、`inventory/shape.ts` と `admin/parse.ts` から読む。`isoSeconds` の定義は `src/core/period.ts` に 1 つにし、`admin/audit.ts` と `inventory/shape.ts` は出し直す。
- `src/core/admin/routes.ts`（804 行）を次の 5 つに分けた。SQL の文・bind・ルートの並びは変えていない。
  - `common.ts`: `checkAdmin`・`checkAdminWrite`・共通の SQL
  - `routes-players.ts`
  - `routes-definitions.ts`
  - `routes-player-data.ts`
  - `routes-reports.ts`

  `routes.ts` は `adminRoutes` を並べるだけにした。
- 新しい試験 `test/route-schema.test.ts` を足した（`ルーターのルートと公開と管理のスキーマのpathsとメソッドが一対一で対応する`）。両方向で一対一かを見て、ずれは 0 件だった。
- 置き場の記述を直した。
  - `docs/guides/working/` の 6 ファイル（admin・analytics・core-foundation・event-reward・player-data・quest の設計書）の、ファイルと関数の置き場を書いた所
  - core の頭書きにあるパスの記述

### コミット
- 02b215f refactor: 本文を読む前の確かめを core に 1 つ・手伝いの写しをまとめ・管理の口のファイルを分け、ルートとスキーマの突き合わせの試験を足す（#69）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 名前は `checkPlayerAccess` にした（確認コマンドが `function checkAccess` の定義を数えるため）。新しいファイルは `access.ts`・`hash.ts`・`query.ts`・`admin/common.ts`・`admin/routes-*.ts` の 4 つ。違っていたら 02b215f を `git revert` する。
- `insertQuestAudit` などの長い位置引数の bind は直さなかった（任意で、挙動を変えるおそれを避けた）。
- 試験は件数を決め打ちせず、一対一と件数が等しいことだけを見る（口を足しても試験を直さずに済む）。
- `GET /health` は、ルーターが直に答える口として試験の一覧に入れた。

### やらなかったこと・断られた操作
- 断られた操作は無い。開発サーバーは起動していない。
- 設計書の中の、前の Issue の確認コマンド（例: `admin-design.md` の `read('src/core/admin/routes.ts')`）は、その時点の記録として直していない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 試験はルートの一覧を `router.ts` から写して組み立てている。ルーターが一覧を出すようにすれば、写しが要らなくなる。
- 前の設計書の確認コマンドのうち、`src/core/admin/routes.ts` に `player-data.set`・`quest.put`・`requireLocalWrite` があることを見るものは、いま回すと落ちる（その Issue は閉じている）。


## #70 公開の前の堅めの設計書（際限なく増えるもの・管理の定義どうしの整合・トークンの失効・試験の穴。11/10 のレビューと未採用の改善の仕分けの残り） — PASS

- `e8e3ce2 docs: 堅めの設計書の G9 にトークンの鍵の無い環境の管理の口の 500 の試験を足す（Issue #70）`
- `2d02c69 docs: 堅めの設計書の見直しの指摘を直す（本文を読む口・G3 と G9 の守るファイルと変えるもの・束の順・試験の準備の扱い。Issue #70）`
- `ac85480 docs: 公開の前の堅めの設計書を書く（際限なく増えるもの・管理の定義どうしの整合・トークン・利用制限・試験の穴。Issue #70）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `docs/guides/working/hardening-design.md` があり git に入っている | 合格 | `git log --oneline -3` → ac85480・2d02c69・e8e3ce2（どれも Issue #70） |
| §0 の見出しと、ゴール・合格の条件・決めること・実装の束・推し・範囲の外 | 合格 | 確認コマンドの内容のチェックを写したスクリプト（/tmp/partial-check-70.mjs）→ `rows 51 OK` |
| 2 つの記録・8 つの設計書・`docs/api-contract.md` の名前 | 合格 | 同上 |
| 扱いの語が全部ある（ranking_entries〜ユーザーが決める） | 合格 | 同上 |
| 試験の名前の表が 8 行以上・G1 の行あり・重複なし・いまの名前と重ならない | 合格 | 同上（51 行。G1 は 8 行） |
| 束ごとの確認コマンドの案が `requireTests` と `gitClean(…, { base })` を使う | 合格 | 同上（§13 の G1〜G10） |
| 互換の試験 `旧CLIはスキーマ変更後のAPIでもランキングを送って読める` に名前で触れている | 合格 | 同上（§2.1・§2.3・§11.1 と、G1〜G10 の requireTests） |
| 指しているパスが実在する | 合格 | 同上（無いパスは 0） |
| 触れたのは設計書だけ | 合格 | 3 つのコミットは設計書だけを変えた。`git status --porcelain` → 追跡外の `docs/inspecs/2026/` だけ（人の入力。チェックの対象外） |
| AI の判定（いまの挙動がソースと合う） | 合格 | 別のエージェントが 2 回見た。1 回目の 10 件の指摘を 2d02c69 で直し、2 人の判定役が 10 件とも直ったと判定。新しく見つかった 1 件（§5.2 の 500 の試験が §11 に無い）は e8e3ce2 で直した |
| ユーザーの最終判定（推し・束の分け方・読みやすさ） | 機械の外 | ユーザーが決める |

### やったこと
- レビューの記録（§3.2 の 2〜10・13・Vary・issueGuest）と仕分けの残りを、ソース（#69 の後）で一件ずつ確かめ、設計書を書いた。いまの挙動・2〜3 案と推し・契約が変わるか・試験の名前を項目ごとに書いた。束は G1〜G10、試験の名前は 51 本、決めることは 13 件、範囲の外は 12 件。
- `APP_ENV` の 4 つの役は #67 を指すだけにし、P6 の設計は変えていない。
- 別のエージェントに見直させ、指摘 10 件（事実の誤り 1 件・確認コマンドの守るファイルの矛盾 2 件・束の順など）を直した。その後の判定で見つかった 1 件も直した。

### コミット
- ac85480 docs: 公開の前の堅めの設計書を書く（Issue #70）
- 2d02c69 docs: 堅めの設計書の見直しの指摘を直す（Issue #70）
- e8e3ce2 docs: 堅めの設計書の G9 にトークンの鍵の無い環境の管理の口の 500 の試験を足す（Issue #70）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `issueGuest` の送り直しを G10 という別の束にした（クライアントだけの契約の変更なので、サーバーの束と混ぜない）。違えば §13 の表で G10 をほかの束にまとめる。
- 束を 9 でなく 10 にした（G1・G2 は挙動を変えない、G3 は内側の直し、G4〜G10 は契約が変わる）。違えば §12 の 12 と §13 を同じコミットで直す。
- 推しはどれも、git で戻せて範囲の小さい案にした（例: ボードは宣言の表でなく 1 人あたりの上限・トークンは `kid` でなく前の鍵との重なり）。§12 の表にまとめた。

### やらなかったこと・断られた操作
- 確認コマンドは丸ごと回していない（内容のチェックの部分だけを写して回した）。断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/api-contract.md` とスキーマの「`flags` は名前の昇順」は、数字だけの名前ではいまも成り立たない（G3 で直す予定として設計書の §9.5 に書いた）。

