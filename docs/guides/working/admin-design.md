# 管理の最小機能（管理の鍵・監査のログ・BAN・データ修正・イベントの定義）の設計書

`docs/guides/decisions/roadmap.md` Phase 2 の「管理コマンド／管理画面の最小機能（ログ・BAN・データ修正）」の設計書。`docs/guides/working/event-reward-design.md` §13 が順 1 に置いた。

管理の口の形と管理画面の扱い・管理の鍵（渡し方・置き場・比べ方・取り替え）・監査のログ・BAN と、止めた人の要求への応答・データ修正（所持品と通貨の付与と取り消し・スコアとセーブの扱い）・イベントの定義の入れ方・付与の文を `src/core/ledger.ts` へ移すか・試験の名前・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`。ゲーム固有のルールを共通のサーバーに入れない）と、これまでの設計書の決定: `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・`tenant_id` を持たない・機能の設定 `game_modules` は認可の代わりにしない）・`docs/guides/working/account-design.md`（トークン `v1.<本文>.<HMAC>`・プレイヤーはトークンの `p` だけで決まる・`requireAuth`）・`docs/guides/working/save-design.md`（リビジョン・墓石）・`docs/guides/working/config-design.md`（マスターデータはサーバーが解釈しない）・`docs/guides/working/abuse-protection-design.md`（D1 の固定窓の `consume`・`Idempotency-Key` の後から足す形）・`docs/guides/working/event-reward-design.md`（一意の鍵と 1 つの `batch`・受領の履歴 `inventory_ledger` の `source_type`）。これらは「決めること」に戻さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

運営する人（ゲームの作者。とその代わりに動く無人の Claude）が、§8 の試験の名前を `requireTests` に渡して実装の Issue を O1〜O4 の順に回し、**ローカルの管理コマンドが管理の鍵を付けて管理の口を呼び、1 人のプレイヤーの所持品・セーブの一覧・スコアを読み、間違って配った通貨を取り消し（受領の履歴に `source_type = 'admin'` の負の行が残り、残高は 0 未満にならない）、同じ修正を 2 回流しても 1 回分にしかならず、迷惑なプレイヤーを BAN するとそのプレイヤーのトークンの要求が 403 で断られ、どの操作も監査のログに「誰が・いつ・何を・前と後」で残り、新しいイベントをマイグレーションを書かずに入れられる**のを見て、ゲームのクライアントに管理の鍵を持たせずに、運用で要る「直す・止める・入れる」が履歴に残る形でできると分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§11 に決めること（案と推し）、§12 に実装の束、§14 に範囲の外がある | 機械（Issue #33 の確認コマンド） |
| ADR 0002・元の文書（`roadmap.md`・`account-design.md`・`abuse-protection-design.md`・`event-reward-design.md`・`operations-security.md`・`architecture.md`）・`APP_ENV`・`requireAuth`・`inventory_ledger`・`source_type`・`Idempotency-Key`・D1・`.dev.vars`・`wrangler secret`・`scripts/cli-mock.mjs`・`CLAUDE.md` が出てくる。管理の鍵・BAN・監査・データ修正・イベントの定義・管理画面の扱いが出てくる | 機械（同上） |
| `APP_ENV` の守りを外す条件（`account-design.md` §10）に触れ、この設計で外さない（§10） | 機械（同上）と AI の判定 |
| Phase 2 の残りの項目（プレイヤーデータ・クエスト・分析）に触れている（§13） | 機械（同上） |
| `スキーマのErrorCodeの列挙は14個のエラーコードと一致する`・`今のCLIモックと同じ形の要求を受け付ける` に名前で触れている（§9） | 機械（同上） |
| §8 の表の束は `O1`〜`O4`。名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§12） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/`・`test/`・`migrations/` の下と、`scripts/`・`openapi/` の下に作るファイルの名前は、パスの形で書かない） | 機械（同上） |
| 管理の鍵をファイルに書かない・ゲームのクライアントに持たせない（§3）。データ修正が行を直に書き換えず履歴に残る（§6）。残高が 0 未満にならない（§6）。`APP_ENV` の守りを外さない（§10）。Cloudflare の数字・機能は確かめた所と「要確認」が分かれている（§1） | AI の判定（作っていない判定役が、§1〜§10 と `src/`・`migrations/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§12 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 挙動の変わる既存の試験は §9 の手続きだけで直す。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束。secret と Cron Triggers を足すことも含む）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（§10）。
- 管理の鍵の値をファイルに書かない。`.dev.vars` を作らない・編集しない（人が自分で書く。§3）。
- O4 の後、会話の側で人が `.dev.vars` に `ADMIN_API_KEY` を書き、`npm run db:migrate:local && npm run dev` と管理コマンドの通し（§7）と `npm run cli:smoke` を回して、両方が `PASS` で通るのを見る（無人の回では開発サーバーを起動しない）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

2026-10-31 の main（`0d0adef`）の `src/`・`migrations/`・`test/`・`scripts/`・`wrangler.jsonc` を読んで確かめた。

| 所 | いま |
| --- | --- |
| 管理の口 | 無い。書き込みの口は全部プレイヤーのトークン（`requireAuth`）で、プレイヤーは自分のデータにしか触れない |
| イベントの定義の入れ方 | 新しい番号のマイグレーション（`event-reward-design.md` §11 の決めること 7 の A）。`migrations/0010_events.sql` に demo-rpg の手本 |
| `requireAuth`（`src/core/auth.ts`） | トークンだけで決まり、**DB を引かない**。呼ぶのは 4 つのモジュール（rankings・saves・inventory・events） |
| 確かめの順 | saves・inventory・events は `requireLocalWrite` → `requireAuth` → `consume`（プレイヤーごと）→ `gameId` → トークンのゲーム → …。rankings の `POST` は `requireLocalWrite` → `requireAuth` → 本文の形（400）→ `consume` → `requireSamePlayer` → … |
| 本文の形の誤りを DB より先に返す試験 | `形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す`（`test/games.test.ts`。壊れた DB と正しいトークンでスコアを投稿して 400 を期待する） |
| 受領の履歴 | `inventory_ledger`（`migrations/0009_inventory.sql`）。`delta` は 0 でない整数（負も入る）・`source_type` は文字列（いまは `'event-claim'` だけ）・`source_id` |
| 残高 | `inventory_balances`。`CHECK (amount >= 0 AND amount <= 1000000000)`。0 の行は作らない（所持品の一覧は行をそのまま返す） |
| 付与の文 | `src/modules/events/index.ts` の受け取りの 3 文（受け取りの行・履歴・残高）。報酬の中身を `event_rewards` から SQL の中で読む |
| 利用制限 | `src/core/rate-limit.ts` の `consume`・`ipSubject`（`CF-Connecting-IP` のハッシュ）。回数は `src/core/rate-limit-policy.ts` の `RATE_LIMITS`（`guestIp`・`guestGame`・`score`・`saves`・`rewards`）。試験 `利用制限の回数と窓は定数のモジュールにある` が中身を `toEqual` で見る |
| エラーコード | 14 個（`test/schema-conformance.test.ts` の `errorCodes`。最後が `INVENTORY_LIMIT_EXCEEDED`） |
| スキーマの操作 | 15 個（試験 `スキーマのファイルはOpenAPI 3.1で15個の操作を持つ`） |
| 鍵 | `AUTH_TOKEN_SECRET`（トークンの署名。`src/core/token.ts` の `tokenSecret`。無ければ `local` だけ公開の既定の鍵、ほかは 500） |
| ゲームの登録の確かめ | `src/core/games.ts` の `loadGame`（登録と機能の設定）・`requireGame`（機能の設定まで見る） |
| CLI モック | `scripts/cli-mock.mjs` は健康 → 設定 → お知らせ → ゲスト → スコア → セーブ → イベントと所持品。要求の形の関数は `scripts/cli-requests.mjs`。管理の鍵を持たない |
| 試験の環境 | `vitest.config.ts` は `wrangler.jsonc` の設定でランタイムを作る。試験は `env`（`cloudflare:test`）を広げて `APP_ENV` を足した `localEnv` を `fetch` に渡す |

元の文書から引く決まり:

- `roadmap.md` Phase 2 の項目（上の段落）と Phase 4 の「管理画面・設定画面・サンプルゲームを同梱」。
- `event-reward-design.md` §6（消費を後から足す形: 負の `delta`・`Idempotency-Key` 必須・1 つの `batch`・足りなければ 409 `INSUFFICIENT_BALANCE`）・§11 の決めること 7（イベントの定義の入れ方。B のローカルの管理コマンド・C の管理の API）・§13 の順 1 の行（データ修正は `source_type = 'admin'`・管理の鍵と `APP_ENV` の守りを外す条件をここで決める・付与の文を `src/core/ledger.ts` へ）・§14（付与の文の共通化）。
- `account-design.md` §8 の決めること 2（トークンは自己完結。1 人だけ取り消す必要〔BAN〕が出たら B の表を足す）・§10（`APP_ENV` の守りを外す条件）・§11 の BAN の行（「B の表を足すか、`accounts` に止めた印を足して `requireAuth` で引く」の 2 案）。
- `abuse-protection-design.md` §5（`Idempotency-Key` の後から足す形: 表 `idempotency_keys`・同じ鍵で違う本文なら 422・書き込みと鍵の保存を同じ `batch`）。
- `docs/guides/decisions/operations-security.md` の 6（ログの保持期間・削除手順を決める）・7（`.dev.vars`・管理用キーを Git にコミットしない。Wrangler の Secrets で管理）・10（local／staging／production の DB と秘密を分ける）・ログ・監視の節（トークンやセーブの本文を記録しない）。
- `docs/guides/working/architecture.md` の 3（「ゲーム内に管理用APIキーを埋め込まない」）・4（作者ごとの独立 Worker・独立 D1）・5（クライアントの長期秘密鍵を安全とみなさない）。

Cloudflare の機能（2026-10-31。リポジトリに入っている wrangler 4.152.0 と `worker-configuration.d.ts` で確かめたものと、要確認のもの）:

- **`wrangler secret put <key>`**: Worker の秘密の値を作る・変える（`npx wrangler secret put --help` の出力で確かめた）。本番の管理の鍵はこれで渡す。値を変えてから全部の場所で効くまでの時間は**要確認**。
- **`.dev.vars`**: `wrangler dev` が Worker の設定の隣の `.dev.vars` を読む（`node_modules/wrangler/wrangler-dist/cli.js` の `devVarsPath`）。`.gitignore` に `.dev.vars` と `.dev.vars.*` がある（git に入らない）。**`@cloudflare/vitest-plugin` が試験のランタイムに `.dev.vars` を読み込むか**は**要確認**。読み込むと、人が書いた `ADMIN_API_KEY` が試験の `env` に入るので、§8 の試験は鍵の有無を `env` に明示して渡す（`ADMIN_API_KEY: undefined` を含む）。
- **`crypto.subtle.timingSafeEqual(a, b)`**: Workers の型（`worker-configuration.d.ts`）にある。長さの違う 2 つを渡したときの振る舞い（投げるか）は**要確認**なので、§3 は両方を SHA-256 にして同じ長さ（32 バイト）で比べる。
- **D1 の JSON の関数（`json_object`）**: §5・§6 の監査の行の「前と後」を SQL の中で作るのに使う。D1 で使えるかは**要確認**。使えなければ、`batch` の前に読んだ値から TypeScript で作る（管理の操作は少なく、前の値の読み違いは監査の行にしか出ない。残高の守りは SQL の条件のまま）。
- **Cloudflare Access（Zero Trust）で `/v1/admin/` の前に人の確かめを置く**こと・**Workers Logs**: この設計では使わない。設定の方法と料金は**要確認**（§14）。
- D1 の書き込みの速さ・上限の数は**要確認**（`operations-security.md` の方針どおり数字を固定しない）。

## 2. 全体（管理の口・置き場・確かめの順）

| 部品 | 中身 | 束 |
| --- | --- | --- |
| 管理の HTTP の口（`/v1/admin/...`） | Worker の中のルート。管理の鍵が要る。入力の確かめ・履歴への記録・監査のログを Worker が持つ | O1〜O4 |
| ローカルの管理コマンド | `scripts/` の下に作る `admin-cli.mjs`（と要求の形の関数 `admin-requests.mjs`）。管理の HTTP の口を呼ぶだけの Node.js のスクリプト。D1 を直に触らない | O4 |
| 管理画面（ブラウザ） | Phase 2 では作らない。Phase 4（配布）の「管理画面・設定画面・サンプルゲームを同梱」へ送る（§11 の決めること 1） | — |

置き場（§11 の決めること 9）:

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/core/admin/key.ts` | `adminSecret(env)`・`requireAdmin(req, secret)`（§3。入出力の無い関数と Web Crypto だけ） | O1 |
| `src/core/admin/audit.ts` | 監査の行の文（§5。O1）・`parseActor`・`parseReason`（O2。書き込みの口で初めて使う）・`requestHash`（O3。増減の `Idempotency-Key` で使う）。入出力の無い関数 | O1〜O3 |
| `src/core/admin/routes.ts` | `adminRoutes`（ルートの一覧。O1〜O4 で行を足す）と共通の確かめ `checkAdmin` | O1 |
| `src/core/admin/parse.ts` | 本文の確かめ（増減・BAN・品目・イベントの定義）。入出力の無い関数 | O2〜O4 |
| `src/core/bans.ts` | `isBanActive(row, now)`・`requireNotBanned(env, claims)`（§4） | O2 |
| `src/core/ledger.ts` | 受領の履歴の種類の名前 `LEDGER_SOURCES`・1 品目の増減の文（§6） | O3 |
| `src/core/router.ts` | `[guestRoute, ...adminRoutes, ...モジュールのルート]` の順に当てる | O1 |

管理は「ゲームごとに使う機能」でなく運営の口なので、`src/modules/` の機能（`game_modules` の行）にしない。モジュールの一覧（`src/modules/index.ts`）は変えないので、試験 `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない` の名前は変わらない。管理のルートはモジュールを読み込まず、表を SQL で読み書きするだけにする（core は modules を読み込まない決まりのまま）。

### 確かめの順（管理の口で全部同じ。`checkAdmin`）

ルート → `requireLocalWrite`（403 `NOT_READY_FOR_PRODUCTION`）→ `adminSecret(env)` が無ければ投げる（入口の `try/catch` で 500 `INTERNAL_ERROR`）→ **管理の利用制限 `RATE_LIMITS.admin`（IP ごと。429 `RATE_LIMITED`・`Retry-After`）** → `requireAdmin`（`Authorization: Bearer <管理の鍵>`。外れは 401 `UNAUTHENTICATED`）→ `gameId` の形（400 `INVALID_ARGUMENT`）→ ゲームの登録（`loadGame`。無ければ 404 `NOT_FOUND` `Unknown game`。機能の設定は見ない）→ 書き込みの口は `X-Admin-Actor`・本文の `reason`（400）→ 口ごとの確かめ。

- 利用制限を鍵の確かめの前に置く: 鍵の当て推量を IP ごとの回数で抑えるため（ゲストの発行の `guestIp` と同じ考え）。正しい鍵でも数える。
- 管理の口はどのプレイヤーのトークンも読まない。プレイヤーのトークンを `Authorization` に入れて送っても、管理の鍵と合わないので 401。

## 3. 管理の鍵

**1 つの共有の鍵 `ADMIN_API_KEY`（Worker ごと）**（§11 の決めること 2）。

| `env.ADMIN_API_KEY` | `env.APP_ENV` | `adminSecret(env)` |
| --- | --- | --- |
| 32 文字以上の文字列 | どれでも | `ADMIN_API_KEY` |
| 無い・32 文字未満 | どれでも | `null`（使う側は投げて 500。**ローカルにも既定の鍵を持たない**） |

- **鍵の値をファイル（`wrangler.jsonc`・ソース・試験・文書）に書かない**（`CLAUDE.md` の「守るもの」・`operations-security.md` の 7）。ローカルは人が自分で `.dev.vars`（git に入らない）に `ADMIN_API_KEY=<32 文字以上>` を書く。staging・production は `wrangler secret put ADMIN_API_KEY` で渡す。無人の回は `.dev.vars` を作らない。
- トークンの鍵（`AUTH_TOKEN_SECRET`）と違い、`local` でも公開の既定の鍵に戻らない: 管理の口は他人のデータを書けるので、鍵を書き忘れた環境で誰でも通れる道を作らない。`local` で鍵が無ければ 500（`.dev.vars` を書き忘れたと分かる）。
- 試験は `fetch(要求, env)` に渡す `env` に、試験の中で作った 32 文字以上の値（例: `'a'.repeat(32)`。秘密でない試験用の値）を入れる。鍵の無い場合の試験は `ADMIN_API_KEY: undefined` を明示する（§1 の要確認）。
- 比べ方（`requireAdmin`）: `parseBearer`（`src/core/token.ts`）で取り出した値と `ADMIN_API_KEY` を、それぞれ SHA-256 にしてから `crypto.subtle.timingSafeEqual` で比べる（長さが中身で変わらず、文字列の `===` を使わない）。外れた理由（見出しが無い・違う）は応答に入れず、どちらも 401 `UNAUTHENTICATED` `Invalid admin credentials`。
- 取り替え: `wrangler secret put ADMIN_API_KEY` で新しい値を入れる（ローカルは `.dev.vars` を書き換えて `npm run dev` を起動し直す）。前の鍵はその時から 401（前の鍵を並べて受ける期間は作らない。管理する人は少なく、同時に持ち替えられる）。
- **ゲームのクライアント（CLI モック・UE・Unity・ブラウザ）に管理の鍵を持たせない**（`architecture.md`）。`scripts/cli-mock.mjs` と `scripts/cli-requests.mjs` には管理の鍵も管理の口も入れない（§7。O4 の確認コマンドが文字列で見る）。
- 管理コマンドは鍵を自分のプロセスの環境変数 `ADMIN_API_KEY` から読む。無ければ、行き先が `127.0.0.1`・`localhost` のときだけ `.dev.vars` から `ADMIN_API_KEY` の行を読む（読むだけ。書かない）。鍵を表示・記録しない。

## 4. BAN（1 人のプレイヤーを止める）

**ゲームごとのプレイヤー（`game_id`・`player_id`）を止める**（§11 の決めること 3）。止めた印は新しい表 `player_bans` に置く。

### 表（O2: `migrations/` の新しい番号 `0012_player_bans.sql`）

```sql
-- 止めたプレイヤー（ゲームごと）。行があり期限の前なら止まっている。解くときは行を消す（解いた記録は監査のログに残る）
CREATE TABLE IF NOT EXISTS player_bans (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- game_players.player_id（トークンの p）
  reason TEXT NOT NULL,                         -- 1〜200 文字（管理の人のメモ。プレイヤーには返さない）
  banned_at INTEGER NOT NULL,                   -- サーバーの時刻（UNIX 秒）
  expires_at INTEGER,                           -- NULL はずっと。値があればその時刻から止めない
  PRIMARY KEY (game_id, player_id)
);
```

`game_players` に列を足す（`ALTER TABLE`）形にしない: マイグレーションを 2 回当てる試験（`マイグレーションを2回当ててもデータは壊れない`）で `ALTER TABLE ADD COLUMN` は 2 回目に落ちる（`event-reward-design.md` §11 の決めること 5 と同じ理由）。

### 止めたときの振る舞い（`requireAuth` は DB を引かないまま）

- **`requireAuth` は変えない**（トークンだけで決まり、DB を引かない）。止めた印は新しい `requireNotBanned(env, claims)` で引き、4 つのモジュールが**プレイヤーの利用制限（`consume`）の直後**に呼ぶ。
  - saves・inventory・events: `requireLocalWrite` → `requireAuth` → `consume` → **`requireNotBanned`** → `gameId` → …
  - rankings の `POST`: `requireLocalWrite` → `requireAuth` → 本文の形 → `consume` → **`requireNotBanned`** → `requireSamePlayer` → …
- 鍵はトークンの `g`・`p`（偽れない）。引く文は `SELECT expires_at AS expiresAt FROM player_bans WHERE game_id = ? AND player_id = ?`（主キーで 1 行）。`isBanActive({ expiresAt }, now)` は `expiresAt === null || now < expiresAt`。
- 止まっていれば **403 `PLAYER_BANNED`**（新しいエラーコード。`Player is banned`）。本文の形は `{ "error": { "code", "message" } }` のまま。理由・期限は返さない（管理の人のメモを漏らさない）。
- `consume` の後に置く理由: `consume` はもともと DB を引く最初の所で、その後に 1 回足すだけで済む。rankings で本文の形の誤り（400）が DB より先に返る順（試験 `形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す`）を変えない。`requireAuth` の中で引くと、この試験の壊れた DB が先に 500 を返す（§11 の決めること 4）。止めた人の要求も利用制限の回数に数える（止めた人の連打を数で抑える）。
- 重さ: 認証の要る要求ごとに主キーの 1 行の読み取りが 1 回増える（`consume` の書き込みに並ぶ）。D1 の 1 回の読み取りの遅れの数字は**要確認**。重くなったら、止めた印をトークンの期限まで Workers の中の入れ物に持つ形を後から足す（§14）。
- 読み取りの公開の口（お知らせ・ランキングの `GET`・設定）は止めない（トークンを読まない口）。止めた人のスコアをランキングから消すのは、別のデータ修正（§6 のスコアを消す）でする。
- 限界（そのまま書く）: ゲストはいつでも新しく発行できるので、止めたゲストは新しいゲスト（別の `playerId`）で戻れる。BAN が効くのは、そのプレイヤーの所持品・セーブ・スコアを持ったまま続けることを止めるところまで。人を止めるには外部の認証（`account-design.md` §11）が要る。

### 管理の口（O2）

| 口 | 本文 | 応答 |
| --- | --- | --- |
| `PUT /v1/admin/players/{playerId}/ban?gameId=…` | `{"reason":"<1〜200 文字>","expiresAt":"<ISO 8601 の UTC。任意>"}` | 200 `{"gameId","playerId","bannedAt","expiresAt"}`（`expiresAt` は無ければ `null`）。印があれば理由と期限と `bannedAt` を置き換える（PUT なので 2 回送っても印は 1 つ。前の印は監査の `before` に残る） |
| `DELETE /v1/admin/players/{playerId}/ban?gameId=…` | `{"reason":"<1〜200 文字>"}` | 200 `{"gameId","playerId","banned":false}`。印が無くても 200（同じ結果）。印が無くても監査に `player.unban` の 1 行（前も後も `null`）を残す（書き込みの操作 1 回で 1 行） |

- `game_players` に無いプレイヤーは 404 `NOT_FOUND` `Unknown player`（打ち間違いの ID を黙って止めない）。
- `expiresAt` が過去・形の誤りは 400 `INVALID_ARGUMENT`。本文が JSON でなければ 400 `INVALID_JSON`（ゲームの口と同じ。管理のスキーマの `ErrorCode` にもある）。
- 印の書き込みと監査の行は 1 つの `batch`（§5）。

## 5. 監査のログ

### 表（O1: `migrations/` の新しい番号 `0011_admin.sql`）

```sql
-- 管理の操作の記録（書き込みの操作 1 回で 1 行）。API からは書き換えない・消さない。ゲームの行を消したときだけ CASCADE で消える
CREATE TABLE IF NOT EXISTS admin_audit_log (
  audit_id INTEGER PRIMARY KEY,                 -- 増える番号（順と続きの鍵）
  audit_ref TEXT NOT NULL UNIQUE,               -- 要求ごとにサーバーが作る（crypto.randomUUID()）。続く文の「この要求の行が入ったか」に使う
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  request_key TEXT,                             -- Idempotency-Key（増減だけ必須。§6）。無い操作は NULL
  request_hash TEXT,                            -- 本文の SHA-256（16 進）。同じ鍵で違う本文を見分ける
  actor TEXT NOT NULL,                          -- X-Admin-Actor（^[a-zA-Z0-9_.@-]{1,64}$。自己申告のラベル）
  action TEXT NOT NULL,                         -- 'player.ban'・'player.unban'・'inventory.adjust'・'ranking.delete'・'item.put'・'event.put'
  target TEXT NOT NULL,                         -- 'player:<id>'・'ranking:<boardId>:<playerId>'・'item:<id>'・'event:<id>'
  before_json TEXT,                             -- 前の状態（JSON。無ければ NULL。4 KiB まで）
  after_json TEXT,                              -- 後の状態（同じ）
  reason TEXT NOT NULL,                         -- 1〜200 文字
  created_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  UNIQUE (game_id, request_key)                 -- SQLite の UNIQUE は NULL どうしを重ならないとみなす（鍵の無い操作は何行でも入る）
);
CREATE INDEX IF NOT EXISTS admin_audit_log_game ON admin_audit_log (game_id, audit_id);
```

- 誰が: 管理の鍵は 1 つの共有なので、鍵からは人が分からない。書き込みの口は `X-Admin-Actor` を必須（無い・形の誤りは 400）にし、そのまま記録する。**自己申告**で、鍵を持つ人どうしの区別にしか使えない（人ごとの鍵は §14）。
- 前と後: 操作の対象の状態を JSON で持つ（例: 増減は `{"itemId":"gold","amount":120}` → `{"itemId":"gold","amount":100}`・BAN は `null` → `{"reason":"…","expiresAt":null}`・スコアを消すは `{"score":1200,"displayName":"…"}` → `null`・イベントの定義は前の定義 → 後の定義）。
- 入れないもの: トークン・管理の鍵・セーブの本文・IP（`operations-security.md` のログ・監視の節と 6）。
- 書き込みの操作と監査の行は**同じ `batch`** に入れる（片方だけ残らない）。監査の行の文を 1 文目にして、続く文は「この要求の `audit_ref` の行が入ったとき」だけ書く（`event-reward-design.md` §5 の `claim_id` と同じ形）。
- 読み取りの口（O1 の 2 つ）は監査に残さない（操作の数を抑える。誰が誰のデータを読んだかを残すのは、人ごとの鍵と一緒に §14）。
- 保持の期間（`operations-security.md` の 6）: **365 日**を決まりにする（定数 `AUDIT_RETENTION_DAYS`。`src/core/admin/audit.ts`）。消すのは Phase 2 の分析（§13 の Cron Triggers で古い行の掃除）と一緒に作り、この設計の束では消す口を作らない（`wrangler.jsonc` を変えない）。365 日を超えた行が残っても害は無く、消す仕組みが入るまでの間は増え続ける（量は管理の操作の数だけ）。

### 監査を読む口（O1）

`GET /v1/admin/audit?gameId=…&limit=20&before=42` → 200 `{"gameId","items":[{"auditId","actor","action","target","before","after","reason","createdAt"}],"nextBefore"}`。新しい順。`limit` は 1〜100（既定 20）、`before` は 1 以上の整数（受領の履歴の `parseHistoryQuery` と同じ形の関数を `src/core/admin/parse.ts` に置く）。`before`・`after` は保存した JSON を読み直した値。

### プレイヤーを読む口（O1）

`GET /v1/admin/players/{playerId}?gameId=…` → 200:

```json
{
  "gameId": "demo-rpg", "playerId": "…", "createdAt": "2026-10-31T01:02:03Z",
  "ban": null,
  "balances": [{ "itemId": "gold", "kind": "currency", "amount": 100 }],
  "history": [{ "entryId": 7, "itemId": "gold", "delta": 100, "sourceType": "event-claim", "sourceId": "…", "createdAt": "…" }],
  "saves": [{ "slotId": "auto", "revision": 3, "size": 120, "deleted": false, "updatedAt": "…" }],
  "rankings": [{ "boardId": "boss-score", "score": 1200, "displayName": "…" }]
}
```

- `game_players` に無いプレイヤーは 404 `NOT_FOUND` `Unknown player`。`history` は新しい順に 20 行。
- `ban` の欄は O2 で足した（上の例は O2 の後の形）。止めていれば `{"reason","bannedAt","expiresAt"}`、**止めていなければ（印が無い・期限が過ぎた）欄ごと載せない**（O1 の試験 `管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない` が `ban` の欄の無いことを見るため。§9）。
- **セーブの本文（`data`）とチェックサムは返さない**（中身はサーバーが解釈しない・管理の人も要らない。`save-design.md`）。

## 6. データ修正

**行を直に書き換えず、履歴に残る形にする。**

| 直すもの | Phase 2（この設計） | 形 |
| --- | --- | --- |
| 所持品・通貨 | **付与と取り消し**（O3） | `inventory_ledger` に `source_type = 'admin'`・`source_id = audit_ref` の行（付与は正・取り消しは負の `delta`）と残高の増減を 1 つの `batch`。残高は 0 未満にも上限（`MAX_ITEM_AMOUNT`）より大きくもしない |
| スコア | **消すだけ**（O3） | 最高スコアだけを残す表（`ranking_entries`）なので「下げる」は意味を持たない。消して、前のスコアを監査に残す。プレイヤーはまた投稿できる |
| セーブ | **入れない**（§11 の決めること 6） | サーバーは本文を解釈せず（ADR 0002・`save-design.md`）、前の版を持たない（最新の 1 行だけ）。管理の人が正しい中身を作れず、戻す元も無い。プレイヤーを読む口でリビジョンと大きさだけ見せる |
| 品目・イベントの定義 | 入れる・置き換える（O4。§7） | 監査に前と後の定義 |

### 所持品・通貨の増減（O3）

`POST /v1/admin/players/{playerId}/inventory?gameId=…`、見出し `Idempotency-Key`（必須・`^[a-zA-Z0-9_-]{8,64}$`）・`X-Admin-Actor`、本文 `{"itemId":"gold","delta":-20,"reason":"二重に配った分を戻す"}`。

- `delta` は 0 でない整数で、絶対値が `MAX_ITEM_AMOUNT` 以下（`parseAdjustment`。400）。
- 応答 200 `{"gameId","playerId","itemId","delta","amount","auditId"}`（`amount` は後の残高）。

`batch` の文（`src/core/ledger.ts` の 1 品目の増減の文。引数は `?` を順に `bind` する。下は読みやすさのために名前で書く）:

```sql
-- 1. 監査の行。品目とプレイヤーがあり、増減の後が 0 以上・上限以下のときだけ。同じゲームの同じ Idempotency-Key があれば何もしない
INSERT INTO admin_audit_log (audit_ref, game_id, request_key, request_hash, actor, action, target, before_json, after_json, reason, created_at)
  SELECT :ref, :g, :key, :hash, :actor, 'inventory.adjust', 'player:' || :p,
         json_object('itemId', :item, 'amount', cur), json_object('itemId', :item, 'amount', cur + :delta), :reason, :now
  FROM (SELECT COALESCE((SELECT amount FROM inventory_balances WHERE game_id = :g AND player_id = :p AND item_id = :item), 0) AS cur)
  WHERE cur + :delta BETWEEN 0 AND :max
    AND EXISTS (SELECT 1 FROM inventory_items WHERE game_id = :g AND item_id = :item)
    AND EXISTS (SELECT 1 FROM game_players WHERE game_id = :g AND player_id = :p)
  ON CONFLICT (game_id, request_key) DO NOTHING;
-- 2. 受領の履歴（この要求の監査の行が入ったときだけ）
INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
  SELECT :g, :p, :item, :delta, 'admin', :ref, :now WHERE EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = :ref);
-- 3. 残高の行があれば増減（同じ条件）
UPDATE inventory_balances SET amount = amount + :delta, updated_at = :now
  WHERE game_id = :g AND player_id = :p AND item_id = :item AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = :ref);
-- 4. 残高の行が無く、付与なら作る（3 で行があれば何もしない）
INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at)
  SELECT :g, :p, :item, :delta, :now WHERE :delta > 0
    AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = :ref)
    AND NOT EXISTS (SELECT 1 FROM inventory_balances WHERE game_id = :g AND player_id = :p AND item_id = :item);
-- 5. 0 になった行を消す（0 の行は作らない決まりのまま。所持品の一覧に 0 が出ない）
DELETE FROM inventory_balances
  WHERE game_id = :g AND player_id = :p AND item_id = :item AND amount = 0 AND EXISTS (SELECT 1 FROM admin_audit_log WHERE audit_ref = :ref);
```

- 残高の守り: 文 1 の `cur + :delta BETWEEN 0 AND :max` が、書く前の残高で 0 未満・上限超えを止める。`inventory_balances` の `CHECK` は最後の守り（落ちれば `batch` が全部戻り 500）。`ON CONFLICT … DO UPDATE` を使わず `UPDATE` と `INSERT` に分けるのは、負の値を入れる行の形を作らないため。
- `batch` の後に `SELECT audit_ref, request_hash, after_json, audit_id FROM admin_audit_log WHERE game_id = :g AND request_key = :key` を引く:

| 引いた結果 | 応答 |
| --- | --- |
| 行がある（この要求の `audit_ref`） | 200 |
| 行がある（前の要求）・`request_hash` が同じ＝二重 | **200 で 1 回目と同じ本文**（`after_json` と `audit_id` から作る）。履歴も残高も増えない |
| 行がある・`request_hash` が違う | 422 `IDEMPOTENCY_KEY_REUSED`（新しいコード。管理の口だけ） |
| 行が無く、品目かプレイヤーが無い | 404 `NOT_FOUND`（`Unknown item`・`Unknown player`）。見分けは下の読み直しで |
| 行が無く、取り消しで 0 未満になる | 409 `INSUFFICIENT_BALANCE`（新しいコード。`event-reward-design.md` §6 の名前。管理の口だけ） |
| 行が無く、付与で上限を超える | 409 `INVENTORY_LIMIT_EXCEEDED`（いまのコード） |

- 行が無いときの読み直し（見分けるための 1 文）: `SELECT (SELECT 1 FROM inventory_items WHERE game_id = :g AND item_id = :item) AS item, (SELECT 1 FROM game_players WHERE game_id = :g AND player_id = :p) AS player, COALESCE((SELECT amount FROM inventory_balances WHERE game_id = :g AND player_id = :p AND item_id = :item), 0) AS cur`。`item` か `player` が NULL なら 404、`cur + delta < 0` なら `INSUFFICIENT_BALANCE`、`cur + delta > MAX_ITEM_AMOUNT` なら `INVENTORY_LIMIT_EXCEEDED`。どれでもなければ（`batch` と読み直しの間に別の修正で残高が動いた）、`delta` が負なら `INSUFFICIENT_BALANCE`・正なら `INVENTORY_LIMIT_EXCEEDED` の 409 を返す（何も書いていないので、管理の人は同じ鍵で流し直せる）。
- 並べて送っても: D1 は `batch` を順に流すので、2 つ目の `batch` の文 1 は一意の鍵で何もせず、その `audit_ref` の行が無いので文 2〜5 も何もしない（イベントの受け取りと同じ）。
- `request_hash` は `{"action","gameId","playerId","itemId","delta","reason"}` を決まった順の JSON にして SHA-256（16 進）。`actor` は入れない（同じ修正を別の人が流し直しても二重にしない）。
- **`Idempotency-Key` の保存は `admin_audit_log` の列にする**（`abuse-protection-design.md` §5 の表 `idempotency_keys` は作らない。§11 の決めること 5）。`idempotency_keys` は、プレイヤーの消費の口（`event-reward-design.md` §6）を足すときに作る。
- 鍵の期限: 監査の行と同じく 365 日（掃除が入るまでは消えない）。同じ鍵を 365 日の内に別の修正に使えば 422 になる。管理コマンドは修正ごとに新しい鍵（`crypto.randomUUID()`）を作り、流し直しのときだけ同じ鍵を指定できる（§7）。

### スコアを消す（O3）

`DELETE /v1/admin/rankings/{boardId}/entries/{playerId}?gameId=…`、見出し `X-Admin-Actor`、本文 `{"reason":"…"}`。

- `batch`: 監査の行（`before_json` は消す行の `score`・`displayName`。行があるときだけ入れる）→ `DELETE FROM ranking_entries WHERE … AND EXISTS (この要求の audit_ref)`。
- 行が無ければ 404 `NOT_FOUND` `Unknown ranking entry`（監査の行も入らない）。2 回目は 404（もう無い）。`Idempotency-Key` は要らない（消すのは何度送っても結果が同じ）。
- `game_players` に無いプレイヤーの行（いまの試験の `p1` のような行）も消せる（ランキングの行だけを見る）。

### 付与の文を `src/core/ledger.ts` へ移すか（§11 の決めること 7）

**1 品目の増減の文（上の 2〜5）と受領の履歴の種類の名前（`LEDGER_SOURCES = { eventClaim: 'event-claim', admin: 'admin' }`）を `src/core/ledger.ts` に置く。イベントの受け取りの 3 文は events のモジュールに残す**（種類の名前だけ `LEDGER_SOURCES.eventClaim` を読むように直す）。

- 受け取りの文は報酬の中身を `event_rewards` から SQL の中で読む（O4 で管理の口がイベントの報酬を置き換えるようになるので、TypeScript で先に読んだ行を渡す形に変えると、読んでから書くまでの間の置き換えで中身がずれる）。1 品目の増減と形が違い、1 つの関数にまとめると引数が増えるだけ。
- これで `inventory_ledger` に書く所は 2 つ（events の受け取り・ledger.ts の増減）。種類の名前は 1 か所。Phase 2 のクエスト（§13）は受け取りと同じ形（報酬の表から読む）なので、そのときに受け取りの 3 文を報酬の表の名前を引数にして ledger.ts へ移すかを決める。

## 7. イベントの定義の入れ方と、管理コマンド

**管理の口で品目とイベントを入れる・置き換える**（§11 の決めること 8。`event-reward-design.md` §11 の決めること 7 の B・C を、管理の HTTP の口と、それを呼ぶ管理コマンドで実現する）。マイグレーションで入れる形（A）は、demo-rpg の手本と試験の行のために残す。

### 品目（O4）

`PUT /v1/admin/items/{itemId}?gameId=…`、見出し `X-Admin-Actor`、本文 `{"kind":"currency","reason":"…"}`。

- 無ければ作る。あって `kind` が同じなら何もしない（200・監査の行は残す）。**あって `kind` が違えば 400 `INVALID_ARGUMENT`**（残高と報酬が種類を前提にしている。品目を消す口は作らない）。
- 応答 200 `{"gameId","itemId","kind"}`。

### イベント（O4）

`PUT /v1/admin/events/{eventId}?gameId=…`、見出し `X-Admin-Actor`、本文:

```json
{
  "kind": "daily", "startsAt": "2026-11-01T00:00:00Z", "endsAt": "2026-12-01T00:00:00Z", "resetOffsetMinutes": 540,
  "rewards": [{ "itemId": "gold", "amount": 100 }],
  "reason": "11 月のログインボーナス"
}
```

- 本文の確かめ（`parseEventDefinition`。400）: `kind` は `once`・`daily`・`weekly`、`startsAt < endsAt`（秒に丸めた ISO 8601 の UTC）、`resetOffsetMinutes` は -720〜840 の整数（既定 0）、`rewards` は 1〜`MAX_REWARD_LINES` 行で品目が重ならず、`amount` は 1〜`MAX_ITEM_AMOUNT`（`migrations/0010_events.sql` の `CHECK` と同じ範囲）。`MAX_REWARD_LINES` は `src/modules/events/limits.ts` にあるので、core から読めるように `src/core/inventory.ts` へ移す（値は変えない。events は core から読む）。
- 報酬の品目が `inventory_items` に無ければ 404 `NOT_FOUND` `Unknown item`（何も書かない）。
- **受け取りの行（`event_claims`）が 1 つでもあるイベントは、`kind`・`startsAt`・`resetOffsetMinutes` を変えられない**（400 `INVALID_ARGUMENT`。区切りの鍵 `period_key` の意味が変わり、二重の止めが崩れるため）。`endsAt`（早く終える・延ばす）と `rewards` は変えられる（変えた後の受け取りから新しい中身）。イベントを消す口は作らない（終えるときは `endsAt` をいまにする）。
- `batch`: 監査の行（前の定義と後の定義）→ `events` を `INSERT … ON CONFLICT (game_id, event_id) DO UPDATE` → `DELETE FROM event_rewards WHERE game_id = ? AND event_id = ?` → 報酬の行を `INSERT`（行の数だけ）。どの文も「この要求の `audit_ref` の行が入ったとき」だけ。
- 応答 200 で入れた定義（`listEvents` の 1 行と同じ欄の名前）。

### 管理コマンド（O4）

`scripts/` の下に `admin-cli.mjs`（入口）と `admin-requests.mjs`（要求の形の関数。試験と共有。`scripts/cli-requests.mjs` と同じ考え）と、その型のファイル `admin-requests.d.mts`（試験の TypeScript から読み込むため。`scripts/cli-requests.d.mts` と同じ形。無いと `npm run typecheck` で落ちる）を作る。`package.json` に行を足さない（`node` で直に起動する）。

- 呼び方: `node <scripts の下の admin-cli.mjs> <操作> [引数]`。操作は `player`・`audit`・`grant`・`revoke`・`ban`・`unban`・`delete-score`・`put-item`・`put-event`（定義は JSON のファイルを引数で渡す）・`smoke`。行き先は `RPG_API_BASE`（既定 `http://127.0.0.1:8787`。CLI モックと同じ）。`X-Admin-Actor` は `--actor`（既定は OS のユーザー名でなく `local-admin`。個人の名前を勝手に記録しない）。
- `grant`・`revoke` は新しい `Idempotency-Key` を作って表示し、`--key <値>` で流し直しに同じ鍵を指定できる。
- `smoke`（通しの確かめ。人が `npm run dev` を起動した後に回す）: ゲストを発行する（ゲームのクライアントの要求の形の関数 `guestRequest` を `scripts/cli-requests.mjs` から読むだけ）→ プレイヤーを読む → `gold` を 50 付与 → 同じ鍵でもう一度（残高 50 のまま）→ 20 取り消し（残高 30）→ 31 取り消し（409 `INSUFFICIENT_BALANCE`）→ BAN → ゲストのトークンで `GET /v1/inventory` が 403 `PLAYER_BANNED` → 解く → 200 で `gold` 30 → 品目とイベントを入れる（ID に時刻を付けて回すたびに新しく）→ ゲストのトークンでイベントの一覧に載る → 監査を読むと、この回の操作が新しい順に並ぶ。最後に `PASS`。
- **`scripts/cli-mock.mjs` には管理の操作を入れない**（ゲームのクライアントの代わりで、管理の鍵を持たせない。§3）。CLI モックの流れ・出力は変えないので `npm run cli:smoke` は変わらない。管理の通しは上の `smoke` と §8 の `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る`（試験は `admin-requests.mjs` の関数を使う）で確かめる。

## 8. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は新しい `test/admin.test.ts`（O1・O3・O4）と `test/bans.test.ts`（O2）。L1（入出力の無い関数）も同じファイル。スキーマの置き換えは `test/schema-conformance.test.ts`。

試験の作り方:

- 管理の鍵は試験の中で作る（`const adminKey = 'a'.repeat(32)`）。`adminEnv = { ...localEnv, ADMIN_API_KEY: adminKey }`。鍵の無い場合は `{ ...localEnv, ADMIN_API_KEY: undefined }` を明示する（§1 の要確認）。
- 試験のゲームは専用（`adm-game` など。`registerGame` と品目・プレイヤーの行を `beforeEach` で入れる）。プレイヤーはゲストの発行で作るか、`game_players`・`accounts` に行を直に入れる。
- 書き込みをするファイルの `beforeEach` で `resetRateLimits(db)` と、監査・止めた印・所持品・受け取りの表の `DELETE`。
- 新しい試験の名前には、機能が増えると変わる数（エラーコード・操作・ルートの個数）を入れない（増えるたびに名前を置き換える手間を作らない。§9）。決まった値（鍵の長さ・送る回数）と、既存の試験の置き換え（`スキーマのErrorCodeの列挙は15個のエラーコードと一致する`）は入れてよい。

| 束 | テストの名前 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- |
| O1 | `管理の鍵はADMIN_API_KEYが32文字以上のときだけ使う` | L1 | `adminSecret` に 32 文字・31 文字・無しを `local` と `disabled` で | 32 文字だけ値。ほかは `null`（`local` でも既定の鍵に戻らない） |
| O1 | `管理の鍵の比べは長さの違う値でも投げずに外れを返す` | L1 | `requireAdmin` に短い値・長い値・同じ値 | 同じ値だけ通る。違う長さで例外にならない |
| O1 | `管理の鍵の無い環境では管理の口がINTERNAL_ERRORの500を返す` | L2 | `ADMIN_API_KEY: undefined` の `local` で `GET /v1/admin/audit` | 500 `INTERNAL_ERROR`。本文に鍵の名前・値が無い |
| O1 | `本番の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV: 'disabled'` と正しい鍵で管理の各口 | 403 `NOT_READY_FOR_PRODUCTION`。何も書かない |
| O1 | `管理の鍵が無いか違う要求はUNAUTHENTICATEDの401を返す` | L2 | 見出し無し・違う鍵・`Bearer` でない | 401 `UNAUTHENTICATED` |
| O1 | `プレイヤーのトークンでは管理の口を通れない` | L2 | ゲストのトークンを `Authorization` に入れて管理の口 | 401 `UNAUTHENTICATED` |
| O1 | `管理の口を上限より多く呼ぶと鍵を確かめる前に429を返す` | L2 | `rate_limit_counters` の `admin-ip` を上限まで埋めて正しい鍵で 1 回 | 429 `RATE_LIMITED` と `Retry-After` |
| O1 | `管理の鍵を取り替えると前の鍵は401になる` | L2 | `ADMIN_API_KEY` を変えた `env` で前の鍵 | 401。新しい鍵は 200 |
| O1 | `管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない` | L2 | 所持品・セーブ・スコアのあるプレイヤーを読む | §5 の形。`data`・`checksum` の欄が無い |
| O1 | `知らないプレイヤーの管理の読み取りはNOT_FOUNDの404を返す` | L2 | `game_players` に無い ID | 404 `NOT_FOUND` |
| O1 | `登録の無いゲームの管理の口はNOT_FOUNDの404を返す` | L2 | 登録の無い `gameId` | 404 `NOT_FOUND` `Unknown game` |
| O1 | `監査のログは新しい順に返りlimitで区切って続きを読める` | L2 | 監査の行を 3 行入れて `limit=2` → `before=nextBefore` | 新しい 2 行 → 残り 1 行 |
| O1 | `管理の口の応答は管理のスキーマに合う` | L2 | O1 の 2 つの口の 200 と 401・404 | `openapi/` の下の管理のスキーマに合う |
| O1 | `管理のスキーマの操作は管理のルートと1対1で対応する` | L2 | 管理のスキーマの `paths` と `adminRoutes` | 同じ組（メソッドとパス）。数を名前に入れない |
| O1 | `管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する` | L2 | 管理のスキーマの `ErrorCode` と、各口の `x-error-codes` の和 | 一致する |
| O2 | `止めた印は期限の時刻から効かなくなり期限の無い印はずっと効く` | L1 | `isBanActive` に期限の前・ちょうど・後・`null` | 前と `null` が真・ちょうどと後が偽 |
| O2 | `BANしたプレイヤーのトークンの要求はPLAYER_BANNEDの403を返す` | L2 | BAN の後に同じトークンで `GET /v1/inventory` | 403 `PLAYER_BANNED`。本文に理由が無い |
| O2 | `BANしたプレイヤーのスコアの投稿とセーブと報酬の受け取りはどれも断られ何も書かない` | L2 | BAN の後にスコア・セーブの `PUT`・受け取り | どれも 403 `PLAYER_BANNED`。行の数が変わらない |
| O2 | `BANを解くと同じトークンでまた通る` | L2 | BAN → 解く → 同じトークンで所持品 | 200 |
| O2 | `期限の過ぎたBANは要求を止めない` | L2 | `expires_at` が過去の行を直に入れて要求 | 200 |
| O2 | `BANは同じゲームのほかのプレイヤーとほかのゲームの同じIDを止めない` | L2 | 1 人を BAN して、別のプレイヤーと別のゲームの同じ ID で要求 | どちらも 200 |
| O2 | `トークンの無い要求と形の誤った本文は止めた印の表を引く前に断る` | L2 | 壊れた DB でトークン無しの所持品・形の誤ったスコアの投稿 | 401・400（500 でない） |
| O2 | `知らないプレイヤーのBANはNOT_FOUNDの404を返し印を作らない` | L2 | `game_players` に無い ID を BAN | 404。`player_bans` が 0 行 |
| O2 | `同じBANを2回送っても止めた印は1つ` | L2 | 同じ BAN を 2 回 | 2 回とも 200。`player_bans` が 1 行 |
| O2 | `BANとBANを解くことは監査のログに前と後が残る` | L2 | BAN → 解く → 監査を読む | `player.unban`・`player.ban` の 2 行。前と後が §5 の形 |
| O2 | `PLAYER_BANNEDの応答はスキーマに合う` | L2 | BAN した人の各口の 403 | `openapi/rpg-online.v1.json` の各操作の 403 に合う |
| O2 | `スキーマのErrorCodeの列挙は15個のエラーコードと一致する` | L2 | `ErrorCode` の `enum` | 14 個と `PLAYER_BANNED`（§9 の置き換え） |
| O3 | `管理の増減の本文はdeltaが0でない整数で上限の内のときだけ通す` | L1 | `parseAdjustment` に 0・小数・上限超え・負・正 | 負と正の整数だけ通る |
| O3 | `管理の付与で所持品が増え受領の履歴にadminの行が残る` | L2 | `gold` を 50 付与 | 200・残高 50・履歴に `sourceType: "admin"`・`sourceId` が監査の `audit_ref` |
| O3 | `管理の取り消しは負の増減で履歴に残り残高を減らす` | L2 | 50 付与 → 20 取り消し | 残高 30・履歴に `delta: -20` |
| O3 | `残高より多い取り消しはINSUFFICIENT_BALANCEの409を返し何も書かない` | L2 | 残高 30 で 31 取り消し | 409 `INSUFFICIENT_BALANCE`。残高・履歴・監査が変わらない |
| O3 | `上限を超える管理の付与はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない` | L2 | 残高を上限の近くにして付与 | 409 `INVENTORY_LIMIT_EXCEEDED`。何も書かない |
| O3 | `取り消して残高が0になった品目は所持品の一覧から消える` | L2 | 30 を 30 取り消してプレイヤーの所持品を読む | `inventory_balances` にその行が無い。一覧に出ない |
| O3 | `同じIdempotency-Keyの付与を2回送っても1回分で同じ本文を返す` | L2 | 同じ鍵と本文で 2 回 | 2 回とも 200 で同じ本文。残高と履歴は 1 回分 |
| O3 | `同じIdempotency-Keyの付与を並べて送っても1回分` | L2 | 同じ鍵と本文を `Promise.all` で 2 つ | 履歴は 1 行・残高は 1 回分 |
| O3 | `同じIdempotency-Keyで違う中身の付与はIDEMPOTENCY_KEY_REUSEDの422を返す` | L2 | 同じ鍵で `delta` を変えて送る | 422 `IDEMPOTENCY_KEY_REUSED`。何も書かない |
| O3 | `Idempotency-Keyの無い管理の付与はINVALID_ARGUMENTの400を返す` | L2 | 見出し無し・形の誤り | 400 `INVALID_ARGUMENT` |
| O3 | `知らない品目か知らないプレイヤーへの管理の付与はNOT_FOUNDの404を返す` | L2 | 無い品目・無いプレイヤー | 404 `NOT_FOUND`。何も書かない |
| O3 | `管理の付与は監査のログに前と後の残高が残る` | L2 | 付与の後に監査を読む | `inventory.adjust` の行。前と後の `amount` |
| O3 | `管理でスコアを消すとランキングから消え監査に前のスコアが残る` | L2 | スコアのある人を消して `GET /v1/rankings/…` | 一覧に出ない。監査の前に `score` |
| O3 | `無いスコアを消すとNOT_FOUNDの404を返し監査に残さない` | L2 | 行の無いボードとプレイヤー | 404。監査が増えない |
| O3 | `受領の履歴の種類の名前は台帳のモジュールの1か所にある` | L1 | `LEDGER_SOURCES` | `{ eventClaim: 'event-claim', admin: 'admin' }` |
| O4 | `イベントの定義の本文は期間と区切りと時差と報酬の行の数を確かめる` | L1 | `parseEventDefinition` に始まり ≥ 終わり・知らない区切り・時差の外・報酬 0 行と 11 行・品目の重なり | どれも外れ。正しい本文は通る |
| O4 | `管理の口で入れた品目とイベントがプレイヤーのイベントの一覧に出る` | L2 | 品目とイベントを入れて、ゲストのトークンで `GET /v1/events` | 一覧に載り、受け取ると品目が増える |
| O4 | `イベントの定義を入れ直すと報酬の中身が置き換わる` | L2 | 報酬を変えて入れ直す | 一覧の `rewards` が新しい中身だけ |
| O4 | `受け取りのあるイベントの区切りと始まりと時差は変えられない` | L2 | 受け取りの後に `kind`・`startsAt`・`resetOffsetMinutes` を変える | 400 `INVALID_ARGUMENT`。`endsAt` と `rewards` だけの変更は 200 |
| O4 | `知らない品目を報酬にしたイベントの定義はNOT_FOUNDの404を返し何も書かない` | L2 | 無い品目の報酬 | 404。`events`・`event_rewards`・監査が変わらない |
| O4 | `品目の種類は後から変えられない` | L2 | `currency` の品目を `item` で入れ直す | 400 `INVALID_ARGUMENT` |
| O4 | `イベントの定義を入れると監査のログに前と後の定義が残る` | L2 | 入れて、入れ直して監査を読む | `event.put` の 2 行。1 行目の前は `null` |
| O4 | `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` | L2 | `admin-requests.mjs` の関数で §7 の `smoke` と同じ流れ | 各手順の応答が §7 のとおり。監査に新しい順で並ぶ |

数（行）: O1 が 15・O2 が 12・O3 が 15・O4 が 8。

CLI モックに管理の鍵と管理の口が入らないことは試験にしない（試験は Workers のランタイムで回り、いまの `test/` にファイルの中身を文字列で読む前例が無い）。O4 の確認コマンド（Node.js で回る）が `scripts/cli-mock.mjs` と `scripts/cli-requests.mjs` の文字列で見る（§12）。

## 9. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `利用制限の回数と窓は定数のモジュールにある`（`test/rate-limits.test.ts`） | O1 | `RATE_LIMITS` に `admin: { scope: 'admin-ip', limit: 60, period: 60 }` が足される | 名前は変えず、`toEqual` の期待に 1 行足す（確かめる中身は弱めない）。`abuse-protection-design.md` §2 の表と `docs/api-contract.md` の「利用制限」に行を足す |
| `スキーマのErrorCodeの列挙は14個のエラーコードと一致する`（`test/schema-conformance.test.ts`） | O2 | 名前の中の数が 15 になる（`PLAYER_BANNED`） | §8 の `スキーマのErrorCodeの列挙は15個のエラーコードと一致する` に置き換える。`errorCodes` に足す |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る`（同） | O2 | 全部のコードを 1 回ずつ出す試験で、`PLAYER_BANNED` が出ないと落ちる | 名前は変えず、BAN したプレイヤーで所持品を読む行を 1 つ足す |
| `管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない`（`test/admin.test.ts`） | O2 | **変わらない**（止めていない人の応答に `ban` の欄を載せない。§5） | 直さない。止めた人の `ban` の欄は O2 の試験で見る |
| `今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`） | 全部 | **変わらない**（CLI モックを変えない。§7） | 直さない。O1〜O4 の確認コマンドの `requireTests` に入れて見張る |
| `形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す`（`test/games.test.ts`） | O2 | **変わらない**（止めた印は `consume` の後に引く。§4） | 直さない。O2 の `requireTests` に入れて見張る |
| `スキーマのファイルはOpenAPI 3.1で15個の操作を持つ`（`test/schema-conformance.test.ts`） | 全部 | **変わらない**（管理の口はゲームのクライアントのスキーマに入れず、`openapi/` の下の別のファイルにする。§11 の決めること 10） | 直さない。O1 の `requireTests` に入れて見張る |
| `マイグレーションを2回当ててもデータは壊れない` | O1・O2 | 当てるファイルが増える（`0011`・`0012` は `IF NOT EXISTS` だけ） | 直さない。O1・O2 の `requireTests` に入れる |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない` | 全部 | **変わらない**（管理はモジュールにしない。§2） | 直さない |
| イベントの受け取りの試験（`test/events.test.ts` の 21 本） | O3・O4 | **変わらない**（受け取りの文は動かさず、種類の名前の読み元と `MAX_REWARD_LINES` の置き場だけ変わる。§6・§7） | 直さない。O3・O4 の `requireTests` に代表の 3 本を入れる |

置き換えは `docs/guides/decisions/test-plan.md` §11 の手続き（名前の嘘を直すだけで、確かめる中身を弱めない）。

束の実装の Issue で直す文書（この Issue では変えない。`CLAUDE.md` 原則 5 で旧文を置き換える。例外を追記しない）:

| 文書 | O1 | O2 | O3 | O4 |
| --- | --- | --- | --- | --- |
| `docs/api-contract.md` | 「管理の API（ゲームのクライアントは使わない）」の節と 2 つの口・利用制限の表に `admin` | `PLAYER_BANNED` と BAN の 2 つの口 | 増減とスコアを消す口・`INSUFFICIENT_BALANCE`・`IDEMPOTENCY_KEY_REUSED`（管理の口だけ） | 品目とイベントの口 |
| `openapi/rpg-online.v1.json` | — | `ErrorCode` に `PLAYER_BANNED`。トークンの要る操作の 403 の `x-error-codes` | — | — |
| `openapi/` の下の新しい `rpg-online-admin.v1.json` | 作る（2 つの操作） | 2 つ足す | 2 つ足す | 2 つ足す |
| `docs/guides/working/architecture.md` | 4 のデータ境界に `admin_audit_log` | 同 `player_bans` | — | — |
| `docs/guides/working/abuse-protection-design.md` | §2 の表に `admin` の行 | — | — | — |
| `docs/guides/working/account-design.md` | — | §11 の BAN の行を「`admin-design.md` §4」に置き換える | — | — |
| `docs/guides/working/event-reward-design.md` | — | — | §3・§14 の `ledger.ts` の行を §6 の決定に置き換える | §11 の決めること 7・§14 の管理の行を §7 に置き換える |
| `docs/guides/decisions/roadmap.md` | — | — | — | Phase 2 の管理の行に印と Issue の番号（O4 の後、会話の側の通しの確かめが済んでから） |

`CLAUDE.md` は変えない（守るものの 2 行と「認証・レート制限・不正対策は未実装」は、守りを外すとき＝ユーザーが決めるときに直す。§10）。

## 10. `APP_ENV` の守りと、守りを外す条件（この設計では外さない）

- **管理の口にも同じ守り（`requireLocalWrite`）を掛ける**（§11 の決めること 11）。`APP_ENV === 'local'` でなければ、正しい管理の鍵があっても 403 `NOT_READY_FOR_PRODUCTION`。`wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない。管理の口だけ別の守り（鍵があれば `local` でなくても通す）にすると、無認証のゲストの書き込みが残る Worker を、管理のために `disabled` 以外でデプロイしたくなる道を作る。
- 外すかどうかはユーザーが決める（`CLAUDE.md` の「守るもの」）。`account-design.md` §10 の「守りを外す条件」のうち、管理で満たせるもの・満たせないもの:

| `account-design.md` §10 の条件 | 管理（この設計）で | いま |
| --- | --- | --- |
| 1. トークンの無い・期限切れ・署名の誤り・なりすましの書き込みが断られる | 関係しない | 満たしている（A1・A2） |
| 2. 連投の制限・送信 ID・ゲストの発行の利用制限 | 関係しない（管理の口の利用制限 `admin` を足す） | 満たしている（R1・R2） |
| 3. スコアの自己申告をどこまで信じるかを決め、ゲストが本人確認でないことを公開の説明に書く | **一部を満たす**: 不正なスコアを消す（§6）・その人を止める（§4）手段ができる。公開の説明は満たさない | 決めてある（`abuse-protection-design.md`）。公開の説明は無い（Phase 4） |
| 4. 秘密を `wrangler secret put` で渡す手順・鍵が無い環境で 500・環境ごとに D1 と鍵を分ける | **一部を満たす**: 管理の鍵も同じ形で、鍵が無ければ 500 を試験で確かめる（O1 の `管理の鍵の無い環境では管理の口がINTERNAL_ERRORの500を返す`）。環境の分離（`operations-security.md` の 10）は運用の作業で満たさない | トークンの鍵は満たしている。環境の分離は無い |
| 5. 守りを外した後の試験の置き換えを設計してある | 満たさない（O1 の `本番の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` も置き換えの対象に増える） | 無い |

管理が加える条件（守りを外す前に要る）: 管理の鍵を `wrangler secret put` で入れる手順と取り替えの手順が手順書にある・監査のログの保持（365 日）と消す仕組み（§13 の分析）がある・人ごとの区別（`X-Admin-Actor` が自己申告であること）を受け入れるか、Cloudflare Access などで人を確かめるかを決める（§14。**要確認**）。

## 11. 決めること

推しの案で §2〜§10 を書いた。違う案にするときは、該当する節と §8 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 管理の口の形と管理画面 | A: ローカルの管理コマンド（`wrangler d1 execute --local` を呼ぶ `scripts/` のスクリプト）。B: 管理の HTTP API（`/v1/admin/...`・管理の鍵）。C: 両方（B と、B を呼ぶ管理コマンド）。管理画面（ブラウザ）は Phase 2 に入れるか、Phase 4 へ送るか | **C（管理コマンドは HTTP の口を呼ぶだけ）・管理画面は Phase 4**。確かめ・履歴・監査・残高の守りを Worker の 1 か所に置け、ローカルと本番（将来）で同じ口になる。A は SQL を直に流すので守りも監査も通らず、`--local` でしか使えず、管理の鍵を試験で確かめられない。B だけでは毎回 `curl` を組み立てることになり、通しの確かめの手段が無い。管理画面は B の口をブラウザから呼ぶだけで後から足せ、ロードマップの Phase 4 に「管理画面・設定画面・サンプルゲームを同梱」がある |
| 2 | 管理の鍵の形 | A: **Worker ごとに 1 つの共有の鍵 `ADMIN_API_KEY`（32 文字以上・`local` でも既定の鍵を持たない・SHA-256 にして `timingSafeEqual`・取り替えは `wrangler secret put` で入れ直す）**。B: ゲームごとの鍵（表に鍵のハッシュ）。C: 人ごとの鍵（表に人と鍵のハッシュ・取り消せる） | **A**。作者ごとに独立の Worker と D1（`architecture.md` の 4）なので、Worker ごとの 1 つで足りる。B・C は鍵の発行と取り消しの口と、その口を守る別の鍵が要る。C は監査の「誰が」を確かにできるので、管理する人が増えたら足す（§14） |
| 3 | BAN の単位 | A: **プレイヤー（ゲームごと）**。B: アカウント（全部のゲーム） | **A**。管理の人が見えるのは `playerId`（ランキング・監査）で、`account_id` はクライアントにも返さない内部の ID。B は `game_players` から `account_id` を引いて広げる形で後から足せる（§14） |
| 4 | 止めた印の置き場と引く所 | A: **新しい表 `player_bans`。`requireAuth` は変えず、プレイヤーの利用制限の直後に `requireNotBanned` で引く**。B: `account-design.md` §8 の決めること 2 の B（トークンを D1 に持ち、取り消す）。C: `accounts` か `game_players` に止めた印の列を足し、`requireAuth` の中で引く | **A**。トークンの形を変えず、いまのトークンのまま止められる。`consume` の後なので、本文の誤りを DB より先に返す試験（`形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す`）の順を変えない。B はトークンの形と発行を作り直す。C は `ALTER TABLE` がマイグレーションを 2 回当てる試験で落ち、`requireAuth` の中で引くと上の試験が 500 になる |
| 5 | 止めた人の要求への応答 | A: **403 `PLAYER_BANNED`（新しいコード）**。B: 403 `PERMISSION_DENIED`。C: 401 `UNAUTHENTICATED` | **A**。トークンは正しく「誰か」は分かっているので 403。クライアント（UE・Unity・ブラウザ）は `PLAYER_BANNED` だけで「止められた」と出し分けられる（ゲストの発行し直しで直らない）。B はなりすましと区別できない。C はクライアントがゲストを発行し直して黙って回り込む |
| 6 | データ修正の範囲（セーブ・スコア） | A: **所持品と通貨の付与と取り消し・スコアを消すこと。セーブは直さない（読むだけ）**。B: A とセーブの墓石化（管理の人が消す）。C: A とセーブの書き込み（管理の人が中身を入れる） | **A**。サーバーはセーブの本文を解釈せず前の版を持たないので、管理の人が正しい中身を作れない（ADR 0002）。B はプレイヤーが自分で消せることと変わらず、壊れたセーブの直しにならない。セーブの版の履歴（戻す元）を持つ設計と一緒に考える（§14） |
| 7 | 付与の文を `src/core/ledger.ts` へ移すか | A: **1 品目の増減の文と履歴の種類の名前を ledger.ts に置き、イベントの受け取りの 3 文は events に残す**。B: 受け取りの 3 文も ledger.ts へ移し、受け取りも 1 品目ずつの文にする。C: 移さない（管理の増減の文を管理の口の中に書く） | **A**。受け取りは報酬の中身を SQL の中で読み、イベントの報酬を管理の口が置き換えるようになっても中身がずれない（§6）。種類の名前は 1 か所になる。B は受け取りの書き方を変え、いまの 21 本の試験の見張る挙動に手を入れる。C は履歴に書く文が散らばり、クエスト（§13）で 3 つ目が増える |
| 8 | イベントの定義の入れ方（`event-reward-design.md` §11 の決めること 7 の B） | A: マイグレーションのまま。B: 管理コマンドが SQL を作って `wrangler d1 execute` で流す。C: **管理の HTTP の口（品目とイベントの `PUT`）と、それを呼ぶ管理コマンド。マイグレーションの形は手本と試験のために残す** | **C**。本文の確かめ（期間・時差・報酬の行の数・品目の有無）と、受け取りのあるイベントの区切りを変えさせない守りと監査を Worker で持てる。A は運営のたびにマイグレーションを書いて当てることになる。B は守りも監査も通らない（決めること 1 の A と同じ） |
| 9 | 管理のコードの置き場 | A: **`src/core/admin/`（ゲームごとの機能にしない・モジュールを読み込まない）**。B: `src/modules/admin/` の新しいモジュールにして `game_modules` に `admin` の行を足す | **A**。管理はゲームが使うかどうかを選ぶ機能でなく運営の口で、機能の設定は認可の代わりにしない（決定のまま）。B はモジュールの一覧の試験と demo-rpg の設定の試験の名前が変わり、`admin` を使わない設定のゲームが直せなくなるだけ |
| 10 | 管理の口の契約の置き場 | A: **`docs/api-contract.md` に「管理の API」の節を足し、形は `openapi/` の下の別のファイル `rpg-online-admin.v1.json`**。B: いまのスキーマ（`openapi/rpg-online.v1.json`）に足す | **A**。ゲームのクライアント（Phase 3 の SDK）がスキーマから管理の口を作らない。いまの試験 `スキーマのファイルはOpenAPI 3.1で15個の操作を持つ` が変わらない。挙動の説明の正は `docs/api-contract.md` の 1 か所のまま |
| 11 | 管理の口の `APP_ENV` の守り | A: **書き込みの口と同じ `requireLocalWrite` を掛ける（読み取りの口も）**。B: 管理の鍵があれば `APP_ENV` を見ない | **A**。この設計では守りを外さない（`CLAUDE.md`）。B は管理だけを本番で使いたくなり、無認証のゲストの書き込みが残る Worker を `local` でデプロイする誤りを誘う（§10） |
| 12 | 二重の止め方（同じ修正を 2 回流す） | A: **増減だけ `Idempotency-Key` を必須にし、`admin_audit_log` の列（`UNIQUE (game_id, request_key)`）に保存する。同じ鍵で違う本文は 422 `IDEMPOTENCY_KEY_REUSED`。BAN・スコアを消す・定義の `PUT` は何度送っても結果が同じなので要らない**。B: `abuse-protection-design.md` §5 の表 `idempotency_keys` を作る。C: 修正の ID を本文に入れる | **A**。増減だけが足し算で、流し直しで二重になる。監査の行と鍵を 1 行にすると、書き込み・履歴・鍵の保存が 1 つの `batch` に収まり表が増えない。B はプレイヤーの消費の口を足すときに作る（プレイヤーごとの鍵）。C は見出しと同じことを本文で決め直すだけ |
| 13 | 監査のログの保持と掃除 | A: **365 日を決まりにし、消す仕組みは §13 の分析（Cron Triggers）と一緒に作る**。B: この束で Cron Triggers を足して毎日消す。C: 消さない | **A**。`wrangler.jsonc` を変えずに済む（Issue の範囲）。量は管理の操作の数だけで、掃除が後になっても困らない。B は `wrangler.jsonc` の `triggers` と `scheduled` の入口が要る。C は `operations-security.md` の 6（保持期間と削除手順を決める）に合わない |
| 14 | パッケージ | A: **足さない（Web Crypto・D1・Node.js の標準だけ）**。B: 管理コマンドに引数の読み取りのライブラリを足す | **A**。引数は `process.argv` で足り、`package.json` を変えない |

## 12. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| O1 | 管理の土台: `migrations/0011_admin.sql`・`src/core/admin/`（key・audit・routes・parse）・`src/core/router.ts`・`RATE_LIMITS.admin`・プレイヤーを読む口と監査を読む口・管理のスキーマ・§9 の O1 の文書・§8 の O1 の試験 | E2（`event-reward-design.md`） | §9 の手続きで 1 本の中身に行を足す | 足さない |
| O2 | BAN: `migrations/0012_player_bans.sql`・`src/core/bans.ts`・4 つのモジュールに `requireNotBanned`・BAN の 2 つの口・`PLAYER_BANNED`・§9 の O2 の文書・§8 の O2 の試験 | O1 | §9 の手続きで 1 本を置き換え・1 本に行を足す | 足さない |
| O3 | データ修正: `src/core/ledger.ts`・増減の口とスコアを消す口・events の種類の名前を ledger.ts から読む・§9 の O3 の文書・§8 の O3 の試験 | O2 | 変えない | 足さない |
| O4 | イベントの定義と管理コマンド: 品目とイベントの `PUT`・`MAX_REWARD_LINES` を `src/core/inventory.ts` へ・`scripts/` の下の管理コマンドと要求の形の関数・§9 の O4 の文書・§8 の O4 の試験 | O3 | 変えない | 足さない |

範囲の外（後の設計書）: §14。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。`gitClean` は `base` を渡さないと作業ツリーしか見ないので、先頭の `base` に**実装の Issue を作るときの main のコミットの SHA** を書き入れる（`docs/guides/procedures/issue-goal-setting.md`）。

O1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const adminSpec = ['openapi', 'rpg-online-admin.v1.json'].join('/');
const files = ['migrations/0011_admin.sql', 'src/core/admin/key.ts', 'src/core/admin/audit.ts', 'src/core/admin/routes.ts',
  'src/core/admin/parse.ts', 'test/admin.test.ts', adminSpec];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/requireLocalWrite/.test(read('src/core/admin/routes.ts')), '管理の口が APP_ENV の守りを通る');
check(/timingSafeEqual/.test(read('src/core/admin/key.ts')), '管理の鍵を時間の一定な比べで確かめる');
check(!/LOCAL_DEV/.test(read('src/core/admin/key.ts')), '管理の鍵に既定の値を持たない');
// 管理の鍵の値をファイルに書かない（wrangler.jsonc に ADMIN_API_KEY が無い）
check(!read('wrangler.jsonc').includes('ADMIN_API_KEY'), 'wrangler.jsonc に管理の鍵が無い');
runTests();
requireTests([
  '管理の鍵はADMIN_API_KEYが32文字以上のときだけ使う',
  '管理の鍵の比べは長さの違う値でも投げずに外れを返す',
  '管理の鍵の無い環境では管理の口がINTERNAL_ERRORの500を返す',
  '本番の設定では管理の鍵があっても管理の口にNOT_READY_FOR_PRODUCTIONの403を返す',
  '管理の鍵が無いか違う要求はUNAUTHENTICATEDの401を返す',
  'プレイヤーのトークンでは管理の口を通れない',
  '管理の口を上限より多く呼ぶと鍵を確かめる前に429を返す',
  '管理の鍵を取り替えると前の鍵は401になる',
  '管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない',
  '知らないプレイヤーの管理の読み取りはNOT_FOUNDの404を返す',
  '登録の無いゲームの管理の口はNOT_FOUNDの404を返す',
  '監査のログは新しい順に返りlimitで区切って続きを読める',
  '管理の口の応答は管理のスキーマに合う',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  // 中身に行を足した既存の試験と、変わらないことを見張る既存の試験（§9）
  '利用制限の回数と窓は定数のモジュールにある',
  'スキーマのファイルはOpenAPI 3.1で15個の操作を持つ',
  'スキーマのErrorCodeの列挙は14個のエラーコードと一致する',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション・モジュール・CLI モック・ゲームのクライアントのスキーマを変えない
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory', '0010_events'].map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/modules/', 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/token.ts', 'scripts/',
  'openapi/rpg-online.v1.json', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

O2:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0012_player_bans.sql', 'src/core/bans.ts', 'test/bans.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
// requireAuth は DB を引かないまま（§4）・4 つのモジュールが止めた印を確かめる
check(!/env\.DB/.test(read('src/core/auth.ts')), 'requireAuth が DB を引かない');
for (const m of ['rankings', 'saves', 'inventory', 'events'])
  check(/requireNotBanned/.test(read(`src/modules/${m}/index.ts`)), `${m} のモジュールが止めた印を確かめる`);
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check((spec.components?.schemas?.ErrorCode?.enum ?? []).includes('PLAYER_BANNED'), 'スキーマの ErrorCode に PLAYER_BANNED がある');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(!all.includes('スキーマのErrorCodeの列挙は14個のエラーコードと一致する'), '置き換えた試験が残っていない（14個）');
runTests();
requireTests([
  '止めた印は期限の時刻から効かなくなり期限の無い印はずっと効く',
  'BANしたプレイヤーのトークンの要求はPLAYER_BANNEDの403を返す',
  'BANしたプレイヤーのスコアの投稿とセーブと報酬の受け取りはどれも断られ何も書かない',
  'BANを解くと同じトークンでまた通る',
  '期限の過ぎたBANは要求を止めない',
  'BANは同じゲームのほかのプレイヤーとほかのゲームの同じIDを止めない',
  'トークンの無い要求と形の誤った本文は止めた印の表を引く前に断る',
  '知らないプレイヤーのBANはNOT_FOUNDの404を返し印を作らない',
  '同じBANを2回送っても止めた印は1つ',
  'BANとBANを解くことは監査のログに前と後が残る',
  'PLAYER_BANNEDの応答はスキーマに合う',
  'スキーマのErrorCodeの列挙は15個のエラーコードと一致する',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
  '形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory', '0010_events', '0011_admin'].map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/token.ts', 'src/core/rate-limit.ts', 'scripts/',
  'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

O3:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['src/core/ledger.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/'admin'/.test(read('src/core/ledger.ts')), '受領の履歴の種類 admin が台帳のモジュールにある');
check(/LEDGER_SOURCES/.test(read('src/modules/events/index.ts')), 'イベントの受け取りが種類の名前を台帳のモジュールから読む');
runTests();
requireTests([
  '管理の増減の本文はdeltaが0でない整数で上限の内のときだけ通す',
  '管理の付与で所持品が増え受領の履歴にadminの行が残る',
  '管理の取り消しは負の増減で履歴に残り残高を減らす',
  '残高より多い取り消しはINSUFFICIENT_BALANCEの409を返し何も書かない',
  '上限を超える管理の付与はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない',
  '取り消して残高が0になった品目は所持品の一覧から消える',
  '同じIdempotency-Keyの付与を2回送っても1回分で同じ本文を返す',
  '同じIdempotency-Keyの付与を並べて送っても1回分',
  '同じIdempotency-Keyで違う中身の付与はIDEMPOTENCY_KEY_REUSEDの422を返す',
  'Idempotency-Keyの無い管理の付与はINVALID_ARGUMENTの400を返す',
  '知らない品目か知らないプレイヤーへの管理の付与はNOT_FOUNDの404を返す',
  '管理の付与は監査のログに前と後の残高が残る',
  '管理でスコアを消すとランキングから消え監査に前のスコアが残る',
  '無いスコアを消すとNOT_FOUNDの404を返し監査に残さない',
  '受領の履歴の種類の名前は台帳のモジュールの1か所にある',
  // 受け取りの挙動が変わらないことを見張る（§9）
  '報酬を受け取ると所持品が増え受領の履歴に残る',
  '同じ期間の受け取りを並べて送っても付与は1回分',
  '所持品の上限を超える報酬はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// マイグレーション（全部）・守り・CLI モックを変えない（O3 は表を足さない）
const keep = ['migrations/', 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/modules/saves/', 'src/modules/config/',
  'src/modules/announcements/', 'scripts/', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

O4:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const cli = ['scripts', 'admin-cli.mjs'].join('/');
const requests = ['scripts', 'admin-requests.mjs'].join('/');
const types = ['scripts', 'admin-requests.d.mts'].join('/');
const files = [cli, requests, types];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
// ゲームのクライアントの代わり（CLI モック）に管理の鍵も管理の口も入れない（§3・§7）
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(!mock.includes('/v1/admin') && !mock.includes('ADMIN_API_KEY'), 'CLI モックに管理の口と鍵が無い');
check(/\/v1\/admin\/events/.test(read(requests)), '管理コマンドがイベントの定義の口を呼ぶ');
runTests();
requireTests([
  'イベントの定義の本文は期間と区切りと時差と報酬の行の数を確かめる',
  '管理の口で入れた品目とイベントがプレイヤーのイベントの一覧に出る',
  'イベントの定義を入れ直すと報酬の中身が置き換わる',
  '受け取りのあるイベントの区切りと始まりと時差は変えられない',
  '知らない品目を報酬にしたイベントの定義はNOT_FOUNDの404を返し何も書かない',
  '品目の種類は後から変えられない',
  'イベントの定義を入れると監査のログに前と後の定義が残る',
  '管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る',
  // イベントの受け取りと CLI モックが変わらないことを見張る（§9）
  '同じ期間の報酬を二重に受け取っても所持品は1回分で同じ本文を返す',
  'CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// マイグレーション（全部）・CLI モック・守りを変えない
const keep = ['migrations/', 'scripts/cli-mock.mjs', 'scripts/cli-requests.mjs', 'scripts/cli-requests.d.mts', 'scripts/issue-run/',
  'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/ledger.ts', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（`CLAUDE.md` の進め方の決まり）。
- 通しの確かめ（管理コマンドの `smoke` と `npm run cli:smoke`）は確認コマンドに入れない（無人の回では開発サーバーを起動せず、`.dev.vars` も作らない）。O4 の後に会話の側で回す（§0）。
- O2 の「`requireAuth` が DB を引かない」は文字列の確かめで見きれない所がある。判定役が差分（`src/core/auth.ts` に D1 の読み取りが足されていないか）で見る。

## 13. Phase 2 の残りの項目（プレイヤーデータ・クエスト・分析）との関係

`event-reward-design.md` §13 の順（管理 → プレイヤーデータ → クエスト → 分析）のまま。この設計が残りの項目に渡すもの:

| 項目（`roadmap.md` Phase 2） | この設計との関係 |
| --- | --- |
| プレイヤーデータ（実績・進行状態・統計値） | プレイヤーを読む口（§5）に、プレイヤーデータの欄を足す。直す口が要るなら、§6 と同じく履歴（前と後）を監査に残す形にする |
| クエスト（達成条件・報酬・進捗） | 報酬の付与は受け取りと同じ形（報酬の表から SQL で読む・一意の鍵・1 つの `batch`）で、`source_type` は `LEDGER_SOURCES` に `quest` を足す（§6）。クエストの定義は §7 のイベントの定義と同じく管理の口で入れる |
| 分析（DAU・継続率）・バックアップ・費用アラート | 監査のログの保持（365 日）を過ぎた行の掃除を Cron Triggers で作る（§5・§11 の決めること 13）。受領の履歴の `source_type = 'admin'` の行は、管理の付与と取り消しの集計の元になる。バックアップと費用アラートは管理の口と関係しない |

## 14. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 管理画面（ブラウザ） | Phase 4。§7 の管理の口をブラウザから呼ぶ（管理の鍵の置き場はブラウザのセッションでなく、Cloudflare Access などの人の確かめと一緒に決める。**要確認**） |
| 人ごとの管理の鍵・読み取りの監査 | `admin_keys(key_id, actor, key_hash, revoked_at)` を足し、`requireAdmin` が鍵から `actor` を決める（`X-Admin-Actor` の自己申告をやめる）。そのとき読み取りの口も監査に残す |
| アカウントの BAN（全部のゲーム） | `account_bans(account_id, …)` を足し、`requireNotBanned` が `game_players` から `account_id` を引いて両方を見る |
| 止めた印を Workers の中に持つ（D1 を引く回数を減らす） | 止めた印の読み取りが重くなったら（§4）。BAN の反映が遅れる時間との引き換えを決める |
| セーブの直し・前の版に戻す | セーブの版の履歴（`save_revisions`）を持つ設計と一緒に（§11 の決めること 6） |
| スコアを下げる・書き換える | 最高スコアだけを残す表の意味が変わる。要るならボードの決まり（`abuse-protection-design.md` §6）と一緒に |
| 監査のログの掃除 | §13 の分析（Cron Triggers・`wrangler.jsonc` の `triggers.crons`） |
| プレイヤーの消費の口と `idempotency_keys` | `event-reward-design.md` §6 |
| 品目・イベントを消す | 消さずに `endsAt` で終える（§7）。品目を消すには、残高と報酬の行の扱いを決める |
| Workers Logs などの外のログ・監視 | `wrangler.jsonc` の `observability` の設定（`config-schema.json` に項目がある）。設定の中身と料金は**要確認**。`operations-security.md` のログ・監視の節と一緒に |
| `APP_ENV` の守りを外すこと | §10。ユーザーが決める |

## 15. 指示の表

| Issue #33 の指示 | どこで答えるか |
| --- | --- |
| 管理の口の形（ローカルの管理コマンド・管理の HTTP API・両方）と管理画面の扱い | §2・§11 の決めること 1 |
| 管理の認証（管理の鍵の渡し方・置き場・取り替え。1 つか、ゲームごとか。比べ方） | §3・§11 の決めること 2 |
| 管理の操作の記録（監査のログ。表の形・保持の期間・Cron Triggers で消すか） | §5・§11 の決めること 13 |
| BAN（プレイヤーかアカウントか・止めた印の置き場・応答・`requireAuth` で D1 を引く重さ） | §4・§11 の決めること 3〜5 |
| データ修正（`inventory_ledger` に `source_type = 'admin'`・取り消しと残高の下限・セーブとスコア） | §6・§11 の決めること 6 |
| 二重の止め方（`Idempotency-Key` か修正の ID か） | §6・§11 の決めること 12 |
| イベントの定義の入れ方（`event-reward-design.md` §11 の決めること 7 の B） | §7・§11 の決めること 8 |
| 付与の文を `src/core/ledger.ts` へ移すか | §6・§11 の決めること 7 |
| 管理の鍵をファイルに書かない・`.dev.vars` と `wrangler secret put`・鍵が無い環境で通らないことを試験で・クライアントに持たせない | §3・§8 の O1 |
| `APP_ENV` の守りを外さない・管理の口の守り・守りを外す条件のうち満たせるもの | §10・§11 の決めること 11 |
| `scripts/cli-mock.mjs` に管理の操作を入れるか・管理の通しの確かめ | §7 |
| Cloudflare の数字・機能は公式で確かめたか「要確認」 | §1 |
| 新しいパッケージは足さない案を推し | §11 の決めること 14 |
| 試験の名前（束は `O1`・`O2`…）・名前の中の数の試験・互換の試験 | §8・§9 |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §12 |
| Phase 2 の残りの項目 | §13 |
