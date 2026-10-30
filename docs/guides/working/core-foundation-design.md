# 共通 API の土台: モジュールへの分割とゲームの登録（設計書）

`docs/guides/decisions/roadmap.md` Phase 1 の最初の 2 項目の設計書。

- 「`src/worker.ts` を `src/core/` と `src/modules/<機能>/` に分ける（API は変えない）」
- 「ゲームの登録（`games`）と、ゲームごとに使う機能の設定。登録の無いゲームは断る」

モジュールの境目・ゲームの登録の表と登録の方法・登録の無いゲームの扱い・確かめ方（試験の名前）・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/` は次の Issue）。
方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`）。`tenant_id` を持たない・モノレポにしない・ゲーム固有のルールを入れない、は決め直さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/worker.ts`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§4 の試験の名前を `requireTests` に渡して実装の Issue を M1 から順に回し、**機能ごとのコードが `src/modules/<機能>/` に分かれ、登録の無いゲームや、その機能を使わない設定のゲームへの要求が `404 NOT_FOUND` で断られ、いまの CLI モックの要求（`demo-rpg`）はそのまま通る**のを見て、アカウント・セーブ・設定配信を足す土台ができたと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§6 に決めること（案と推し）、§7 に実装の束がある | 機械（Issue #13 の確認コマンド） |
| `src/core/`・`src/modules/announcements`・`src/modules/rankings`・`games`・ADR 0002 が出てくる | 機械（同上） |
| 挙動が変わりうる既存の試験と、互換を見張る試験に名前で触れている（§5） | 機械（同上） |
| §4 の試験の名前の表の束は `M1`・`M2`… だけ・名前に重複が無く、いまの `test/` の名前と重ならない・`M1`・`M2` の行がある | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使う（§7） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/core/`・`src/modules/` の下と新しい番号のマイグレーションを除く） | 機械（同上） |
| M1 が挙動を変えない分割になっている・M2 以降の挙動の変化が §5 に全部挙がり、`docs/guides/decisions/test-plan.md` §11 の手続きで直す形になっている | AI の判定（作っていない判定役が、§1〜§5 と `src/worker.ts`・`test/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§7 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- M1 は挙動を変えない。いまの試験 34 本（2026-10-30 の main で `node scripts/test.mjs` → `Result: PASS 34/34`）を**1 行も変えずに**通す。
- M2・M3 は §5 に挙げた試験だけを、§5 の手続きで直す。ほかの試験の期待する結果を変えない。`今のCLIモックと同じ形の要求を受け付ける` は全部の束で変えずに通す。
- `package.json` を変えない（全部の束）。`migrations/0001_initial.sql` を書き換えない。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

`src/worker.ts`・`migrations/0001_initial.sql`・`test/`（2026-10-30 の main）を読んで確かめた。

| 所 | いま |
| --- | --- |
| `src/worker.ts` | 1 ファイルに全部。型（`Env`・`Database`）・応答の手伝い（`json`・`error`）・ID の検証（`validId`）・ルート（`route` の中の `if` の並び）・SQL・入口（`default.fetch` の `try/catch` で 500 `INTERNAL_ERROR`）。外へ出したふつうの関数は無い |
| ルート | `GET /health`・`GET /v1/announcements`・`GET /v1/rankings/{boardId}`・`POST /v1/rankings/{boardId}`。どれにも当たらなければ 404 `NOT_FOUND` `Endpoint not found` |
| 検査の順（POST） | パスがルートに当たらなければ 404（ボードの形の外れ）→ `APP_ENV !== 'local'` なら 403（本文を読む前）→ JSON の読み取り（400 `INVALID_JSON`）→ 形の検証（400 `INVALID_ARGUMENT`）→ 書き込み |
| 検査の順（GET） | `gameId` の形（400）→（ランキングは `limit`（400））→ 読み取り |
| 表 | `announcements`・`ranking_entries` の 2 つ。どちらも `game_id` を持つ。ゲームの一覧の表は無い。初期データは `demo-rpg` のお知らせ `welcome` だけ |
| 存在しないゲーム | 形の正しい `gameId` なら 200 と空の `items`（`docs/api-contract.md`。`docs/guides/working/failure-case-test-plan.md` §5 の決めること 1 で A に決め、「登録の仕組みを入れるときに B を決め直す」と書いてある） |
| 試験が使うゲーム | `demo-rpg`（ほぼ全部）・`other-rpg`（他ゲームの分離の 4 本。うち 3 本は `other-rpg` へ POST する）・`no-such-game`（存在しないゲームの 2 本） |
| CLI モック | `scripts/cli-mock.mjs` と `scripts/cli-requests.mjs` は `demo-rpg` だけを使う |
| 試験の入口 | `test/health.test.ts` 以外の試験は `import worker from '../src/worker'` で `default.fetch` を直に呼ぶ。`test/health.test.ts` は `cloudflare:workers` の `exports.default.fetch` で `wrangler.jsonc` の `main`（`src/worker.ts`）を通す。どちらもこのパスと `default` の書き出しに頼る |
| 試験の D1 | `vitest.config.ts` が `migrations/` を全部読み、`test/apply-migrations.ts` が当てる。新しい番号のマイグレーションは置くだけで試験の D1 に入る |

`docs/guides/working/architecture.md` の「4. データ境界」は、`games` を「ゲームの設定と公開状態」として想定エンティティに挙げ、「PoC で実際に作るのは `ranking_entries` と `announcements` のみ」と書いている。`gameId` を認証・認可の境界とみなさない、とも書いている（この設計の機能の設定も、ADR 0002 のとおり認可の代わりにしない）。

## 2. モジュールの境目（M1）

### ファイルの分け方

| ファイル | 中身 | 読み込んでよいもの |
| --- | --- | --- |
| `src/worker.ts` | 入口だけ。`src/modules/index.ts` の一覧を `src/core/router.ts` に渡し、`default.fetch` の `try/catch`（500 `INTERNAL_ERROR`・中身を返さない）を持つ。試験と `wrangler.jsonc` の `main` が指すので、このパスを残す | `src/core/`・`src/modules/index.ts` |
| `src/core/env.ts` | `Env`・`Database`・`Statement` の型 | — |
| `src/core/http.ts` | `jsonHeaders`・`json()`・`error()`（いまの関数をそのまま移す） | — |
| `src/core/ids.ts` | `idPattern`・`validId()` | — |
| `src/core/guards.ts` | `requireLocalWrite(env)`: `APP_ENV !== 'local'` なら 403 `NOT_READY_FOR_PRODUCTION` の応答、通るなら `null` | `src/core/http.ts` |
| `src/core/module.ts` | モジュールの型（下）。`Route` と `GameModule` | `src/core/env.ts` |
| `src/core/router.ts` | `createRouter(modules)`: `GET /health` と、モジュールのルートを上から順に当て、どれにも当たらなければ 404 `NOT_FOUND` `Endpoint not found` | `src/core/` だけ |
| `src/modules/index.ts` | モジュールの一覧 `modules = [announcements, rankings]`。**機能の名前の正はここ 1 か所**（M3 で使う） | `src/modules/*` |
| `src/modules/announcements/index.ts` | `GET /v1/announcements` のルートと SQL | `src/core/` |
| `src/modules/rankings/index.ts` | `GET`・`POST /v1/rankings/{boardId}` のルートと SQL | `src/core/`・同じフォルダー |
| `src/modules/rankings/validate.ts` | ふつうの関数: `parseLimit(raw)`（`limit` の 1〜50・既定 10）・`parseScoreSubmission(value)`（本文の検証）。入出力を持たない（CLAUDE.md の「ロジックは入出力から外へ出す」） | `src/core/ids.ts` |

決まり:

- **`src/core/` は `src/modules/` を読み込まない**（向きは modules → core だけ）。一覧を組み立てるのは入口の `src/worker.ts`。M1 の確認コマンドが `src/core/` の `import` を読んで確かめる。
- モジュールどうしは読み込み合わない（`announcements` と `rankings` は互いを知らない）。
- `/health` は機能ではないので core に置く（登録・機能の設定に関係なく 200）。

### モジュールの型

```ts
// src/core/module.ts
export type Route = {
  method: 'GET' | 'POST';
  pattern: RegExp;                       // url.pathname に当てる。^…$ で書く
  handle(req: Request, env: Env, match: RegExpExecArray, url: URL, known: readonly string[]): Promise<Response>;  // known は M3 で足した
};
export type GameModule = {
  name: string;                          // 'announcements' | 'rankings'（M3 の機能の設定の名前と同じ）
  routes: Route[];
};
```

- ルートの `pattern` はいまの `if` の条件をそのまま写す（お知らせは `^/v1/announcements$`、ランキングは `^/v1/rankings/([a-zA-Z0-9_-]{1,64})$`）。パスに当たってメソッドが違うときは、いまと同じく 404 `NOT_FOUND`（405 にしない。挙動を変えない）。
- エラーの `message` の文・ヘッダー・検査の順（§1）・SQL の文は**変えない**。M1 は移すだけ。

## 3. ゲームの登録（M2）と機能の設定（M3）

### 表（新しい番号のマイグレーション。`migrations/0001_initial.sql` は書き換えない）

`migrations/0002_games.sql`（M2）:

```sql
CREATE TABLE IF NOT EXISTS games (
  game_id TEXT NOT NULL PRIMARY KEY,           -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO games (game_id, display_name) VALUES ('demo-rpg', 'Demo RPG');
```

`migrations/0003_game_modules.sql`（M3）:

```sql
CREATE TABLE IF NOT EXISTS game_modules (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  module TEXT NOT NULL,                        -- src/modules/index.ts の name
  PRIMARY KEY (game_id, module)
);
-- それまでに登録したゲームは、いまの 2 つの機能を使う設定にする（M2 と M3 の間に足したゲームも断られないように）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'announcements' FROM games;
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'rankings' FROM games;
```

- `ON DELETE CASCADE` は、ゲームの行を消したときに機能の設定の行が外部キーで残らないようにするため（M3 の実装で足した。試験の準備で `games` だけを消す M2 の試験がそのまま通る）。
- `game_id` だけを持ち、`tenant_id` は持たない（ADR 0002。デプロイが 1 テナント）。一つのデプロイに複数のゲームを入れられる形にしておくのは、試験が `demo-rpg` と `other-rpg` の分離を確かめるため。
- 行があれば「その機能を使う」。行が無ければ使わない（§6 の決めること 3）。後のアカウント・セーブ・設定配信は、`src/modules/index.ts` に名前を足し、使うゲームの行を新しいマイグレーションで足す。
- 「公開状態」（`docs/guides/working/architecture.md` §4 の想定）の欄はいま作らない。要る場面（公開前のゲームを隠す）が出たら欄を足す。
- どちらも `IF NOT EXISTS`・`INSERT OR IGNORE` で、2 回当てても壊れない（試験 `マイグレーションを2回当ててもデータは壊れない` がそのまま通る）。

### 登録の方法

新しいマイグレーションで入れる（§6 の決めること 2 の推し）。`demo-rpg` は `0002` で登録済みにする。ゲームを足すときは `INSERT OR IGNORE INTO games …` と `game_modules` の行を書いた新しい番号のマイグレーションを足す。管理 API は作らない（認証が無いので、無認証の書き込みの口を増やさない）。

### 登録と機能の確かめ（core）

`src/core/games.ts`:

```ts
// 入出力を持たないふつうの関数（L1 で確かめる）
export function enabledModules(rows: Array<{ module: string | null }>, known: readonly string[]): Set<string>;
// D1 を 1 回引く。登録が無ければ null
export async function loadGame(db: Database, gameId: string, known: readonly string[]): Promise<{ gameId: string; modules: Set<string> } | null>;
// 断る応答か null。登録が無い → 404 NOT_FOUND 'Unknown game'。機能を使わない → 404 NOT_FOUND 'Feature not enabled for this game'
export async function requireGame(env: Env, gameId: string, module: string, known: readonly string[]): Promise<Response | null>;
```

- SQL は `SELECT g.game_id, m.module FROM games g LEFT JOIN game_modules m ON m.game_id = g.game_id WHERE g.game_id = ?` を `prepare().bind()` で引く（M2 では `game_modules` が無いので `SELECT game_id FROM games WHERE game_id = ?` だけ。M3 で JOIN に変える）。
- `known` は `src/modules/index.ts` の名前。`src/core/router.ts` が渡された一覧の `name` から作り、`handle` の 5 番目の引数で各モジュールへ渡し、モジュールが `requireGame` に渡す（core が modules を読み込まず、モジュールも一覧を読み込まない）。表にある知らない名前は捨てる。
- **呼ぶ所はモジュールの handle の中で、入力の形を確かめた後・DB を読み書きする前**（§6 の決めること 5）。検査の順は次のとおり。いまの順の後ろに 1 段足すだけなので、ほかの 400・403 の試験の結果は変わらない。

| 操作 | 検査の順（太字が足す段） |
| --- | --- |
| `GET /v1/announcements` | `gameId` の形（400）→ **登録と `announcements` の設定（404）** → 読み取り |
| `GET /v1/rankings/{boardId}` | `gameId` の形（400）→ `limit`（400）→ **登録と `rankings` の設定（404）** → 読み取り |
| `POST /v1/rankings/{boardId}` | `APP_ENV`（403）→ JSON（400）→ 本文の形（400）→ **登録と `rankings` の設定（404）** → 書き込み |

- 登録を引く SQL が失敗したら、いまと同じく入口の `try/catch` で 500 `INTERNAL_ERROR`（中身を返さない）。

### 契約の変わる所（M2 の実装の Issue で、同じコミットで直す）

| ファイル | 直す所 |
| --- | --- |
| `docs/api-contract.md` | 「形の正しい `gameId`・`boardId` なら、データが無くても（存在しないゲーム・ボードでも）200 と空の `items`」の行を**置き換える**: 「登録の無い `gameId` は 404 `NOT_FOUND`。登録済みのゲームなら、ボードにデータが無くても 200 と空の `items`」。エラーコードの一覧は変えない（`NOT_FOUND` を使い回す） |
| `openapi/rpg-online.v1.json` | `listAnnouncements` に 404 の応答（`Error`・`x-error-codes: ["NOT_FOUND"]`）を足す。`getRanking`・`submitScore` は 404 `NOT_FOUND` がもうあるので、説明の文に「登録の無いゲーム」を足すだけ。`ErrorCode` の列挙は 5 つのまま |
| `docs/guides/working/failure-case-test-plan.md` | §5 の決めること 1 を「**ゲームだけ B**（登録の無いゲームは 404。ボードは表を作らず A のまま 200 と空）」に決め直し、§3 の 2 行（§5 の表）を新しい名前の行に置き換え、§4 の K1 の確認コマンドの案の名前も置き換える |
| `docs/guides/working/architecture.md` | §4 の「PoC で実際に作るのは…のみ」に `games` を足す |

M3 の実装の Issue で、同じコミットで直す所:

| ファイル | 直す所 |
| --- | --- |
| `docs/api-contract.md` | 「登録の無い `gameId` は 404」の行に「その機能を使わない設定のゲームも 404 `NOT_FOUND`」を足して 1 行に置き換える |
| `openapi/rpg-online.v1.json` | 3 つの操作の 404 の説明の文に「機能を使わない設定のゲーム」を足す。`ErrorCode` の列挙と `x-error-codes` は変えない |
| `docs/guides/working/architecture.md` | §4 に `game_modules` を足す |

## 4. 試験の名前の表

L2 の試験の作り方（`src/worker.ts` の `default` を直に呼ぶ・書き込みだけ `APP_ENV: 'local'`・偽の DB・試験ごとにデータを消す）は `docs/guides/working/failure-case-test-plan.md` §2 と同じ。ゲームの登録は試験の手伝い `test/support/games.ts` の `registerGame(db, gameId, modules = ['announcements', 'rankings'])` で入れ、`registerGame` は `INSERT OR IGNORE` で入れる（`beforeEach` で何度呼んでも主キーで落ちない）。試験のファイルは `beforeEach` で `demo-rpg` 以外のゲームの行を消す（`demo-rpg` はマイグレーションのまま残す）。`game_modules` の外部キーは `ON DELETE CASCADE` なので、`games` の行を消せば機能の設定の行も消える（M2 の `test/games.test.ts` は `games` だけを消す）。`test/game-modules.test.ts` のように `game_modules` を先に消してもよい。

| 束 | テストの名前 | 確かめること | 層 |
| --- | --- | --- | --- |
| M1 | `モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない` | `src/modules/index.ts` の `modules` の `name` がちょうど `announcements`・`rankings`・`saves`（セーブの V1 で置き換えた。名前の正は `docs/guides/working/save-design.md` §7）。全部のルートの `method` と `pattern` の組に重なりが無く、`/health` に当たるルートが無い | L1 |
| M1 | `limitの検証関数は1から50の数字だけを通し無ければ10にする` | `parseLimit`: `null` → 10・`'1'`・`'50'` は通る・`'0'`・`'51'`・`'1.5'`・`'-1'`・`'1e1'`・`' 5'` は外れ | L1 |
| M1 | `スコアの投稿の検証関数はいまのAPIと同じ所で合否を分ける` | `parseScoreSubmission`: スコア 0・10 億・表示名 1 文字と 40 文字は通る。スコア -1・1.5・10 億 1・文字列、表示名 0 文字と 41 文字、ID の形の外れ、配列・`null` は外れ。知らない欄は結果に残さない | L1 |
| M1 | `IDの検証関数は英数字とハイフンと下線の1から64文字だけを通す` | `validId`: 64 文字は通る・65 文字・空・空白入り・`'` 入り・文字列でない値は外れ | L1 |
| M2 | `登録の無いゲームのランキングはNOT_FOUNDの404を返す` | 登録の無い `no-such-game` で `GET /v1/rankings/boss-score` → 404・`NOT_FOUND` | L2 |
| M2 | `登録の無いゲームのお知らせはNOT_FOUNDの404を返す` | 登録の無い `no-such-game` で `GET /v1/announcements` → 404・`NOT_FOUND` | L2 |
| M2 | `登録の無いゲームへのスコアの投稿はNOT_FOUNDの404を返し記録しない` | `APP_ENV=local` で `no-such-game` に正しい本文を POST → 404・`NOT_FOUND`。`ranking_entries` の行が増えない | L2 |
| M2 | `登録したゲームならデータが無くてもランキングは200と空の一覧を返す` | `registerGame` で `empty-rpg` を入れ、データ無しで GET → 200・`{"gameId":"empty-rpg","boardId":"boss-score","items":[]}` | L2 |
| M2 | `登録したゲームならデータが無くてもお知らせは200と空の一覧を返す` | 同じく `GET /v1/announcements?gameId=empty-rpg` → 200・`{"gameId":"empty-rpg","items":[]}` | L2 |
| M2 | `マイグレーションを当てるとdemo-rpgが登録済みになる` | 試験の D1 の `games` に `demo-rpg` の行がある（`npm run cli:smoke` が通り続ける前提） | L2 |
| M2 | `本番の設定では登録の無いゲームへの投稿もNOT_READY_FOR_PRODUCTIONの403を返す` | `APP_ENV` が `local` でない env で `no-such-game` に POST → 403（404 より先に断る。§3 の検査の順） | L2 |
| M2 | `形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す` | 偽の DB（`prepare` が投げる）で `gameId` の形が外れた GET・POST → 500 でなく 400 `INVALID_ARGUMENT` | L2 |
| M2 | `登録の無いゲームのNOT_FOUNDの応答はスキーマに合う` | 3 つの操作で登録の無いゲームの 404 を起こし、本文が `Error` に合い、`x-error-codes` に `NOT_FOUND` がある | L2 |
| M3 | `ゲームの機能の設定の行から使える機能の集合を作り知らない名前は捨てる` | `enabledModules`: `[{module:'rankings'},{module:'chat'},{module:null}]` と既知 `['announcements','rankings']` → `{'rankings'}` | L1 |
| M3 | `demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される` | 試験の D1 の `game_modules` の `demo-rpg` の行がちょうど `announcements`・`rankings`・`saves` の 3 つ（セーブの V1 で置き換えた。名前の正は `docs/guides/working/save-design.md` §7） | L2 |
| M3 | `rankingsを使わない設定のゲームのランキングはNOT_FOUNDの404を返す` | `registerGame(db, 'news-only', ['announcements'])` で GET ランキング → 404・`NOT_FOUND` | L2 |
| M3 | `rankingsを使わない設定のゲームへのスコアの投稿はNOT_FOUNDの404を返し記録しない` | 同じゲームに POST → 404・行が増えない | L2 |
| M3 | `announcementsを使わない設定のゲームのお知らせはNOT_FOUNDの404を返す` | `registerGame(db, 'score-only', ['rankings'])` で GET お知らせ → 404・同じゲームのランキングは 200 | L2 |
| M3 | `機能の設定はゲームごとで他のゲームの設定に引きずられない` | `news-only` と `demo-rpg` を並べ、`demo-rpg` のランキングは 200 のまま・`news-only` のお知らせは 200 | L2 |

数（行）: M1 が 4・M2 が 9・M3 が 6。どれも、いまの `test/` の名前と重ならない（2026-10-30 に `test/*.ts` の `it('…')` と突き合わせた）。

- 置き場は束ごとに 1 ファイル（M1 は `test/modules.test.ts`、M2 は `test/games.test.ts`、M3 は `test/game-modules.test.ts`）。試験の手伝いは `test/support/games.ts`。
- M1 の試験は L1 だけ。挙動を変えないことは、いまの 34 本が 1 行も変えずに通ることで確かめる（新しい L2 の試験で写し直さない）。
- テストの名前は表の文そのまま `it('…')` に書く。名前を変えるときは、この表も同じコミットで直す（`docs/guides/procedures/node-test-procedure.md`）。

## 5. 挙動が変わる既存の試験と、直す手続き

M1 では既存の試験を 1 本も変えない。M2・M3 で変わるのは次だけ。

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `存在しないゲームのランキングは200と空の一覧を返す` | M2 | 登録の無いゲームは 404 になり、名前の「200 と空の一覧」が嘘になる | 消して、§4 の `登録の無いゲームのランキングはNOT_FOUNDの404を返す` に置き換える。「登録済みで空なら 200」は `登録したゲームならデータが無くてもランキングは200と空の一覧を返す` が受け継ぐ |
| `存在しないゲームのお知らせは200と空の一覧を返す` | M2 | 同上 | 消して、`登録の無いゲームのお知らせはNOT_FOUNDの404を返す` と `登録したゲームならデータが無くてもお知らせは200と空の一覧を返す` に置き換える |
| `他のゲームのランキングは返さない`・`SQLを混ぜたgameIdはINVALID_ARGUMENTの400を返す`・`同じプレイヤーIDでも他のゲームの記録は書き換えない` | M2 | `other-rpg` へ POST するので、登録が無いと 404 で落ちる | **開始状態だけ**を直す: `beforeEach` で `registerGame(db, 'other-rpg')`。要求と期待する結果は 1 文字も変えない |
| `今のCLIモックと同じ形の要求を受け付ける` | 全部 | 変わらない（`demo-rpg` は `0002`・`0003` で登録済み・両方の機能を使う） | **変えない。** 互換を見張る試験。落ちたら試験でなく実装（マイグレーションの初期データ）を直す |
| `マイグレーションを2回当ててもデータは壊れない` | M2・M3 | 変わらない（新しいマイグレーションも `IF NOT EXISTS`・`INSERT OR IGNORE`） | 変えない |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る`・`スキーマのErrorCodeの列挙は5つのエラーコードと一致する` | M2 | 変わらない（新しいエラーコードを足さない） | 変えない。404 の組は `登録の無いゲームのNOT_FOUNDの応答はスキーマに合う` で見る |

手続き（`docs/guides/decisions/test-plan.md` §11 は「テストを緑に合わせて弱めない・消さない。期待値を実装に合わせて書き換えない（直すのは実装か、設計を直してからテスト）」。2 本を消すのは、緑に合わせるためでなく**設計（契約）を先に変えたため**で、§11 の「設計を直してからテスト」の道を通る。その証拠は、手順 1 の設計を直すコミットが、試験を置き換えるコミットより先にあること）:

1. 先に設計を直す: この設計書の決めること 1（§6）で B に決めたことを、M2 の実装の Issue の最初のコミットで `docs/guides/working/failure-case-test-plan.md` §5 の決めること 1 に写し（A から「ゲームだけ B・ボードは A」へ決め直し。`存在しないボードのランキングは200と空の一覧を返す` は変えずに残る）、§3 の 2 行と §4 の K1 の名前を置き換え、`docs/api-contract.md` の該当の行を置き換える（§3 の「契約の変わる所」。CLAUDE.md 原則 5。例外を追記しない）。
2. 同じ束の中で試験を置き換える。消す 2 本は、より強い期待（404 で断る）の 2 本と「登録済みなら 200 と空」の 2 本に置き換わるので、確かめる範囲は減らない。
3. 確認コマンドで、消した 2 本の名前が `test/` に残っていないこと・置き換えの名前が通ることを見る（§7 の M2）。
4. ほかの試験が落ちたら、期待する結果を直さず `docs/guides/decisions/test-plan.md` §8 の欠陥レポートの形で報告し、設計か実装かを振り分ける（design-cycle §5）。

## 6. 決めること

推しの案で §2〜§5 を書いた。ADR 0002 の決定（`tenant_id` を持たない・モノレポにしない・ゲーム固有のルールを入れない）は前提で、ここに戻さない。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 登録の無いゲームの扱い | A: いまのまま 200 と空の `items`（登録は機能の設定のためだけ）。B: **404 `NOT_FOUND` で断る**（エラーコードは使い回し、`message` を `Unknown game` にする）。C: 404 で断り、新しいエラーコード `GAME_NOT_FOUND` を足す（`docs/api-contract.md` のコードの一覧・`openapi/rpg-online.v1.json` の `ErrorCode` の列挙と各操作の `x-error-codes`・試験 `スキーマのErrorCodeの列挙は5つのエラーコードと一致する` と `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` の期待を変える） | **B**。ロードマップの「登録の無いゲームは断る」と Phase 1 の完了条件（登録されていないゲームには触れられない）に合う。いまでもボードの形が外れたら 404 `NOT_FOUND` なので、クライアントの分岐が増えない。C は ErrorCode の試験 2 本の期待を変える分だけ範囲が広い。クライアントがゲームの不一致と URL の誤りを分けたくなったら、`/v1/` の中で「足すだけ」の C に移れる |
| 2 | ゲームの登録の方法 | A: **新しい番号のマイグレーションで入れる**（`0002` で `demo-rpg`）。B: `wrangler.jsonc` の `vars`（例: `GAME_ID`・`ENABLED_MODULES`）で持ち、表を作らない。C: 管理 API（`POST /v1/admin/games`）。D: 登録用のスクリプト（`wrangler d1 execute` を呼ぶ） | **A**。`npm run db:migrate:local` だけで `demo-rpg` が登録され、`npm run cli:smoke` が通り続ける。試験の D1 にも同じ経路で入る。B は ADR 0002 の「デプロイが 1 ゲーム」には合うが、`games` の表（ロードマップ）と複数のゲームの分離の試験が作れず、`wrangler.jsonc` も変える。C は認証が無いので推さない（無認証の書き込みの口を増やす）。D は管理画面（Phase 2）を作るときに決め直す |
| 3 | 機能の設定の持ち方 | A: **別の表 `game_modules(game_id, module)`。行があれば使う**。B: `games` に JSON の欄（`modules`）。C: 設定を持たず、登録したゲームは全部の機能を使う | **A**。SQL の `prepare().bind()` で引け、機能を足すときは行を足すだけ。B は JSON の読み取りと形の検証が要る。C はロードマップの「ゲームごとに使う機能の設定」に届かない |
| 4 | 機能を使わない設定のゲームへの要求 | A: **404 `NOT_FOUND`**（`message` は `Feature not enabled for this game`）。B: 403 と新しいエラーコード `FEATURE_DISABLED` | **A**。決めること 1 と同じ理由でコードを足さない。ADR 0002 のとおり、この設定は認可の代わりでないので 403（権限が無い）の意味にしない |
| 5 | 登録を確かめる所 | A: **モジュールの handle の中で、入力の形を確かめた後に core の `requireGame` を呼ぶ**。B: core の router でルートに当てた直後に、どのモジュールでも共通に確かめる | **A**。いまの検査の順（403 → 400）の後ろに 1 段足すだけで、既存の 400・403 の試験の結果が変わらない。B は POST の本文を読む前に `gameId` が要り、形の検証より先に DB を引くので順が変わる |
| 6 | M1 の試験の層 | A: **L1 だけ足し、挙動はいまの 34 本で見る**。B: M1 でも L2 の試験を足し直す | **A**。挙動の正はいまの試験。同じことを L2 で写すと、名前の違う同じ試験が増える |

## 7. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| M1 | §2 の分割（`src/core/`・`src/modules/announcements`・`src/modules/rankings`・`src/modules/index.ts`）・§4 の M1 の L1 の試験。挙動を変えない | — | 変えない（34 本がそのまま通る） | 足さない |
| M2 | `migrations/0002_games.sql`・`src/core/games.ts` の `loadGame`・`requireGame`（登録だけ）・各モジュールから呼ぶ・`test/support/games.ts`・§3 の「契約の変わる所」・§4 の M2 の試験 | M1 | §5 の手続きで 2 本を置き換え・3 本の開始状態を直す | 足さない |
| M3 | `migrations/0003_game_modules.sql`・`enabledModules`・`requireGame` で機能の設定も見る・`registerGame` に機能の引数・§4 の M3 の試験・§3 の M3 の「直す所」 | M2 | 変えない | 足さない |

範囲の外（後の設計書）: アカウント・セーブ・設定配信（ロードマップ Phase 1 の次の項目）。これらは §2 の `GameModule` として `src/modules/<機能>/` に足し、§3 の `game_modules` の行でゲームごとに使う・使わないを決める。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。

`gitClean` は `base` を渡さないと作業ツリーしか見ず、無人の回がコミットした後は変えていても通ってしまう。どの案も先頭の `base` に、**実装の Issue を作るときの main のコミットの SHA** を書き入れ、`gitClean(…, { base })` で比べる（`docs/guides/procedures/issue-goal-setting.md`）。

M1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const core = ['src', 'core'].join('/');
const files = ['env.ts', 'http.ts', 'ids.ts', 'guards.ts', 'module.ts', 'router.ts'].map((f) => core + '/' + f)
  .concat(['src/modules/index.ts', 'src/modules/announcements/index.ts', 'src/modules/rankings/index.ts', 'src/modules/rankings/validate.ts']);
mustExist(files);
gitTracked(files);
// core は modules を読み込まない
const coreFiles = existsSync(core) ? readdirSync(core).filter((f) => f.endsWith('.ts')) : [];
const bad = coreFiles.filter((f) => /from\s+['"][^'"]*modules/.test(readFileSync(core + '/' + f, 'utf8')));
check(bad.length === 0, 'src/core は src/modules を読み込まない（読み込む: ' + bad.join(', ') + '）');
runTests();
requireTests([
  'モジュールの一覧はannouncementsとrankingsでルートが重ならない',
  'limitの検証関数は1から50の数字だけを通し無ければ10にする',
  'スコアの投稿の検証関数はいまのAPIと同じ所で合否を分ける',
  'IDの検証関数は英数字とハイフンと下線の1から64文字だけを通す',
  '存在しないゲームのランキングは200と空の一覧を返す',
  '存在しないゲームのお知らせは200と空の一覧を返す',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// 挙動を変えない: いまの試験・契約・データを変えない
gitClean(['test/failure-input.test.ts', 'test/failure-server.test.ts', 'test/health.test.ts', 'test/schema-conformance.test.ts', 'test/support/',
  'migrations/', 'openapi/', 'docs/api-contract.md', ['package', 'json'].join('.'), 'wrangler.jsonc'], { base });
done();
```

M2:

```js
import { readFileSync, readdirSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const files = ['migrations/0002_games.sql', 'src/core/games.ts', 'test/support/games.ts', 'test/games.test.ts'];
mustExist(files);
gitTracked(files);
// 置き換えた 2 本が残っていない（§5）
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
for (const old of ['存在しないゲームのランキングは200と空の一覧を返す', '存在しないゲームのお知らせは200と空の一覧を返す']) {
  check(!all.includes(old), '置き換えた試験が残っていない: ' + old);
}
const spec = JSON.parse(readFileSync('openapi/rpg-online.v1.json', 'utf8'));
const r404 = spec.paths['/v1/announcements']?.get?.responses?.['404'];
check(Boolean(r404) && (r404['x-error-codes'] ?? []).includes('NOT_FOUND'), 'スキーマの listAnnouncements に 404 NOT_FOUND がある');
runTests();
requireTests([
  '登録の無いゲームのランキングはNOT_FOUNDの404を返す',
  '登録の無いゲームのお知らせはNOT_FOUNDの404を返す',
  '登録の無いゲームへのスコアの投稿はNOT_FOUNDの404を返し記録しない',
  '登録したゲームならデータが無くてもランキングは200と空の一覧を返す',
  '登録したゲームならデータが無くてもお知らせは200と空の一覧を返す',
  'マイグレーションを当てるとdemo-rpgが登録済みになる',
  '本番の設定では登録の無いゲームへの投稿もNOT_READY_FOR_PRODUCTIONの403を返す',
  '形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す',
  '登録の無いゲームのNOT_FOUNDの応答はスキーマに合う',
  '他のゲームのランキングは返さない',
  'SQLを混ぜたgameIdはINVALID_ARGUMENTの400を返す',
  '同じプレイヤーIDでも他のゲームの記録は書き換えない',
  'マイグレーションを2回当ててもデータは壊れない',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// §5 に挙げた failure-input 以外の既存の試験は変えない（failure-input は §5 の 2 本の置き換えと開始状態だけ。判定役が差分で見る）
gitClean(['test/failure-server.test.ts', 'test/schema-conformance.test.ts', 'test/health.test.ts', 'test/apply-migrations.ts',
  'migrations/0001_initial.sql', 'scripts/', ['package', 'json'].join('.'), 'wrangler.jsonc'], { base });
done();
```

M3:

```js
import { runTests, requireTests, mustExist, gitTracked, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const files = ['migrations/0003_game_modules.sql', 'test/game-modules.test.ts'];
mustExist(files);
gitTracked(files);
runTests();
requireTests([
  'ゲームの機能の設定の行から使える機能の集合を作り知らない名前は捨てる',
  'demo-rpgはannouncementsとrankingsの両方を使う設定で登録される',
  'rankingsを使わない設定のゲームのランキングはNOT_FOUNDの404を返す',
  'rankingsを使わない設定のゲームへのスコアの投稿はNOT_FOUNDの404を返し記録しない',
  'announcementsを使わない設定のゲームのお知らせはNOT_FOUNDの404を返す',
  '機能の設定はゲームごとで他のゲームの設定に引きずられない',
  '登録の無いゲームのランキングはNOT_FOUNDの404を返す',
  'マイグレーションを2回当ててもデータは壊れない',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// openapi/ と docs/api-contract.md は M3 で直す所がある（§3）ので守らない
gitClean(['migrations/0001_initial.sql', 'migrations/0002_games.sql', 'test/failure-input.test.ts', 'test/failure-server.test.ts',
  'test/schema-conformance.test.ts', 'test/health.test.ts', 'test/apply-migrations.ts', 'scripts/', ['package', 'json'].join('.'), 'wrangler.jsonc'], { base });
done();
```

- M2 の後は、ローカルの D1 に `npm run db:migrate:local` をもう一度当ててから `npm run dev` と `npm run cli:smoke` を回す（`0002` が入っていないと `demo-rpg` も 404 になる）。実装の Issue の報告に、その実行結果を観測記録として残す。
- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり・`docs/guides/procedures/issue-goal-setting.md`）。M1 の案は、いまの main で回すと `mustExist`・`gitTracked` と `requireTests` の新しい 4 本が NG になり、既存の 3 本は OK になる見込み。

## 8. 指示の表

| Issue #13 の指示 | どこで答えるか |
| --- | --- |
| モジュールの境目を決める | §2 |
| ゲームの登録の表と登録の方法を決める | §3・§6 の決めること 2・3 |
| 登録の無いゲームの扱いを決める（案と推し。断るなら変わる試験の名前と、test-plan のどの手続きで直すか。新しいエラーコードなら契約とスキーマの何を変えるか） | §6 の決めること 1・§5・§3 の「契約の変わる所」 |
| 確かめ方（テストの名前）・束ごとの確認コマンドの案（`requireTests`） | §4・§7 |
| 束は 2 つ以上。M1 は挙動を変えない分割で 34 本がそのまま通る。M2 以降がゲームの登録 | §7（M1・M2・M3）・§0 |
| 試験の名前の表の列は「束・テストの名前・確かめること・層」・束の列は M1・M2… だけ | §4 |
| ADR 0002 の決定を決めることに戻さない | 冒頭・§6 の前書き |
| 無認証の書き込みの管理 API を推さない。`demo-rpg` を登録済みにして `npm run cli:smoke` が通り続ける | §6 の決めること 2・§3・§7 の注 |
| 既存のマイグレーションを書き換えない。表は新しい番号で足す | §3（`0002`・`0003`） |
| アカウント・セーブ・設定配信は範囲の外。機能の設定で後から有効・無効にできる形だけ | §3・§7 の「範囲の外」 |
| 実装しない・`package.json` を変えない・契約とロードマップと ADR を書き換えない | 冒頭（この設計書では書き換えず、M2 の実装の Issue でする所を §3 に挙げた） |
