# Issue の無人実行のまとめ（20261024-185353）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261024-185353/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #12 API スキーマの束 S1: OpenAPI のスキーマ・検証関数・応答がスキーマに合う試験を足す | PASS | 6 | 2026-10-24 18:54〜18:59 | 1 | 1 |  |

## #12 API スキーマの束 S1: OpenAPI のスキーマ・検証関数・応答がスキーマに合う試験を足す — PASS

- `fa39b9c test: API スキーマ（OpenAPI 3.1）と自前の検証関数・応答がスキーマに合う試験 8 本を足す (#12)`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 3 つのファイルがあり git にコミットされている | 合格 | コミット fa39b9c で `openapi/rpg-online.v1.json`・`test/support/schema-check.ts`・`test/schema-conformance.test.ts` を足した。`git status --short` は空 |
| スキーマが §3 の名前（Health.status.const が "ok"・ErrorCode が 5 つ・応答は additionalProperties: false・ScoreSubmission は true） | 合格 | `components.schemas` は §3 の 10 個の名前だけ。`operationId` は 4 つ。別のエージェントがファイルを読んで確かめた |
| S1 の試験 8 本が通り、全部で 34 本 | 合格 | `node scripts/test.mjs --file test/schema-conformance.test.ts` → `Result: PASS 8/8`。`node scripts/test.mjs` → `Tests 34 passed (34)`・`Result: PASS 34/34` |
| 試験が本当にスキーマを見ている（書き換えると落ちる） | 合格 | 一時に書き換えて `--filter` で回し、そのあと戻した（`cmp` で元と同じことを確かめた）。Health の const を "ng" にすると `GET /healthの応答はスキーマに合う` が `Result: FAIL (0/1)`。ErrorCode から INTERNAL_ERROR を抜くと、`スキーマのErrorCodeの列挙は5つのエラーコードと一致する` と `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` がどちらも `Result: FAIL (0/1)` |
| `docs/api-contract.md` が `openapi/rpg-online.v1.json` を指す | 合格 | 「形の正はスキーマ（`openapi/rpg-online.v1.json`）、挙動の説明の正はこの文書」の 1 行だけを足した |
| `npm run typecheck` が exit 0 | 合格 | `npm run typecheck` → exit 0 |
| 守るファイルを f2f4d67 から変えていない | 合格 | `git diff --stat f2f4d67 -- src migrations package.json package-lock.json wrangler.jsonc vitest.config.ts tsconfig.json test/health.test.ts test/failure-input.test.ts test/failure-server.test.ts test/apply-migrations.ts` の出力は空 |

判定は、実装していない別のエージェントが、上の実行記録と差分 fa39b9c を読んで行った（確認コマンドは回させていない）。結論は全部の条件で合格・ブロッカーは無し。

### やったこと
- `openapi/rpg-online.v1.json` を作った。OpenAPI 3.1.0 で、操作は 4 つ、`components.schemas` は §3 の名前だけ。
  - 状態とエラーコードの組は、各応答の `x-error-codes` に書いた。
  - 応答のヘッダーは `Cache-Control: no-store` を書いた。
  - `charset=utf-8` は `info.description` に書いた。
  - `displayName` の長さを `.length` で数えることは、その欄の `description` に書いた。
- `test/support/schema-check.ts` を作った。パッケージを足さない検証関数で、§2 の 14 語だけを見る。
  - 知らない語や `components.schemas` の外を指す `$ref` があると、例外を投げる。
  - 文字列の長さは `.length` で数える。
- `test/schema-conformance.test.ts` を作った。§4 の S1 の 8 本で、名前は表の文のまま。
  - L2 の試験は、状態・ヘッダー・本文を、スキーマのその操作のその状態の応答に当てる。
  - エラーの試験は、5 つのエラーコードを 10 とおりの要求で起こす。500 は偽の DB で起こす。
- `docs/api-contract.md` に 1 行を足した。
- テスト・型の確かめ・スキーマの書き換えで落ちることの確かめを実行し、別のエージェントに判定させた。

### コミット
- fa39b9c test: API スキーマ（OpenAPI 3.1）と自前の検証関数・応答がスキーマに合う試験 8 本を足す (#12)

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `x-error-codes` は、応答のオブジェクト（`responses["400"]` など）の直下に置いた。違っていたら、置き場をスキーマと `expectConforms` の 2 か所で直す。
- `displayName`・`score`・`Cache-Control` の形は、使う所ごとにその場で書いた。共通の名前にして `components.schemas` に置くと、§3 にない名前が増えるため。共通にしたいなら、§3 の表に名前を足してから `$ref` に替える。
- JSON の import のための型の宣言のファイルは足さなかった。いまの `tsconfig.json` のままで typecheck が exit 0 だったため。
- `limit` の「数字だけの文字列を整数に直してから見る」処理は、S1 に入れなかった。クエリを検証する S2 で足す。

### やらなかったこと・断られた操作
- S2・S3 はやらなかった。`src/` の変更とパッケージの追加もしていない。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 設計書 §2 には「JSON の import は `resolveJsonModule` で型が通る」とあるが、`tsconfig.json` にその設定は無い。実際は TypeScript の既定で通っている。§2 の文を直すとよい。
- `getHealth` の 500 と、`Object required` の 400 を起こす試験は無い。S1 の条件（5 つのコードを 1 つずつ起こす）は満たしている。

