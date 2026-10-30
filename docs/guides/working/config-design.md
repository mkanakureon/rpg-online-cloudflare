# 設定配信（機能フラグ・マスターデータ・ゲームの版）の設計書

`docs/guides/decisions/roadmap.md` Phase 1 の「設定配信：機能フラグ・マスターデータ・ゲームの版」の設計書。

ゲームごとの設定（機能フラグ・マスターデータ・クライアントに求める最低の版）の形・置き場（D1 か KV か）・読む API・変わっていなければ送り直さない仕組み（`ETag`）・設定の入れ方・認証と `APP_ENV` の扱い・機能の設定（`game_modules`）への足し方・CLI モックの変え方・確かめ方（試験の名前）・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`）・`docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・`games`・`game_modules`・`requireGame`・ゲームの登録はマイグレーション）・`docs/guides/working/account-design.md`（`requireAuth`・トークン `v1.<本文>.<HMAC>`・`APP_ENV` の守りと §10 の外す条件）・`docs/guides/working/save-design.md`（直前の機能の設計書。形と §8 の既存の試験の置き換えの手続き）。`tenant_id` を持たない・機能の設定は認可の代わりにしない・登録の無いゲームは 404・ゲームの登録はマイグレーション、は決め直さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§7 の試験の名前を `requireTests` に渡して実装の Issue を C1・C2 の順に回し、**クライアントが起動時に `GET /v1/config?gameId=demo-rpg&clientVersion=…` を 1 回読むと、そのゲームの機能フラグと「更新が要るか」が返り、2 回目からは `If-None-Match` で 304（本文なし）が返って送り直しが無く、マスターデータはキーごとに中身を解釈されないまま返り、CLI モック（`scripts/cli-mock.mjs`）が設定の読み取りから 304 までを通せる**のを見て、ゲームを作り直さずに機能の出し入れと古いクライアントへの更新の促しができる仕組みが、ゲームの中身を知らない共通のサーバーにできたと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§10 に決めること（案と推し）、§11 に実装の束がある | 機械（Issue #23 の確認コマンド） |
| ADR 0002・`core-foundation-design.md`・`account-design.md`・`save-design.md`・`game_modules`・`src/modules/`・機能フラグ・マスターデータ・ゲームの版・`APP_ENV`・`scripts/cli-mock.mjs`・`ETag` が出てくる。置き場の案に D1 と KV が出てくる | 機械（同上） |
| 機能の一覧や名前の中の数で挙動が変わりうる既存の試験 3 本と、互換を見張る `今のCLIモックと同じ形の要求を受け付ける` に名前で触れている（§8） | 機械（同上） |
| §7 の表の束は `C1`・`C2` だけ・名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§11） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/`・`test/`・`migrations/` の下を除く） | 機械（同上） |
| サーバーがマスターデータの中身を解釈しない（§2）。設定を書き換える API を作らない（§4）。`APP_ENV` の守りを外さない。挙動の変わる既存の試験が §8 に全部挙がり、`docs/guides/decisions/test-plan.md` §11 の手続きで直す形になっている | AI の判定（作っていない判定役が、§2〜§8 と `src/`・`test/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§11 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- C1・C2 はお知らせ・ランキング・ゲストの発行・セーブの挙動を変えない。§8 に挙げた試験のほかは、いまの試験を 1 行も変えずに通す。
- `今のCLIモックと同じ形の要求を受け付ける` は名前も中身も変えず、全部の束で通す（§8）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束。KV を足さない）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

`src/`・`migrations/`・`test/`（2026-10-30 の main `492f688`）を読んで確かめた。

| 所 | いま |
| --- | --- |
| 機能の名前 | `src/modules/index.ts` の `modules = [announcements, rankings, saves]`。ルーターが `known` として各ルートに渡し、モジュールが `requireGame` に渡す |
| ルートの型 | `src/core/module.ts` の `Route.method` は `'GET' \| 'POST' \| 'PUT' \| 'DELETE'`。ルーターはメソッドとパスの両方が合うルートを上から当て、無ければ 404 `Endpoint not found`（405 にしない） |
| 応答の見出し | `src/core/http.ts` の `jsonHeaders` が全部の応答に `cache-control: no-store` を付ける。`ETag`・304 を返す所は無い。試験 `登録の無いゲームのNOT_FOUNDの応答はスキーマに合う` が 404 の `no-store` を見る |
| 機能の設定 | `games`（`0002`）・`game_modules`（`0003`）。`0005` が既存のゲームに `saves` の行を入れた。`demo-rpg` は `announcements`・`rankings`・`saves` |
| 守り | `src/core/guards.ts` の `requireLocalWrite`: `APP_ENV !== 'local'` なら 403 `NOT_READY_FOR_PRODUCTION`。書き込みとセーブの全操作が呼ぶ。お知らせ・ランキングの `GET` は呼ばない（トークンも要らない） |
| 環境 | `src/core/env.ts` の `Env = { DB; APP_ENV; AUTH_TOKEN_SECRET? }`。`wrangler.jsonc` に D1 の `DB` だけ（KV・R2 は無い） |
| エラーコード | 11 個（`INVALID_ARGUMENT`・`NOT_FOUND`・`NOT_READY_FOR_PRODUCTION`・`INVALID_JSON`・`INTERNAL_ERROR`・`UNAUTHENTICATED`・`TOKEN_EXPIRED`・`PERMISSION_DENIED`・`SAVE_CONFLICT`・`PAYLOAD_TOO_LARGE`・`SLOT_LIMIT_EXCEEDED`） |
| スキーマの操作 | 9 つ（`getHealth`・`issueGuest`・`listAnnouncements`・`getRanking`・`submitScore`・`listSaves`・`getSave`・`putSave`・`deleteSave`） |
| SHA-256 | `src/modules/saves/checksum.ts` の `sha256Hex`（`crypto.subtle.digest`）。モジュールどうしは互いを読み込まない決まり（`src/modules/index.ts` の頭書き） |
| CLI モック | `scripts/cli-mock.mjs` が `/health` → お知らせ → ゲストの発行 → スコアの投稿 → ランキング → セーブの書いて読む → 一覧 → 削除。本文と見出しは `scripts/cli-requests.mjs`（型は `scripts/cli-requests.d.mts`）。`call()` は応答を必ず `response.json()` で読むので、本文の無い 304 は `call()` を通せない（削除の後の 404 と同じく `fetch` を直に使う） |

元の文書から引く決まり:

- 構想の §2（`docs/inspecs/2026/10/` の人が書いた入力。読むだけ）: 「設定配信：マスターデータ、機能フラグ、ゲームバージョン」は P0。
- 構想の §4「ゲームごとに機能を選択する」: 機能の設定は使える機能を決めるだけで、認証・認可の代わりにならない。→ 設定配信そのものも `game_modules` の 1 行で切る（§2）。**機能フラグ（ゲームの中の機能の出し入れ）と機能の設定（`game_modules`。サーバーの API を使うか）は別のもの**として扱う（§2）。
- 構想の §5 の `environment`（development / staging / production）: 識別子として分ける案。→ ADR 0002 の「ゲームごと・環境ごとに別々にデプロイ」と `docs/guides/decisions/operations-security.md` の 10（環境ごとに D1 を分ける）で、設定の中では分けない（§10 の決めること 5）。
- 構想の §6「Cloudflare の使い分け」: KV は「設定配信、キャッシュ」に「必要時」。D1 にあらゆる処理を集中させない。→ §10 の決めること 1 で D1 と KV を比べる。
- ADR 0002: ゲーム固有のルールを共通のサーバーに入れない。作る順はゲームの登録 → アカウント → セーブ → **設定配信**。→ サーバーはマスターデータの中身を解釈しない（§2）。

### Cloudflare の上限（2026-10-30 に公式の文書で確かめた）

| 何の | 上限 | 出どころ |
| --- | --- | --- |
| D1 の文字列・BLOB・1 行 | 2,000,000 バイト | developers.cloudflare.com/d1/platform/limits/（`save-design.md` §1 で同じ日に確かめた） |
| D1 の SQL の文の長さ | 100,000 バイト | 同上 |
| KV の 1 つの値 | 25 MiB | developers.cloudflare.com/kv/platform/limits/ |
| KV のキー | 512 バイト | 同上 |
| KV の同じキーへの書き込み | 1 秒に 1 回 | 同上 |
| KV の読み取り | Free は 1 日 100,000 回・Paid は無制限 | 同上 |
| KV の `cacheTtl` の最小 | 30 秒 | 同上 |

**要確認**: KV に書いた値が全部の場所から読めるようになるまでの時間（「最大 60 秒ほど」と言われるが、上の限度の頁には書かれていなかった）。§10 の決めること 1 で KV を推さない理由の一つなので、KV に移すときに確かめる。

## 2. データの形（C1: 機能フラグとクライアントの版。C2: マスターデータ）

### 用語の区別

| 語 | 何か | 誰が見るか |
| --- | --- | --- |
| 機能の設定（`game_modules`） | そのゲームがサーバーの API（`announcements`・`rankings`・`saves`・`config`）を使うか。無ければ 404 | サーバー（`requireGame`） |
| 機能フラグ | ゲームの中の機能（新しいショップの画面など）を出すかの真偽値。名前も意味もゲームが決める | クライアントだけ。サーバーは保存して返すだけ |
| マスターデータ | ゲームが使う表（アイテムの値段など）。キーごとの文字列。中身はゲームが決める | クライアントだけ。サーバーは解釈しない |
| クライアントの版（ゲームの版） | ゲームのビルドの版（`1.2.0` など）。サーバーはゲームごとに「最低の版」と「最新の版」を持つ | サーバーが比べて `update` を返す（§3） |

### サーバーが持つもの・持たないもの

サーバーはマスターデータを**解釈しない**（ADR 0002）。JSON として読まない・欄を見ない・中身で弾かない（大きさだけ数える）。機能フラグも名前と真偽値を返すだけで、サーバーの挙動はフラグで変えない（サーバーの挙動を切るのは `game_modules`）。設定は**全プレイヤーに同じもの**を配る（プレイヤーごと・段階的な配信は範囲の外。§9）。秘密（鍵・内部の URL）を設定に入れない（だれでも読めるため。§4）。

### 表（C1: `migrations/` の新しい番号 `0006_config.sql`）

```sql
-- ゲームごとのクライアントの版（1 ゲーム 1 行。行が無ければ版の決まりが無い）
CREATE TABLE IF NOT EXISTS game_configs (
  game_id TEXT NOT NULL PRIMARY KEY REFERENCES games(game_id) ON DELETE CASCADE,
  min_client_version TEXT,                     -- これより古いクライアントは update: "required"。NULL は決まりなし
  latest_client_version TEXT                   -- これより古いクライアントは update: "available"。NULL は決まりなし
);
-- 機能フラグ（名前ごとに 1 行。真偽値だけ。§10 の決めること 2）
CREATE TABLE IF NOT EXISTS config_flags (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  PRIMARY KEY (game_id, name)
);
-- それまでに登録したゲームは config を使う設定にする（0003・0005 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'config' FROM games;
-- demo-rpg の手本の設定（CLI モックの通しの確かめに使う）
INSERT OR IGNORE INTO game_configs (game_id, min_client_version, latest_client_version) VALUES ('demo-rpg', '1.0.0', '1.0.0');
INSERT OR IGNORE INTO config_flags (game_id, name, enabled) VALUES ('demo-rpg', 'demo-flag', 1);
```

- `games(game_id)` の `ON DELETE CASCADE` は `0003`〜`0005` と同じ理由（ゲームの行だけを消す `test/games.test.ts` の `beforeEach` が外部キーで断られないため）。
- 版の形（§3 の `parseVersion`）は SQL の `CHECK` で確かめられない（SQLite に正規表現が無い）ので、読むときに確かめる。形の外れた版が表にあれば、それはマイグレーションの誤りなので 500 `INTERNAL_ERROR`（`throw` して入口の `try/catch` に任せる）。§7 の L2 の試験で、手本のマイグレーションの版が形に合うことを見る。
- `INSERT OR IGNORE` と `IF NOT EXISTS` だけなので、2 回当てても壊れない（`マイグレーションを2回当ててもデータは壊れない` は変わらない）。
- 設定を**変える**ときは新しい番号のマイグレーションに `UPDATE game_configs …`・`INSERT … ON CONFLICT (game_id, name) DO UPDATE SET enabled = excluded.enabled` を書く（既存のファイルを書き換えない。CLAUDE.md の「守るもの」。§10 の決めること 4）。

### 表（C2: `migrations/` の新しい番号 `0007_config_master_data.sql`）

```sql
-- マスターデータ（キーごとに 1 行。data はサーバーが解釈しない文字列）
CREATE TABLE IF NOT EXISTS config_master_data (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  key TEXT NOT NULL,                           -- ^[a-zA-Z0-9_-]{1,64}$
  data TEXT NOT NULL CHECK (length(CAST(data AS BLOB)) <= 65536),  -- MAX_MASTER_DATA_BYTES（UTF-8 のバイト数）
  PRIMARY KEY (game_id, key)
);
```

- `demo-rpg` には手本の行を入れない（C2 の実装で決めた）。C1 の試験（`test/config.test.ts`）が `demo-rpg` の設定の応答の全体を `toEqual` で比べていて、手本を入れると `masterData` の欄が載って落ちるため。マスターデータの試験は専用のゲーム（`cfg-master` など）に行を入れて行う。

- 大きさの上限は `CHECK` で表に持たせる（書き込みの API が無いので、入れる側＝マイグレーションで断られるのが一番早い）。`length(CAST(data AS BLOB))` は UTF-8 のバイト数（D1 の文字の符号化は UTF-8）。64 KiB にした理由は §10 の決めること 3。
- マイグレーションの `INSERT` に値をそのまま書くので、D1 の「SQL の文の長さ 100,000 バイト」が先に効くことがある（`'` を `''` に逃がすと膨らむ）。長すぎる文はマイグレーションが失敗するので、黙って切れることは無い。そのときはキーを分ける。

### 定数（`src/modules/config/limits.ts` の 1 か所）

| 名前 | 値 | 理由 |
| --- | --- | --- |
| `MAX_MASTER_DATA_BYTES` | 65,536（64 KiB） | C2。`0007` の `CHECK` と同じ数（§10 の決めること 3）。§7 の試験で両方が同じことを見る |

### モジュールのファイル（`src/modules/config/`）

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/modules/config/version.ts` | ふつうの関数: `parseVersion(text)`（`^\d{1,9}(\.\d{1,9}){0,2}$` を数の配列に）・`compareVersions(a, b)`（区切りごとに数として比べ、足りない区切りは 0）・`updateStatus(client, min, latest)`（`'none' \| 'available' \| 'required' \| 'unknown'`） | C1 |
| `src/modules/config/etag.ts` | `etagOf(body)`（本文の UTF-8 の SHA-256 の 16 進を `"` で囲む。`crypto.subtle.digest`）・`matchesIfNoneMatch(header, etag)`（`*`・`,` で区切った複数・`W/` の弱い印を扱う） | C1 |
| `src/modules/config/limits.ts` | 上の定数 | C2 |
| `src/modules/config/index.ts` | `config: GameModule`（`name: 'config'`）のルートと SQL | C1（マスターデータは C2） |
| `src/modules/index.ts` | `modules = [announcements, rankings, saves, config]` | C1 |

- SHA-256 は `src/modules/saves/checksum.ts` にもあるが、モジュールどうしは読み込まない決まりなので `etag.ts` に 3 行で持つ（core に移す片付けは §9）。
- `src/core/` は変えない。`ETag` と `cache-control: no-cache` の見出しは `src/core/http.ts` の `json` を使わず、モジュールの中で `jsonHeaders` を広げて作る（エラーの応答は `error()` のまま `no-store`）。

## 3. API（C1: 設定を読む。C2: マスターデータを読む）

どれも `GET` だけ。**設定を書き換える API は作らない**（§4）。トークンも `APP_ENV` の守りも掛けない（§10 の決めること 6）。`Authorization` が付いていても確かめずに無視する。

### `GET /v1/config?gameId=demo-rpg&clientVersion=1.0.0`（C1。C2 で `masterData` を足す）

応答（200。見出し `content-type: application/json; charset=utf-8`・`cache-control: no-cache`・`etag: "<64 文字の 16 進>"`）:

```json
{"gameId":"demo-rpg","clientVersion":{"minimum":"1.0.0","latest":"1.0.0","update":"none"},"flags":{"demo-flag":true}}
```

C2 からは、マスターデータのあるゲームに `masterData` を足す（`/v1/` の中では欄を足すだけ。`docs/api-contract.md` の互換の決まり）。例は `items` に `{"potion":{"price":50}}`（23 バイト）を入れたゲーム `my-rpg`:

```json
{"gameId":"my-rpg","clientVersion":{"minimum":"1.0.0","latest":"1.0.0","update":"none"},"flags":{"demo-flag":true},"masterData":[{"key":"items","size":23}]}
```

- `clientVersion.minimum`・`latest`: 表の値。行が無い・`NULL` なら `null`。
- `clientVersion.update`: 問い合わせの `clientVersion` を `updateStatus` で比べた結果。`clientVersion` を送らなければ `"unknown"`。最低の版より古い → `"required"`、最新の版より古い → `"available"`、ほか（決まりが無いときも）→ `"none"`（§5）。
- `flags`: 名前 → 真偽値。名前の昇順に並べる（同じ設定なら同じ本文 → 同じ `ETag`）。無ければ `{}`。
- `masterData`（C2）: キーとバイト数の一覧（キーの昇順）。中身は入れない（§10 の決めること 3）。マスターデータが 1 つも無いゲームでは欄ごと載せない（C1 の形の応答のまま。スキーマで必須にしない）。

検査の順（上から。最初に当たったもので返す）:

| # | 確かめ | 外れたとき |
| --- | --- | --- |
| 1 | ルート（`^/v1/config$` と `GET`） | 404 `NOT_FOUND`（`Endpoint not found`。`POST` などほかのメソッドも） |
| 2 | 問い合わせの `gameId` が `validId` | 400 `INVALID_ARGUMENT`（`Invalid gameId`） |
| 3 | 問い合わせに `clientVersion` があれば（空の `clientVersion=` も含む）`parseVersion` が通る | 400 `INVALID_ARGUMENT`（`Invalid clientVersion`） |
| 4 | `requireGame(env, gameId, 'config', known)` | 404 `NOT_FOUND`（`Unknown game`・`Feature not enabled for this game`） |
| 5 | `game_configs`・`config_flags`（C2 は `config_master_data` の `key` と `length(CAST(data AS BLOB))` も）を `prepare().bind()` で引く。表の版が `parseVersion` に通らなければ `throw` | 500 `INTERNAL_ERROR`（入口の `try/catch`。中身を返さない） |
| 6 | 本文を作り、`etagOf(本文)` を計算する。`matchesIfNoneMatch(If-None-Match, etag)` なら 304 | — |

304 の応答: 本文なし・見出しは `etag`・`cache-control: no-cache` だけ。

### `GET /v1/config/master/{key}?gameId=my-rpg`（C2）

応答（200。見出しは上と同じ形の `cache-control: no-cache`・`etag`）:

```json
{"gameId":"my-rpg","key":"items","data":"{\"potion\":{\"price\":50}}"}
```

- `data` は入れた文字列そのまま（サーバーは JSON として読まない。`save-design.md` の決めること 3 と同じ理由で、送った物と返る物のバイト列を変えない）。
- 検査の順: 1 ルート（`^/v1/config/master/([a-zA-Z0-9_-]{1,64})$` と `GET`。形の外れたキーは 404 `Endpoint not found`）→ 2 `gameId`（400）→ 3 `requireGame(…, 'config', …)`（404）→ 4 `SELECT data FROM config_master_data WHERE game_id = ? AND key = ?`。無ければ 404 `NOT_FOUND`（`Master data not found`）→ 5 `ETag` と `If-None-Match`（304）。

### `ETag` とキャッシュの見出し（§10 の決めること 7）

- `ETag` は**応答の本文の SHA-256**（強い `ETag`）。設定の版の番号を表に持たない（マイグレーションを書く人が番号を進め忘れると、変わったのに 304 が返るため）。本文から計算するので、表を変えれば必ず変わる。
- `cache-control: no-cache`: 端末・途中のキャッシュは保存してよいが、使う前に毎回 `If-None-Match` で確かめる。変わっていなければ 304 で本文を送らない。`max-age` は付けない（機能フラグを切ったのが届くまでの遅れを作らない）。
- 304 でも D1 は引く（本文から `ETag` を作るため）。減るのは送る量だけ。D1 を引く回数を減らすのは §9。
- エラーの応答は `error()` のまま `cache-control: no-store`（いまの試験 `登録の無いゲームのNOT_FOUNDの応答はスキーマに合う` のとおり）。

### 新しいエラーコード（§10 の決めること 8）

足さない（11 個のまま）。形の外れは `INVALID_ARGUMENT`、無いゲーム・機能・キーは `NOT_FOUND`。古いクライアントは 200 の `update: "required"` で知らせる（エラーにしない）。だから `スキーマのErrorCodeの列挙は11個のエラーコードと一致する` と `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` は変わらない（§8）。

### 契約の変わる所（束の実装の Issue の最初のコミットで、試験より先に直す。CLAUDE.md 原則 5。例外を追記しない）

C1:

- `docs/api-contract.md`: `## GET /v1/config?gameId=demo-rpg&clientVersion=…` の節を足す（上の応答・`update` の決まり・`ETag` と `If-None-Match` と 304・トークンが要らないこと・設定に秘密を入れないこと）。エラーコードの一覧は変えない。
- `openapi/rpg-online.v1.json`: 操作 `getConfig`・`Config`・`ClientVersion` を足す。200 の `headers` に `ETag`、304（本文なし）、400・404・500 の `x-error-codes`。`security` は付けない（`listAnnouncements` と同じ）。
- `docs/guides/working/api-schema-design.md` §4 の `スキーマのファイルはOpenAPI 3.1で9つの操作を持つ` を、§7 の C1 の名前に置き換える。`test/modules.test.ts`・`test/game-modules.test.ts`・`test/schema-conformance.test.ts` の頭書きの「名前の正」の、置き換える旧い名前を挙げた文を、C1 で置き換えた試験はこの設計書 §7 が正だという文に**置き換える**（旧い名前を頭書きに残さない。§11 の確認コマンドは `it('…')` の名前だけを見るが、正の文書と試験を食い違わせないため。`save-design.md` §7・§11 の名前は V1・V2 の確認コマンドの記録なので変えない）。
- `docs/guides/working/architecture.md` の「4. データ境界」に `game_configs`・`config_flags` を足す（作っている表の一覧を置き換える）。

C2:

- `docs/api-contract.md`: `## GET /v1/config/master/{key}?gameId=demo-rpg` の節を足し、`GET /v1/config` の応答の例を `masterData` のある形に置き換える。
- `openapi/rpg-online.v1.json`: 操作 `getMasterData`・`MasterData` を足し、`Config` に `masterData` を足す（必須にしない。C1 の形の応答もスキーマに合う）。
- `docs/guides/working/api-schema-design.md` §4 の名前を §7 の C2 の名前に置き換える。`docs/guides/working/architecture.md` §4 に `config_master_data` を足す。

## 4. 認証・`APP_ENV`・書き換えの口が無いこと

- **設定を書き換える API（管理の口）は作らない。** 認証が無いので、無認証の書き込みの口を増やさない。管理画面・管理 API は Phase 2（ロードマップ）。設定はマイグレーションで入れる（§10 の決めること 4）。§7 の試験 `設定のパスへのGETのほかのメソッドはNOT_FOUNDの404を返す` で書き換えの口が無いことを見張る。
- **読むのにトークンも `APP_ENV` の守りも掛けない**（§10 の決めること 6）。設定は全プレイヤーに同じものを配る公開の情報で、セーブ（プレイヤーの非公開のデータ。`save-design.md` の決めること 8）と違う。ゲストの発行より前（起動直後・メンテナンスや更新の案内）に読みたい。いまのお知らせ・ランキングの `GET` と同じ扱い。
- **`APP_ENV === 'local'` の時だけ書き込みを通す守り（`requireLocalWrite`）は外さない**。設定配信には書き込みが無いので、守りを呼ぶ所も無い。`wrangler.jsonc` の既定 `APP_ENV=disabled` は変えない。守りを外す条件は `account-design.md` §10 のとおりで、ここでは決めない。デプロイもしない。
- `game_modules` の `config` の行は「そのゲームが設定配信を使うか」であって認可ではない（`core-foundation-design.md`）。行が無ければ 404 `Feature not enabled for this game`。
- 設定はだれでも読めるので、**秘密（鍵・内部の URL・未発表の情報）を機能フラグ・マスターデータに入れない**（`docs/api-contract.md` の節に書く）。

## 5. クライアントの版の扱い（§10 の決めること 9）

- **名乗るのはクライアント**: クライアントは自分のビルドの版を問い合わせの `clientVersion` で送る。サーバーはゲームごとに「最低の版」と「最新の版」を持つ（マイグレーションで入れる）。版をトークンに入れない（トークンを出し直さずに版を上げられるように）。
- **形**: `^\d{1,9}(\.\d{1,9}){0,2}$`（`1`・`1.2`・`1.2.3`）。英字の付いた版（`1.2.3-beta`）は受けない（400）。エンジンごとのビルドの番号はゲームがこの形にそろえて送る。
- **比べ方**（`compareVersions`）: ドットで区切り、区切りごとに**数として**比べる（`1.10` は `1.9` より新しい）。足りない区切りは 0（`1` と `1.0.0` は同じ）。
- **最低の版より古いクライアントに返すもの**: 200 と `update: "required"`（エラーにしない）。設定そのものも返す（更新の案内の文や店の URL をマスターデータで渡せるように）。どう止めるか（更新の画面を出すなど）はクライアントの仕事。
- **ほかの API は版で断らない**（C1・C2 とも）。セーブやスコアの投稿を最低の版で断るのは、ゲストのトークンに版が無く、偽れる値で断っても守りにならないので範囲の外（§9）。
- 最低の版・最新の版は `NULL` にできる（決まりが無い → `"none"`）。最低の版が最新の版より新しい表は、マイグレーションの誤りとして扱わず、そのまま比べる（`required` が先に当たる）。

## 6. CLI モック（`scripts/cli-mock.mjs`）の変え方（C1・C2）

API を変えたら CLI モックも合わせる決まり（CLAUDE.md）なので、**API を足す束ごとに、その束で足した API を CLI モックに足す**。

C1（設定を読む）:

1. `scripts/cli-requests.mjs` に `CLI_CLIENT_VERSION = '1.0.0'` と `configPath(gameId, clientVersion)`（`/v1/config?gameId=…&clientVersion=…` を返す）を足し、`scripts/cli-requests.d.mts` に型を足す。いまの `scoreSubmission`・`guestRequest`・`authHeaders`・セーブの関数は変えない。
2. `scripts/cli-mock.mjs` は `/health` の直後（ゲストの発行の前。トークンが要らないことを流れで見せる）に、**`GET /v1/config?gameId=demo-rpg&clientVersion=1.0.0` が 200 で `update` が `"required"` でないことを確かめ、応答の `etag` を `If-None-Match` に付けてもう一度読み、304 を確かめる** を足す。304 は本文が無いので `call()` を通さず `fetch` を直に使う（いまの削除の後の 404 と同じ）。

C2（マスターデータ）:

3. `scripts/cli-mock.mjs` の C1 の流れの後に、**設定の `masterData` の最初のキーを `GET /v1/config/master/<key>?gameId=demo-rpg` で読み、`data` のバイト数が一覧の `size` と同じことを確かめる** を足す。`data` は画面に出さない（`size` だけ出す。マスターデータは大きくなりうるため）。

どちらの束も、`npm run cli:smoke` は `npm run dev` に対して通る。`npm run db:migrate:local` で `0006`（C2 は `0007`）が当たっていることが前提。

## 7. 試験の名前の表

置き場は C1 が `test/config.test.ts`、C2 が `test/config-master.test.ts`。ただし、§8 で置き換える試験の後を継ぐものは置き換える試験と同じファイルに置く（機能の一覧は `test/modules.test.ts`、機能の設定は `test/game-modules.test.ts`、操作の数は `test/schema-conformance.test.ts`）。スキーマに合うかを見る試験（`設定の応答はスキーマに合う`・`マスターデータの応答はスキーマに合う`）は `expectConforms` がある `test/schema-conformance.test.ts` に置く。CLI モックの流れの試験は、互換の試験と並べて `test/failure-server.test.ts` に置く。試験のゲームは `test/support/games.ts` の `registerGame(db, id, ['config'])` で登録する（`test/support/games.ts` は変えない。既定の機能は `announcements`・`rankings` のまま）。設定の行は試験の中で `prepare().bind()` で入れる。テストの名前は表の文そのまま `it('…')` に書く。名前を変えるときは、この表も同じコミットで直す（`docs/guides/procedures/node-test-procedure.md`）。

- **設定を書き換える試験は専用のゲームで行う**（`registerGame(db, 'cfg-etag', ['config'])` などに行を入れる）。`demo-rpg` の手本（`demo-flag`）は書き換えない。同じファイルの中では D1 の中身が引き継がれるので、手本を書き換えると後に走る試験が順番しだいで落ちる。ファイルの `beforeEach` は試験のゲームの行（`games` の `demo-rpg` 以外）を消す。
- **304 は `expectConforms` に通さない**（いまの手伝いは本文が JSON であることを必ず見るので、本文の無い 304 で落ちる）。スキーマに合うかの試験の中で、状態が 304・本文が空・スキーマに 304 の応答があり、その `headers` の `ETag` の形に合う、を直に見る。手伝い（`expectConforms`）は変えない。

| 束 | テストの名前 | 入力 | 期待する結果 | 層 |
| --- | --- | --- | --- | --- |
| C1 | `版の文字列の検証関数は数字とドットの1から3つの組だけを通す` | `parseVersion` に `1`・`1.2`・`1.2.3`・`0.0.0`、外れとして `''`・`1.`・`.1`・`1.2.3.4`・`1.2.3-beta`・`v1`・`1.a`・10 桁の数・`null` | 正しいものだけ数の配列。外れは `null` | L1 |
| C1 | `版の比べ方は区切りごとに数として比べ足りない区切りを0とみなす` | `compareVersions` に `1.10` と `1.9`・`1` と `1.0.0`・`2.0` と `1.99.99` | 正・0・正（逆に並べると符号が逆） | L1 |
| C1 | `クライアントの版と最低の版と最新の版から更新の要否を決める` | `updateStatus` に（最低より古い）・（最低と同じで最新より古い）・（最新と同じ）・（最新より新しい）・（クライアントの版が無い）・（最低と最新が `null`） | `required`・`available`・`none`・`none`・`unknown`・`none` | L1 |
| C1 | `If-None-Matchの解釈は弱い印と複数の値と星印を扱う` | `matchesIfNoneMatch` に `null`・同じ値・`W/` の付いた同じ値・`"x", <同じ値>`・`*`・違う値 | false・true・true・true・true・false | L1 |
| C1 | `ETagは本文のSHA-256の16進を引用符で囲み同じ本文なら同じ値になる` | `etagOf` に同じ文字列 2 回と 1 文字違う文字列 | `^"[0-9a-f]{64}"$`・同じ・違う | L1 |
| C1 | `設定を読むとそのゲームの機能フラグとクライアントの版が返る` | `demo-rpg` の `GET /v1/config?gameId=demo-rpg&clientVersion=1.0.0`（`0006` の手本のまま） | 200・`clientVersion` が `{minimum:'1.0.0', latest:'1.0.0', update:'none'}`・`flags` が `{'demo-flag': true}`。手本の版が `parseVersion` に通る | L2 |
| C1 | `設定の応答にはETagとno-cacheのcache-controlが付く` | 同じ要求 | `etag` が `^"[0-9a-f]{64}"$`・`cache-control` が `no-cache`・`content-type` が JSON | L2 |
| C1 | `同じETagをIf-None-Matchで送ると本文の無い304を返す` | 1 回目の `etag` を `If-None-Match` に付けてもう一度 | 304・本文が空・同じ `etag` | L2 |
| C1 | `設定が変わるとETagが変わり古いETagでは200と新しい本文を返す` | 専用のゲームで 1 回目の後に `config_flags` を `UPDATE` し、古い `etag` を付けて読む | 200・新しい `flags`・`etag` が 1 回目と違う | L2 |
| C1 | `最低の版より古いクライアントの版を送るとupdateがrequiredの200を返す` | 最低 `1.2.0`・最新 `1.3.0` のゲームに `clientVersion=1.1.9` | 200・`update: 'required'`・`flags` も返る | L2 |
| C1 | `最新の版より古く最低の版以上のクライアントにはupdateがavailableを返す` | 同じゲームに `clientVersion=1.2.0`・`1.3.0`・`1.10.0` | `available`・`none`・`none` | L2 |
| C1 | `クライアントの版を送らなければupdateがunknownを返す` | `clientVersion` 無し | 200・`update: 'unknown'`・`minimum`・`latest` は表の値 | L2 |
| C1 | `形の外れたクライアントの版はINVALID_ARGUMENTの400を返す` | `clientVersion=1.2.3-beta`・`clientVersion=` | 400・`INVALID_ARGUMENT` | L2 |
| C1 | `設定の行が無いゲームは版がnullで機能フラグが空の設定を返す` | `registerGame(db, 'cfg-empty', ['config'])` だけで読む | 200・`minimum: null`・`latest: null`・`update: 'none'`（版を送ったとき）・`flags: {}` | L2 |
| C1 | `他のゲームの機能フラグは設定に混ざらない` | `other-rpg` に別のフラグを入れ、`demo-rpg` を読む | `demo-rpg` の `flags` に `other-rpg` の名前が無い | L2 |
| C1 | `configを使わない設定のゲームの設定はNOT_FOUNDの404を返す` | `registerGame(db, 'no-config', ['rankings'])` を読む | 404・`NOT_FOUND`（`Feature not enabled for this game`）・`cache-control: no-store` | L2 |
| C1 | `登録の無いゲームの設定はNOT_FOUNDの404を返す` | `gameId=no-such-game`・`gameId=demo.rpg` | 404 `NOT_FOUND`（`Unknown game`）・400 `INVALID_ARGUMENT` | L2 |
| C1 | `設定はトークンが無くても本番の設定でも読める` | `APP_ENV` が `disabled` の env・`Authorization` 無し／壊れたトークン付き | どれも 200 で同じ本文（`NOT_READY_FOR_PRODUCTION` にも 401 にもならない） | L2 |
| C1 | `設定のパスへのGETのほかのメソッドはNOT_FOUNDの404を返す` | `APP_ENV=local` で `/v1/config` に `POST`・`PUT`・`DELETE` | どれも 404 `Endpoint not found`・表が変わらない | L2 |
| C1 | `ゲームの行を消すとそのゲームの設定も消える` | `other-rpg` を `config` つきで登録して版とフラグを入れ、`games` から消す | `game_configs`・`config_flags` に `other-rpg` の行が残らない。`demo-rpg` の行は残る | L2 |
| C1 | `設定の読み取りでDBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない` | `prepare` が投げる偽の DB・表に形の外れた版（`1.x`）を入れたゲーム | どちらも 500・`INTERNAL_ERROR`・本文に SQL が入らない | L2 |
| C1 | `設定の応答はスキーマに合う` | 200・400・404 と 304 を起こす | 200・400・404 の本文が `getConfig` の応答のスキーマに合い（`expectConforms`）、`x-error-codes` にコードがある。200 のスキーマに `ETag` の見出しがある。304 は本文が空で、`etag` がスキーマの 304 の見出しの形に合う（`expectConforms` に通さない） | L2 |
| C1 | `スキーマのファイルはOpenAPI 3.1で10個の操作を持つ` | `openapi/rpg-online.v1.json` | いまの 9 つと `getConfig`・`$ref` が全部解ける（§8 で置き換える試験の後を継ぐ） | L1 |
| C1 | `demo-rpgはannouncementsとrankingsとsavesとconfigを使う設定で登録される` | `game_modules` の `demo-rpg` の行 | `['announcements', 'config', 'rankings', 'saves']`（§8 で置き換える試験の後を継ぐ） | L2 |
| C1 | `モジュールの一覧はannouncementsとrankingsとsavesとconfigでルートが重ならない` | `modules` | 名前が 4 つ・`メソッド パターン` が重ならない・どれも `/health` に当たらない（§8 で置き換える試験の後を継ぐ） | L1 |
| C1 | `CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る` | `scripts/cli-requests.mjs` の `configPath`・`CLI_CLIENT_VERSION` で読み、`etag` を付けてもう一度（`scripts/cli-mock.mjs` の C1 の流れ。§6） | 200・`update` が `required` でない・2 回目が 304 | L2 |
| C2 | `マスターデータを読むと入れた文字列がそのまま返る` | 専用のゲーム `cfg-master` に入れた `items`（`{"potion":{"price":50}}`）と、改行・`'`・絵文字を含む文字列を入れたキー | 200・`data` が入れた文字列とバイト列まで同じ | L2 |
| C2 | `マスターデータの応答にはETagが付き同じETagなら304を返す` | 専用のゲームのキーで、1 回目の `etag` を `If-None-Match` に付けてもう一度・`data` を変えて古い `etag` で | 304 で本文なし・200 で新しい `data` と違う `etag`。`cache-control` は `no-cache` | L2 |
| C2 | `設定の応答にマスターデータのキーと大きさの一覧が載る` | キーを 2 つ入れたゲームの `GET /v1/config` | `masterData` がキーの昇順で `size` が UTF-8 のバイト数。`data` は入らない | L2 |
| C2 | `マスターデータが変わると設定のETagも変わる` | 専用のゲームで、大きさの違う `data` に書き換えて `GET /v1/config` | `etag` が変わる（`size` が本文に入るため） | L2 |
| C2 | `無いキーのマスターデータはNOT_FOUNDの404を返す` | `GET /v1/config/master/no-such-key?gameId=demo-rpg`・形の外れたキー `bad.key` | 404 `NOT_FOUND`（`Master data not found`）・404 `NOT_FOUND`（`Endpoint not found`） | L2 |
| C2 | `他のゲームのマスターデータは読めない` | `other-rpg` だけにある `secret-table` を `gameId=demo-rpg` で読む | 404・`NOT_FOUND` | L2 |
| C2 | `configを使わない設定のゲームのマスターデータはNOT_FOUNDの404を返す` | `registerGame(db, 'no-config', ['rankings'])` に行を入れて読む | 404・`NOT_FOUND`（`Feature not enabled for this game`） | L2 |
| C2 | `上限を超えるマスターデータは表に入らず上限ちょうどは入る` | `MAX_MASTER_DATA_BYTES` バイトと 1 バイト多い文字列（`あ` で 3 バイトずつ数えるものも）を `INSERT` | ちょうどは入り、超えると `CHECK` で断られる（行が増えない） | L2 |
| C2 | `マスターデータの応答はスキーマに合う` | 200・304・404 と、`masterData` のある `getConfig` の 200 | 200・404 が `getMasterData`・`getConfig` の応答のスキーマに合う。304 は本文が空で `etag` がスキーマの 304 の見出しの形に合う（`expectConforms` に通さない） | L2 |
| C2 | `スキーマのファイルはOpenAPI 3.1で11個の操作を持つ` | `openapi/rpg-online.v1.json` | C1 の 10 個と `getMasterData`（C1 の 10 個の操作の試験の後を継ぐ） | L1 |
| C2 | `CLIモックと同じ流れで設定に載ったマスターデータを読める` | 同じ関数で設定を読み、`masterData` の最初のキーを読む（`scripts/cli-mock.mjs` の C2 の流れ。§6） | 200・`data` のバイト数が一覧の `size` と同じ | L2 |

数（行）: C1 が 26・C2 が 11。どれも、いまの `test/` の名前と重ならない（2026-10-30 に `test/*.ts` の `it('…')` と突き合わせた）。

## 8. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される`（`test/game-modules.test.ts`） | C1 | `0006` が `demo-rpg` に `config` の行を足すので、行がちょうど 3 つの期待が外れる | 消して、§7 の `demo-rpgはannouncementsとrankingsとsavesとconfigを使う設定で登録される` に置き換える（見る範囲は増える） |
| `モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない`（`test/modules.test.ts`） | C1 | 一覧が 4 つになり、名前がちょうど 3 つの期待が外れる | 消して、§7 の `モジュールの一覧はannouncementsとrankingsとsavesとconfigでルートが重ならない` に置き換える（ルートが重ならない・`/health` に当たらないの確かめはそのまま） |
| `スキーマのファイルはOpenAPI 3.1で9つの操作を持つ`（`test/schema-conformance.test.ts`） | C1 | 操作が 10 個になる | 消して、§7 の `スキーマのファイルはOpenAPI 3.1で10個の操作を持つ` に置き換える。C2 で同じ手続きで `…11個の操作を持つ` に置き換える |
| `スキーマのErrorCodeの列挙は11個のエラーコードと一致する`・`エラーの応答はスキーマに書いた状態とエラーコードの組で返る`（同上） | C1・C2 | **変わらない**（エラーコードを足さない。§3） | 名前も中身も変えない |
| `今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`） | C1・C2 | **変わらない**。スコアの流れ（ゲストの発行 → トークン付きの投稿 → `GET`）は変えない。`scripts/cli-requests.mjs` の `guestRequest`・`authHeaders`・`scoreSubmission` も変えない | 名前も中身も変えない。CLI モックに足す設定の流れは、§7 の新しい試験 `CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る`（C1）・`CLIモックと同じ流れで設定に載ったマスターデータを読める`（C2）で見る（互換の試験を広げて中身を変えるより、黙って弱める道を作らない） |
| `CLIモックと同じ流れでゲストのセーブを書いて読み直せる`・`CLIモックと同じ流れでセーブの一覧に出たスロットを消せる`（同上） | C1・C2 | 変わらない（セーブの関数を変えない） | 変えない |
| `登録の無いゲームのNOT_FOUNDの応答はスキーマに合う`（`test/games.test.ts`） | C1 | 変わらない（試すパスを手で並べた表で、設定のパスは入らない。エラーの応答は `no-store` のまま） | 変えない。設定の 404 は §7 の `configを使わない設定のゲームの設定はNOT_FOUNDの404を返す` で見る |
| `test/schema-conformance.test.ts` の手伝い `expectConforms` を使う試験 | C1・C2 | 変わらない（304 は手伝いに通さず試験の中で見る。§7） | 手伝いも試験も変えない |
| `マイグレーションを2回当ててもデータは壊れない` | C1・C2 | 変わらない（`0006`・`0007` は `IF NOT EXISTS` と `INSERT OR IGNORE` だけ） | 変えない |
| `機能の設定はゲームごとで他のゲームの設定に引きずられない` ほか、`registerGame` で登録するゲームの試験 | C1・C2 | 変わらない（`test/support/games.ts` の既定の機能は `announcements`・`rankings` のままで、試験のゲームは `config` を使わない） | 変えない（`test/support/games.ts` も変えない） |

手続き（`docs/guides/decisions/test-plan.md` §11 は「テストを緑に合わせて弱めない・消さない。期待値を実装に合わせて書き換えない（直すのは実装か、設計を直してからテスト）」。上の置き換えは緑に合わせるためでなく**設計（機能の一覧と契約）を先に変えたため**で、§11 の「設計を直してからテスト」の道を通る。`save-design.md` §8 と同じ手続き）:

1. 先に設計を直す: 束の実装の Issue の最初のコミットで、§3 の「契約の変わる所」を `docs/api-contract.md`・`openapi/rpg-online.v1.json`・`docs/guides/working/api-schema-design.md`・`docs/guides/working/architecture.md` に写す（旧文を置き換える。CLAUDE.md 原則 5）。
2. 同じ束の中で試験を置き換える。消す試験（C1 で 3 本・C2 で 1 本）は、名前の数を直した、同じかより広く見る試験に置き換わるので、確かめる範囲は減らない。
3. 確認コマンドで、消した名前が `test/` に残っていないこと・置き換えの名前が通ることを見る（§11）。
4. ほかの試験が落ちたら、期待する結果を直さず `docs/guides/decisions/test-plan.md` §8 の欠陥レポートの形で報告し、設計か実装かを振り分ける（design-cycle §5）。

## 9. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 設定を書き換える API・管理画面 | Phase 2 の管理機能。管理用の認可の設計と一緒に、`game_configs`・`config_flags`・`config_master_data` を書く口を作る。`ETag` は本文から作るので、書く口が増えても読む側は変えない |
| 環境ごとに違う設定（staging だけフラグを立てる） | §10 の決めること 4 の B（環境ごとの SQL を `wrangler d1 execute --file` で当てる）を足す。読む API は変えない |
| プレイヤーごと・割合での段階的な配信・A/B テスト | フラグに条件の欄を足す別の設計。いまは全員に同じ値なので、`ETag` を全員で共有できる |
| D1 を引く回数を減らす（304 でも引いている） | KV か Cache API に、ゲームごとの本文と `ETag` を置く（§10 の決めること 1 の B・C）。書き換えの口ができてから（入れた時に消す仕組みと一緒に） |
| 最低の版でほかの API（セーブ・スコア）を断る | 版を偽れない形（署名つきのビルドの証明など）ができてから。いまは 200 の `update: "required"` で促すだけ |
| SHA-256 の手伝いを `src/core/` に一つにまとめる | `src/modules/saves/checksum.ts` と `src/modules/config/etag.ts` の SHA-256 を core の 1 関数にする片付け。挙動は変わらない |
| 64 KiB を超えるマスターデータ | R2 に置き、`config_master_data` に置き場の列を新しいマイグレーションで足す。API の形（`data`）は変えない |
| `demo-rpg` のマスターデータの手本（`npm run cli:smoke` でマスターデータの流れも通す） | C1 の試験（`test/config.test.ts`）の `demo-rpg` の応答の比べ方を、見る欄だけの `toMatchObject` に直す Issue の後で、新しい番号のマイグレーションに手本の `INSERT` を書く。API は変えない |
| ブラウザから読むときの CORS（`ETag` を読ませる `Access-Control-Expose-Headers`） | Phase 3 のブラウザのクライアントで、全部の API の CORS と一緒に決める |

## 10. 決めること

推しの案で §2〜§8 を書いた。ADR 0002・`core-foundation-design.md`・`account-design.md`・`save-design.md` の決定は前提で、ここに戻さない。新しいパッケージは、どの推しでも足さない（パッケージの要る案は D だけで、推さない）。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 置き場 | A: **D1 の表（`game_configs`・`config_flags`・`config_master_data`）**。B: KV（ゲームごとに 1 つの値に設定の全部を JSON で置く）。`wrangler.jsonc` に `"kv_namespaces": [{ "binding": "CONFIG", "id": "<本番の ID。ファイルに書かない>" }]`、`Env` に `CONFIG: KVNamespace` を足し、`npm run cf-typegen` で `worker-configuration.d.ts` を作り直す（この Issue では変えない）。入れ方は `wrangler kv key put`。C: コードに埋める（`src/modules/config/` の下の JSON をビルドに含める）。D: KV に置き、読み書きを手伝うパッケージを足す | **A**。設定の入れ方をゲームの登録と同じマイグレーションにでき（決めること 4）、`game_modules`・`games` と同じ D1 で `ON DELETE CASCADE` と `requireGame` がそのまま効く。`wrangler.jsonc` を変えずに済み、試験は Miniflare の D1 で回る。B は読むのが速く D1 の負荷を減らせる（構想 §6 の「KV は設定配信、キャッシュ」）が、書いてから全部の場所に届くまでの遅れ（要確認。§1）があり、入れ方がマイグレーションの外（`wrangler kv key put`）になって、ローカル・試験・本番で入れる手順が別になる。同じキーへの書き込みは 1 秒に 1 回。C は設定を変えるたびにデプロイが要り、ゲームを作り直さずに機能を出し入れするゴールに合わない。D はパッケージを足す（足さずに済む A がある）。D1 の負荷が気になったら、A のまま KV をキャッシュとして前に置く（§9） |
| 2 | 機能フラグの形 | A: **真偽値だけ（`config_flags.enabled` が 0 か 1。応答は `{名前: true/false}`）**。B: 真偽値・数・文字列のどれか（JSON の値を文字列で持つ）。C: 何でも入る JSON | **A**。3 つのエンジンで受ける型が 1 つに決まり（UE の JSON で型の混ざった物を読むのは手間）、スキーマで `additionalProperties: { type: boolean }` と書ける。数や文字列の値（ドロップ率・URL）はマスターデータに置く（決めること 3。中身をゲームが決める所に寄せる）。B・C はフラグとマスターデータの境目がぼやける。足すときは `/v1/` の中で新しい欄（例: `values`）を足せる |
| 3 | マスターデータの形と大きさの上限 | A: 1 ゲーム 1 つの JSON の文字列を設定の応答に入れる。B: **キーごとの文字列（`config_master_data`）。設定の応答にはキーと大きさの一覧だけを載せ、中身はキーごとの `GET /v1/config/master/{key}` で、キーごとの `ETag` を付けて返す。1 キー 64 KiB（65,536 バイト）まで（表の `CHECK`）**。C: キーごとの JSON の値（サーバーが JSON として読んで返す）。上限の案: 64 KiB・1 MB（D1 の 1 行 2,000,000 バイトの半分）・決めない | **B と 64 KiB**。変わった表だけ取り直せる（アイテムの値段を変えても、ほかの表は 304）。設定の応答は小さいまま（起動のたびに読むもの）。中身を文字列のまま返すので、送った物と返る物のバイト列が変わらない（`save-design.md` の決めること 3 と同じ）。A は 1 つ変えると全部を送り直す。C はサーバーが JSON を読み直して書き出し、エンジンごとの書き方の違いでバイト列が変わる。64 KiB はマイグレーションの 1 つの `INSERT` が D1 の「SQL の文の長さ 100,000 バイト」に収まりやすい大きさ（`'` を逃がすと膨らむので、確実ではない。超えるとマイグレーションが失敗して気づける。§2）。上限を上げるのは互換を壊さない |
| 4 | 設定の入れ方 | A: **新しい番号のマイグレーション（ゲームの登録と同じ。`INSERT OR IGNORE`、変えるときは `UPDATE`・`ON CONFLICT DO UPDATE`）**。B: マイグレーションの外の SQL のファイルを環境ごとに置き、`wrangler d1 execute --file` で当てる（書き込みの API を増やさない）。C: 設定を書き換える API（管理の口） | **A**。書き込みの口を増やさず、`core-foundation-design.md` のゲームの登録と同じ道で、ローカル・試験・本番に同じ手順で入る（試験の D1 にも `test/apply-migrations.ts` で当たる）。履歴が git に残る。弱みは全部の環境に同じ設定が入ること（決めること 5）で、要るようになったら B を足す（§9）。C は認証が無いので作らない（Issue の決まり。Phase 2） |
| 5 | `environment`（development・staging・production）を設定の中で分けるか | A: **分けない（`environment` の列を持たない）**。B: 表に `environment` の列を持ち、Worker の `APP_ENV` で選ぶ | **A**。ADR 0002 の「ゲームごとに別々にデプロイ」と `operations-security.md` の 10（環境ごとに D1 を分ける）で、環境はデプロイと D1 で分かれる。B は 1 つの D1 に全部の環境の設定が入り、`APP_ENV` を読む所が増える（`APP_ENV` はいま守りのためだけの値）。環境ごとに違う値が要るときは決めること 4 の B で、その環境の D1 にだけ当てる |
| 6 | 読む API にトークンや `APP_ENV` の守りを掛けるか | A: **掛けない（お知らせ・ランキングの `GET` と同じ）**。B: トークンを要る（`requireAuth`）。C: `APP_ENV` の守りを掛ける（`local` でなければ 403） | **A**。設定は全プレイヤーに同じものを配る公開の情報で、非公開のセーブと違う（`save-design.md` の決めること 8 は非公開だから掛けた）。ゲストの発行より前に読みたい（更新の促し・メンテナンスの案内）。秘密を入れない決まり（§4）と組にする。B はゲストの発行（`local` だけ）より前に読めない。C は本番の設定で更新の促しが届かない。どの案でも書き込みの守り（`requireLocalWrite`）は外さない（書き込みが無い） |
| 7 | 変わっていなければ送り直さない仕組みと、キャッシュの見出し | A: **本文の SHA-256 を強い `ETag` にし、`If-None-Match` が合えば 304。`cache-control: no-cache`**。B: 表に設定の版の番号を持ち、それを `ETag` にする。C: `ETag` を使わず `cache-control: max-age=60` で端末に持たせる。D: 本文の中の `revision` をクライアントが比べる（HTTP の仕組みを使わない） | **A**。表を変えれば必ず変わる（B は番号を進め忘れると、変わったのに 304 が返り、黙って古い設定が残る）。`no-cache` は「保存してよいが使う前に確かめる」なので、機能フラグを切ったのが次の起動で必ず届く（C は最大 60 秒遅れ、304 も無い）。HTTP の標準なので、ブラウザは何もしなくても `If-None-Match` を送る。D は 3 つのクライアントに独自の比べを書かせる。SHA-256 は Web Crypto でパッケージが要らない |
| 8 | 新しいエラーコードを足すか | A: **足さない（`INVALID_ARGUMENT`・`NOT_FOUND`・`INTERNAL_ERROR` を使い回す。古いクライアントは 200 の `update: "required"`）**。B: 古いクライアントに 426 と `CLIENT_UPGRADE_REQUIRED` を返す。C: 無いマスターデータのキーに `MASTER_DATA_NOT_FOUND` を足す | **A**。B は古いクライアントが設定（更新の案内の文や店の URL）を読めなくなり、エラーコードの試験 2 本の期待が変わる。C は `NOT_FOUND` の `message` で分かり、クライアントの分岐が増えない。足すときは `/v1/` の中で「足すだけ」で移れる |
| 9 | クライアントの版の扱い | A: **クライアントが `clientVersion` を問い合わせで名乗り、サーバーが `^\d{1,9}(\.\d{1,9}){0,2}$` を区切りごとに数で比べて `update`（`none`・`available`・`required`・`unknown`）を返す。ほかの API は版で断らない**（§5）。B: サーバーは最低の版・最新の版を返すだけで、比べるのはクライアント。C: SemVer の全部（`-beta` などの前置き版）を受ける | **A**。比べ方が 1 か所（L1 の試験のある `compareVersions`）に決まり、3 つのエンジンで `1.10` と `1.9` の比べを書き分けずに済む。B は比べ方の食い違いがエンジンごとに出る。C は前置き版の順序の決まりが複雑で、要るゲームが出てから足せる（形を広げるのは互換を壊さない） |
| 10 | 束の分け方 | A: **C1 で設定を読む（機能フラグ・クライアントの版・`ETag`・304・`game_modules` の `config`・CLI モックの読む流れ）、C2 でマスターデータ（キーごとの読む API・設定の一覧・CLI モックのマスターデータを読む流れ）**。B: 1 つの束で全部 | **A**。C1 だけで「機能フラグが届く・古いクライアントに更新を促す・変わらなければ 304」のゴールの芯が確かめられ、1 つの Issue の差分が小さい。マスターデータは表とルートが別で、C1 の応答に欄を足すだけで載る。B は 1 回の無人の回で 37 本の試験になる |
| 11 | 設定配信を `src/modules/` に置き、`game_modules` で切るか | A: **`src/modules/config/` のモジュールにし、`game_modules` の `config` の行で使う・使わないを切る。`0006` で既存のゲーム（`demo-rpg` を含む）を使う設定にする**。B: `src/core/` に置き、全部のゲームで使う。C: モジュールにするが `demo-rpg` には行を足さない | **A**（Issue の出発点のとおり）。設定配信を使わないゲーム（ランキングだけのブラウザゲーム）があり得るので切れるほうがよい。ほかのモジュールは設定を読まない（サーバーの挙動はフラグで変えない。§2）ので、core に置く理由が無い。`demo-rpg` を使う設定にするので、`demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される` と `モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない` を §8 の手続きで置き換える。C は CLI モックの通しの確かめ（ロードマップの完了条件）が `demo-rpg` で通らない |

## 11. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| C1 | `migrations/` の新しい `0006_config.sql`・`src/modules/config/`（`version.ts`・`etag.ts`・`index.ts` の `GET /v1/config`）・`src/modules/index.ts` に `config`・§3 の C1 の「契約の変わる所」・CLI モックの設定を読む流れ（`scripts/cli-mock.mjs`・`scripts/cli-requests.mjs`・`scripts/cli-requests.d.mts`。§6）・§7 の C1 の試験 | V2（`save-design.md`） | §8 の手続きで 3 本を置き換え | 足さない |
| C2 | `migrations/` の新しい `0007_config_master_data.sql`・`src/modules/config/limits.ts`・`GET /v1/config/master/{key}`・`GET /v1/config` の `masterData`・§3 の C2 の「契約の変わる所」・CLI モックのマスターデータを読む流れ（§6）・§7 の C2 の試験 | C1 | §8 の手続きで 1 本を置き換え | 足さない |

範囲の外（後の設計書）: §9 の表。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。

`gitClean` は `base` を渡さないと作業ツリーしか見ず、無人の回がコミットした後は変えていても通ってしまう。どの案も先頭の `base` に、**実装の Issue を作るときの main のコミットの SHA** を書き入れ、`gitClean(…, { base })` で比べる（`docs/guides/procedures/issue-goal-setting.md`）。

束は既存のテストのファイル（`test/schema-conformance.test.ts`・`test/modules.test.ts`・`test/game-modules.test.ts`・`test/failure-server.test.ts`）に手を入れるので、そのファイルを `gitClean` で守れない。代わりに、**`base` の `test/*.ts` にあった試験の名前を全部、§8 で置き換える名前を除いて `requireTests` に渡す**（消した・名前を変えた・落ちる試験があれば止まる。`runTests()` は試験を消しても PASS になるため）。

C1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const namesIn = (src) => [...src.matchAll(/\bit\('([^']+)'/g)].map((m) => m[1]);
const files = ['migrations/0006_config.sql', 'src/modules/config/index.ts', 'src/modules/config/version.ts',
  'src/modules/config/etag.ts', 'test/config.test.ts'];
mustExist(files);
gitTracked(files);
// パッケージを足さない・Web Crypto で ETag を作る
check(/crypto\.subtle\.digest/.test(read('src/modules/config/etag.ts')), 'ETag は Web Crypto の digest で作る');
// 設定を書き換える口を作らない・GET だけ（§4）
const mod = read('src/modules/config/index.ts');
check(/method:\s*'GET'/.test(mod) && !/method:\s*'(POST|PUT|DELETE)'/.test(mod), '設定のモジュールは GET のルートだけを持つ');
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/'config'/.test(read('migrations/0006_config.sql')) && /game_modules/.test(read('migrations/0006_config.sql')), '0006 が既存のゲームを config を使う設定にする');
// CLI モックが設定を読み、304 を受け取る（§6）
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(mock.includes('/v1/config') && /If-None-Match/i.test(read('scripts/cli-mock.mjs')) && read('scripts/cli-mock.mjs').includes('304'), 'CLI モックが設定を読み If-None-Match で 304 を確かめる');
// 置き換えた 3 本が残っていない（§8）・残りの既存の試験は全部ある（下の requireTests）
const replaced = ['demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される', 'モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない',
  'スキーマのファイルはOpenAPI 3.1で9つの操作を持つ'];
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
for (const n of replaced) check(!namesIn(all).includes(n), '置き換えた試験が残っていない: ' + n);
const baseTests = execSync(`git ls-tree --name-only ${base} test/`, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'))
  .flatMap((f) => namesIn(execSync(`git show ${base}:${f}`, { encoding: 'utf8' })));
check(baseTests.length > 0, 'base の試験の名前を読めた');
// 契約を先に直した（§3）・エラーコードは足さない
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check(Boolean(spec.paths?.['/v1/config']?.get), 'スキーマに GET /v1/config がある');
check((spec.components?.schemas?.ErrorCode?.enum ?? []).length === 11, 'スキーマの ErrorCode は 11 個のまま');
check(read('docs/api-contract.md').includes('/v1/config'), '契約に設定の節がある');
runTests();
requireTests([
  '版の文字列の検証関数は数字とドットの1から3つの組だけを通す',
  '版の比べ方は区切りごとに数として比べ足りない区切りを0とみなす',
  'クライアントの版と最低の版と最新の版から更新の要否を決める',
  'If-None-Matchの解釈は弱い印と複数の値と星印を扱う',
  'ETagは本文のSHA-256の16進を引用符で囲み同じ本文なら同じ値になる',
  '設定を読むとそのゲームの機能フラグとクライアントの版が返る',
  '設定の応答にはETagとno-cacheのcache-controlが付く',
  '同じETagをIf-None-Matchで送ると本文の無い304を返す',
  '設定が変わるとETagが変わり古いETagでは200と新しい本文を返す',
  '最低の版より古いクライアントの版を送るとupdateがrequiredの200を返す',
  '最新の版より古く最低の版以上のクライアントにはupdateがavailableを返す',
  'クライアントの版を送らなければupdateがunknownを返す',
  '形の外れたクライアントの版はINVALID_ARGUMENTの400を返す',
  '設定の行が無いゲームは版がnullで機能フラグが空の設定を返す',
  '他のゲームの機能フラグは設定に混ざらない',
  'configを使わない設定のゲームの設定はNOT_FOUNDの404を返す',
  '登録の無いゲームの設定はNOT_FOUNDの404を返す',
  '設定はトークンが無くても本番の設定でも読める',
  '設定のパスへのGETのほかのメソッドはNOT_FOUNDの404を返す',
  'ゲームの行を消すとそのゲームの設定も消える',
  '設定の読み取りでDBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない',
  '設定の応答はスキーマに合う',
  'スキーマのファイルはOpenAPI 3.1で10個の操作を持つ',
  'demo-rpgはannouncementsとrankingsとsavesとconfigを使う設定で登録される',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigでルートが重ならない',
  'CLIモックと同じ流れで設定を読み変わっていなければ304を受け取る',
  // base にあった既存の試験の全部（置き換えた 3 本を除く。互換の `今のCLIモックと同じ形の要求を受け付ける` を含む）
  ...baseTests.filter((n) => !replaced.includes(n)),
]);
// core（守り・認証・機能の設定）・ほかのモジュール・既存のマイグレーションと、手を入れない試験のファイルを変えない
gitClean(['src/core/', 'src/modules/rankings/', 'src/modules/announcements/', 'src/modules/saves/', 'scripts/issue-run/', 'scripts/test.mjs',
  'migrations/0001_initial.sql', 'migrations/0002_games.sql', 'migrations/0003_game_modules.sql', 'migrations/0004_accounts.sql',
  'migrations/0005_saves.sql', 'test/failure-input.test.ts', 'test/auth.test.ts', 'test/accounts.test.ts', 'test/games.test.ts',
  'test/health.test.ts', 'test/saves.test.ts', 'test/saves-manage.test.ts', 'test/support/', 'wrangler.jsonc', pkg], { base });
done();
```

C2:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const namesIn = (src) => [...src.matchAll(/\bit\('([^']+)'/g)].map((m) => m[1]);
const files = ['migrations/0007_config_master_data.sql', 'src/modules/config/limits.ts', 'test/config-master.test.ts'];
mustExist(files);
gitTracked(files);
// 上限は表の CHECK と定数の 2 か所で同じ数（§2）
check(/65536/.test(read('migrations/0007_config_master_data.sql')) && /65[_,]?536/.test(read('src/modules/config/limits.ts')), 'マスターデータの上限が表と定数で 64 KiB');
const mod = read('src/modules/config/index.ts');
check(/config\\?\/master/.test(mod), 'マスターデータを読むルートがある');
check(!/method:\s*'(POST|PUT|DELETE)'/.test(mod), '設定のモジュールは GET のルートだけを持つ');
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
// CLI モックがマスターデータを読む（§6）
check(/config\/master/.test(read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs')), 'CLI モックが設定に載ったマスターデータを読む');
// 置き換えた 1 本が残っていない（§8）・残りの既存の試験は全部ある（下の requireTests）
const replaced = ['スキーマのファイルはOpenAPI 3.1で10個の操作を持つ'];
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
for (const n of replaced) check(!namesIn(all).includes(n), '置き換えた試験が残っていない: ' + n);
const baseTests = execSync(`git ls-tree --name-only ${base} test/`, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'))
  .flatMap((f) => namesIn(execSync(`git show ${base}:${f}`, { encoding: 'utf8' })));
check(baseTests.length > 0, 'base の試験の名前を読めた');
// 契約を先に直した（§3）・エラーコードは足さない
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check(Boolean(spec.paths?.['/v1/config/master/{key}']?.get), 'スキーマに GET /v1/config/master/{key} がある');
check((spec.components?.schemas?.ErrorCode?.enum ?? []).length === 11, 'スキーマの ErrorCode は 11 個のまま');
runTests();
requireTests([
  'マスターデータを読むと入れた文字列がそのまま返る',
  'マスターデータの応答にはETagが付き同じETagなら304を返す',
  '設定の応答にマスターデータのキーと大きさの一覧が載る',
  'マスターデータが変わると設定のETagも変わる',
  '無いキーのマスターデータはNOT_FOUNDの404を返す',
  '他のゲームのマスターデータは読めない',
  'configを使わない設定のゲームのマスターデータはNOT_FOUNDの404を返す',
  '上限を超えるマスターデータは表に入らず上限ちょうどは入る',
  'マスターデータの応答はスキーマに合う',
  'スキーマのファイルはOpenAPI 3.1で11個の操作を持つ',
  'CLIモックと同じ流れで設定に載ったマスターデータを読める',
  // base（C1 の後の main）にあった試験の全部（置き換えた 1 本を除く。C1 の試験と互換の試験を含む）
  ...baseTests.filter((n) => !replaced.includes(n)),
]);
// 既存のマイグレーション・core・ほかのモジュール・手を入れない試験のファイルを変えない
gitClean(['src/core/', 'src/modules/rankings/', 'src/modules/announcements/', 'src/modules/saves/', 'src/modules/index.ts',
  'scripts/issue-run/', 'scripts/test.mjs', 'migrations/0001_initial.sql', 'migrations/0002_games.sql', 'migrations/0003_game_modules.sql',
  'migrations/0004_accounts.sql', 'migrations/0005_saves.sql', 'migrations/0006_config.sql', 'test/failure-input.test.ts', 'test/auth.test.ts',
  'test/accounts.test.ts', 'test/games.test.ts', 'test/health.test.ts', 'test/saves.test.ts', 'test/saves-manage.test.ts',
  'test/modules.test.ts', 'test/game-modules.test.ts', 'test/config.test.ts', 'test/support/', 'wrangler.jsonc', pkg], { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり）。
- C1 の `base` の試験の名前は、2026-10-30 の main `492f688` のもの（上の `namesIn` で数える）。C2 の `base` は C1 が入った後の main なので、C1 の試験も自動で入る。
- C2 は `test/config.test.ts` を守る（C1 の試験の中身を C2 で変えない）。C1 の試験は `demo-rpg` と空のゲームの設定の応答の全体を `toEqual` で比べているので、C2 は `demo-rpg` に手本を入れず、マスターデータの無いゲームでは `masterData` の欄を載せない（§2・§3）。`npm run cli:smoke` でマスターデータの流れも通すには、C1 の試験の比べ方を直してから新しい番号のマイグレーションで手本を入れる（§9 の後の片付け）。
- `今のCLIモックと同じ形の要求を受け付ける` の**期待する結果の行**が変わっていないか（§8 の「名前も中身も変えない」）は、名前までしか確認コマンドで見きれない。判定役が差分で見る。

## 12. 指示の表

| Issue #23 の指示 | どこで答えるか |
| --- | --- |
| ゲームごとの設定（機能フラグ・マスターデータ・最低の版）の形 | §2・§3・§10 の決めること 2・3 |
| 置き場（D1 か KV か・コードに埋めるか）。KV なら `wrangler.jsonc` に何を足すか。上限の数字は公式の文書で確かめ、確かめられないものは要確認 | §1 の「Cloudflare の上限」・§10 の決めること 1 |
| 読む API | §3 |
| 変わっていなければ送り直さない仕組み（`ETag`・`If-None-Match`・304）とキャッシュの見出し | §3 の「`ETag` とキャッシュの見出し」・§10 の決めること 7 |
| 設定の入れ方（マイグレーションか、書き込みを増やさない方法）。書き換える API は作らない | §2・§4・§10 の決めること 4 |
| 認証と `APP_ENV` の扱い（守りは外さない。読む API の守りは決めることに） | §4・§10 の決めること 6 |
| クライアントの版（古いクライアントに何を返すか・比べ方・誰が名乗るか） | §5・§10 の決めること 9 |
| `environment` を設定の中で分けるか | §10 の決めること 5 |
| 新しいエラーコード | §3・§10 の決めること 8 |
| `src/modules/config/` と `game_modules` の行・`demo-rpg` を使う設定にするか・変わる既存の試験の直し方（test-plan §11） | §2・§8・§10 の決めること 11 |
| サーバーはマスターデータの中身を解釈しない | §2・§3 |
| 新しいパッケージは案と推しだけ・足さない案を 1 つは | §10 の決めること 1（D がパッケージの案。推しの A は足さない） |
| CLI モックの変え方（どの束で、どう） | §6・§11 |
| 確かめ方（テストの名前。束は `C1`・`C2`） | §7 |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §11 |
