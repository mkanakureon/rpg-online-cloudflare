# Issue の無人実行のまとめ（20261110-225536）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-225536/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #74 G4: 本文を読む所を core の 1 つにまとめ、上限（セーブのほかは 16 KiB）を超える本文に 413 を返す（契約が変わる・足すだけ。堅めの設計書の G4） | PASS | 7 | 2026-11-10 22:55〜23:02 | 1 | 2 |  |

## #74 G4: 本文を読む所を core の 1 つにまとめ、上限（セーブのほかは 16 KiB）を超える本文に 413 を返す（契約が変わる・足すだけ。堅めの設計書の G4） — PASS

- `32c398c docs: 本文の大きさの上限の行の検査の位置を、各口の確かめの順に任せる（ランキングとゲストの発行では利用制限より前のため。#74）`
- `3b83c04 feat: 本文を読む所を src/core/body.ts の 1 つにまとめ、上限（セーブのほかは 16 KiB）を超える本文に 413 PAYLOAD_TOO_LARGE を返す（#74。堅めの G4）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 要求の本文を読む所が `src/core/` の 1 ファイルだけ | 満たす | 確認コマンドの 1 の部分だけ回した: 読む所は `src/core/body.ts` だけ（OK） |
| 公開と管理のスキーマで、本文を受け取る口が全部 413 `PAYLOAD_TOO_LARGE` を持つ。口の数・いまある応答は変えない。`ErrorCode` は `PAYLOAD_TOO_LARGE` を足すだけ | 満たす | 2 の部分: 両方のスキーマで missing・changed・enum が OK（公開 3 口・管理 11 口に 413 を足した。管理の `ErrorCode` に `PAYLOAD_TOO_LARGE` を足した） |
| `docs/api-contract.md` に「本文の大きさの上限」と 413 と 16 KiB（16,384 バイト）が同じ行にある。新しい `…_TOO_LARGE` を足さない | 満たす | 3 の部分: contract line OK・no new TOO_LARGE OK |
| `APP_ENV=local` の守りが残る・`src/core/` がモジュールを読み込まない | 満たす | 4 の部分: guard OK・core no modules OK |
| 型の確かめ | 満たす | `npm run typecheck` が exit 0 |
| テストの入口が PASS で、新しい 3 本と base の 446 本がある | 満たす | `node scripts/test.mjs` → `Result: PASS 449/449`（446 + 新しい 3 本。新しい試験は `test/hardening-g4.test.ts`） |
| base から守るものを変えていない | 満たす | `git diff eaf3bac --stat` に出るのは `docs/api-contract.md`・openapi の 2 本・src の 6 ファイル・新しい試験のファイルだけ |
| 上限の値 16 KiB でよいか | ユーザーが決める | 機械では見ない |

判定役（別のエージェント）がログと差分を読み、全部を「満たす」と判定した。止めない欠陥として 1 つ挙げた文書の誤りは直した（下の 2 つ目のコミット）。

### やったこと
- `src/core/body.ts` を足した。`readBytes`・`readText`・`readJson` と `MAX_JSON_BODY_BYTES = 16_384` を置いた。`Content-Length` が上限を超えれば読まずに 413 を返す。`Content-Length` が無いか嘘のときは、流れを上限まで読んで、超えた所で `cancel` して 413 を返す。JSON でなければ 400 `INVALID_JSON`。
- 本文を読む 5 か所を `readJson` に置き換えた。ゲストの発行・ランキングの POST・プレイヤーデータの POST・セーブの PUT（上限は `MAX_REQUEST_BYTES` のまま）・管理の `checkAdminWrite`。どこも前に本文を読んでいた位置で呼び、検査の順は変えていない。セーブの `readBody` は消した。`MAX_REQUEST_BYTES` は `saves/limits.ts` に名前のまま残した。
- openapi: 本文を受け取る口の全部に 413（`x-error-codes: [PAYLOAD_TOO_LARGE]`）を足し、管理の `ErrorCode` に `PAYLOAD_TOO_LARGE` を足した。
- `docs/api-contract.md`: 「本文の大きさの上限（413）」の行を 1 つ足し、各口の確かめの順に「本文の大きさ（413）」を入れた。管理の共通の文とコードの文も合わせた。
- 試験 `test/hardening-g4.test.ts`（新しい 3 本）と、変えた src のファイルの頭書き。

### コミット
- 3b83c04 feat: 本文を読む所を src/core/body.ts の 1 つにまとめ、上限（セーブのほかは 16 KiB）を超える本文に 413 PAYLOAD_TOO_LARGE を返す（#74。堅めの G4）
- 32c398c docs: 本文の大きさの上限の行の検査の位置を、各口の確かめの順に任せる（#74）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 手伝いは `src/core/body.ts` に置き、16 KiB の定数 `MAX_JSON_BODY_BYTES` は core の 1 つにして、各口が明示して渡す形にした。口ごとに別の名前の定数が要るなら、各モジュールの `limits.ts` に定義を移すだけで戻せる。
- 413 の `message` は、セーブと同じ `Request body too large` にそろえた。

### やらなかったこと・断られた操作
- 断られた操作は無い。`docs/guides/working/` の設計書は直していない（古い `req.json`・`readBody` の記述が無いことを grep で確かめた）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/api-contract.md` の「クライアントの決まり」の節に、16 KiB の口も `PAYLOAD_TOO_LARGE` を返すことが書かれていない（クライアントの層は変えない決めなので、範囲の外）。

