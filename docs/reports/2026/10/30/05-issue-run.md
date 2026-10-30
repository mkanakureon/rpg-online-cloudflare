# Issue の無人実行のまとめ（20261030-112125）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-112125/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #17 アカウント（ゲストの最小形）の設計書を書く（ロードマップ Phase 1） | PASS | 13 | 2026-10-30 11:21〜11:34 | 1 | 2 |  |

## #17 アカウント（ゲストの最小形）の設計書を書く（ロードマップ Phase 1） — PASS

- `5d3e7db docs: アカウントの設計書の見直しを反映（試験の手伝いの代わりの ID の条件・S1 の名前の正の文書・試験の置き場）`
- `38d998d docs: アカウント（ゲストの最小形）の設計書を書く（ロードマップ Phase 1・Issue #17）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 設計書が `docs/guides/working/account-design.md` にあり、コミット済み | 満たす | 38d998d・5d3e7db。`git status --porcelain` に設計書は出ない（出るのは元からある `docs/inspecs/2026/` だけ） |
| §0 のゴールと合格の条件・「決めること」（案と推し）・「実装の束」 | 満たす | 確認コマンドの文書の部分だけを写した `/tmp/partial-check-17.mjs` → `OK`。判定役 2 人とも「満たす」 |
| 必須の語・`今のCLIモックと同じ形の要求を受け付ける` に名前で触れている | 満たす | 同じ → `OK` |
| K3 の「認証後」の 7 本に名前で触れ、表に写していない | 満たす | 同じ → `OK`（7 本を読めた。A2 に 5 本・範囲の外に 2 本） |
| 試験の名前の表（A1・A2・重複なし・いまの `test/` と重ならない） | 満たす | 同じ → `rows 21`・`OK`（A1 が 14・A2 が 7） |
| 確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す | 満たす | 同じ → `OK` |
| 指しているパスが実在する | 満たす | 同じ → `OK`（無いパスは 0） |
| コード・テスト・設定・規約を `20b07dd` から変えていない | 満たす | `git diff --stat 20b07dd HEAD` → 変わったのは `account-design.md` の 1 ファイルだけ |

判定は、書いていないエージェントにさせた（1 回目の判定はブロッカー 1 件・中くらい 1 件。直したあとに 2 人で再判定し、2 人とも 8 項目すべて「満たす」・ブロッカーなし）。

### やったこと
- Issue #17 と元の文書（ADR 0002・core-foundation-design・failure-case-test-plan・operations-security・api-contract・openapi・CLI モック・`src/`・`test/`・構想 §5）を読み、`docs/guides/working/account-design.md` を書いた（§0〜§12）。
- 判定役の指摘を反映した:
  - §7 の試験の手伝い `bearer` は、本文の ID が `validId` に合わないとき `demo-rpg`/`p1` に戻す。これで 400 を期待する既存の 2 本が 401 に変わらない。
  - S1 の試験の名前の正である `api-schema-design.md` §4 を、契約を変える所の一覧に足した。
  - スキーマの試験 2 本の置き場を `schema-conformance.test.ts` にした。
  - 崩れた本文に正しい署名を付けたトークンの作り方を書いた。

### コミット
- 38d998d docs: アカウント（ゲストの最小形）の設計書を書く（ロードマップ Phase 1・Issue #17）
- 5d3e7db docs: アカウントの設計書の見直しを反映（試験の手伝いの代わりの ID の条件・S1 の名前の正の文書・試験の置き場）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 推しの案:
  - アカウントは `src/core/` に置き、`game_modules` で使う・使わないを切らない。
  - トークンは HMAC-SHA256 の自己完結の形（Web Crypto）・期限 30 日・更新はしない。
  - 鍵は `AUTH_TOKEN_SECRET`。無いときは `APP_ENV=local` の場合だけ、ローカル用の既定の鍵を使う。
  - 本文の `playerId` は残し、トークンと違えば 403 `PERMISSION_DENIED`。
  - いまの CLI モックの要求（トークン無し）は A2 で断り、CLI モックと互換の試験を同じ束で直す。
  - エラーコードを 3 つ足す。
  - 送信 ID と 429 は後に回す。
  - パスは `/v1/` のまま。

  違っていたら、設計書 §8 の推しを差し替え、§2〜§9 を直す新しいコミットで戻す。
- ゲストの発行の応答は 200 にした（いまの POST と同じ。§8 の決めること 10）。

### やらなかったこと・断られた操作
- 実装（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/`）はしていない（Issue の範囲の外）。
- 確認コマンドは丸ごとは回していない。文書を見る部分だけを `/tmp/partial-check-17.mjs` で回した。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `test/schema-conformance.test.ts` の `beforeEach` は `accounts`・`game_players` の行を消さない。行の数を見る試験はほかのファイルにあるのでいまは問題ないが、A1 の実装の時に気をつける。
- 判定役から出た小さな提案（設計書に `Statement` の型の `first` を書き足す）は入れていない。

