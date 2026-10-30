# Issue の無人実行のまとめ（20261030-145854）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-145854/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #26 利用制限とスコアの不正対策の設計書を書く（ロードマップ Phase 1） | PASS | 10 | 2026-10-30 14:59〜15:09 | 1 | 2 |  |

## #26 利用制限とスコアの不正対策の設計書を書く（ロードマップ Phase 1） — PASS

- `7ca69cf docs: 利用制限の設計書の見直しを直す（R1 の守るマイグレーションを 7 つ全部・R2 の確かめを consume に・K3 の入力の違いを明記・api-contract のログインの行・ローカルの no-ip の影響）（Issue #26）`
- `f10b302 docs: 利用制限とスコアの不正対策の設計書を書く（D1 の固定窓・ゲストの発行は IP とゲームごと・RATE_LIMITED と Retry-After・Idempotency-Key はいまの書き込みに掛けない・束 R1・R2）（Issue #26）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 設計書が `docs/guides/working/abuse-protection-design.md` にあり、コミット済み | 満たす | `git diff --stat 09b7f3c HEAD` → このファイルだけ（387 行）。コミット f10b302・7ca69cf |
| §0 にゴール・合格の条件、決めること（案と推し）・実装の束の節 | 満たす | 確認コマンドの文書の部分を写したもの（/tmp/part26.mjs）で全部 ok。§0・§10（8 項目）・§11 |
| 必要な語（ADR 0002・4 つの設計書・operations-security.md・failure-case-test-plan.md・429・Retry-After・Idempotency-Key・Durable Objects・D1・APP_ENV・scripts/cli-mock.mjs・CLAUDE.md）、ゲストの発行・スコアの不正対策の範囲 | 満たす | 同上で全部 ok（§4・§6） |
| K3 の残りの 2 本に名前で触れ、表に写さない | 満たす | 同上「k3 not copied」ok。§7 の K3 の割り当ての表（行は R で始まらない） |
| `スキーマのErrorCodeの列挙は11個のエラーコードと一致する`・`今のCLIモックと同じ形の要求を受け付ける` に名前で触れる | 満たす | 同上 ok（§8） |
| 試験の名前の表（R1 がある・重複なし・いまの test/ と重ならない） | 満たす | 同上: 17 行（R1 14・R2 3）、重複なし、重なりなし |
| 束ごとの確認コマンドの案（requireTests・gitClean に base） | 満たす | 同上 ok（§11 の R1・R2） |
| 指しているパスが実在する | 満たす | 同上 `missing []` |
| コード・テスト・設定・規約を 09b7f3c から変えていない | 満たす | `git diff --stat 09b7f3c HEAD` は設計書 1 つだけ。`git status` は人の置いた `docs/inspecs/2026/`（追跡外・触っていない）だけ |
| 判定役の判定（作っていない別のエージェント） | 全部 PASS | 合格の条件 9 つと「先に決めておくこと」(a)〜(f) をすべて PASS。軽い欠陥 6 つの指摘を受け、設計書の中のもの 5 つを 7ca69cf で直した |

### やったこと
- Issue #26 と元の文書（ADR 0002・roadmap・account／save／config の設計書・operations-security・failure-case-test-plan・api-contract）と `src/`・`test/`・`wrangler.jsonc` を読み、いまの挙動を確かめた。
- Cloudflare の Rate Limiting のバインディングを、公式の文書と、入っている wrangler 4.152.0 の `config-schema.json`（period は 10 か 60）・miniflare の実装で確かめた。確かめられないもの（D1 の上限・ローカルの `CF-Connecting-IP`・WAF のプラン・料金）は「要確認」と書いた。
- 設計書を書いた。中身: D1 の固定窓・ゲストの発行は IP（ハッシュ）とゲームごと・スコアとセーブはプレイヤーごと・`RATE_LIMITED` と `Retry-After`・`Idempotency-Key` はいまの 3 つの書き込みに掛けない・スコアの不正対策の範囲と限界・`APP_ENV` の守りは外さない・試験の名前・束 R1・R2 と確認コマンドの案。
- 判定役（別のエージェント）に判定させ、指摘を設計書に反映した。

### コミット
- f10b302 docs: 利用制限とスコアの不正対策の設計書を書く（Issue #26）
- 7ca69cf docs: 利用制限の設計書の見直しを直す（Issue #26）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 数える場所は D1 の表を推した（wrangler.jsonc もパッケージも変えずに済む）。違っていたら §10 の決めること 1 を B（Durable Objects）に替え、§3 と §11 を直す。
- `Idempotency-Key` はいまの書き込みに掛けない案を推した。そのため K3 の `同じ送信IDの二重送信は1回分として扱う` は、見出しを読まない実装でも通る試験になる。掛けるなら §5 と決めること 5 を B に替える。
- 回数の初期値（ゲスト IP 10 回／60 秒・ゲーム 300 回・スコア 30 回・セーブ 60 回）は §2 の表の推し。値を変えるときは、定数とこの表を一緒に直す。
- K3 の連投の試験は、上限まで数えた行を表に入れてから 1 回だけ送る形にした（窓の境目で結果が揺れないため）。計画の入力の書き方は R1 の Issue で置き換える（§7 に書いた）。

### やらなかったこと・断られた操作
- 実装（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/`）、CLAUDE.md・api-contract・operations-security の書き換えは、Issue の範囲の外なのでしなかった。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 判定役の指摘 3: `同じ送信IDの二重送信は1回分として扱う` は、中身が既存の `同じスコアを二重送信しても行は1つで結果は同じ` と重なる。`account-design.md` §10 の条件 2 を、中身より名前で満たす形になる（設計の選択として §5 に明記済み。ユーザーが決める）。
- `failure-case-test-plan.md` の K3 の連投の入力の書き方は、この設計（表に行を入れてから 1 回送る）と違う。守るファイルなので、R1 の Issue で直す。

