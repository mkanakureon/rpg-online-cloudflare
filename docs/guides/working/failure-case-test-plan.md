# 失敗ケース 8 つのテスト計画（設計書）

`docs/03-roadmap.md` の「優先的にテストする失敗ケース」1〜8 を、試験の名前の表にした設計書。
次の実装の Issue は、§3 の表の「テストの名前」をそのまま `requireTests([...])` に渡す。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。
エンドポイントとエラーコードの正は `docs/api-contract.md`、いまの挙動の正は `src/worker.ts`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、この表の名前を `requireTests` に渡して実装の Issue を回し、8 つの失敗ケースのうち**いまの PoC で試験できるものが全部、テストとして通る**のを見て、PoC の API が失敗の入力で壊れない・他ゲームのデータを漏らさないと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| 8 つのケースが全部、§3 の表に 1 行以上ある | 機械（Issue #5 の確認コマンド） |
| テストの名前に重複が無い。時期は `いま`・`認証後`・`UE統合後` のどれか | 機械（同上） |
| ケース 2・3・4 に、時期 `いま` の行が 1 つ以上ある | 機械（同上） |
| §4 に実装の束（K1・K2…）と、束ごとの確認コマンドの案（`requireTests`）がある | 機械（同上） |
| 期待する結果が `docs/api-contract.md` と `src/worker.ts` の挙動に合う（違う所は §5 の「決めること」に挙がっている） | AI の判定（作っていない判定役が、表と契約・ソースを並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§4 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- `src/` の挙動を変えるのは §5 で決まった所だけ。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

| 項目 | いまの挙動（`src/worker.ts`・`migrations/0001_initial.sql`） |
| --- | --- |
| `gameId` の検証 | `^[a-zA-Z0-9_-]{1,64}$`。外れたら `400 INVALID_ARGUMENT`。GET でも POST でも同じ |
| ボード ID | パスの `^/v1/rankings/([a-zA-Z0-9_-]{1,64})$`。外れたら（例: 65 文字・空白入り）どのエンドポイントにも当たらず `404 NOT_FOUND` |
| 存在しないゲーム・ボード | ゲームやボードの一覧の表が無い。形の正しい ID なら `200` と空の `items` が返る |
| `limit` | 数字だけの 1〜50。外れたら `400 INVALID_ARGUMENT`。既定 10 |
| スコア | `Number.isSafeInteger` かつ 0〜1,000,000,000。外れたら `400 INVALID_ARGUMENT`。文字列の `"1200"` も 400。DB にも `CHECK(score >= 0 AND score <= 1000000000)` |
| 書き込み | `APP_ENV !== 'local'` なら `403 NOT_READY_FOR_PRODUCTION`（本文を読む前）。本文が JSON でなければ `400 INVALID_JSON`、オブジェクトでなければ `400 INVALID_ARGUMENT` |
| 同じプレイヤーの再送 | 主キー `(game_id, board_id, player_id)` で 1 行。スコアは `MAX` で高いほうだけ残る。`display_name` は毎回上書き、`updated_at` は毎回サーバーの `datetime('now')` |
| 時刻 | クライアントの時刻は受け取らない（知らない欄は無視）。同点の順は `updated_at ASC, player_id ASC` |
| 他ゲーム | SQL はどれも `WHERE game_id = ?` を `prepare().bind()` で渡す。別のゲームの行は返らない |
| DB の失敗 | `fetch` の `catch` で `500 INTERNAL_ERROR`・`Internal server error`。エラーの中身は返さない |
| 認証 | 無い（ケース 8 は全部 `認証後`） |
| テストの環境 | `wrangler.jsonc` の既定は `APP_ENV=disabled`。D1 は試験ごとの分けた環境で、マイグレーションは自動では入らない |

## 2. 試験の作り方（全部の束で共通）

- **層**は `docs/guides/decisions/test-plan.md` §3 の L1（ふつうの関数）・L2（HTTP と D1 を通す）。いまの `src/worker.ts` には外へ出した関数が無いので、`いま` の行は L2 にする（§5 の 決めること 3）。
- L2 の試験は、`src/worker.ts` の `default` を直に読み込み、`fetch(要求, env)` を呼ぶ。`env` は `cloudflare:workers` の `env` を広げて、書き込みの試験だけ `APP_ENV: 'local'` を渡す。`wrangler.jsonc` の既定の `APP_ENV=disabled` は変えない。
- D1 のテーブルは、`vitest.config.ts` で `@cloudflare/vitest-plugin` の `readD1Migrations('migrations')` を読み、試験の準備（setup のファイル）で `applyD1Migrations(env.DB, …)` する。データは試験ごとに入れ、試験の間で前のデータに頼らない。
- DB の失敗の試験は、`prepare` が例外を投げる偽の `DB` を `env` に渡す（本物の D1 を壊さない）。
- テストの名前は §3 の表の文そのまま `it('…')` に書く。名前を変えるときは、この表も同じコミットで直す（`docs/guides/procedures/node-test-procedure.md`）。
- 置き場は `test/` の下で、束ごとに 1 ファイル（例: K1 は `test/failure-input.test.ts`、K2 は `test/failure-server.test.ts`）。

## 3. 試験の名前の表

ケースの番号は `docs/03-roadmap.md` の「優先的にテストする失敗ケース」の番号。束は §4。

| ケース | テストの名前 | 時期 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- | --- |
| 1 | `DBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない` | いま | L2 | 偽の DB（`prepare` が `SQLITE_ERROR: no such table` を投げる）で `GET /v1/rankings/boss-score?gameId=demo-rpg` | 500・`{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}`。本文に `SQLITE` も表の名前も入らない（束 K2） |
| 1 | `書き込みでDBが失敗してもINTERNAL_ERRORの500を返す` | いま | L2 | 偽の DB・`APP_ENV=local` で正しい `POST /v1/rankings/boss-score` | 500・`INTERNAL_ERROR`・本文にエラーの中身が入らない（K2） |
| 1 | `途中で切れたJSONの本文はINVALID_JSONの400を返す` | いま | L2 | `APP_ENV=local`・本文 `{"gameId":"demo-rpg","sco`（送信の途中で切れた形） | 400・`INVALID_JSON`。行は増えない（K2） |
| 1 | `CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する` | UE統合後 | L2 | CLI モック（`scripts/cli-mock.mjs`）が、応答しないサーバーへ要求する | 決めた時間で打ち切り、決めた回数だけ再試行して、終了コード 1 と理由を出す（回数と時間は Phase 3 で決める） |
| 1 | `UEクライアントは500を受けたら再試行して利用者に通信エラーを出す` | UE統合後 | L3 | UE のクライアントが `500 INTERNAL_ERROR` を受ける | 再試行のあと、ゲームの画面に通信エラーが出て、ゲームは止まらない（ユーザーが見る） |
| 2 | `存在しないゲームのランキングは200と空の一覧を返す` | いま | L2 | データ無しで `GET /v1/rankings/boss-score?gameId=no-such-game` | 200・`{"gameId":"no-such-game","boardId":"boss-score","items":[]}`（いまの挙動。404 にするかは §5 の 決めること 1）（K1） |
| 2 | `存在しないボードのランキングは200と空の一覧を返す` | いま | L2 | `demo-rpg` の `boss-score` に 1 行入れて `GET /v1/rankings/no-such-board?gameId=demo-rpg` | 200・`items` が空。`boss-score` の行が混ざらない（決めること 1）（K1） |
| 2 | `存在しないゲームのお知らせは200と空の一覧を返す` | いま | L2 | `GET /v1/announcements?gameId=no-such-game` | 200・`{"gameId":"no-such-game","items":[]}`（決めること 1）（K1） |
| 2 | `ボードIDの形が正しくなければNOT_FOUNDの404を返す` | いま | L2 | `GET /v1/rankings/` に 65 文字のボード ID、と `GET /v1/rankings/boss%20score` | どちらも 404・`NOT_FOUND`（K1） |
| 2 | `gameIdが無いか形が正しくなければINVALID_ARGUMENTの400を返す` | いま | L2 | `GET /v1/rankings/boss-score`（`gameId` 無し）・`gameId=` （空）・`gameId=demo.rpg` | どれも 400・`INVALID_ARGUMENT`（K1） |
| 2 | `limitが1から50の外なら400を返す` | いま | L2 | `limit=0`・`limit=51`・`limit=-1`・`limit=1.5`・`limit=abc` | どれも 400・`INVALID_ARGUMENT`。`limit=1` と `limit=50` は 200（K1） |
| 3 | `スコアがマイナスなら400を返しランキングに載らない` | いま | L2 | `APP_ENV=local`・`score: -1` で POST、のあと GET | POST は 400・`INVALID_ARGUMENT`。GET の `items` にそのプレイヤーが無い（K1） |
| 3 | `スコアが整数でなければ400を返す` | いま | L2 | `score: 1.5`・`score: "1200"`・`score: null`・`score` 無し | どれも 400・`INVALID_ARGUMENT`。行は増えない（K1） |
| 3 | `スコアが10億を超えると400を返す` | いま | L2 | `score: 1000000001`・`score: 9007199254740993`（安全な整数の外） | どちらも 400・`INVALID_ARGUMENT`。行は増えない（K1） |
| 3 | `スコアが0と10億ちょうどなら受け付ける` | いま | L2 | 別のプレイヤーで `score: 0` と `score: 1000000000` | どちらも 200・`{"ok":true,…}`。GET で両方が載る（K1） |
| 4 | `他のゲームのランキングは返さない` | いま | L2 | `demo-rpg` と `other-rpg` の `boss-score` に 1 行ずつ入れて `GET /v1/rankings/boss-score?gameId=demo-rpg` | 200・`items` は `demo-rpg` の行だけ。`other-rpg` の `playerId` が無い（K1） |
| 4 | `他のゲームのお知らせは返さない` | いま | L2 | `other-rpg` にお知らせを 1 件足し、`GET /v1/announcements?gameId=demo-rpg` | 200・`items` は `welcome` だけ（マイグレーションの初期データ）（K1） |
| 4 | `SQLを混ぜたgameIdはINVALID_ARGUMENTの400を返す` | いま | L2 | GET は `gameId=demo-rpg' OR '1'='1`（URL エンコード）。POST は `APP_ENV=local` で本文の `gameId` を同じ文字列に | どちらも 400・`INVALID_ARGUMENT`。他ゲームの行は返らない（K1） |
| 4 | `同じプレイヤーIDでも他のゲームの記録は書き換えない` | いま | L2 | `demo-rpg` の `p1` が 1200 の状態で、`other-rpg` の `p1` を 5000 で POST | `demo-rpg` の GET の `p1` は 1200 のまま（K1） |
| 4 | `他のプレイヤーになりすました書き込みを弾く` | 認証後 | L2 | トークンのプレイヤーと違う `playerId` で POST | 403（コードは認証の設計で決める）。行は変わらない |
| 5 | `同じスコアを二重送信しても行は1つで結果は同じ` | いま | L2 | `APP_ENV=local`・同じ本文の POST を 2 回 | どちらも 200・同じ本文。GET でそのプレイヤーは 1 行・`score` は 1200（K2） |
| 5 | `低いスコアを後から送っても最高スコアが残る` | いま | L2 | 1200 を POST のあと 800 を POST | どちらも 200。GET の `score` は 1200（K2） |
| 5 | `同じプレイヤーが並べて連投しても最高スコアだけが残る` | いま | L2 | 同じプレイヤーで score 1〜20 の POST を `Promise.all` で 20 本 | 全部 200。GET でそのプレイヤーは 1 行・`score` は 20（K2） |
| 5 | `決めた回数を超えて連投すると429を返す` | 認証後 | L2 | 同じプレイヤーが決めた時間の中で決めた回数を超えて POST | 429（コード名・回数・時間は Phase 1 の利用制限で決める）。行は変わらない |
| 5 | `同じ送信IDの二重送信は1回分として扱う` | 認証後 | L2 | 同じ送信 ID（ヘッダーか欄。形は認証と一緒に決める）の POST を 2 回 | 2 回目は 1 回目と同じ応答で、記録は 1 回分（決めること 4） |
| 6 | `クライアントが送った時刻の欄は無視しサーバーの時刻で記録する` | いま | L2 | `APP_ENV=local`・本文に `"submittedAt":"2099-01-01T00:00:00Z"` を足して POST | 200。D1 の `updated_at` はサーバーの今の時刻（2099 年でない）。応答に時刻の欄は無い（K2） |
| 6 | `同点なら先に記録した人が上に並ぶ` | いま | L2 | 同点の 2 行を入れて GET。`p2` の `updated_at` を `2026-01-01 00:00:00`、`p1` を `2026-01-02 00:00:00` にする（ID の順と時刻の順を逆にする） | 先の時刻の `p2` が上（`ORDER BY score DESC, updated_at ASC, player_id ASC`）（K2） |
| 6 | `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う` | UE統合後 | L3 | 端末の時計を 1 日ずらしたゲームで、期間限定イベントを開く | 期間の内か外かがサーバーの時刻で決まる（ユーザーが見る。イベントの API は Phase 2） |
| 7 | `マイグレーションを2回当ててもデータは壊れない` | いま | L2 | `applyD1Migrations` を当てたあとに 1 行入れ、`readD1Migrations` の各 `queries` を `env.DB.batch` で直にもう一度流す（`applyD1Migrations` の 2 回目は当てた記録を見て飛ばすので、それでは確かめにならない） | 2 回目の SQL がエラーにならず、入れた行と `welcome` が残る（K2） |
| 7 | `今のCLIモックと同じ形の要求を受け付ける` | いま | L2 | `scripts/cli-mock.mjs` と同じ本文（`gameId`・`playerId`・`displayName`・`score`）で POST のあと GET | 200・`ok: true`。GET に載る（API を変えたら CLI モックも直す合図）（K2） |
| 7 | `知らない欄が付いた要求も受け付ける` | いま | L2 | 正しい本文に `"clientVersion":"0.0.1"` と `"extra":{}` を足して POST | 200。知らない欄は保存されない（新しい CLI と古いサーバー、の向きの互換）（K2） |
| 7 | `旧CLIはスキーマ変更後のAPIでもランキングを送って読める` | UE統合後 | L2 | 次のマイグレーションを当てたあと、その前の版の CLI モックの要求の形で POST と GET | 200 で送れて読める。変えるなら版の番号の扱いを先に決める（決めること 5） |
| 8 | `トークンが無い書き込みは401を返す` | 認証後 | L2 | `Authorization` 無しで POST | 401（コード名は認証の設計で決める）。行は増えない |
| 8 | `期限切れのトークンは401を返す` | 認証後 | L2 | 期限の過ぎたトークンで POST | 401・期限切れと分かるコード。行は増えない |
| 8 | `署名の正しくないトークンは401を返す` | 認証後 | L2 | 署名を書き換えたトークンで POST | 401。行は増えない。本文に検証の中身が入らない |
| 8 | `認証が入っても本番でない環境の無認証の書き込みは403のまま` | 認証後 | L2 | `APP_ENV=disabled` でトークン無しの POST | 403・`NOT_READY_FOR_PRODUCTION`（いまの守り。認証の設計で置き換えるまで残す） |

数（行）: いま 25（K1 が 14・K2 が 11）・認証後 7・UE統合後 4。

## 4. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る（K1 が試験の土台を作る）。

| 束 | 中身 | 時期 | 前の束 |
| --- | --- | --- | --- |
| K1 | 試験の土台（§2 の D1 マイグレーションの準備・`env` に `APP_ENV: 'local'` を渡す手伝い）と、入力の検証・他ゲームの分離（ケース 2・3・4 の `いま`） | いま | — |
| K2 | サーバー側の失敗と互換（ケース 1・5・6・7 の `いま`） | いま | K1 |
| K3 | 認証・なりすまし・連投の制限・送信 ID（ケース 4・5・8 の `認証後`） | 認証後 | 認証の設計（Phase 1） |
| K4 | CLI・UE のリトライ・時刻・旧クライアント（ケース 1・6・7 の `UE統合後`） | UE統合後 | Phase 3 |

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む。

K1:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
runTests();
requireTests([
  '存在しないゲームのランキングは200と空の一覧を返す',
  '存在しないボードのランキングは200と空の一覧を返す',
  '存在しないゲームのお知らせは200と空の一覧を返す',
  'ボードIDの形が正しくなければNOT_FOUNDの404を返す',
  'gameIdが無いか形が正しくなければINVALID_ARGUMENTの400を返す',
  'limitが1から50の外なら400を返す',
  'スコアがマイナスなら400を返しランキングに載らない',
  'スコアが整数でなければ400を返す',
  'スコアが10億を超えると400を返す',
  'スコアが0と10億ちょうどなら受け付ける',
  '他のゲームのランキングは返さない',
  '他のゲームのお知らせは返さない',
  'SQLを混ぜたgameIdはINVALID_ARGUMENTの400を返す',
  '同じプレイヤーIDでも他のゲームの記録は書き換えない',
]);
gitClean(['src/', 'migrations/', ['package', 'json'].join('.'), 'wrangler.jsonc']);
done();
```

K2:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
runTests();
requireTests([
  'DBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない',
  '書き込みでDBが失敗してもINTERNAL_ERRORの500を返す',
  '途中で切れたJSONの本文はINVALID_JSONの400を返す',
  '同じスコアを二重送信しても行は1つで結果は同じ',
  '低いスコアを後から送っても最高スコアが残る',
  '同じプレイヤーが並べて連投しても最高スコアだけが残る',
  'クライアントが送った時刻の欄は無視しサーバーの時刻で記録する',
  '同点なら先に記録した人が上に並ぶ',
  'マイグレーションを2回当ててもデータは壊れない',
  '今のCLIモックと同じ形の要求を受け付ける',
  '知らない欄が付いた要求も受け付ける',
]);
gitClean(['src/', 'migrations/', ['package', 'json'].join('.'), 'wrangler.jsonc']);
done();
```

K3（認証の設計が決まってから。名前は §3 のまま）:

```js
import { runTests, requireTests, done } from './scripts/issue-run/check-lib.mjs';
runTests();
requireTests([
  '他のプレイヤーになりすました書き込みを弾く',
  '決めた回数を超えて連投すると429を返す',
  '同じ送信IDの二重送信は1回分として扱う',
  'トークンが無い書き込みは401を返す',
  '期限切れのトークンは401を返す',
  '署名の正しくないトークンは401を返す',
  '認証が入っても本番でない環境の無認証の書き込みは403のまま',
]);
done();
```

K4（Phase 3。自動にできる 2 本だけ `requireTests` に入れ、L3 の 2 本はユーザーが見る）:

```js
import { runTests, requireTests, done } from './scripts/issue-run/check-lib.mjs';
runTests();
requireTests([
  'CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する',
  '旧CLIはスキーマ変更後のAPIでもランキングを送って読める',
]);
done();
```

- K1・K2 は `src/` の挙動を変えない束。テストが落ちたら、欠陥として `docs/guides/decisions/test-plan.md` §8 の形で報告し、§5 の決まりに当たらなければ直すか設計を直すかを design-cycle §5 で振り分ける。
- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだテストを作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり）。

## 5. 決めること（いまの挙動が契約に無い・決まっていない所）

挙動はこの設計書では直さない。§3 の期待する結果は「推し」の案で書いてある。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 存在しないゲーム・ボードの GET の応答 | A: いまのまま 200 と空の `items`。B: ゲームとボードの表を足し 404 `NOT_FOUND` | **A**。PoC にゲームの登録の仕組みが無く、B は新しいマイグレーションと登録の API が要る。`docs/api-contract.md` に「形が正しい ID は 200 と空の一覧」と 1 行足す（契約の正はそちら）。登録の仕組みを入れるときに B を決め直す |
| 2 | 書き込みで、低いスコアでも `displayName` を上書きする | A: いまのまま上書き。B: スコアが上がったときだけ上書き | **A**。名前の変更を反映できる。§3 の試験は `score` だけを見るので、どちらでも通る |
| 3 | 入力の検証を `src/worker.ts` の外のふつうの関数にするか | A: K1 で検証の関数を外へ出し、L1 の試験を足す。B: いまは L2 だけ | **B**（K1・K2 は `src/` を変えない束にして、試験だけを先にそろえる）。外へ出すのは認証を入れる K3 の前に、別の Issue で。§3 の名前は HTTP で見る形なので、外へ出しても変えなくてよい |
| 4 | 二重送信の見分け方（送信 ID） | A: `Idempotency-Key` のヘッダー。B: 本文の欄 | **A**（本文の形を変えず、CLI と UE で同じに付けられる）。認証の設計（K3）で決める |
| 5 | 旧クライアントとの互換の決まり | A: 欄は足すだけで消さない・意味を変えない。B: パスに版（`/v2/`）を足す | **A**（いまは `/v1/` だけで、`src/worker.ts` は知らない欄を無視している）。欄を消すときだけ B |

## 6. 指示の表

| Issue #5 の指示 | どこで答えるか |
| --- | --- |
| 8 つを試験の名前の表にする・名前は `it('…')` の文そのまま | §3 |
| 列は ケース・テストの名前・時期・層・入力（要求）・期待する結果 | §3 |
| ケース 1 のサーバー側は `いま`、CLI・UE のリトライは `UE統合後` | §3 のケース 1 |
| ケース 8 は全部 `認証後` | §3 のケース 8 |
| 契約と違う・決まっていない所は期待する結果に案を書き、決めることに推しつきで挙げる。挙動は直さない | §3 の期待する結果・§5 |
| 実装の束と、束ごとの `requireTests` の確認コマンドの案 | §4 |
