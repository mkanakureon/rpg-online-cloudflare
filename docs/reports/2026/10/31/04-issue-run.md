# Issue の無人実行のまとめ（20261031-125429）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261031-125429/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #36 Phase 2 の実装 O3: データ修正（所持品と通貨の付与と取り消し・スコアを消す・Idempotency-Key・台帳のモジュール） | PASS | 11 | 2026-10-31 12:54〜13:05 | 1 | 2 |  |

## #36 Phase 2 の実装 O3: データ修正（所持品と通貨の付与と取り消し・スコアを消す・Idempotency-Key・台帳のモジュール） — PASS

- `aa2a300 feat: 管理 O3 のデータ修正を足す（台帳のモジュール src/core/ledger.ts の LEDGER_SOURCES と 1 品目の増減の文・所持品と通貨の増減の POST と Idempotency-Key・スコアを消す DELETE・requestHash と parseAdjustment・events は種類の名前を LEDGER_SOURCES から読む・O3 の試験 15 本）（Issue #36）`
- `b8e9b6a docs: O3 の契約を先に書く（所持品と通貨の増減の POST とスコアを消す DELETE・INSUFFICIENT_BALANCE と IDEMPOTENCY_KEY_REUSED は管理の口だけ・event-reward-design.md §3 §14 の ledger.ts の行を admin-design.md §6 の決定に置き換え）（Issue #36）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `src/core/ledger.ts` があり git に入っている | 満たす | `git ls-files src/core/ledger.ts` に出る（コミット aa2a300） |
| `LEDGER_SOURCES`（eventClaim・admin）と 1 品目の増減の文 | 満たす | `src/core/ledger.ts:13`・`INSERT INTO inventory_ledger` を含む文が 4 つ（`adjustStatements`） |
| 管理の口が `../ledger` を読み込み、`audit.ts` に `requestHash` | 満たす | `src/core/admin/routes.ts` の import・`src/core/admin/audit.ts` の `requestHash` |
| events が `LEDGER_SOURCES` から読み、`'event-claim'` が残っていない | 満たす | `grep "'event-claim'" src/modules/events/index.ts` → 0 件 |
| `APP_ENV=local` の守りが残っている | 満たす | `src/core/guards.ts` は base から変更なし |
| 管理のスキーマに POST・DELETE・2 つのコード | 満たす | `openapi/rpg-online-admin.v1.json` の paths と ErrorCode |
| ゲームのスキーマに 2 つのコードを足していない | 満たす | `git diff --stat bc3d61e -- openapi/rpg-online.v1.json` → 差分なし |
| `docs/api-contract.md` に 2 つの口と 2 つのコード | 満たす | 「管理の API」の節に 2 つの口、「エラーレスポンス」に 2 つのコード（コミット b8e9b6a） |
| `event-reward-design.md` §3・§14 が `admin-design.md` §6 を指す | 満たす | 古い 2 行は grep で 0 件。`admin-design.md` §6 は 2 件 |
| CLI モックと `wrangler.jsonc` に管理の鍵・管理の口が無い | 満たす | grep `ADMIN_API_KEY\|/v1/admin` → どれも 0 件 |
| `npm run typecheck` が通る | 満たす | `npm run typecheck` → exit 0 |
| テストの入口が `Result: PASS` | 満たす | `node scripts/test.mjs` → `Result: PASS 240/240` |
| §8 の O3 の 15 本がある | 満たす | JUnit で 15 の名前がそれぞれ 1 回ずつ見つかり、failures は 0 |
| base の試験が全部残って通る | 満たす | base の試験 225 本の名前がどれも JUnit にある（225＋15＝240） |
| 守るもの（マイグレーション・core の 8 ファイル・ほかのモジュール・scripts・ゲームのスキーマ・既存の試験・設定・package.json）を変えていない | 満たす | `git diff --stat bc3d61e -- <守るもの>` に出たのは `test/admin.test.ts` と `src/modules/events/index.ts` だけ（どちらも変えてよいファイル） |

判定は別のエージェントに頼んだ。確認コマンドは回させず、差分・ログ・JUnit を読ませた。判定は「総合: 合格」。

### やったこと
- 契約の文書を先に直した: `docs/api-contract.md` に増減の口とスコアを消す口、管理の口だけのコード 2 つを足した。管理のスキーマに 2 つの操作と 4 つのスキーマを足し、ErrorCode に 3 つ足した。`event-reward-design.md` §3・§14 の旧文は新しい文に置き換えた。
- `src/core/ledger.ts` を新しく作った。中身は `LEDGER_SOURCES` と `adjustStatements`（§6 の 2〜5 文）。
- `src/core/admin/` に足したもの:
  - `audit.ts`: `requestHash`・`parseIdempotencyKey`
  - `parse.ts`: `parseAdjustment`
  - `routes.ts`: `POST /v1/admin/players/{playerId}/inventory` と `DELETE /v1/admin/rankings/{boardId}/entries/{playerId}`
- `src/modules/events/index.ts` は種類の名前を `LEDGER_SOURCES.eventClaim` から読むようにした。受け取りの 3 文は、実行される SQL が同じまま。
- `test/admin.test.ts` に O3 の 15 本を足した。既存の行と期待は変えていない。

### コミット
- b8e9b6a docs: O3 の契約を先に書く（…）（Issue #36）
- aa2a300 feat: 管理 O3 のデータ修正を足す（…）（Issue #36）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 監査の前と後は SQL の `json_object` で作った（O2 の BAN が D1 で同じ関数を使って通っていたので使えると判断した）。TypeScript で作る形にするなら、`routes.ts` の `insertAdjustAudit` を直せばよい。
- events の種類の名前は、定数を SQL の文字列に埋め込む形にした（bind にすると受け取りの 3 文の引数の並びが変わるため）。bind にするなら、`events/index.ts` の 2 文と bind の並びを直す。
- スコアを消す口の 200 の本文は、設計書に形が書かれていないので `{"gameId","boardId","playerId","deleted":true,"auditId"}` にした。変えるなら `routes.ts`・管理のスキーマの `AdminRankingDeleteResult`・`api-contract.md` の 3 か所を一緒に直す。
- 管理のスキーマの ErrorCode に `INVENTORY_LIMIT_EXCEEDED` も足した。既存の試験が「ErrorCode の列挙は、各口の x-error-codes を合わせたものと一致する」ことを求めているため。
- 増減の口での確かめの順は「共通の確かめ → `X-Admin-Actor` → JSON → `reason` → `Idempotency-Key` → `itemId`・`delta`」にした。順を変えるなら `routes.ts` と `api-contract.md` を直す。
- 増減の delta は、スキーマでは 0 を除く形（`not`）にしなかった。試験の検証関数が `not` を扱えないため、0 を除くことは説明に書いた。

### やらなかったこと・断られた操作
- 開発サーバーの起動と通しの確かめ（`cli:smoke`）はしていない。会話の側でやる。
- `docs/inspecs/2026/` は追跡外で、開始時からあった。触れていない。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 試験に足せるもの（判定役の指摘）。どれも合否には響かない:
  - 無い品目に負の delta を送ったときに 409 でなく 404 を返す、という順を見る行
  - batch と読み直しの間に残高が動いた場合の分かれ道
  - 監査の `request_key` が、送った鍵と同じ値か
- `docs/guides/working/architecture.md` には `src/core/ledger.ts` の置き場が書かれていない（§9 の表では O3 にこの文書は無い）。

