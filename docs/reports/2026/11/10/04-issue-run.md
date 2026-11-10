# Issue の無人実行のまとめ（20261110-211123）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-211123/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #71 G1: 時刻を取る所を core の 1 つにまとめ、時計の境目と並べて送る試験を足す（挙動を変えない。堅めの設計書の G1） | PASS | 5 | 2026-11-10 21:11〜21:16 | 1 | 1 |  |

## #71 G1: 時刻を取る所を core の 1 つにまとめ、時計の境目と並べて送る試験を足す（挙動を変えない。堅めの設計書の G1） — PASS

- `7a9694b refactor: サーバーの時刻を取る所を core の serverNow 1 つにまとめ、時計の境目と並べて送る試験を足す（#71。G1）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| src/ で `Date.now(` は src/core/ の 1 か所だけ・引数の無い `new Date()` が無い | 合格 | 確認コマンドの静的な部分を node で実行: Date.now は `['src/core/clock.ts']`、new Date() は `[]` |
| `APP_ENV=local` の守りが残る・src/core/ がモジュールを読み込まない | 合格 | `src/core/guards.ts` は差分に無い。core がモジュールを読み込むファイルは `[]` |
| 型の確かめ | 合格 | `npm run typecheck` がエラー無し |
| `vi.useFakeTimers` を使わない | 合格 | src/・test/ で `useFakeTimers(` は `[]`。時計は `vi.spyOn(Date, 'now')` |
| テストが PASS・新しい 8 本がある・base の 422 本が通る | 合格 | `node scripts/test.mjs` → `Result: PASS 430/430`。`--filter 'G1'` → `Result: PASS 8/8`（test/clock.test.ts） |
| base から契約・クライアント・scripts・既存の試験・文書・設定・規約を変えていない | 合格 | `git diff --stat 0cb43c6 --` で該当のパスの変更は無い。test/ は新しいファイル `test/clock.test.ts` の追加だけ |
| 挙動を変えない | 合格（AI の判定） | 別のエージェントが差分を読んで判定。時刻の値・取る時点と順・SQL・応答は変わっていない |
| 試験の読みやすさ | ユーザーの最終判定 | — |

### やったこと
- `src/core/clock.ts` に `serverNow()`（UNIX 秒）を足した。src/ で時刻を取るのはここだけ。
- accounts（2 か所）・player-data・quests・events のモジュールにあった写しを `serverNow()` に置き換えた。admin/common の `serverNow` は `../clock` を読み直して渡す形にした（admin の 4 ファイルの import は変えていない）。auth・bans・rate-limit・activity の既定の引数は `serverNow()` を呼ぶ形にした。
- `test/clock.test.ts` に §11 の G1 の 8 本を足した。時計の境目・期限ちょうど・並べて送る、を確かめる。
- `docs/guides/working/event-reward-design.md` と `src/core/period.ts` の説明の文を、時刻を取る所（`serverNow`）に合わせた。
- 作った本人でない判定役（Agent）に、差分と上のログを読ませて判定させた。結果は全部合格。

### コミット
- 7a9694b refactor: サーバーの時刻を取る所を core の serverNow 1 つにまとめ、時計の境目と並べて送る試験を足す（#71。G1）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 時計の関数の名前と置き場は `src/core/clock.ts` の `serverNow` にした（admin で使っていた名前に揃えた）。違っていたら名前を変えて import を付け替える。
- admin/common の `serverNow` は消さず、`export { serverNow } from '../clock'` で読み直して渡す形にした。admin の口のファイルの変更を減らすため。admin のファイルから直に読むほうがよければ、各 import を `../clock` に付け替えてこの行を消す。
- 試験の境目は 2030-01-15 00:00 UTC にした（デイリーの区切りの境目で、60 秒の窓の境目でもある）。利用制限の試験には、上限が小さい（10 回）トークンの更新を使った。戻すときは test/clock.test.ts の定数を変える。

### やらなかったこと・断られた操作
- 並べて送る 3 本は、いまの実装のまま通った（ローカルの D1）。実装は直していない。
- 断られた操作は無い。開発サーバーは起動していない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 1 本目の試験の「全部の口」に、BAN の判定と管理の口の時刻は通しで入っていない（どちらも同じ関数を呼ぶことは grep の確かめで保証されている）。
- 並べて送る試験はローカルの D1 が要求を順に流すことに頼っている。本番の D1 での並びは保証しない（設計書 §6 の要確認のまま）。

