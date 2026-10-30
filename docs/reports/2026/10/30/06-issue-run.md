# Issue の無人実行のまとめ（20261030-114244）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261030-114244/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #18 アカウント A1: ゲストの発行とトークン（Web Crypto の HMAC）を足す | PASS | 8 | 2026-10-30 11:43〜11:50 | 1 | 2 |  |

## #18 アカウント A1: ゲストの発行とトークン（Web Crypto の HMAC）を足す — PASS

- `ada2b30 feat: ゲストの発行と Web Crypto の HMAC のトークンを足す（アカウント A1・Issue #18）`
- `d8765cb docs: ゲストの発行（POST /v1/accounts/guest）の契約を先に書く（アカウント A1・Issue #18）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `migrations/0004_accounts.sql`・`src/core/token.ts`・`src/core/accounts.ts`・`test/accounts.test.ts` があり、コミットされている | 満たす | `git ls-files` に 4 つとも出る。ada2b30 で追加 |
| トークンは Web Crypto（`crypto.subtle`）の HMAC で署名する（パッケージを足さない） | 満たす | `token.ts` の `crypto.subtle.importKey`（HMAC・SHA-256）・`sign`・`verify`。`package.json`・lock の差分なし |
| `スキーマのファイルはOpenAPI 3.1で4つの操作を持つ` が `test/` と `api-schema-design.md` に残っていない | 満たす | `grep -rn "4つの操作" test/ docs/guides/working/api-schema-design.md` → 0 件（exit 1） |
| OpenAPI に `POST /v1/accounts/guest`・`api-contract.md` にその節・`architecture.md` §4 に `accounts`・`game_players` | 満たす | d8765cb。`issueGuest`・`GuestRequest`・`GuestIssued` を追加、契約の節と §4 の一覧を更新 |
| `npm run typecheck` が通る | 満たす | `tsc --noEmit` 終了コード 0 |
| `Result: PASS`・A1 の 14 本と既存の 4 本がある・通る | 満たす | `node scripts/test.mjs` → `Result: PASS 64/64`。check-lib の `requireTests`（18 本）を既存の junit に当てて `OK（全部満たす）` |
| `src/modules/`・`scripts/`・0001〜0003・ほかの既存の試験・`wrangler.jsonc`・`package.json` を `76cbde7` から変えていない | 満たす | `git diff --stat 76cbde7 -- <その一覧>` → 差分なし |

判定は別のエージェント（判定役）が差分・テストのログ・型のログ・設計書を読んで行い、7 つとも「満たす」、ブロッカーなし。

### やったこと
- 契約を先に直した（d8765cb）: `openapi/rpg-online.v1.json` に `issueGuest`・`GuestRequest`・`GuestIssued`、`docs/api-contract.md` に `## POST /v1/accounts/guest`、`api-schema-design.md` §3 の表と §4 の S1（`5つの操作`）・確認コマンドの案、`architecture.md` §4 に `accounts`・`game_players`。
- 実装と試験（ada2b30）: `migrations/0004_accounts.sql`、`src/core/token.ts`（`signToken`・`verifyToken`・`parseBearer`・`tokenSecret`・`TOKEN_TTL_SECONDS`・`LOCAL_DEV_TOKEN_SECRET`）、`src/core/accounts.ts`（`guestRoute`・`parseGuestRequest`）、`src/core/env.ts`（`batch`・`AUTH_TOKEN_SECRET?`）、`src/core/router.ts`（`/health` の次にゲストの発行）、`test/accounts.test.ts`（A1 の 12 本。`beforeEach` で `game_players`・`accounts` を消す）、`test/schema-conformance.test.ts`（1 本の置き換えと `ゲストの発行の応答はスキーマに合う` の追加だけ）。
- 観測記録（合否には入れない）: `npm run db:migrate:local` → `0004_accounts.sql ✅`。`npm run dev` を起動し、`POST /v1/accounts/guest {"gameId":"demo-rpg"}` → 200（`playerId` は UUID・`expiresAt` は 30 日後）、`{"gameId":"nope"}` → 404 `NOT_FOUND`。`npm run cli:smoke` → `PASS: local CLI smoke test`（A1 では CLI モックは変えていない）。開発サーバーは自分で止めた（8787 の待ち受けがないことを確かめた）。

### コミット
- d8765cb docs: ゲストの発行（POST /v1/accounts/guest）の契約を先に書く（アカウント A1・Issue #18）
- ada2b30 feat: ゲストの発行と Web Crypto の HMAC のトークンを足す（アカウント A1・Issue #18）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `verifyToken` は base64url を厳しく読む（戻して書き直すと元に戻らないものは外れ）。署名の最後の文字の使わないビットだけを変えたトークンも `bad_signature` にするため。違っていたら `token.ts` の `fromBase64url` の比較の 1 行を外す。
- `AUTH_TOKEN_SECRET` が空の文字列のときは「32 文字未満」として扱い `null` にする（既定の鍵へ戻さない）。違っていたら `tokenSecret` の `secret !== undefined` を空文字も除く形に変える。
- `GuestIssued.token` のスキーマに `pattern: ^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$` を付けた（本文の形は決めない）。違っていたら OpenAPI と `api-schema-design.md` §3 の行から外す。
- `architecture.md` §4 の予定の行 `players`（プラットフォーム認証済みのプレイヤー）を `accounts`・`game_players` に置き換えた（設計書 §3 の「一覧を置き換える」）。違っていたら d8765cb のその行を戻す。
- `api-schema-design.md` §3 の状態とエラーコードの表の 404 の行に、もともと OpenAPI にあった `listAnnouncements` も書き足した（挙動は変えない）。

### やらなかったこと・断られた操作
- 断られた操作はなし。
- 開発サーバーのログ `/tmp/issue18-dev.log`・差分 `/tmp/issue18.diff` などの追跡外の一時ファイルは消していない。
- A2 の範囲（スコアの投稿の認証・CLI モック・K3 の試験）はやっていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 鍵が無いときの 500（§3 の順 5）と、`batch` で片方だけ入らないこと（順 6）を見る試験はない（§6 が求めていない）。
- `src/worker.ts` の `console.error('Unhandled Worker error', err)` は DB のエラーをそのままログに出す。いまの SQL で `account_id` がエラー文に入る道はないが、「ログに出さない」を将来も守るなら見直す所。

