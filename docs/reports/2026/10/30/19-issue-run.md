# Issue の無人実行のまとめ（20261030-221850）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-221850/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #31 所持品 E1: 所持品・通貨・受領の履歴を読む 2 つの口を足す（0009_inventory・RATE_LIMITS.rewards） | PASS | 11 | 2026-10-30 22:19〜22:29 | 1 | 2 |  |

## #31 所持品 E1: 所持品・通貨・受領の履歴を読む 2 つの口を足す（0009_inventory・RATE_LIMITS.rewards） — PASS

- `0886d71 feat: 所持品 E1 の 2 つの読む口を足す（0009_inventory・src/modules/inventory・RATE_LIMITS.rewards・試験 17 本・§9 の 3 本の置き換え）（Issue #31）`
- `3c790aa docs: 所持品と受領の履歴の 2 つの口を契約に足す（getInventory・listInventoryHistory・429・利用制限の表）（Issue #31）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 新しい 5 つのファイルがあり git に入っている | 満たす | `git status --short` で未追跡は `docs/inspecs/2026/` だけ。0886d71 に 5 つとも入っている |
| 所持品のモジュールが `consume` を呼ぶ | 満たす | `src/modules/inventory/index.ts` の checkAccess で `consume(env.DB, RATE_LIMITS.rewards, '<g>:<p>')` を呼ぶ |
| `rewards` が `src/core/rate-limit-policy.ts` にある | 満たす | `rewards: { scope: 'rewards', limit: 60, period: 60 }` |
| `APP_ENV=local` の守りが残っている | 満たす | `src/core/guards.ts` は base から差分なし。2 つの口とも最初に `requireLocalWrite` を通る |
| スキーマに `getInventory`・`listInventoryHistory` があり、どちらにも 429 `RATE_LIMITED` | 満たす | `openapi/rpg-online.v1.json` に足した（Retry-After つき）。試験 `スキーマのファイルはOpenAPI 3.1で13個の操作を持つ` が通る |
| `docs/api-contract.md` に 2 つの節と、「利用制限」の表の所持品の行 | 満たす | `## GET /v1/inventory?gameId=…`・`## GET /v1/inventory/history?…` の 2 節と、表の行 |
| `abuse-protection-design.md` §2 の表に所持品の行 | 満たす | §2 の表に `/v1/inventory` の行を足した |
| `architecture.md` に `src/modules/inventory/` の置き場 | 満たす | §4 のデータ境界に、所持品の表と置き場の行を足した |
| `npm run typecheck` が通る | 満たす | `tsc --noEmit` が exit 0 |
| テストの入口が `Result: PASS` | 満たす | `node scripts/test.mjs` → `Result: PASS 176/176` |
| 設計書 §8 の E1 の 17 本がある | 満たす | 14 本は `test/inventory.test.ts`、3 本は置き換えた名前で既存のファイルにある。名前を照らして、欠けは 0 |
| base の試験が残って通る・置き換えた 3 本の旧い名前が残っていない | 満たす | base の名前から 3 本を除いた中で欠けは 0。旧い 3 つの名前は 0 件 |
| 守るもの（既存のマイグレーション・core の 5 つ・ほかのモジュール・scripts・直さない試験のファイル・test/support・設定・package.json）を変えていない | 満たす | `git diff --stat 6433864 -- <守るもの>` の出力が空 |

判定は、別のエージェント（作っていない判定役）が私の実行ログと差分を読んで行った。結果は全部「満たす」で、欠陥は見つからなかった。

### やったこと
- 最初のコミットで契約を直した。`openapi/rpg-online.v1.json` に 2 つの操作と 4 つのスキーマを足し、`docs/api-contract.md` に 2 つの節と利用制限の行を足した。前置きの文は旧文を置き換えた。
- `migrations/0009_inventory.sql` を足した（設計書 §3 のとおり）。
- 定数を置いた。
  - `src/core/inventory.ts`（`MAX_ITEM_AMOUNT`・品目の種類）
  - `src/modules/inventory/limits.ts`
- `src/modules/inventory/shape.ts`（`shapeInventory`・`parseHistoryQuery`）と `index.ts`（2 つの `GET`。確かめの順は §4 のとおり）を作り、`src/modules/index.ts` に登録した。
- `RATE_LIMITS.rewards` を足した。
- 文書を直した: `abuse-protection-design.md` §2 と `architecture.md`。
- 試験:
  - 新しい `test/inventory.test.ts` に 14 本を置いた。
  - §9 の 3 本を置き換えた（schema-conformance・modules・game-modules）。
  - `利用制限の回数と窓は定数のモジュールにある` には `rewards` の行を足しただけ。
  - 変えた試験のファイルの頭書きの「正」を、`event-reward-design.md` §8 に置き換えた。

### コミット
- 3c790aa docs: 所持品と受領の履歴の 2 つの口を契約に足す（getInventory・listInventoryHistory・429・利用制限の表）（Issue #31）
- 0886d71 feat: 所持品 E1 の 2 つの読む口を足す（0009_inventory・src/modules/inventory・RATE_LIMITS.rewards・試験 17 本・§9 の 3 本の置き換え）（Issue #31）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- **履歴の `limit`・`before` を確かめる位置:** `requireGame` の後にした。§4 の「ゲームの登録と機能の設定 → 口ごとの確かめ」に合わせた。前に移すなら、`index.ts` の履歴の口で `parseHistoryQuery` を `checkAccess` の前へ動かし、契約の 1 文を直す。
- **続きの有無の見分け方:** `limit + 1` 行を引いて見分ける（続きが無ければ `nextBefore` を載せない）。戻すなら `index.ts` の 1 か所を直す。
- **`createdAt` の形:** UNIX 秒を秒までの ISO 8601（`…Z`）に直して返す（§3）。スキーマの `pattern` も同じ形にした。
- **試験の手伝い:** `test/support/` を直せないので、スキーマに当てる `expectConforms` の小さな版を `test/inventory.test.ts` の中に書いた。

### やらなかったこと・断られた操作
- E2（イベント・受け取り・`0010`・CLI モック）はやっていない（Issue の範囲外）。開発サーバーも起動していない。
- 断られた操作はなかった。
- 追跡外の `docs/inspecs/2026/` には触れていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `parseHistoryQuery` は `limit=007` のような先頭が 0 の数字を受け付ける（害は無い。セーブの `parseRevision` と同じ作り）。
- `migrations/0008_rate_limits.sql` の scope の注記に `rewards` が無い。既存のマイグレーションは書き換えられないので、そのままにした。

