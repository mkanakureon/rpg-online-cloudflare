# アカウント（ゲストの最小形）の設計書

`docs/guides/decisions/roadmap.md` Phase 1 の「アカウント（ゲストの最小形）：アカウントの発行・トークン・ゲーム別のプレイヤー ID。テスト用の無認証 POST を廃止する」の設計書。

アカウントとゲーム別のプレイヤーのデータの境目・ゲストの発行の API・トークンの形と確かめ方・既存の書き込み（スコアの投稿）への当て方・CLI モックの変え方・確かめ方（試験の名前）・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`）と `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・`games`・`game_modules`・`requireGame`）。`tenant_id` を持たない・機能の設定（`game_modules`）は認可の代わりにしない・登録の無いゲームは 404、は決め直さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。失敗ケースの試験の名前の正は `docs/guides/working/failure-case-test-plan.md`（K3 の「認証後」の 7 本は §6 で名前で割り当てるだけで、§6 の表に写さない）。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§6 の試験の名前を `requireTests` に渡して実装の Issue を A1・A2 の順に回し、**ゲストのアカウントを発行するとゲーム別のプレイヤー ID とトークンが返り、トークンの無い・期限切れの・署名の正しくない・他のプレイヤーになりすました書き込みが断られ、CLI モック（`scripts/cli-mock.mjs`）はゲストを発行してからトークンを付けてスコアを送れる**のを見て、「送られてきた `playerId` を信じる」書き込みが無くなり、セーブを足す土台ができたと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§8 に決めること（案と推し）、§9 に実装の束がある | 機械（Issue #17 の確認コマンド） |
| ADR 0002・`core-foundation-design.md`・`account_id`・ゲーム別のプレイヤー ID・`Authorization`・`APP_ENV`・`NOT_READY_FOR_PRODUCTION`・`scripts/cli-mock.mjs`・K3・`game_modules` が出てくる。互換を見張る試験 `今のCLIモックと同じ形の要求を受け付ける` に名前で触れている | 機械（同上） |
| K3 の「認証後」の 7 本に名前で触れ（束への割り当てか範囲の外）、§6 の試験の名前の表に写していない | 機械（同上） |
| §6 の表の束は `A1`・`A2` だけ・名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§9） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/`・`test/`・`migrations/` の下を除く） | 機械（同上） |
| A1 がスコアの投稿の挙動を変えない・A2 の挙動の変化が §7 に全部挙がり、`docs/guides/decisions/test-plan.md` §11 の手続きで直す形になっている。`APP_ENV` の守りを外さない | AI の判定（作っていない判定役が、§2〜§7 と `src/`・`test/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§9 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- A1 はスコアの投稿・お知らせ・ランキングの挙動を変えない。§7 で A1 に挙げた 1 本のほかは、いまの試験を 1 行も変えずに通す。
- A2 は §7 に挙げた試験だけを、§7 の手続きで直す。ほかの試験の期待する結果を変えない。
- `今のCLIモックと同じ形の要求を受け付ける` は名前を変えず、全部の束で通す（A2 で中身を新しい CLI モックに合わせる。§7）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（§10）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

`src/`・`migrations/`・`test/`（2026-10-30 の main `20b07dd`）を読んで確かめた。

| 所 | いま |
| --- | --- |
| 書き込みの API | `POST /v1/rankings/{boardId}` だけ。`src/modules/rankings/index.ts` |
| 検査の順（POST） | ルートに当たらなければ 404 → `requireLocalWrite`（`APP_ENV !== 'local'` なら 403 `NOT_READY_FOR_PRODUCTION`・本文を読む前）→ JSON（400 `INVALID_JSON`）→ `parseScoreSubmission`（400 `INVALID_ARGUMENT`）→ `requireGame`（404 `NOT_FOUND`）→ 書き込み |
| プレイヤー | 本文の `playerId`（`^[a-zA-Z0-9_-]{1,64}$`）をそのまま信じる。誰でも誰の `playerId` でも書ける。アカウントの表は無い |
| 表 | `announcements`・`ranking_entries`（`migrations/0001_initial.sql`）・`games`（`0002`）・`game_modules`（`0003`。`game_id` に `ON DELETE CASCADE`）。`ranking_entries.player_id` に外部キーは無い |
| 機能の名前 | `src/modules/index.ts` の `modules = [announcements, rankings]`。ルーターが `known` として `requireGame` に渡す。`src/core/` は `src/modules/` を読み込まない |
| 環境 | `src/core/env.ts` の `Env = { DB; APP_ENV }`。`Database` の型は `prepare` だけ。`wrangler.jsonc` の既定は `APP_ENV=disabled`、`npm run dev` だけが `--var APP_ENV:local` を渡す。秘密の値は無い |
| エラーコード | 5 つ（`INVALID_ARGUMENT`・`NOT_FOUND`・`NOT_READY_FOR_PRODUCTION`・`INVALID_JSON`・`INTERNAL_ERROR`）。試験 `スキーマのErrorCodeの列挙は5つのエラーコードと一致する` が `openapi/rpg-online.v1.json` の `ErrorCode` と突き合わせる |
| スキーマの操作 | 4 つ（`getHealth`・`listAnnouncements`・`getRanking`・`submitScore`）。試験 `スキーマのファイルはOpenAPI 3.1で4つの操作を持つ` が数える |
| CLI モック | `scripts/cli-mock.mjs` が `/health` → お知らせ → `POST`（`Content-Type` だけ・トークン無し）→ `GET` の順に呼ぶ。本文は `scripts/cli-requests.mjs` の `scoreSubmission(playerId = 'cli-smoke-player')`（`gameId`・`playerId`・`displayName`・`score`）。試験 `今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`）が同じ関数で本文を作る |
| 試験の POST | `test/failure-input.test.ts`・`test/failure-server.test.ts`・`test/games.test.ts`・`test/game-modules.test.ts`・`test/schema-conformance.test.ts` が、ファイルごとの `post`／`postRaw` の手伝い（と `failure-input` の 1 か所の直書き）で `Authorization` 無しに POST する |

元の文書から引く決まり:

- 構想の §5「データベース設計の基本」（`docs/inspecs/2026/10/` の人が書いた入力。読むだけ）: `account_id`（共通アカウント）と `game_player_id`（ゲーム内プレイヤー）を分ける。外部の作者のゲームに内部の `account_id` をそのまま渡さず、ゲームごとに分けた公開用の ID を使う。`gameId` を指定するだけの API はアクセス制御に使えない。
- ADR 0002: アカウントをセーブより先に作る（「送られてきた `playerId` を信じる」形のセーブを作らないため）。`tenant_id` を持たず、表には `game_id` を持たせる。
- `docs/guides/decisions/operations-security.md` の公開前の必須要件 2（ID の単純申告を認可に使わない）・7（秘密情報を Git に入れない・Wrangler の Secrets）・10（環境分離）。

## 2. データの境目（A1）

### ID

| ID | どこに | 形 | クライアントに見せるか |
| --- | --- | --- | --- |
| `account_id` | `accounts` の主キー | `crypto.randomUUID()` | **見せない**（応答・トークン・ログに出さない）。後でゲームをまたいで同じ人を結ぶためだけに持つ |
| ゲーム別のプレイヤー ID（構想の `game_player_id`） | `game_players.player_id`。API では `playerId` | `crypto.randomUUID()`（`account_id` とは別の乱数。`account_id` から計算しない）。36 文字で `src/core/ids.ts` の `idPattern` に合う | 見せる。ランキングの `playerId` もこれになる |

`account_id` とゲーム別のプレイヤー ID は 1 対多（1 つのアカウントがゲームごとに 1 人のプレイヤーを持つ）。ゲストの発行は、1 回で「アカウント 1 つ＋そのゲームのプレイヤー 1 人」を作る。同じアカウントで別のゲームのプレイヤーを作る口（ログイン・引き継ぎ）は範囲の外（§11）。

### 表（`migrations/` の新しい番号 `0004_accounts.sql`）

```sql
CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT NOT NULL PRIMARY KEY,        -- 内部の ID。クライアントに返さない
  kind TEXT NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                     -- ゲーム別のプレイヤー ID（API の playerId）
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, account_id)                 -- 1 つのアカウントは 1 つのゲームに 1 人
);
```

- 初期データは入れない（`INSERT` が無いので、試験 `マイグレーションを2回当ててもデータは壊れない` は変わらない）。
- `games(game_id)` に `ON DELETE CASCADE` を付ける理由は `migrations/0003_game_modules.sql` と同じ（ゲームの行だけを消す `test/games.test.ts` の `beforeEach` が外部キーで断られないため）。
- `ranking_entries.player_id` には外部キーを足さない（既存の試験が `p1` などを直に入れるため。トークンを確かめた書き込みだけが `game_players` の ID で入る）。
- 外部の認証（Steam など）は、後で `account_identities(provider, subject, account_id)` の表を足すだけで結べる（§11）。

### 置き場

アカウントは `src/modules/` のモジュールにせず、**`src/core/` に置く**（§8 の決めること 1）。トークンを確かめるのはランキングやこれから作るセーブなど全部の書き込みのモジュールで、`src/core/` は `src/modules/` を読み込まない決まり（`core-foundation-design.md` §2）なので、確かめる側は core に要る。アカウントは `game_modules` で使う・使わないを切らない（どのゲームにも要る土台。`game_modules` に `accounts` の行を足さないので、試験 `demo-rpgはannouncementsとrankingsの両方を使う設定で登録される` と `モジュールの一覧はannouncementsとrankingsでルートが重ならない` は変わらない）。

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/core/token.ts` | ふつうの関数（入出力は Web Crypto だけ）: `signToken`・`verifyToken`・`parseBearer`・`tokenSecret`・定数 `TOKEN_TTL_SECONDS`・`LOCAL_DEV_TOKEN_SECRET`（§4） | A1 |
| `src/core/accounts.ts` | `POST /v1/accounts/guest` のルート（§3）と SQL。`Route` の形で書き、`src/core/router.ts` が `/health` の次に当てる | A1 |
| `src/core/auth.ts` | `requireAuth(req, env, now)`: `Authorization` を確かめ、通れば `{ gameId, playerId }`、通らなければ 401 の応答（§5） | A2 |
| `src/core/env.ts` | `Env` に `AUTH_TOKEN_SECRET?: string`、`Database` に `batch` を足す | A1 |

## 3. ゲストの発行の API（A1）

`POST /v1/accounts/guest`

要求:

```json
{"gameId":"demo-rpg"}
```

応答（200）:

```json
{"gameId":"demo-rpg","playerId":"6f1c…（UUID）","token":"v1.eyJn….Qk3…","expiresAt":"2026-11-29T00:00:00.000Z"}
```

検査の順（上から。最初に当たったもので返す）:

| # | 確かめ | 外れたとき |
| --- | --- | --- |
| 1 | `requireLocalWrite(env)`（書き込みの API。本文を読む前） | 403 `NOT_READY_FOR_PRODUCTION` |
| 2 | IP の利用制限（`consume`。本文を読む前。`abuse-protection-design.md` §2・§3） | 429 `RATE_LIMITED`・`Retry-After` |
| 3 | 本文が JSON | 400 `INVALID_JSON` |
| 4 | 本文がオブジェクトで、`gameId` が `validId`（知らない欄は無視） | 400 `INVALID_ARGUMENT` |
| 5 | `loadGame` でゲームが登録済み（`game_modules` は見ない。§2） | 404 `NOT_FOUND`（`Unknown game`） |
| 6 | ゲームの利用制限（`consume`。登録の後） | 429 `RATE_LIMITED`・`Retry-After` |
| 7 | `tokenSecret(env)` が鍵を返す（§4） | 例外を投げ、入口の `try/catch` で 500 `INTERNAL_ERROR`（中身を返さない） |
| 8 | `db.batch` で `accounts` と `game_players` に 1 行ずつ（どちらかが落ちれば両方入らない） | DB の失敗は 500 `INTERNAL_ERROR` |
| 9 | `signToken({ gameId, playerId, exp: now + TOKEN_TTL_SECONDS }, key)` | — |

- 応答に `account_id` を入れない（§2）。`expiresAt` はトークンの `exp` を ISO 8601 にしたもの。
- 状態は 200（ほかの POST と同じ。§8 の決めること 10）。

契約の変わる所（A1 の実装の Issue で、試験より先に直す。CLAUDE.md 原則 5。例外を追記しない）:

- `docs/api-contract.md` に `## POST /v1/accounts/guest` の節を足す（上の要求・応答・`APP_ENV=local` のときだけ通ること）。
- `openapi/rpg-online.v1.json` に操作 `issueGuest`（`POST /v1/accounts/guest`）・`GuestRequest`・`GuestIssued` を足す。応答は 200・400（`INVALID_ARGUMENT`・`INVALID_JSON`）・403（`NOT_READY_FOR_PRODUCTION`）・404（`NOT_FOUND`）・500（`INTERNAL_ERROR`）。エラーコードは足さない。
- `docs/guides/working/api-schema-design.md` §4 の S1 の表と確認コマンドの案の `スキーマのファイルはOpenAPI 3.1で4つの操作を持つ` を、§6 の `スキーマのファイルはOpenAPI 3.1で5つの操作を持つ` に置き換える（試験の名前の正の文書を、試験と同じ束で直す）。
- `docs/guides/working/architecture.md` の「4. データ境界」に `accounts`・`game_players` を足す（作っている表の一覧を置き換える）。

## 4. トークンの形と確かめ方（A1）

### 形

`v1.<本文>.<署名>`（3 つを `.` でつなぐ。§8 の決めること 2）

- 本文: `{"g":"<gameId>","p":"<playerId>","exp":<UNIX 秒>}` の JSON を UTF-8 にして base64url（`=` 無し）。`account_id` は入れない（本文はクライアントが読める）。
- 署名: `HMAC-SHA256(鍵, "v1." + 本文)` を base64url。Workers の Web Crypto（`crypto.subtle.importKey`・`sign`・`verify`）で作る。**パッケージを足さない。**
- 期限: `TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60`（30 日。`src/core/token.ts` の 1 か所。§8 の決めること 3）。

### 確かめ方（`verifyToken(token, key, nowSeconds)`）

上から順に見て、最初に外れた理由を返す。`now` は引数で受け取る（試験で時刻を動かすため）。

| # | 確かめ | 外れたときの理由 |
| --- | --- | --- |
| 1 | `.` で 3 つに分かれ、1 つ目が `v1` | `malformed` |
| 2 | 署名を `crypto.subtle.verify` で確かめる（文字列の比較をしない。かかる時間が中身で変わらない） | `bad_signature` |
| 3 | 本文が base64url の JSON で、`g`・`p` が `validId`・`exp` が整数 | `malformed` |
| 4 | `exp > now` | `expired` |

通れば `{ ok: true, claims: { gameId, playerId, exp } }`。署名を本文の読み取りより先に見るので、署名の正しくない本文は JSON として読まない。

`parseBearer(value)`: `Authorization` の値が `Bearer <トークン>`（`Bearer` は大文字小文字を区別しない・間は空白 1 つ以上）ならトークン、そうでなければ `null`。

### 鍵の置き場（§8 の決めること 4）

`tokenSecret(env)`:

| `env.AUTH_TOKEN_SECRET` | `env.APP_ENV` | 返す鍵 |
| --- | --- | --- |
| 32 文字以上の文字列 | どれでも | `AUTH_TOKEN_SECRET` |
| 無い | `local` | `LOCAL_DEV_TOKEN_SECRET`（コードに書いた、ローカル専用の公開された値。名前に `LOCAL_DEV` を入れる） |
| 無い・32 文字未満 | `local` でない | `null`（使う側は 500。公開された既定の鍵で署名も確かめもしない） |
| 32 文字未満 | `local` | `null`（設定の誤りを黙って既定に戻さない） |

- 本番（将来）は `wrangler secret put AUTH_TOKEN_SECRET` で渡す。**鍵の値をファイル（`wrangler.jsonc`・`.dev.vars`・ソース）に書かない**（`docs/guides/decisions/operations-security.md` の 7）。
- ローカル（`npm run dev`）は `APP_ENV=local` なので、何も足さずに `LOCAL_DEV_TOKEN_SECRET` で動く。`.dev.vars` は編集しない・`package.json` の `dev` も変えない。人が自分の鍵で試したいときは、自分で `.dev.vars` に `AUTH_TOKEN_SECRET` を書けば、それが勝つ。
- 試験は `fetch(要求, env)` に渡す `env` に `AUTH_TOKEN_SECRET` を入れて渡せる（鍵の取り替えの試験）。入れなければ `localEnv`（`APP_ENV: 'local'`）で既定の鍵になる。試験の手伝い `test/support/auth.ts`（A2）は `src/core/token.ts` の `signToken` と `LOCAL_DEV_TOKEN_SECRET` でトークンを作る。
- 鍵を変えると、それまでのトークンは全部 401 になる（取り消しの手段はこれだけ。§8 の決めること 2 のトレードオフ）。

## 5. スコアの投稿への当て方（A2）

### 検査の順（`POST /v1/rankings/{boardId}`）

| # | 確かめ | 外れたとき | いまとの差 |
| --- | --- | --- | --- |
| 1 | ルートに当たる | 404 `NOT_FOUND` `Endpoint not found` | 同じ |
| 2 | `requireLocalWrite(env)` | 403 `NOT_READY_FOR_PRODUCTION` | 同じ（**外さない**。§10） |
| 3 | `requireAuth`: `parseBearer` が `null` | 401 `UNAUTHENTICATED`（`Missing or malformed Authorization`） | 新しい |
| 3 | `tokenSecret(env)` が `null` | 500 `INTERNAL_ERROR` | 新しい |
| 3 | `verifyToken` が `malformed`・`bad_signature` | 401 `UNAUTHENTICATED`（`Invalid token`。どちらの理由かは返さない） | 新しい |
| 3 | `verifyToken` が `expired` | 401 `TOKEN_EXPIRED`（`Token expired`） | 新しい |
| 4 | 本文が JSON | 400 `INVALID_JSON` | 同じ（認証の後になる） |
| 5 | `parseScoreSubmission` | 400 `INVALID_ARGUMENT` | 同じ |
| 6 | プレイヤーの利用制限（`consume`。鍵はトークンの `g`・`p`。本文の形の後・なりすましの前。`abuse-protection-design.md` §3） | 429 `RATE_LIMITED`・`Retry-After` | 利用制限 R1 で足した |
| 7 | 本文の `gameId`・`playerId` がトークンの `g`・`p` と同じ | 403 `PERMISSION_DENIED`（`Token does not match player`） | 新しい（なりすまし） |
| 8 | `requireGame(env, gameId, 'rankings', known)` | 404 `NOT_FOUND` | 同じ |
| 9 | 書き込み | DB の失敗は 500 | 同じ |

- 認証（3）は本文を読む前（2 の守りと同じ理由: 認証されていない要求の本文を読まない）。
- `requireAuth` は DB を引かない（トークンは自己完結。§8 の決めること 2）。だから既存の DB の失敗の試験の順（`requireGame` で落ちて 500）は変わらない。
- 本文の `playerId` は残す（§8 の決めること 6）。本文の形（`gameId`・`playerId`・`displayName`・`score`）は変えず、`Authorization` の見出しを足すだけ。
- **テスト用の無認証 POST は A2 で廃止する**: `APP_ENV=local` でも、トークンの無い書き込みは 401（ロードマップの「テスト用の無認証 POST を廃止する」）。`APP_ENV` の守りは残るので、`local` でない環境の書き込みは、トークンがあっても無くても 403 のまま。

### 新しいエラーコード（§8 の決めること 8）

| コード | 状態 | いつ |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | `Authorization` が無い・`Bearer` でない・トークンの形か署名が正しくない |
| `TOKEN_EXPIRED` | 401 | トークンの期限が過ぎた（クライアントはゲストを発行し直す） |
| `PERMISSION_DENIED` | 403 | トークンのゲームかプレイヤーと、本文の `gameId`・`playerId` が違う |

契約の変わる所（A2 の実装の Issue で、試験より先に直す。CLAUDE.md 原則 5。例外を追記しない）:

- `docs/api-contract.md`: `POST /v1/rankings/{boardId}` の節に `Authorization: Bearer <token>` が要ること・本文の `playerId` がトークンと違えば 403 を書き、「`npm run dev` で…`APP_ENV=local` を与えた時のみ書込み可能」の行を「`APP_ENV=local` の時だけ・トークンがある時だけ」に置き換える。「現PoCの代表コード」の一覧を 8 つに置き換える。末尾の「※ HTTP認証方式と詳細スキーマはPhase 1で確定させる。」をこの設計書を指す 1 行に置き換える。
- `openapi/rpg-online.v1.json`: `ErrorCode` の列挙に 3 つを足す。`components.securitySchemes` に `bearerToken`（`type: http`・`scheme: bearer`）を足し、`submitScore` に `security` を付ける。`submitScore` に 401（`x-error-codes`: `UNAUTHENTICATED`・`TOKEN_EXPIRED`）を足し、403 の `x-error-codes` に `PERMISSION_DENIED` を足す。
- `docs/guides/working/api-schema-design.md` §4 の S1 の表と確認コマンドの案の `スキーマのErrorCodeの列挙は5つのエラーコードと一致する` を、§6 の `スキーマのErrorCodeの列挙は8つのエラーコードと一致する` に置き換える。
- `docs/guides/working/failure-case-test-plan.md`: §3 の `他のプレイヤーになりすました書き込みを弾く`・`トークンが無い書き込みは401を返す`・`期限切れのトークンは401を返す` の期待する結果の「コード（名）は認証の設計で決める」を、上のコードに置き換える。§4 の K3 の確認コマンドの案を、この設計書の A2 と範囲の外の 2 本（§6）に分けた形に置き換える。名前は変えない。

### CLI モック（`scripts/cli-mock.mjs`）の変え方（A2）

API を変えたら CLI モックも合わせる決まり（CLAUDE.md）なので、スコアの投稿にトークンが要るようになる A2 で変える。A1 では変えない（足した API を使わなくても、いまの通しの確かめは通る）。

1. `scripts/cli-requests.mjs` に `guestRequest()`（`{ gameId: 'demo-rpg' }` を返す）と `authHeaders(token)`（`{ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }`）を足し、`scripts/cli-requests.d.mts` に型を足す。`scoreSubmission(playerId)` は変えない。
2. `scripts/cli-mock.mjs` は `/health` → お知らせ → **`POST /v1/accounts/guest`（`guestRequest()`）** → `POST /v1/rankings/{smokeBoardId(now)}`（回すたびに別のボード `boss-score-<時刻の36進>`。同点の前の回の行が上位 10 件を埋めても自分の行が見つかるように。Issue #28）（本文は `scoreSubmission(発行された playerId)`・見出しは `authHeaders(発行された token)`）→ `GET` で載っているかを見る、の順にする。トークンは画面に出さない（`operations-security.md` の「トークンを記録しない」。応答の表示から `token` を伏せる）。
3. `npm run cli:smoke` は `npm run dev`（`APP_ENV=local`・既定の鍵）に対して通る。

## 6. 試験の名前の表

置き場は束ごとに 1 ファイル（A1 は `test/accounts.test.ts`、A2 は `test/auth.test.ts`）。ただし §7 で置き換える試験の後を継ぐ 2 本（`スキーマのファイルはOpenAPI 3.1で5つの操作を持つ`・`スキーマのErrorCodeの列挙は8つのエラーコードと一致する`）と、スキーマに合うかを見る 2 本（`ゲストの発行の応答はスキーマに合う`・`認証のエラーの応答はスキーマに合う`）は、手伝いの `expectConforms` がある `test/schema-conformance.test.ts` に置く。試験の手伝いは `test/support/auth.ts`（A2）。テストの名前は表の文そのまま `it('…')` に書く。名前を変えるときは、この表も同じコミットで直す（`docs/guides/procedures/node-test-procedure.md`）。

| 束 | テストの名前 | 入力 | 期待する結果 | 層 |
| --- | --- | --- | --- | --- |
| A1 | `トークンを作って確かめると同じゲームとプレイヤーと期限が戻る` | `signToken({gameId:'demo-rpg',playerId:'p1',exp:now+60}, key)` を `verifyToken(…, key, now)` | `ok: true`・`claims` が同じ 3 つ。トークンが `v1.` で始まり 3 つに分かれる | L1 |
| A1 | `トークンの本文か署名を1文字でも変えると署名の誤りとして弾く` | 本文の 1 文字・署名の 1 文字を変えたもの・別の鍵で作ったもの | どれも `bad_signature` | L1 |
| A1 | `期限の時刻を過ぎたトークンは期限切れとして弾く` | `exp = now` と `exp = now - 1` と `exp = now + 1` | 前の 2 つは `expired`・最後は `ok: true` | L1 |
| A1 | `形の崩れたトークンは形の誤りとして弾く` | 空文字・`.` が 1 つ・`v2.` で始まる・正しい署名で本文が JSON でない・`g` が `idPattern` に合わない | どれも `malformed`（署名の正しくないものは `bad_signature` が先）。「正しい署名で本文が崩れた」ものは `signToken` で作れないので、試験の中で Web Crypto の HMAC で直に署名して作る | L1 |
| A1 | `Authorizationの値からBearerのトークンだけを取り出す` | `Bearer abc`・`bearer  abc`・`Basic abc`・`Bearer`・`abc`・`null` | `abc`・`abc`・`null`・`null`・`null`・`null` | L1 |
| A1 | `鍵はAUTH_TOKEN_SECRETを使いローカルでだけ既定の鍵に戻る` | §4 の `tokenSecret` の表の 4 行 | 表のとおり（`local` でない環境で既定の鍵を返さない） | L1 |
| A1 | `ゲストの発行はアカウントとゲーム別のプレイヤーを1つずつ作りトークンを返す` | `APP_ENV=local`・`{"gameId":"demo-rpg"}` で POST | 200・`playerId` が `idPattern` に合う・`token` が `verifyToken` を通り `p` が `playerId`・`expiresAt` が `exp`。`accounts`・`game_players` が 1 行ずつ増え、`game_players` の `account_id` が `accounts` の行を指す | L2 |
| A1 | `ゲストの発行の応答に内部のaccount_idを入れない` | 同じ POST | 応答の本文（トークンの本文を base64url から戻したものも）に D1 の `account_id` の値が入らない。欄は `gameId`・`playerId`・`token`・`expiresAt` だけ | L2 |
| A1 | `ゲストを2回発行すると別のアカウントと別のプレイヤーIDになる` | 同じ本文で 2 回 POST | `playerId` が違う・`accounts` が 2 行 | L2 |
| A1 | `登録の無いゲームへのゲストの発行はNOT_FOUNDの404を返し何も作らない` | `{"gameId":"no-such-game"}` | 404・`NOT_FOUND`・`accounts`・`game_players` の行が増えない | L2 |
| A1 | `本番の設定ではゲストの発行もNOT_READY_FOR_PRODUCTIONの403を返す` | `APP_ENV` が `local` でない env で POST | 403・`NOT_READY_FOR_PRODUCTION`・行が増えない | L2 |
| A1 | `ゲストの発行の本文が正しくなければ400を返す` | 途中で切れた JSON・配列・`gameId` 無し・`gameId=demo.rpg` | 1 つ目は `INVALID_JSON`、ほかは `INVALID_ARGUMENT`・行が増えない | L2 |
| A1 | `ゲストの発行の応答はスキーマに合う` | 200・400・403・404 を起こす | 本文が `issueGuest` の応答のスキーマに合い、`x-error-codes` にコードがある（`test/schema-conformance.test.ts` の `expectConforms` を使う） | L2 |
| A1 | `スキーマのファイルはOpenAPI 3.1で5つの操作を持つ` | `openapi/rpg-online.v1.json` | 操作が `getHealth`・`getRanking`・`issueGuest`・`listAnnouncements`・`submitScore`・`$ref` が全部解ける（§7 で置き換える試験の後を継ぐ） | L1 |
| A2 | `トークンのゲームが違うスコアの投稿はPERMISSION_DENIEDの403を返す` | `other-rpg` を登録し、`other-rpg` のトークンで本文の `gameId` が `demo-rpg` の POST | 403・`PERMISSION_DENIED`・行が増えない | L2 |
| A2 | `認証の失敗は本文を読む前に返す` | トークン無しで本文 `{"gameId":`（切れた JSON） | 401・`UNAUTHENTICATED`（400 `INVALID_JSON` でない） | L2 |
| A2 | `BearerでないAuthorizationは401を返す` | `Authorization: Basic …`・`Bearer`（トークン無し） | どちらも 401・`UNAUTHENTICATED`・行が増えない | L2 |
| A2 | `AUTH_TOKEN_SECRETを変えると前の鍵のトークンは401になる` | 既定の鍵のトークンで、`AUTH_TOKEN_SECRET`（32 文字以上）を入れた env に POST | 401・`UNAUTHENTICATED`。同じ env の鍵で作ったトークンなら 200 | L2 |
| A2 | `発行したゲストのトークンで送ったスコアがそのプレイヤーとして載る` | ゲストを発行し、その `playerId` と `token` で POST のあと GET | 200・GET の `playerId` が発行された ID | L2 |
| A2 | `認証のエラーの応答はスキーマに合う` | `UNAUTHENTICATED`・`TOKEN_EXPIRED`・`PERMISSION_DENIED` を起こす | 本文が `submitScore` のスキーマに合い、`x-error-codes` にコードがある | L2 |
| A2 | `スキーマのErrorCodeの列挙は8つのエラーコードと一致する` | `openapi/rpg-online.v1.json` の `ErrorCode` | いまの 5 つと `UNAUTHENTICATED`・`TOKEN_EXPIRED`・`PERMISSION_DENIED`（§7 で置き換える試験の後を継ぐ） | L1 |

数（行）: A1 が 14・A2 が 7。どれも、いまの `test/` の名前と重ならない（2026-10-30 に `test/*.ts` の `it('…')` と突き合わせた）。

### K3（失敗ケースの計画の「認証後」の 7 本）の割り当て

名前の正は `docs/guides/working/failure-case-test-plan.md` §3。ここでは名前で割り当てるだけで、上の表に写さない。置き場は A2 の `test/auth.test.ts`。

| K3 の試験 | 割り当て | この設計での期待する結果 |
| --- | --- | --- |
| `トークンが無い書き込みは401を返す` | A2 | 401・`UNAUTHENTICATED`・行が増えない |
| `期限切れのトークンは401を返す` | A2 | `exp` が過去のトークン（`test/support/auth.ts` で作る）で 401・`TOKEN_EXPIRED`・行が増えない |
| `署名の正しくないトークンは401を返す` | A2 | 署名の 1 文字を変えたトークンで 401・`UNAUTHENTICATED`・本文に `bad_signature` も鍵も入らない |
| `他のプレイヤーになりすました書き込みを弾く` | A2 | `p1` のトークンで本文の `playerId` が `p2` の POST → 403・`PERMISSION_DENIED`・`p2` の行は変わらない |
| `認証が入っても本番でない環境の無認証の書き込みは403のまま` | A2 | `APP_ENV=disabled` でトークン無しの POST → 403・`NOT_READY_FOR_PRODUCTION`（401 でない。§5 の順の 2 が 3 より先）。§10 の条件で守りを外すまで残す |
| `決めた回数を超えて連投すると429を返す` | **範囲の外**（§8 の決めること 9） | ロードマップ「スコア不正対策と利用制限の適用範囲を決定」の設計で決める |
| `同じ送信IDの二重送信は1回分として扱う` | **範囲の外**（§8 の決めること 9） | 送信 ID は `Idempotency-Key` の見出し（失敗ケースの計画 §5 の決めること 4 の A）。保存の表と期限を、利用制限と同じ設計で決める |

## 7. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `スキーマのファイルはOpenAPI 3.1で4つの操作を持つ` | A1 | 操作が 5 つになり、名前の「4つ」が嘘になる | 消して、§6 の `スキーマのファイルはOpenAPI 3.1で5つの操作を持つ` に置き換える（見る範囲は増える） |
| `test/failure-input.test.ts`・`test/failure-server.test.ts`・`test/games.test.ts`・`test/game-modules.test.ts`・`test/schema-conformance.test.ts` の POST の試験（`post`・`postRaw` の手伝いと、`スコアが10億を超えると400を返す` の直書きの 1 か所） | A2 | トークンが無いと 401 で落ちる | **開始状態（要求の見出し）だけ**を直す: 手伝いが `test/support/auth.ts` の `bearer(gameId, playerId)` で本文の `gameId`・`playerId` のトークンを `Authorization` に付ける（本文がオブジェクトでない・`gameId` か `playerId` が `validId` に合わないときは `demo-rpg`・`p1`。形の正しくない ID でトークンを作ると §4 の確かめの 3 で `malformed` の 401 になり、`SQLを混ぜたgameIdはINVALID_ARGUMENTの400を返す`・`形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す` の 400 に届かないため。代わりの値のトークンでも、本文の検証（§5 の順の 5）がなりすましの確かめ（7）より先なので 400 のまま）。本文・env・期待する結果は 1 文字も変えない。`本番の設定では…403を返す` の試験も見出しが付くだけで、期待は 403 のまま |
| `今のCLIモックと同じ形の要求を受け付ける` | A2 | いまの CLI モックの要求（トークン無し）は 401 になる | **名前を変えず、中身を A2 の CLI モックに合わせる**: `scripts/cli-requests.mjs` の `guestRequest()` でゲストを発行し、`scoreSubmission(発行された playerId)` を `authHeaders(発行された token)` で POST、GET で載ることを見る。期待する結果（200・`ok: true`・GET の行がその本文と同じ）は変えない。CLI モックと試験が同じ関数を読むので、これからも「API を変えたら CLI モックも直す合図」のまま |
| `スキーマのErrorCodeの列挙は5つのエラーコードと一致する` | A2 | コードが 8 つになり、名前の「5つ」が嘘になる | 消して、§6 の `スキーマのErrorCodeの列挙は8つのエラーコードと一致する` に置き換える |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` | A2 | 試験の中の `errorCodes`（いまの 5 つ）と、起こしたコードの集合が一致するかを見ているので、8 つにすると足りなくなる | `errorCodes` に 3 つを足し、`submitScore` の 3 つのコードを起こす行を足す。いまの行と期待は変えない（見る範囲は増える） |
| `マイグレーションを2回当ててもデータは壊れない` | A1 | 変わらない（`0004` は `IF NOT EXISTS` だけ） | 変えない |
| `demo-rpgはannouncementsとrankingsの両方を使う設定で登録される`・`モジュールの一覧はannouncementsとrankingsでルートが重ならない` | A1 | 変わらない（アカウントは core に置き、`game_modules` に行を足さない。§2） | 変えない |

手続き（`docs/guides/decisions/test-plan.md` §11 は「テストを緑に合わせて弱めない・消さない。期待値を実装に合わせて書き換えない（直すのは実装か、設計を直してからテスト）」。上の置き換えは緑に合わせるためでなく**設計（契約）を先に変えたため**で、§11 の「設計を直してからテスト」の道を通る。互換の試験を黙って弱めないため、名前を残し、期待する結果を変えない）:

1. 先に設計を直す: 束の実装の Issue の最初のコミットで、§3（A1）・§5（A2）の「契約の変わる所」を `docs/api-contract.md`・`openapi/rpg-online.v1.json`・`docs/guides/working/api-schema-design.md`・`docs/guides/working/failure-case-test-plan.md` に写す（旧文を置き換える。CLAUDE.md 原則 5）。
2. 同じ束の中で試験を置き換える。消す 2 本（A1 で 1 本・A2 で 1 本）は、名前の数を直した、より広く見る試験に置き換わるので、確かめる範囲は減らない。
3. 確認コマンドで、消した名前が `test/` に残っていないこと・置き換えの名前が通ることを見る（§9）。
4. ほかの試験が落ちたら、期待する結果を直さず `docs/guides/decisions/test-plan.md` §8 の欠陥レポートの形で報告し、設計か実装かを振り分ける（design-cycle §5）。

## 8. 決めること

推しの案で §2〜§7 を書いた。ADR 0002 と `core-foundation-design.md` の決定（`tenant_id` を持たない・`src/core/` と `src/modules/<機能>/`・機能の設定は認可の代わりにしない・登録の無いゲームは 404）は前提で、ここに戻さない。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | アカウントの置き場 | A: **`src/core/`**（`token.ts`・`accounts.ts`・`auth.ts`）。`game_modules` で切らない。B: `src/modules/accounts/` の新しいモジュールにして、`game_modules` に `accounts` の行を足す | **A**。トークンを確かめるのは全部の書き込みのモジュールで、core は modules を読み込まない決まりなので、確かめる側は core に要る。B はアカウントを使わない設定のゲームが書き込めなくなるだけで得が無く、`0004` で `game_modules` に行を足すと試験 `demo-rpgはannouncementsとrankingsの両方を使う設定で登録される`（行がちょうど 2 つ）の期待が変わる |
| 2 | トークンの形 | A: **署名つきの自己完結の形**（`v1.<本文>.<HMAC-SHA256>`・Workers の Web Crypto・パッケージを足さない）。B: ランダムな値（32 バイト）を作り、その SHA-256 を D1 の表に持つ（取り消せる・書き込みごとに D1 を 1 回引く・鍵が要らない）。C: JWT のライブラリ（例: `jose`）で JWT（HS256）。パッケージを足す | **A**。書き込みごとに D1 を引かず、既存の DB の失敗の試験の順を変えない。K3 の `署名の正しくないトークンは401を返す` がそのまま当てはまる。取り消しは鍵の取り替え（全部）だけになるのがトレードオフで、1 人だけ取り消す必要（BAN など。Phase 2 の管理機能）が出たら B の表を足す。C は形が標準になるが、確かめるのは自分のサーバーだけで、パッケージを足す得が無い |
| 3 | 期限 | A: **30 日・更新の口は作らない**（期限が切れたらゲストを発行し直す。前のプレイヤーは引き継がない）。B: 1 時間の短いトークン＋長い更新用の秘密（D1 にハッシュ）と `POST /v1/accounts/token`。C: 期限無し | **A**。ゲストの最小形として範囲が小さい。いまのクライアントは CLI モックだけで、30 日の間に引き継ぎで困る人がいない。B は引き継ぎ（§11）と一緒に設計する。C は K3 の `期限切れのトークンは401を返す` に合わず、漏れたトークンが永久に使える |
| 4 | 署名の鍵の置き場 | A: **`AUTH_TOKEN_SECRET`（本番は `wrangler secret put`）。無ければ `APP_ENV=local` のときだけコードの `LOCAL_DEV_TOKEN_SECRET` に戻る**（§4）。B: `package.json` の `dev` に `--var AUTH_TOKEN_SECRET:…` を足す。C: `.dev.vars` に書いてもらう（無人の回は編集できない・人に頼む） | **A**。`package.json`・`wrangler.jsonc`・`.dev.vars` を変えずにローカルと試験が動き、`local` でない環境では公開された鍵を使わない（無ければ 500）。B は鍵の値をファイルに書く（ローカル用でも、本番の値と取り違える道を作る）。C は人の手が要り、試験の環境（vitest）には効かない |
| 5 | `account_id` とゲーム別のプレイヤー ID・クライアントに見せる ID | A: **別々の乱数（UUID）。クライアントに見せるのはゲーム別のプレイヤー ID（`playerId`）だけ**。B: `playerId` を `account_id` と `game_id` のハッシュで作る。C: `account_id` をそのまま `playerId` にする | **A**。構想 §5 の「内部のアカウント ID をそのまま渡さない・ゲームごとに分けた公開用の ID」に合う。B は鍵の無いハッシュなら `account_id` を知る人が他のゲームの ID を計算でき、鍵を持つと鍵が 2 つになる。C はゲームをまたいで同じ人だと分かってしまう |
| 6 | スコアの投稿の `playerId` | A: **本文の `playerId` を残し、トークンの `p`（と `g`）と違えば 403 `PERMISSION_DENIED`**。B: 本文の `playerId` を任意にしてトークンから取る（本文の欄は無視）。C: いまのまま本文だけを信じる | **A**。本文の形が変わらず、CLI モックと各エンジンのクライアントは見出しを足すだけ。K3 の `他のプレイヤーになりすました書き込みを弾く`（違う `playerId` で POST → 403）がそのまま試験になる。B は送った ID が黙って別の ID に置き換わり、クライアントの誤りが見えない。C はなりすましを防げない（ロードマップの完了条件「ほかのプレイヤーのデータには触れられない」に届かない） |
| 7 | いまの CLI モックの要求（トークン無し・本文に `playerId`）を受け続けるか | A: `APP_ENV=local` ではトークン無しも受け続ける。B: A2 では受け、次の束で断る（移行期間）。C: **A2 で断り（401）、同じ束で CLI モックと互換の試験 `今のCLIモックと同じ形の要求を受け付ける` を新しい要求に合わせる**（§7） | **C**。ロードマップの「テスト用の無認証 POST を廃止する」に合う。書き込みはローカル専用で、リポジトリの外に古い要求を送るクライアントが無い（ADR 0002。いまのクライアントは CLI モックだけ）。互換の試験は名前と期待する結果を残し、`docs/guides/decisions/test-plan.md` §11 の「設計を直してからテスト」で中身だけを CLI モックに合わせる（黙って弱めない）。A はなりすましの穴をローカルに残し、K3 の試験と両立しない。B は同じ変更を 2 回の束に分けるだけ |
| 8 | 新しいエラーコード | A: **`UNAUTHENTICATED`（401）・`TOKEN_EXPIRED`（401）・`PERMISSION_DENIED`（403）を足す**（§5）。B: 401 は `UNAUTHENTICATED` 1 つで、期限切れは `message` で分ける。C: なりすましも 401 | **A**。K3 の `期限切れのトークンは401を返す` の「期限切れと分かるコード」に合い、クライアントは `TOKEN_EXPIRED` だけでゲストの発行し直しに分岐できる。なりすましは「誰かは分かったが許されない」なので 403。`docs/api-contract.md` のコードの一覧と `openapi/rpg-online.v1.json` の `ErrorCode`・`submitScore` の `x-error-codes` を変える（§5） |
| 9 | 送信 ID（`Idempotency-Key`）と連投の制限（429） | A: この設計の束（A3）でやる。B: **後に回す**（ロードマップ「スコア不正対策と利用制限の適用範囲を決定」の設計で、2 つを一緒に） | **B**。どちらも「プレイヤーごと・時間ごと」の数え方と保存の表・期限を決める必要があり、アカウントが入ってから決めるほうが小さい。いまの最高スコアだけを残す書き込みは二重送信でも結果が同じ（K2 の `同じスコアを二重送信しても行は1つで結果は同じ`）なので、急がない。K3 の 2 本は §6 で範囲の外と書いた |
| 10 | ゲストの発行の応答の状態 | A: **200**。B: 201 Created | **A**。いまの `POST /v1/rankings/{boardId}` と同じで、クライアントの分岐が増えない |
| 11 | トークンを要るようにした書き込みを `/v1/` に置くか | A: **`/v1/` のまま**。B: `/v2/rankings/{boardId}` を足し、`/v1/` の POST はいまのまま残す | **A**。`docs/api-contract.md` の互換の決まりは本文の欄（足すだけ・消さない・意味を変えない）で、A2 も本文の欄は変えない。書き込みはこれまでローカル専用で、公開したクライアントが無い。B は無認証の書き込みの口を残す（決めること 7 の A と同じ穴） |

## 9. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| A1 | `migrations/` の新しい `0004_accounts.sql`・`src/core/token.ts`・`src/core/accounts.ts`（`POST /v1/accounts/guest`）・`src/core/router.ts` に発行のルート・`src/core/env.ts`・§3 の「契約の変わる所」・§6 の A1 の試験。スコアの投稿は変えない | M3（`core-foundation-design.md`） | §7 の手続きで 1 本を置き換え | 足さない |
| A2 | `src/core/auth.ts` の `requireAuth`・`src/modules/rankings/index.ts` で §5 の順に呼ぶ・`test/support/auth.ts`・既存の POST の試験の見出し・§5 の「契約の変わる所」・CLI モック（`scripts/cli-mock.mjs`・`scripts/cli-requests.mjs`・`scripts/cli-requests.d.mts`）・§6 の A2 の試験と K3 の 5 本 | A1 | §7 の手続きで 1 本を置き換え・2 本の中身を直し・POST の手伝いに見出しを足す | 足さない |

範囲の外（後の設計書）: K3 の残りの 2 本（連投の制限・送信 ID）・ログインと引き継ぎ・外部の認証（§11）・`APP_ENV` の守りを外すこと（§10。ユーザーが決める）。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。

`gitClean` は `base` を渡さないと作業ツリーしか見ず、無人の回がコミットした後は変えていても通ってしまう。どの案も先頭の `base` に、**実装の Issue を作るときの main のコミットの SHA** を書き入れ、`gitClean(…, { base })` で比べる（`docs/guides/procedures/issue-goal-setting.md`）。

A1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0004_accounts.sql', 'src/core/token.ts', 'src/core/accounts.ts', 'test/accounts.test.ts'];
mustExist(files);
gitTracked(files);
// パッケージを足さない・Web Crypto で署名する
const token = existsSync('src/core/token.ts') ? readFileSync('src/core/token.ts', 'utf8') : '';
check(/crypto\.subtle/.test(token) && /HMAC/.test(token), 'トークンは Web Crypto の HMAC で署名する');
// 置き換えた 1 本が残っていない（§7）
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
check(!all.includes('スキーマのファイルはOpenAPI 3.1で4つの操作を持つ'), '置き換えた試験が残っていない（4つの操作）');
const spec = JSON.parse(readFileSync('openapi/rpg-online.v1.json', 'utf8'));
check(Boolean(spec.paths['/v1/accounts/guest']?.post), 'スキーマに POST /v1/accounts/guest がある');
runTests();
requireTests([
  'トークンを作って確かめると同じゲームとプレイヤーと期限が戻る',
  'トークンの本文か署名を1文字でも変えると署名の誤りとして弾く',
  '期限の時刻を過ぎたトークンは期限切れとして弾く',
  '形の崩れたトークンは形の誤りとして弾く',
  'Authorizationの値からBearerのトークンだけを取り出す',
  '鍵はAUTH_TOKEN_SECRETを使いローカルでだけ既定の鍵に戻る',
  'ゲストの発行はアカウントとゲーム別のプレイヤーを1つずつ作りトークンを返す',
  'ゲストの発行の応答に内部のaccount_idを入れない',
  'ゲストを2回発行すると別のアカウントと別のプレイヤーIDになる',
  '登録の無いゲームへのゲストの発行はNOT_FOUNDの404を返し何も作らない',
  '本番の設定ではゲストの発行もNOT_READY_FOR_PRODUCTIONの403を返す',
  'ゲストの発行の本文が正しくなければ400を返す',
  'ゲストの発行の応答はスキーマに合う',
  'スキーマのファイルはOpenAPI 3.1で5つの操作を持つ',
  'マイグレーションを2回当ててもデータは壊れない',
  'demo-rpgはannouncementsとrankingsの両方を使う設定で登録される',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// スコアの投稿・CLI モック・既存のマイグレーションと試験（置き換える 1 本のファイルを除く）を変えない
gitClean(['src/modules/', 'scripts/', 'migrations/0001_initial.sql', 'migrations/0002_games.sql', 'migrations/0003_game_modules.sql',
  'test/failure-input.test.ts', 'test/failure-server.test.ts', 'test/games.test.ts', 'test/game-modules.test.ts', 'test/modules.test.ts',
  'test/support/games.ts', 'wrangler.jsonc', pkg], { base });
done();
```

A2:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
const files = ['src/core/auth.ts', 'test/support/auth.ts', 'test/auth.test.ts'];
mustExist(files);
gitTracked(files);
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
// CLI モックはゲストを発行してからトークンを付けて送る（§5）
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(mock.includes('/v1/accounts/guest') && mock.includes('Authorization'), 'CLI モックがゲストを発行し Authorization を付ける');
// APP_ENV の守りを外していない（§10）
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
// 置き換えた 1 本が残っていない（§7）・契約を先に直した（§5）
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
check(!all.includes('スキーマのErrorCodeの列挙は5つのエラーコードと一致する'), '置き換えた試験が残っていない（5つのエラーコード）');
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
const codes = spec.components?.schemas?.ErrorCode?.enum ?? [];
for (const c of ['UNAUTHENTICATED', 'TOKEN_EXPIRED', 'PERMISSION_DENIED']) check(codes.includes(c), 'スキーマの ErrorCode に ' + c + ' がある');
check(!read('docs/guides/working/failure-case-test-plan.md').includes('認証の設計で決める'), '失敗ケースの計画の「認証の設計で決める」を置き換えた');
runTests();
requireTests([
  'トークンのゲームが違うスコアの投稿はPERMISSION_DENIEDの403を返す',
  '認証の失敗は本文を読む前に返す',
  'BearerでないAuthorizationは401を返す',
  'AUTH_TOKEN_SECRETを変えると前の鍵のトークンは401になる',
  '発行したゲストのトークンで送ったスコアがそのプレイヤーとして載る',
  '認証のエラーの応答はスキーマに合う',
  'スキーマのErrorCodeの列挙は8つのエラーコードと一致する',
  // K3（名前の正は failure-case-test-plan.md §3）
  'トークンが無い書き込みは401を返す',
  '期限切れのトークンは401を返す',
  '署名の正しくないトークンは401を返す',
  '他のプレイヤーになりすました書き込みを弾く',
  '認証が入っても本番でない環境の無認証の書き込みは403のまま',
  // 互換と、見出しだけを直した既存の試験
  '今のCLIモックと同じ形の要求を受け付ける',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
  '本番の設定では登録の無いゲームへの投稿もNOT_READY_FOR_PRODUCTIONの403を返す',
  '同じプレイヤーIDでも他のゲームの記録は書き換えない',
  '書き込みでDBが失敗してもINTERNAL_ERRORの500を返す',
]);
// マイグレーション・お知らせ・設定を変えない（A2 は表を足さない）
gitClean(['migrations/', 'src/modules/announcements/', 'src/core/guards.ts', 'test/modules.test.ts', 'test/support/games.ts', 'wrangler.jsonc', pkg], { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり）。
- A2 の既存の試験の直しが §7 の「見出しだけ」に収まっているかは、確認コマンドでは見きれない。判定役が差分（期待する結果の行が変わっていないか）で見る。

## 10. `APP_ENV` の守りを外す条件（この設計の束では外さない）

`APP_ENV === 'local'` の時だけ書き込みを通す守り（`src/core/guards.ts`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` は CLAUDE.md の「守るもの」で、外すかどうかはユーザーが決める。A1・A2 では外さない（K3 の `認証が入っても本番でない環境の無認証の書き込みは403のまま` がそれを見張る）。外してよい条件と、そのとき直す所だけを書く。

外してよい条件（全部）:

1. A1・A2 が合格している（トークンの無い・期限切れ・署名の誤り・なりすましの書き込みが断られる）。
2. K3 の残りの 2 本（`決めた回数を超えて連投すると429を返す`・`同じ送信IDの二重送信は1回分として扱う`）と、ゲストの発行そのものの利用制限（IP ごと。発行の乱造を防ぐ）が実装され、試験が通る（`docs/guides/decisions/operations-security.md` の 4）。
3. スコアの自己申告をどこまで信じるか（`operations-security.md` の 3）を、ロードマップ「スコア不正対策と利用制限の適用範囲を決定」で決めてある。ゲストのアカウントは本人確認（同 1）でないことを、公開の説明に書いてある。
4. `AUTH_TOKEN_SECRET` を `wrangler secret put` で渡す手順があり、鍵が無い環境で書き込みが 500 になって通らないこと（§4 の `tokenSecret`）が試験で確かめられている。local／staging／production で D1 と鍵が分かれている（同 7・10）。
5. 守りを外した後の試験の置き換え（`認証が入っても本番でない環境の無認証の書き込みは403のまま` と、`NOT_READY_FOR_PRODUCTION` を期待する試験）を、§7 と同じ手続きで設計してある。

そのとき直す所:

- `CLAUDE.md` の「守るもの」の 2 行: 「**無認証の API をデプロイしない**」と「**書き込みの API は `APP_ENV === 'local'` のときだけ通し、ほかは `403 NOT_READY_FOR_PRODUCTION`。** `wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない」を、新しい決まり（例: 書き込みはトークンを確かめたときだけ通す・鍵をファイルに書かない）に置き換える。プロジェクトの節の「認証・レート制限・不正対策は未実装」も置き換える。
- `docs/guides/decisions/operations-security.md`: 冒頭の「現状」（無認証のスコア投稿は `APP_ENV=local` でのみ許可）を置き換え、公開前の必須要件の 1・2・4・7・10 のどれを満たしたかを書く。
- `docs/api-contract.md` の冒頭の「書込み系APIは公開用に使用しない」と、`NOT_READY_FOR_PRODUCTION` の説明。

## 11. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| Steam など外部の認証との連携 | `account_identities(provider, subject, account_id)` の表を足し、確かめた外部 ID から `account_id` を引いて同じトークンを発行する。トークンの形（§4）と `game_players` は変えない |
| ログイン（メールなど）・複数端末の引き継ぎ・同じアカウントで別のゲームのプレイヤーを作る | 引き継ぎ用の秘密（§8 の決めること 3 の B）か外部 ID でアカウントを確かめ、`game_players` に行を足す。`UNIQUE (game_id, account_id)` が 1 ゲーム 1 人を守る |
| 1 人だけのトークンの取り消し（BAN） | `docs/guides/working/admin-design.md` §4 で決めた: トークンは取り消さず、ゲームごとのプレイヤーを止めた印の表 `player_bans`（`migrations/0012_player_bans.sql`）を、4 つのモジュールがプレイヤーの利用制限の後に `requireNotBanned`（`src/core/bans.ts`）で引く。`requireAuth` は変えない（DB を引かない）。アカウント単位の BAN・トークンの取り消しは `admin-design.md` §14 |
| 連投の制限・送信 ID | §8 の決めること 9 |
| お知らせ・ランキングの GET に認証を付ける | 付けない（読み取りは公開。ランキングに出る `playerId` はゲーム別の公開用 ID で、`account_id` は出ない） |

## 12. 指示の表

| Issue #17 の指示 | どこで答えるか |
| --- | --- |
| アカウントとゲーム別のプレイヤーのデータの境目 | §2 |
| ゲストの発行の API | §3 |
| トークンの形と確かめ方・期限・鍵の置き場（ローカルと試験での渡し方） | §4・§8 の決めること 2〜4 |
| 既存の書き込み（スコアの投稿）への当て方 | §5・§8 の決めること 6 |
| CLI モックの変え方（どの束で、どう） | §5 の「CLI モックの変え方」・§9 の A2 |
| 確かめ方（テストの名前）・K3 の 7 本の割り当て（表に写さない） | §6 |
| いまの CLI モックの要求を受け続けるか・互換の試験の扱い（test-plan §11） | §7・§8 の決めること 7 |
| 新しいエラーコードと、契約・スキーマの何を変えるか | §5・§8 の決めること 8 |
| 送信 ID と連投の制限をこの束でやるか | §8 の決めること 9・§6 の K3 の割り当て |
| アカウントを `src/modules/` に置くか core に置くか | §2・§8 の決めること 1 |
| `APP_ENV` の守りを外さない・外す条件と、そのとき `CLAUDE.md`・`operations-security.md` のどこを変えるか | §10 |
| 外部の認証・ログイン・引き継ぎは範囲の外で、後から足せる形 | §11 |
| 新しいパッケージの案は書くだけ・Web Crypto の案を 1 つ挙げる | §8 の決めること 2（A が Web Crypto・C が JWT のライブラリ） |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §9 |
