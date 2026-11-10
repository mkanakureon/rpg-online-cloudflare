# Issue の無人実行のまとめ（20261110-223612）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-223612/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #73 G3: ログに DB のエラーを出さない・LIMIT 50 の定数・Vary: Origin・区切りの宣言を読む所・管理コマンドの引数と、flags の並びと Vary の契約の文（契約を変えない内側の直し。堅めの設計書の G3） | PASS | 6 | 2026-11-10 22:36〜22:42 | 1 | 1 |  |

## #73 G3: ログに DB のエラーを出さない・LIMIT 50 の定数・Vary: Origin・区切りの宣言を読む所・管理コマンドの引数と、flags の並びと Vary の契約の文（契約を変えない内側の直し。堅めの設計書の G3） — PASS

- `5df54d0 fix: 入口のログに DB のエラーを出さず、お知らせの上限を定数に・ローカルの許さないオリジンにも Vary: Origin・add のキーがある書き込みだけ区切りの宣言を読む・管理コマンドの整数でない引数を送る前に止める（#73。堅めの G3）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `src/` の console にエラーの値をそのまま渡さない | 満たす | 確認コマンドの正規表現を node で再現 → `leaks []`。`src/worker.ts` は `errorName(err)`（名前だけ）を変数にしてから出す |
| `src/` の SQL に `LIMIT 50` を直書きしない | 満たす | 同 → `lit []`（`LIMIT ?` に `ANNOUNCEMENTS_LIMIT` を bind） |
| 契約の `flags` の行が並びは保証しないと書く | 満たす | 同 → `flags true` |
| 契約の CORS の節に「Vary: Origin」と「許さないオリジン」の行 | 満たす | 同 → `cors true` |
| `quest-design.md` に宣言を足した瞬間の書き込みは数えないことがある | 満たす | 同 → `quest true` |
| 公開のスキーマの変更は flags の説明だけ | 満たす | 同 → `spec true` |
| `APP_ENV=local` の守り・`src/core/` がモジュールを読まない | 満たす | 同 → `guard true`。`src/core/` の変更は core 内の読み込みだけ |
| 型の確かめ | 満たす | `npm run typecheck` → エラー無し |
| テストが PASS・新しい 5 本と base の 441 本 | 満たす | `node scripts/test.mjs` → `Result: PASS 446/446`。`--filter G3` → `Result: PASS 5/5` |
| base から変えていないもの | 満たす | `git diff --stat d69df05 -- test/ migrations/ clients/ docs/guides/{decisions,procedures,manuals} docs/adr hardening-design.md 設定類 CLAUDE.md .claude/ admin スキーマ` → 空。`scripts/` は `admin-cli.mjs` だけ変更（新しいファイル `admin-cli.d.mts` を足した） |
| ユーザーの最終判定（ログの文の中身・試験の読みやすさ） | 人が決める | ログは `Unhandled Worker error <エラーの名前>` だけ |

判定は別のエージェントが差分とログを読んで行った（全条件「満たす」）。

### やったこと
- `src/worker.ts`・`src/core/http.ts`: 入口の 500 のログはエラーの名前（`errorName`）と決まったラベルだけ。message・cause を出さない
- `src/modules/announcements/index.ts`: `ANNOUNCEMENTS_LIMIT = 50` を定数にして bind
- `src/core/cors.ts`: `local` で Origin のある要求が許さないオリジンのとき `Vary: Origin` だけを足す（`Access-Control-*` は今のまま）
- `src/modules/player-data/index.ts`: `hasAddKey` を足し、add のキーがある書き込みのときだけ `loadKeyPeriods` を読む
- `scripts/admin-cli.mjs`: `--limit`・`--before` は整数でなければ送る前に止める。`commands` を出し、起動した時だけ main を走らせ、`node:fs` は使う時に読む（試験が Workers のランタイムから読み込むため）。型の宣言 `scripts/admin-cli.d.mts` を足した
- 文書: `docs/api-contract.md`（flags の並び・CORS の Vary の行・お知らせの最大 50 件）、`openapi/rpg-online.v1.json`（flags の説明だけ）、`docs/guides/working/quest-design.md` §6（宣言を読む条件と、宣言を足した瞬間の書き込み）
- 試験: 新しいファイル `test/hardening-g3.test.ts` に 5 本

### コミット
- 5df54d0 fix: 入口のログに DB のエラーを出さず…（#73。堅めの G3）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `docs/api-contract.md` に「最大 50 件」が無かった（スキーマの summary にだけあった）ので、お知らせの節に「`items`は`id`の昇順で最大 50 件。」を 1 行足し、試験は契約とスキーマの summary の両方と突き合わせた。違っていたらその 1 行と試験の契約の突き合わせを消す
- 管理コマンドは `--before` も整数の確かめに入れた（Issue の「数の引数（`--limit` など）」）。違っていたら `optionalIntegerOf(f.before…)` を `Number` に戻す
- `errorName` は `src/worker.ts` でなく `src/core/http.ts` に置いた（Worker の入口に default 以外の書き出しを作らないため）

### やらなかったこと・断られた操作
- 断られた操作は無し。開発サーバーは起動していない。確認コマンドは丸ごと回していない（部分だけ再現）

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/guides/working/config-design.md:174` に「flags は名前の昇順に並べる」が残る（Issue が working の設計書で直してよい所を絞っているため触らない）
- `scripts/admin-cli.mjs` の起動の判定は argv[1] の末尾のファイル名で見るので、シンボリックリンクの別名から起動すると動かない

