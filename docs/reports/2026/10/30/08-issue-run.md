# Issue の無人実行のまとめ（20261030-121600）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-121600/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #20 セーブ（スロット・リビジョン・チェックサム・形式の版）の設計書を書く（ロードマップ Phase 1） | PASS | 20 | 2026-10-30 12:16〜12:35 | 1 | 3 |  |

## #20 セーブ（スロット・リビジョン・チェックサム・形式の版）の設計書を書く（ロードマップ Phase 1） — PASS

- `af25a36 docs: セーブの設計書に墓石の上限を範囲の外と書き、V2 の CLI の確かめを緩める（Issue #20）`
- `2a41096 docs: セーブの設計書を判定で直す（削除は墓石でリビジョンを戻さない・CLI モックを V1 から合わせる・確認コマンドで既存の試験を全部見る）（Issue #20）`
- `f06777d docs: セーブ（スロット・リビジョン・チェックサム・形式の版）の設計書を書く（ロードマップ Phase 1・Issue #20）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 設計書が `docs/guides/working/save-design.md` にあり、コミットされている | 満たす | `git log` で f06777d・2a41096・af25a36。`git diff --name-only 8ac12cf HEAD` は save-design.md だけ |
| §0 にゴールと合格の条件、決めること（案と推し）、実装の束の節がある | 満たす | `/^##\s*0[.\s]/m` が true。§0・§10（決めること 12 個。推しつき）・§11（実装の束）。必須の語は node で全部あった |
| ADR 0002・core-foundation-design.md・account-design.md・game_modules・src/modules/saves・requireAuth・Authorization・APP_ENV・scripts/cli-mock.mjs・409・リビジョン・チェックサム・スロット・形式の版・D1・R2 | 満たす | node の includes と正規表現で欠けなし |
| 既存の試験 3 本と `今のCLIモックと同じ形の要求を受け付ける` に名前で触れている | 満たす | §8 の表と §10 の決めること 12。includes で確認 |
| 試験の名前の表（V1・V2・重複なし・いまの test/ と重ならない） | 満たす | Issue と同じ正規表現で V1 27 行・V2 14 行、重複なし、test/*.ts の `it('…')` との重なりなし |
| 束ごとの確認コマンドの案が requireTests を使い、gitClean に base を渡す | 満たす | §11 の V1・V2。`/gitClean\([^)]*base/` が true |
| 指しているパスが実在する | 満たす | Issue と同じ正規表現で、無いパスなし（最後のコミットの後にも回した） |
| src/・test/・migrations/・openapi/・scripts/・package.json などを 8ac12cf から変えていない | 満たす | `git diff --name-only 8ac12cf HEAD` は save-design.md だけ。`git status` は追跡外の `docs/inspecs/2026/` だけ（もとからあった） |
| （設計書 §0 の AI の判定）中身を解釈しない・トークン必須・APP_ENV の守り・§8 が test-plan §11 に沿う | 満たす | 作っていない判定役のエージェントが 2 回判定した。1 回目は条件つき（直すべき点 8 つ）。直した後の 2 回目（2a41096）で全部満たす。残った軽い 2 点は af25a36 で直した |

確認コマンドの全体は回していない（スクリプトが回す）。

### やったこと
- Issue #20、元の文書（ADR 0002・core-foundation-design・account-design・構想の §5・§6・failure-case-test-plan）、src/・test/・migrations/・cli-mock を読んで、いまの挙動を確かめた
- D1・R2・Workers の上限を Cloudflare の公式の文書で確かめた（D1 の 1 行 2,000,000 バイト・SQL の文 100,000 バイトなど）。`bind` の値が文の長さに数えられるかは読み取れなかったので「要確認」と書いた
- 設計書 `docs/guides/working/save-design.md` を書いた: D1 の行に本体を置く・PUT/GET（V1）と一覧/DELETE（V2）・本文の `baseRevision` で楽観的な排他（409 `SAVE_CONFLICT`）・SHA-256 のチェックサム（クライアントが送り、サーバーが `crypto.subtle.digest` で確かめる）・`formatVersion` はサーバーが解釈しない・64 KiB の上限・スロットは 10 個まで・プレイヤーはトークンの `p` だけで決める・読むのにも APP_ENV の守りを掛ける・削除は墓石・`game_modules` の `saves`・試験の名前の表 41 本・束ごとの確認コマンドの案
- 判定役の指摘で直したこと: 削除でリビジョンが戻ると黙って上書きされる問題（墓石にした）・CLI モックを API を足す束ごとに合わせる・確認コマンドで base の既存の試験を全部 requireTests に渡す・`size` の例・`MAX_REQUEST_BYTES`・試験の置き場・墓石の上限は範囲の外と書いた

### コミット
- f06777d docs: セーブ（スロット・リビジョン・チェックサム・形式の版）の設計書を書く
- 2a41096 docs: セーブの設計書を判定で直す（削除は墓石・CLI モックを V1 から・既存の試験を全部見る）
- af25a36 docs: セーブの設計書に墓石の上限を範囲の外と書き、V2 の CLI の確かめを緩める

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 推しは全部、設計書 §10 の決めること 1〜12 に書いた（置き場は D1・本体は文字列・リビジョンは本文の欄・上限は 64 KiB など）。違っていれば、その行と §2〜§7・§11 の該当する所を直す（文書だけなので git で戻せる）
- Issue の「持つのは識別・形式の版・本体・チェックサム・リビジョン・時刻だけ」に、`size` と `deleted`（墓石）を足した。どちらも中身を解釈しない。理由は §2 に書いた。要らなければ列と試験の行を消す
- `今のCLIモックと同じ形の要求を受け付ける` は変えず、CLI モックのセーブの流れは新しい試験 2 本で見る形にした

### やらなかったこと・断られた操作
- 実装（src/・test/・migrations/・openapi/・scripts/）はしていない（Issue の範囲の外）
- 断られた操作はない

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/api-contract.md` の「将来予定」に `PUT/GET /v1/saves/{slot}` がある。実装の V1 で消すと設計書 §3 に書いたので、いまは直さない
- `docs/guides/working/architecture.md` の §2 に「R2: セーブデータ」とある。設計書の推し（D1）と食い違うので、V1 の「データ境界」と一緒に直すとよい

