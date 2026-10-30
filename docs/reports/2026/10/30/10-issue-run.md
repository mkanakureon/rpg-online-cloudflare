# Issue の無人実行のまとめ（20261030-131540）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-131540/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #22 セーブ V2: セーブの一覧・削除（墓石）・スロットの上限を足す | PASS | 8 | 2026-10-30 13:15〜13:24 | 1 | 2 | Bash |

## #22 セーブ V2: セーブの一覧・削除（墓石）・スロットの上限を足す — PASS

- `5f1ea87 feat: セーブの一覧・削除（墓石）・スロットの上限（MAX_SLOTS・SLOT_LIMIT_EXCEEDED）と CLI モックの一覧を見て消す流れを足す（Issue #22）`
- `a2b044e docs: セーブ V2 の契約を先に直す（GET /v1/saves・DELETE /v1/saves/{slotId}・SLOT_LIMIT_EXCEEDED）（Issue #22）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `test/saves-manage.test.ts` があり git にコミット済み | OK | 5f1ea87 で追加（`git ls-files` に出る）。頭書きあり |
| CLI モックが一覧を見て消す・`APP_ENV=local` の守りが残る・セーブのルートが `MAX_SLOTS` を使う | OK | `scripts/cli-mock.mjs` に `GET /v1/saves` → `DELETE …&baseRevision=` → `GET` が 404。`src/core/guards.ts` は b1ca307 から差分なし。`src/modules/saves/index.ts` が `MAX_SLOTS` を import して使う |
| 置き換えた 2 本が `test/` と `api-schema-design.md` に無い・コードの一覧を比べる行が残る | OK | 名前で探して 0 件（node のスクリプト）。`test/schema-conformance.test.ts` に `expect([...seen].sort()).toEqual([...errorCodes].sort())` が残る |
| openapi に一覧・削除・`SLOT_LIMIT_EXCEEDED`、api-contract.md に `DELETE /v1/saves/{slotId}`・`SLOT_LIMIT_EXCEEDED` | OK | `paths['/v1/saves'].get`（listSaves）・`paths['/v1/saves/{slotId}'].delete`（deleteSave）・ErrorCode が 11 個。契約の文書に 2 つの節を足し、代表コードを 11 個にした |
| `npm run typecheck` が通る | OK | `tsc --noEmit` の終了コードが 0 |
| テストの入口が `Result: PASS`・V2 の 14 本と base の全試験（置き換えた 2 本を除く）がある・通る | OK | `node scripts/test.mjs` → `Result: PASS 110/110`。base の 98 本 − 置き換えた 2 本 + 新しい 14 本 = 110。足りない名前・重なる名前なし |
| マイグレーション・スコア・お知らせ・`src/core/`・手を入れない試験・`wrangler.jsonc`・`package.json` を変えていない | OK | 守るパスに `git diff --stat b1ca307 -- …` をかけて差分なし |

判定は別のエージェントがログ（test.log・junit.xml・typecheck.log）と差分を読んで出した。全部 OK・欠陥なし。

### やったこと
- 契約を先に直した: `openapi/rpg-online.v1.json` に `listSaves`・`deleteSave`・`SaveList`・`SaveListItem`・`SaveDeleted` を足し、ErrorCode に `SLOT_LIMIT_EXCEEDED` を足した。putSave の 409 にも同じコードを足した。`docs/api-contract.md` に GET 一覧と DELETE の節を足し、PUT の節に上限を書き、代表コードを 11 個にした。`docs/guides/working/api-schema-design.md` の §3 の操作の表・形の表・状態とコードの表、§4 の S1 の名前と確認コマンドの例を V2 に置き換えた。
- 実装: `src/modules/saves/validate.ts` に `parseRevision` を足した。`src/modules/saves/index.ts` に、DELETE（墓石にしてリビジョンを進める）と、一覧（GET /v1/saves）と、`MAX_SLOTS` の上限（409 `SLOT_LIMIT_EXCEEDED`）を足した。
- 試験: `test/saves-manage.test.ts` に 10 本を足した。`test/schema-conformance.test.ts` は 2 本を置き換え、`セーブの一覧と削除の応答はスキーマに合う` を足し、`errorCodes` に `SLOT_LIMIT_EXCEEDED` と、それを起こす行を足した。`test/failure-server.test.ts` に `CLIモックと同じ流れでセーブの一覧に出たスロットを消せる` を足した。
- CLI モック: 一覧 → 消す → 404 の流れを足した。DELETE の応答はそのまま出す（data もトークンも入らない）。

### コミット
- a2b044e docs: セーブ V2 の契約を先に直す（GET /v1/saves・DELETE /v1/saves/{slotId}・SLOT_LIMIT_EXCEEDED）（Issue #22）
- 5f1ea87 feat: セーブの一覧・削除（墓石）・スロットの上限（MAX_SLOTS・SLOT_LIMIT_EXCEEDED）と CLI モックの一覧を見て消す流れを足す（Issue #22）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- DELETE の `baseRevision` は数字だけの文字列（1〜16 桁）で、1 以上の安全な整数だけを通す。`1.5`・`-1`・空は 400 にした（違っていたら `parseRevision` の正規表現を直す）。
- 一覧の SQL に `LIMIT MAX_SLOTS` を付けた。スキーマの `maxItems: 10` に必ず収めるため（要らなければ、その行の `LIMIT` を外す）。
- 上限のときに墓石のスロットへ書き直すのは、新しいスロットと同じく `SLOT_LIMIT_EXCEEDED` にした。設計書 §3 の SQL のとおり。
- `api-schema-design.md` の §3 の状態とエラーコードの表は V1 の操作も抜けていたので、作る物の中として V1・V2 の操作を一緒に足した（戻すなら a2b044e のその表の差分だけ戻す）。

### やらなかったこと・断られた操作
- `npm run dev` と `npm run cli:smoke` の観測: 開発サーバーを裏で起動するコマンドが auto mode に断られた。観測記録は無い（合否には入れない）。`npm run db:migrate:local` は回せて「No migrations to apply!」だった。
- `docs/inspecs/2026/`（追跡外・人の文書）には触っていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- PUT と DELETE で行が返らなかったときの分け方（`hasLiveSlot`）は、書き込みとは別の問い合わせになっている。間に別の要求が入ると、返すコードが入れ替わることがある（409 の 2 つのコード、DELETE の 409 と 404）。どちらの場合も書き込みはしないので、データは壊れない。
- 将来 `MAX_SLOTS` を下げると、一覧の `LIMIT` のせいで、上限を超えた生きているスロットが一覧に出なくなる。

