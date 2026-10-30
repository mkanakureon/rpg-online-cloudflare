# Issue の無人実行のまとめ（20261030-192505）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-192505/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #29 利用制限 R2: セーブの 4 つの操作にプレイヤーごとの利用制限を掛ける（429・Retry-After） | PASS | 5 | 2026-10-30 19:25〜19:30 | 1 | 2 |  |

## #29 利用制限 R2: セーブの 4 つの操作にプレイヤーごとの利用制限を掛ける（429・Retry-After） — PASS

- `ab020d0 feat: 利用制限 R2 を足す（セーブの 4 つの操作をトークンのプレイヤーごとに合わせて数える RATE_LIMITS.saves・トークンの後 gameId の前で 429 RATE_LIMITED と Retry-After・試験 R2 の 3 本・セーブの試験のファイルの beforeEach に resetRateLimits）（Issue #29）`
- `d6ba01b docs: セーブの 4 つの操作の利用制限の契約を足す（api-contract の「利用制限」の表にセーブの行・4 つの節に 429 RATE_LIMITED と確かめの順・スキーマの 4 つの操作に 429 と Retry-After）（Issue #29）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `src/modules/saves/index.ts` が `consume` を呼ぶ・回数と窓が定数のモジュール・`APP_ENV=local` の守りが残る | 合格 | `checkAccess` で `requireAuth` の後・`gameId` の前に `consume(env.DB, RATE_LIMITS.saves, '<g>:<p>')` を呼ぶ。`RATE_LIMITS.saves` は `src/core/rate-limit-policy.ts`（変更なし）。`src/core/guards.ts` は変更なし（別のエージェントの判定役が差分を読んで確認） |
| スキーマのセーブの 4 つの操作に 429 `RATE_LIMITED`・契約の「利用制限」の表にセーブの行・PUT の節に 429 | 合格 | `openapi/rpg-online.v1.json` の listSaves・getSave・putSave・deleteSave に 429（`x-error-codes: [RATE_LIMITED]`・`Retry-After` は必須）。`docs/api-contract.md` の表にセーブの行。4 つの節に 429 と確かめの順（コミット d6ba01b） |
| `npm run typecheck` が通る | 合格 | `npm run typecheck` の終了コードは 0 |
| テストの入口が `Result: PASS`・R2 の 3 本と base の試験が全部ある | 合格 | `node scripts/test.mjs` → `Result: PASS 162/162`。base（3963241）の試験の名前 159 個と R2 の 3 本は全部 junit.xml にあり、足りないものは 0 |
| 守るファイルを 3963241 から変えていない | 合格 | `git diff --name-only 3963241` の対象は守る道すべてで出力が空。変えたのは契約の 2 つ・`src/modules/saves/index.ts`・`test/saves*.test.ts`（`beforeEach` に `resetRateLimits` を足しただけ）・新しい `test/saves-rate-limits.test.ts` |

### やったこと
- 契約: `docs/api-contract.md` の冒頭・「利用制限」の表・セーブの 4 つの節（429 と確かめの順）を直した。`openapi/rpg-online.v1.json` のセーブの 4 つの操作に 429 を足し、`info.description` も直した。
- 実装: `src/modules/saves/index.ts` の `checkAccess` で、設計書 §3 の順（門 → トークン → **プレイヤーの制限** → gameId → トークンのゲーム）どおりに `consume` を呼ぶ。4 つのルートはどれもここを通る。
- 試験: 新しい `test/saves-rate-limits.test.ts` に R2 の 3 本を置いた。`test/saves.test.ts`・`test/saves-manage.test.ts` は、`beforeEach` に `resetRateLimits` を足しただけ。`failure-server`・`schema-conformance` はすでに呼んでいたので変えていない。
- 判定は別のエージェントにさせた。ログと差分を読み、5 つの条件を全部合格と判定した。

### コミット
- d6ba01b docs: セーブの 4 つの操作の利用制限の契約を足す（Issue #29）
- ab020d0 feat: 利用制限 R2 を足す（Issue #29）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 制限は設計書 §3 の位置（`requireAuth` の後・`gameId` の前）に置き、順はずらさなかった。既存の試験は壊れなかった。壊れた DB の試験は 500 のままになる。設計書と `save-design.md` は直していない。戻すなら `checkAccess` の 3 行を動かす。
- 新しい試験のファイル名は Issue の指定に合わせて `test/saves-rate-limits.test.ts` にした。設計書 §7 の本文（201 行目）にある名前は `test/saves-limits.test.ts`。違っていたら `git mv` で名前を変える。

### やらなかったこと・断られた操作
- 開発サーバーの起動と `npm run cli:smoke` はしていない（Issue の指定。この回の後に会話の側で確かめる）。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/guides/working/abuse-protection-design.md` §7 の本文（201 行目）にある R2 のファイル名 `test/saves-limits.test.ts` が、Issue の指定 `test/saves-rate-limits.test.ts` と食い違っている（守るファイルなので、直すなら会話の側で）。
- `docs/guides/working/save-design.md` §3 の検査の順に、プレイヤーの制限（429）がまだ書かれていない（守るファイル。会話の側で足す）。
- 429 を直に確かめる試験は、GET の一覧と PUT にしかない。1 つのスロットの GET と DELETE は、同じ `checkAccess` を通ることだけが根拠になっている。

