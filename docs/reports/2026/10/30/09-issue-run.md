# Issue の無人実行のまとめ（20261030-125048）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-125048/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #21 セーブ V1: セーブを書く・読む API（リビジョン・チェックサム・上限）を足す | PASS | 9 | 2026-10-30 12:51〜13:00 | 1 | 3 | Bash |

## #21 セーブ V1: セーブを書く・読む API（リビジョン・チェックサム・上限）を足す — PASS

- `8fa98ef docs: スキーマの設計書の操作の表にセーブを足し、CLI モックのセーブの表示を size と revision だけにする（Issue #21）`
- `d776a46 feat: セーブを書く・読む API（リビジョン・チェックサム・64 KiB の上限）と CLI モックの流れを足す（Issue #21）`
- `ccf920c docs: セーブ V1 の契約を先に直す（PUT・GET /v1/saves/{slotId}・SAVE_CONFLICT・PAYLOAD_TOO_LARGE）（Issue #21）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0005_saves.sql`・`src/modules/saves/` の 4 ファイル・`test/saves.test.ts` があり、コミット済み | 合格 | `git ls-files` で 6 ファイルとも追跡されている（コミット d776a46） |
| チェックサムは `crypto.subtle.digest` で計算／`requireLocalWrite` と `requireAuth` を通す／`APP_ENV=local` の守りが残る／消した印の列がある | 合格 | `src/modules/saves/checksum.ts` が `crypto.subtle.digest('SHA-256', …)` を使う。`index.ts` の `checkAccess` が門 → トークンの順に通す。`src/core/guards.ts` は未変更。`0005` に `deleted` の列がある |
| CLI モックがセーブを書いて読み、`crypto.subtle` で計算する | 合格 | `scripts/cli-requests.mjs` に `sha256Hex`（crypto.subtle）がある。`cli-mock.mjs` が `PUT`→`GET /v1/saves/cli-smoke` を通す。試験 `CLIモックと同じ流れでゲストのセーブを書いて読み直せる` が PASS |
| 置き換える 4 本が `test/` と `api-schema-design.md` に残らない／`seen` と `errorCodes` を比べる行が残る | 合格 | 自分の照合スクリプトで `replaced left []`。`api-schema-design.md` の旧い名前は 0 件（grep -c）。比べる行は消していない |
| OpenAPI に `PUT`・`GET /v1/saves/{slotId}` と `SAVE_CONFLICT`・`PAYLOAD_TOO_LARGE`、契約にセーブの節がある | 合格 | `putSave`・`getSave` と `ErrorCode` の 10 個がある。`docs/api-contract.md` に `## PUT/GET /v1/saves/{slotId}` の節がある（ccf920c） |
| `npm run typecheck` が通る | 合格 | `tsc --noEmit`・exit 0 |
| テストの入口が `Result: PASS`、§7 の V1 の 27 本と、aa5ab59 の試験の全部（4 本を除く）がある | 合格 | `node scripts/test.mjs` → `Result: PASS 98/98`。JUnit と照合して、必要な名前の欠けは 0 件（V1 の 27 本と base の 71 本） |
| スコア・お知らせ・認証・既存のマイグレーション・手を入れない試験・`wrangler.jsonc`・`package.json` を変えていない | 合格 | 守るパスについて `git diff --stat aa5ab59 -- …` を取ると空 |

判定は別のエージェント（判定役）がした。ログ・差分を読み、8 つとも合格とした。

### やったこと
- 契約を先に直した（ccf920c）:
  - `openapi/rpg-online.v1.json` に `getSave`・`putSave`・`SaveWrite`・`SaveMeta`・`Save` を足し、エラーコードを 2 つ足した。
  - `docs/api-contract.md` にセーブの節を足し、代表コードを 10 個にした。「将来予定」の `PUT/GET /v1/saves/{slot}` の行を消した。
  - `api-schema-design.md` の S1 の名前を置き換えた。
  - `core-foundation-design.md` の M1・M3 の名前を置き換えた。
  - `architecture.md` の §1・§2・§4 で、セーブを D1 に置くことと `saves` の表を書いた（「R2: セーブデータ」を置き換えた）。
- 実装と試験（d776a46）:
  - `0005_saves.sql` と `src/modules/saves/`（limits・checksum・validate・index）を足した。`Route.method` に PUT・DELETE を、`modules` に saves を足した。
  - CLI モックにセーブの流れを足した。
  - `test/saves.test.ts`（21 本）を足した。§8 の 4 本を置き換え、エラーコードの試験に 2 行足した。
  - セーブのスキーマの試験と、CLI の流れの試験を足した。
- 判定役の指摘から直した（8fa98ef）: `api-schema-design.md` §3 の操作の表を 7 つにした。CLI モックのセーブの表示を `size`・`revision` だけにした（設計書 §6 のとおり）。契約の文の区切りも直した。
- 観測（合否には入れない）:
  - `npm run db:migrate:local` で `0005_saves.sql` が当たった（✅・3 commands）。
  - `npm run dev` と `npm run cli:smoke` は試せていない。開発サーバーを起動するコマンドが断られた（下の「断られた操作」）。

### コミット
- ccf920c docs: セーブ V1 の契約を先に直す（PUT・GET /v1/saves/{slotId}・SAVE_CONFLICT・PAYLOAD_TOO_LARGE）（Issue #21）
- d776a46 feat: セーブを書く・読む API（リビジョン・チェックサム・64 KiB の上限）と CLI モックの流れを足す（Issue #21）
- 8fa98ef docs: スキーマの設計書の操作の表にセーブを足し、CLI モックのセーブの表示を size と revision だけにする（Issue #21）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 本文のバイト数は `req.arrayBuffer()` で数えてから UTF-8 に戻した。設計書は `req.text()` と書くが、バイト数で比べる意味は同じ。違っていれば `readBody` を `text()` と `utf8Size` に書き換える。
- `limits.ts` に `MAX_SLOTS = 10` を置いた（設計書 §2 の定数の表のとおり）。使う所は無い。Issue の「`MAX_SLOTS` は作らない」を厳しく読むなら、この 1 行を消す。
- core-foundation-design.md は、§4 の表の名前だけを置き換えた。§5 の確認コマンドの記録は変えていない（設計書 §3 が「M1・M3 の行」と書くため）。違っていれば同じ名前を §5 でも置き換える。
- 新しい試験 `セーブの読み書きの応答はスキーマに合う` は、`beforeEach` を変えず、試験の頭で `p1` のセーブを消す形にした（既存の試験の変更を許された範囲に抑えるため）。

### やらなかったこと・断られた操作
- 断られた: `npm run dev` をバックグラウンドで起動 → `npm run cli:smoke` → 止める、を 1 つのコマンドで回そうとして断られた。そのため CLI モックの実機での通しは見ていない。代わりに同じ流れを L2 の試験 `CLIモックと同じ流れでゲストのセーブを書いて読み直せる` で見ている（PASS）。
- `docs/inspecs/2026/`（追跡外）には触れていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- Issue の「`MAX_SLOTS` は作らない」と、設計書 §2 の「`limits.ts`（V1）に `MAX_SLOTS`」が食い違っている。V2 の Issue を作るときに、どちらの文を正にするか揃える。
- `core-foundation-design.md` §5 の確認コマンドの記録に、置き換える前の名前が残っている（記録として残すか、決めておく）。

