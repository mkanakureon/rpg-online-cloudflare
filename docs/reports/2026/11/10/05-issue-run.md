# Issue の無人実行のまとめ（20261110-213656）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-213656/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #72 G2: 仕分けの試験の残りと batch の文の数の試験を足し、試験のスキーマの確かめに type の配列と minItems を見せる（挙動を変えない。堅めの設計書の G2） | NOT-PASS | 9 | 2026-11-10 21:37〜21:46 | 4 | 1 |  |

## #72 G2: 仕分けの試験の残りと batch の文の数の試験を足し、試験のスキーマの確かめに type の配列と minItems を見せる（挙動を変えない。堅めの設計書の G2） — NOT-PASS

理由: 4 回で合格しなかった。最後の理由: 報告ファイルが「## 結果: 合格」になっていない。判定表で未合格の条件を満たす。最後の返答: …変わっていません。

- **足りない試験:** `ヘルスチェックはDBの失敗でINTERNAL_ERRORの500を返す` の 1 本です。`/health` が DB を読まないので、`src/` を変えない限り通りません（実測 `expected 200 to be 500`）。
- **止めた理由:** Issue は `src/` の変更も試験を弱めることも禁じ、新しい試験が落ちたら未合格で止めると決めています。満たしていない条件を「合格」とは書きません。
- **済んでいる分:** ほかの 10 本は足してあり、全体で `Result: PASS 440/440` です（コミット `16c50a2`）。

直し方を決めてください。推しは、別の Issue で `/health` に DB の確かめを足す案です。もう一つの案は、設計書とスキーマの説明をいまの挙動に書き直す案です。

- `16c50a2 test: 仕分けの試験の残りと batch の文の数の試験を足し、試験のスキーマの確かめに type の配列と minItems を見せる（#72。G2）`

### 結果: 未合格

試験 1 本（`ヘルスチェックはDBの失敗でINTERNAL_ERRORの500を返す`）が、いまの実装では通りません。`GET /health` は DB を読まずに 200 を返すからです（`src/core/router.ts` の 20〜22 行目）。Issue の「先に決めておくこと」に従い、実装は直さず、試験も弱めずに止めました。ほかの条件はすべて満たしています。

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `PlayerDataWrite.changes` に `minItems: 1` があり、base からの変更はそれだけ | 合格 | `git diff cd2f6f2 --stat` で `openapi/rpg-online.v1.json` は 1 行の追加だけ（`"minItems": 1,`） |
| スキーマの突き合わせの試験のファイルから消した行は準備だけで、`beforeEach` が ranking_entries とお知らせのほかの表も消す | 合格 | このファイルの差分は追加だけ。`beforeEach` に `DELETE FROM` を 15 文足した（saves・event_claims・残高・BAN・プレイヤーデータの表・accounts など） |
| `APP_ENV=local` の守りが残っている | 合格 | `src/` に差分が無い |
| 型の確かめが通る | 合格 | `npm run typecheck` は exit 0（`g2-typecheck.log`） |
| テストの入口が PASS で、新しい 11 本と base の 430 本がある | **不合格** | `node scripts/test.mjs` → `Result: PASS 440/440`（`g2-full-test.log`）。内訳は base 430 本・新しい 10 本。足りない 1 本（ヘルスチェック）を足すと `expected 200 to be 500` で落ちる（下に実測） |
| base から変えないもの（src/・admin のスキーマ・clients/・scripts/・migrations/・既存の test/・文書・設定） | 合格 | diffstat は `openapi/rpg-online.v1.json`・`test/hardening.test.ts`（新しいファイル）・`test/schema-conformance.test.ts`・`test/support/schema-check.ts` の 4 つだけ |

判定は別のエージェントに頼み、ログと差分を読ませました。結果も同じで、不合格は条件 5 だけです。足した 10 本は名前どおりのことを見ている、という判定でした。

### 実測（ヘルスチェックの 1 本）

`test/hardening.test.ts` に次の試験を書いて回しました。

```ts
it('ヘルスチェックはDBの失敗でINTERNAL_ERRORの500を返す', async () => {
  const res = await worker.fetch(new Request(`${base}/health`), { ...baseEnv, DB: brokenDB } as never);
  const text = await expectInternalError(res);   // 500 と { error: { code: 'INTERNAL_ERROR', ... } }
  expect(text).not.toContain('D1_ERROR');
});
```

結果は `× ヘルスチェックはDBの失敗でINTERNAL_ERRORの500を返す`・`AssertionError: expected 200 to be 500`・`Result: FAIL (30/31)` でした。
`GET /health` は DB を読まないので、DB が壊れていても 500 は起きません。公開のスキーマの getHealth の 500 の説明「想定外の失敗（DB の失敗など）」と、設計書 §7 の #12 が、いまの実装と合っていません。

### やったこと

- `openapi/rpg-online.v1.json`: `PlayerDataWrite.changes` に `minItems: 1` を足した。
- `test/support/schema-check.ts`: `type` の配列（`['string','null']`）と `minItems` を見るようにした。`type` が名前でも名前の配列でもなければ例外にする。
- `test/schema-conformance.test.ts`: 次の 3 つを足した。
  - `beforeEach` で、プレイヤーの行と、試験が足した `schema-*` のイベントを消す。
  - 自己試験の表に `minItems` と `type` の配列の 2 行。
  - 新しい試験 2 本（`試験のスキーマの確かめはtypeの配列とminItemsを見る`・`スキーマの突き合わせの試験は前の試験の行に左右されない`）。
  - 順の試験は、`beforeEach` を直す前に回して落ちることを確かめた（accounts 1・saves 11・player_activity_days 7 などが残っていた）。直した後は PASS。
- `test/hardening.test.ts`（新しいファイル）: G2 の試験を 8 本足した。
  - 本文が配列なら 400
  - 鍵が短い環境での 500
  - セーブの 1 つの読み取りと削除の 429
  - BAN で断った要求も遊んだ日に数える
  - BAN されていても上限を超えれば 429
  - 無い品目への負の増減は 404
  - 監査の request_key
  - 63 文の batch

### コミット

- `16c50a2` test: 仕分けの試験の残りと batch の文の数の試験を足し、試験のスキーマの確かめに type の配列と minItems を見せる（#72。G2）

### 選んだこと（自分で決めた点・違っていたときの戻し方）

- **ヘルスチェックの試験はコミットに入れなかった。** main で落ちる試験を残さないためです。試験のコードは上の「実測」に残したので、`test/hardening.test.ts` に戻せばそのまま使えます。
- **試験の置き場を分けた。** スキーマに関わる 2 本は `test/schema-conformance.test.ts`、残りは新しい `test/hardening.test.ts` です。違っていたら、`it` をほかのファイルへ移すだけで戻せます。
- **順の試験はファイルの最後に置いた。** そこで、前の試験が書く表が空であることを見ます。それより前の試験は accounts・saves などに行を残すので、この形で消し忘れを捕まえられます。
- **鍵が短い環境の「書き込み」は 4 つの口で見た。** セーブの PUT・スコアの投稿・プレイヤーデータの POST・トークンの更新です。

### やらなかったこと・断られた操作

- ヘルスチェックの試験は足していない（理由は上）。直し方はユーザーが決めます。案は 2 つです。
  - **A（推し）:** 別の束で `/health` が DB を確かめるようにする（例: `SELECT 1`）。いまの試験名のまま通せて、公開のスキーマの 500 の説明とも合います。
  - **B:** 設計書 §7 の #12・§11 の試験名と、公開のスキーマの getHealth の 500 の説明を「DB を読まず 200」に書き直す。
- 断られた操作はありません。
- 終わる前の確かめ（Stop hook）に何度も押し返されたが、「合格」とは書いていない。Issue の「先に決めておくこと」が、試験が落ちたら実装も試験も変えずに未合格で止めると決めているため。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）

- `docs/guides/working/api-schema-design.md` の 55 行目にある「検証関数が見る語」の一覧に、`minItems` と `type` の配列が載っていない。この Issue で直してよい文書の範囲（試験の置き場を書いている所）の外なので、直していない。
- 設計書 §7 の #36 の「batch の後の読み直しの分かれ道」には、試験が無い。§11 に名前が無いので、条件の外として扱った。

