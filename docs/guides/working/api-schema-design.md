# API スキーマを機械検証可能にする（設計書）

`docs/guides/decisions/roadmap.md` Phase 1 の「APIスキーマをOpenAPI等で機械検証可能にする」の設計書。
いまの 4 つのエンドポイントとエラーの形を、機械で読めるスキーマのファイルにする方式・置き場・確かめ方（試験の名前）・実装の束を決める。**この設計書では実装しない**（スキーマのファイル・テスト・`src/` は次の Issue）。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`、いまの挙動の正は `src/worker.ts`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§4 の試験の名前を `requireTests` に渡して実装の Issue を回し、**スキーマのファイルと実際の API の応答・`docs/api-contract.md` の例・CLI モックの要求が食い違うとテストが落ちる**のを見て、API の形が機械で確かめられるようになったと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§5 に決めること、§6 に実装の束がある | 機械（Issue #11 の確認コマンド） |
| 4 つのエンドポイントとエラーコード 5 つが全部出てくる（§1・§3） | 機械（同上） |
| 決めることの表に方式の選び方（OpenAPI 3.1・JSON Schema・コードから作る）が案と推しつきである | 機械（同上）と AI の判定 |
| §4 の試験の名前の表の束は `S1`・`S2`… だけ・名前に重複が無い・`S1` の行がある | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使う（§6） | 機械（同上） |
| 指しているパスが実在する | 機械（同上） |
| スキーマの中身（§3）が `src/worker.ts` の挙動と `docs/api-contract.md` に合う。§4 の試験が `docs/guides/working/failure-case-test-plan.md` の試験と同じことを確かめていない | AI の判定（作っていない判定役が、表と契約・ソースを並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§6 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- `src/` の挙動を変えない（S1・S2）。スキーマと挙動が食い違ったら、テストを弱めず、§5 の決まりで「スキーマを直すか・挙動を直すか」を振り分ける（`docs/guides/decisions/test-plan.md` §11）。
- `package.json` を変えない（S1・S2）。パッケージを足す S3 は、ユーザーが §5 の決めること 2 で足すと決めたときだけ作る。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

`src/worker.ts`（2026-10-24 の main）を読んで確かめた。スキーマはこれを写す。

| エンドポイント | 入力 | 成功の応答 | 失敗の応答（状態・コード・message） |
| --- | --- | --- | --- |
| `GET /health` | なし | 200 `{"status":"ok","service":"rpg-online-backend"}` | — |
| `GET /v1/announcements` | クエリ `gameId`（`^[a-zA-Z0-9_-]{1,64}$`・必須） | 200 `{"gameId","items":[{"id","title","body"}]}`。`items` は最大 50・`id` の昇順。データが無くても 200 と空の `items` | 400 `INVALID_ARGUMENT` `Invalid gameId` |
| `GET /v1/rankings/{boardId}` | パス `boardId`（`^[a-zA-Z0-9_-]{1,64}$`）・クエリ `gameId`（同じ形・必須）・`limit`（数字だけの 1〜50・既定 10） | 200 `{"gameId","boardId","items":[{"playerId","displayName","score"}]}`。`items` は最大 `limit`・`score DESC, updated_at ASC, player_id ASC` の順 | 400 `INVALID_ARGUMENT`（`Invalid gameId`・`limit must be 1..50`）。`boardId` の形が外れたらどのルートにも当たらず 404 `NOT_FOUND` |
| `POST /v1/rankings/{boardId}` | パス `boardId`・本文 JSON `{"gameId","playerId","displayName","score"}`。`gameId`・`playerId` は ID の形、`displayName` は 1〜40 文字の文字列、`score` は 0〜1,000,000,000 の安全な整数。知らない欄は無視 | 200 `{"ok":true,"gameId","boardId","playerId"}` | 403 `NOT_READY_FOR_PRODUCTION` `Authentication not implemented`（`APP_ENV !== 'local'`。本文を読む前）・400 `INVALID_JSON` `Request body must be JSON`・400 `INVALID_ARGUMENT`（`Object required`・`Invalid ranking payload`） |
| どれにも当たらない | — | — | 404 `NOT_FOUND` `Endpoint not found` |
| どのエンドポイントでも | — | — | 例外は 500 `INTERNAL_ERROR` `Internal server error`（中身を返さない） |

- 応答はどれも `content-type: application/json; charset=utf-8`・`cache-control: no-store`。
- エラーはどれも `{"error":{"code","message"}}`（`docs/guides/working/architecture.md` の「3. APIの基本契約」・`docs/api-contract.md` の「エラーレスポンス」）。
- `docs/api-contract.md` の例は `boss-score` の具体的なパスで書かれている（`/v1/rankings/boss-score`）。スキーマではパスの引数 `{boardId}` にする。
- `docs/api-contract.md` に無い挙動: `items` の最大 50 件（お知らせ）、エラーの `message` の文、ヘッダー。スキーマにどこまで書くかは §5。
- 外へ出したふつうの関数・ルートの表は `src/worker.ts` に無い（ルートは `route` の中の `if` の並び）。スキーマとルートの一致は、HTTP で外から確かめる（§4 の S2）。

## 2. 方式（§5 で決めたとおり）

- **スキーマは OpenAPI 3.1 の JSON で 1 ファイル**。置き場はリポジトリ直下の `openapi/` のフォルダー（`openapi/rpg-online.v1.json`）。`/v1/` の中では欄を足すだけ（`docs/api-contract.md` の「互換の決まり」）なので、`/v2/` を足すときだけ別のファイルにする。
- OpenAPI 3.1 の `components.schemas` は JSON Schema（2020-12）そのものなので、要求・応答の形は JSON Schema で書く。YAML にしないのは、パッケージを足さずに読めるため（Vite が JSON をそのまま読み込める。YAML は読む道具が要る）。
- **検証の関数はパッケージを足さずに自前で書く**（S1）。このスキーマが使う JSON Schema の語だけを見る小さな関数（`type`・`properties`・`required`・`additionalProperties`・`items`・`maxItems`・`pattern`・`minLength`・`maxLength`・`minimum`・`maximum`・`const`・`enum`・`$ref` の `#/components/schemas/…`）。置き場は試験の側の `test/support/schema-check.ts`（`src/` を変えない）。スキーマで使う語を増やすときは、この関数と S1 の自己試験を同じコミットで直す。
- **契約の正**: 形（欄・型・範囲・状態コードとエラーコードの組）の正はスキーマ、挙動の説明（順位の付け方・最高スコアの保持・互換の決まり・書き込みの守り）の正は `docs/api-contract.md`。`docs/api-contract.md` の例はスキーマに合うことを S2 の試験で確かめる（どちらかだけ直すと落ちる）。`docs/api-contract.md` の書き換え（スキーマを指す 1 行を足す）は、S1 の実装の Issue で行う（この設計書ではしない）。
- 試験は vitest で、いまの試験と同じく Workers のランタイムの中で回す。スキーマは `import spec from '../openapi/rpg-online.v1.json'` で読む。`docs/api-contract.md` は `?raw` の import で文字列として読む。いまの `tsconfig.json` には `?raw` の型が無いので、S2 で `test/` に `declare module '*?raw'` の型のファイルを足す（JSON の import は `resolveJsonModule` で型が通る）（読めなければ S2 の実装の Issue で、Node.js 側の `vitest.config.ts` で読んで `miniflare.bindings` に渡す形に切り替える。いまの `TEST_MIGRATIONS` と同じ渡し方）。

## 3. スキーマの中身（いまの挙動を写す）

`paths` の 5 つの操作と、`components.schemas` に置く形（`issueGuest` はアカウントの A1 で足した。挙動の正は `docs/guides/working/account-design.md` §3）。

| 操作（`operationId`） | エンドポイント | 引数・本文 | 応答（状態 → 形） |
| --- | --- | --- | --- |
| `getHealth` | `GET /health` | なし | 200 → `Health`（`status` は `const: "ok"`・`service` は `const: "rpg-online-backend"`）・500 → `Error` |
| `issueGuest` | `POST /v1/accounts/guest` | 本文 `GuestRequest`（必須） | 200 → `GuestIssued`（`gameId`・`playerId`・`token`・`expiresAt`）・400・403・404・500 → `Error` |
| `listAnnouncements` | `GET /v1/announcements` | クエリ `gameId`（必須・`Id`） | 200 → `AnnouncementList`（`gameId`・`items` は `Announcement` の配列・`maxItems: 50`）・400・500 → `Error` |
| `getRanking` | `GET /v1/rankings/{boardId}` | パス `boardId`（`Id`）・クエリ `gameId`（必須・`Id`）・`limit`（`integer`・`minimum: 1`・`maximum: 50`・`default: 10`） | 200 → `RankingList`（`gameId`・`boardId`・`items` は `RankingEntry` の配列・`maxItems: 50`）・400・404・500 → `Error` |
| `submitScore` | `POST /v1/rankings/{boardId}` | パス `boardId`（`Id`）・本文 `ScoreSubmission`（必須） | 200 → `ScoreAccepted`（`ok` は `const: true`・`gameId`・`boardId`・`playerId`）・400・403・404・500 → `Error` |

| 形（`components.schemas`） | 中身 |
| --- | --- |
| `AnnouncementList`・`RankingList`・`ScoreAccepted`・`GuestIssued` | `gameId`・`boardId`・`playerId` は `Id`。欄は全部必須 |
| `GuestRequest` | `gameId`（`Id`・必須）。`additionalProperties: true`（知らない欄は無視する決まり） |
| `GuestIssued` | `gameId`・`playerId`（`Id`）・`token`（`string`・`pattern: "^v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"`）・`expiresAt`（`string`）。内部の `account_id` の欄は無い |
| `Id` | `type: string`・`pattern: "^[a-zA-Z0-9_-]{1,64}$"`（`gameId`・`playerId`・`boardId` で共通。`docs/guides/working/architecture.md` の「識別」） |
| `Announcement` | `id`・`title`・`body`（どれも `string`・必須） |
| `RankingEntry` | `playerId`（`Id`）・`displayName`（`string`・1〜40）・`score`（`integer`・0〜1000000000） |
| `ScoreSubmission` | `gameId`・`playerId`（`Id`）・`displayName`（`string`・1〜40）・`score`（`integer`・0〜1000000000）。全部必須。`additionalProperties: true`（知らない欄は無視する決まり） |
| `Error` | `error` の中に `code`（`ErrorCode`）と `message`（`string`）。両方必須 |
| `ErrorCode` | `enum: [INVALID_ARGUMENT, NOT_FOUND, NOT_READY_FOR_PRODUCTION, INVALID_JSON, INTERNAL_ERROR]` |

状態コードとエラーコードの組（スキーマでは各応答の `Error` に `x-error-codes` の拡張の欄で書く。OpenAPI は `x-` の欄を許す）:

| 状態 | エラーコード | 出る操作 |
| --- | --- | --- |
| 400 | `INVALID_ARGUMENT` | `listAnnouncements`・`getRanking`・`submitScore`・`issueGuest` |
| 400 | `INVALID_JSON` | `submitScore`・`issueGuest` |
| 403 | `NOT_READY_FOR_PRODUCTION` | `submitScore`・`issueGuest` |
| 404 | `NOT_FOUND` | `listAnnouncements`・`getRanking`・`submitScore`・`issueGuest`（登録の無いゲーム）と、`boardId` の形が外れたとき・スキーマに無いパス |
| 500 | `INTERNAL_ERROR` | 全部 |

- 応答の形は `additionalProperties: false`（§5 の決めること 4）。欄を足すときはスキーマも同じコミットで足す合図になる。
- `limit` はスキーマでは `integer`。`src/worker.ts` は `1.5`・`abc`・`-1` を 400 にする（数字だけの文字列）。クエリは文字列で来るので、検証の関数は「数字だけの文字列を整数に直してから見る」とし、それ以外は外れにする。
- `message` は `string` だけにして、文は決めない（§5 の決めること 5）。
- `content-type` は応答の `content` の `application/json` で表す（OpenAPI 3.1 は `headers` の `Content-Type` を無視する決まり）。`charset=utf-8` は説明の文に書き、S1 の試験が実物のヘッダーを見る。`cache-control` だけを `headers` に書く。
- `displayName` の長さ: `src/worker.ts` は `displayName.length`（UTF-16 の単位）で 1〜40 を見る。JSON Schema の `minLength`・`maxLength` は文字（コードポイント）で数えるので、BMP の外の文字（絵文字など）で食い違う。自前の検証関数（§2）は `src/worker.ts` に合わせて `.length` で数え、そのことをスキーマの `description` に書く。数え方を文字に揃えるかは、挙動を変えることなので別の Issue で決める（§5 の決めること 3 の振り分け）。S2 の境目の試験は BMP の中の文字だけを使う。
- 応答の `RankingEntry` は DB より厳しい（DB の `display_name`・`player_id` に CHECK が無い）。いまは API だけが書くので合うが、手やマイグレーションで行を入れたら S1 が落ちうる。

## 4. 試験の名前の表

いまある試験（`docs/guides/working/failure-case-test-plan.md` §3 の表・`test/health.test.ts`）は**挙動**（状態コード・データ）を見る。ここの試験は**スキーマの側から**見る（応答がスキーマに合う・スキーマと実物が食い違わない）。同じ入力を使うことはあっても、確かめることが違う。

| 束 | テストの名前 | 確かめること | 層 |
| --- | --- | --- | --- |
| S1 | `スキーマのファイルはOpenAPI 3.1で5つの操作を持つ` | `openapi` が `3.1.x`・`paths` の操作が `getHealth`・`issueGuest`・`listAnnouncements`・`getRanking`・`submitScore` のちょうど 5 つ・`$ref` が全部 `components.schemas` の中を指す | L1 |
| S1 | `スキーマの検証関数は型と必須と範囲と形の外れを見つける` | §2 の検証の関数の自己試験。§2 の語ごとに、合う値と外れる値を 1 つずつ渡し、外れだけを外れと言う（関数が何も見ずに通すことを防ぐ） | L1 |
| S1 | `スキーマのErrorCodeの列挙は5つのエラーコードと一致する` | `ErrorCode` の `enum` がちょうど `INVALID_ARGUMENT`・`NOT_FOUND`・`NOT_READY_FOR_PRODUCTION`・`INVALID_JSON`・`INTERNAL_ERROR` | L1 |
| S1 | `GET /healthの応答はスキーマに合う` | 200 の本文が `Health` に合い、ヘッダーがスキーマの `headers` に合う | L2 |
| S1 | `GET /v1/announcementsの応答はスキーマに合う` | 初期データの `welcome` がある状態で 200 の本文が `AnnouncementList` に合う | L2 |
| S1 | `GET /v1/rankings/{boardId}の応答はスキーマに合う` | 2 行入れて 200 の本文が `RankingList` に合う | L2 |
| S1 | `POST /v1/rankings/{boardId}の応答はスキーマに合う` | `APP_ENV=local` で正しい本文を送り、200 の本文が `ScoreAccepted` に合う | L2 |
| S1 | `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` | 5 つのエラーコードを 1 つずつ起こし（偽の DB で 500 も）、本文が `Error` に合い、状態とコードの組が §3 の表（スキーマの `x-error-codes`）に載っている | L2 |
| S2 | `スキーマの操作はどれもsrc/worker.tsのルートに当たる` | スキーマの 5 つの操作に、スキーマの例の値で要求し、どれも `NOT_FOUND` でない | L2 |
| S2 | `スキーマに無いメソッドとパスはNOT_FOUNDの404を返す` | スキーマの `paths` から作った「無いメソッド」（`POST /health`・`DELETE /v1/rankings/{boardId}` など）と「無いパス」（`/v1/events`）が 404 `NOT_FOUND`。スキーマに無いルートを足すと落ちる | L2 |
| S2 | `スキーマの入力の制約の境目でAPIの合否がスキーマと一致する` | `ScoreSubmission` と `limit` の `minimum`・`maximum`・`minLength`・`maxLength`・`pattern` から境目の値（ちょうど・1 つ外）を作って送り、スキーマが通す値は 200・外す値は 400 `INVALID_ARGUMENT`。値は手で並べずスキーマから作る | L2 |
| S2 | `api-contract.mdの要求と応答の例はスキーマに合う` | `docs/api-contract.md` の ```json の例（各エンドポイントの応答・入力・エラー）が、その節の操作のスキーマに合う | L1 |
| S2 | `api-contract.mdのエラーコードの一覧はスキーマと一致する` | 「エラーレスポンス」の節の「コード（状態）」の並びが、§3 の状態とエラーコードの組と同じ | L1 |
| S2 | `CLIモックの要求の本文はスキーマの入力に合う` | `scripts/cli-requests.mjs` の `scoreSubmission()` が `ScoreSubmission` に合う（`scripts/cli-mock.mjs` とスキーマが食い違わない） | L1 |
| S3 | `OpenAPIのメタスキーマでスキーマのファイルが正しいと判定される` | §5 の決めること 2 で足すと決めた `ajv`（2020-12）で、OpenAPI 3.1 のメタスキーマ（JSON のファイルとして `openapi/` に置く）にスキーマのファイルを当て、エラーが 0。Workers のランタイムでは子プロセスを起こせないので、`@redocly/cli lint` のような CLI は `it()` にせず、確認コマンドの `check()` で回す | L1 |
| S3 | `自前の検証関数と検証の道具の判定が一致する` | S1 の応答と §4 S2 の境目の値で、自前の関数と道具（例: `ajv`）の合否が全部同じ | L1 |

数（行）: S1 が 8・S2 が 6・S3 が 2。

- `スキーマの入力の制約の境目でAPIの合否がスキーマと一致する` は、K1 の `limitが1から50の外なら400を返す`・`スコアが10億を超えると400を返す` などと入力が重なるが、値をスキーマから作り「スキーマと API が同じ所で分かれる」ことを見る。K1 の代わりにはしない（K1 は挙動の正、こちらはスキーマの正しさ）。
- L2 の試験の作り方（`src/worker.ts` の `default` を直に呼ぶ・`env` に `APP_ENV: 'local'` を渡す・偽の DB・試験ごとにデータを消す）は `docs/guides/working/failure-case-test-plan.md` §2 と同じ。
- 置き場は束ごとに 1 ファイル（S1 は `test/schema-conformance.test.ts`、S2 は `test/schema-contract.test.ts`）。検証の関数は `test/support/schema-check.ts`。
- テストの名前は表の文そのまま `it('…')` に書く。名前を変えるときは、この表も同じコミットで直す（`docs/guides/procedures/node-test-procedure.md`）。

## 5. 決めること

推しの案で §2〜§4 を書いた。**2026-10-24、ユーザーが 6 つとも推しの案（1A・2A・3A・4A・5A・6A）に決めた。** S3（パッケージを足す）は、決めること 2 を B か C に決め直したときだけ作る。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | スキーマの方式 | A: **OpenAPI 3.1 の JSON**（形は JSON Schema 2020-12）。B: OpenAPI 3.1 の YAML（読みやすいが、読む道具のパッケージが要る）。C: OpenAPI を使わず JSON Schema のファイルだけ（パスと状態コードを書く所が無く、ルートの一致を確かめられない）。D: コードから作る（TypeScript の型や `zod` などの定義からスキーマを出す。`src/worker.ts` の書き換えとパッケージが要る） | **A**。パッケージを足さずに読める・パスと状態コードとエラーコードを 1 ファイルに書ける・UE や他の道具がそのまま読める。D は入力の検証を `src/worker.ts` の外へ出すとき（failure-case-test-plan の決めること 3）に決め直す |
| 2 | 検証の道具 | A: **パッケージを足さず、自前の小さな検証関数**（§2。使う語だけ）。B: `ajv`（JSON Schema の検証）を devDependencies に足す。C: B に加えて `@redocly/cli` などで OpenAPI のファイル自体を lint する | **A**（S1・S2 はこれで作る。`package.json` を変えない）。自前の関数の誤りが心配になったら B・C を S3 として足す（足すかどうかはユーザーが決める） |
| 3 | 契約の正をどちらにするか | A: **形の正はスキーマ・挙動の説明の正は `docs/api-contract.md`。例が合うことを試験で確かめる**（S2）。B: `docs/api-contract.md` を正のままにし、スキーマはその写し。C: スキーマを正にし、`docs/api-contract.md` の例をスキーマから作る（作る道具が要る） | **A**。CLAUDE.md 原則 5（一つの契約は一か所）のとおり、形と説明で正を分け、重なる例は機械で食い違いを見つける。S1 の実装の Issue で `docs/api-contract.md` に「形の正はスキーマ」の 1 行を足す |
| 4 | 応答の知らない欄 | A: **応答のスキーマは `additionalProperties: false`**（サーバーが欄を足したらスキーマも足す合図。S1 が落ちる）。B: `true`（足しても落ちない） | **A**。互換の決まり「欄は足すだけ」はクライアント側の受け方の決まりで、スキーマを最新に保つのはサーバー側の仕事。要求（`ScoreSubmission`）は知らない欄を無視する決まりなので `true` |
| 5 | エラーの `message` の文 | A: **`string` だけ。文は決めない**。B: 操作ごとに `enum` で決める | **A**。クライアントは `code` で分ける（`docs/guides/working/architecture.md` の「エラー」）。文は人が読むためで、変えても互換を壊さない |
| 6 | スキーマのファイルの置き場 | A: **リポジトリ直下の `openapi/`**。B: `docs/` の下。C: `src/` の下 | **A**。`docs/` の置き場の決まり（CLAUDE.md）は文書のためで、機械が読むファイルを混ぜない。`src/` は Worker のコードだけにする（`src/` に置くと Worker に入る） |

## 6. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る（S1 がスキーマのファイルと検証の関数を作る）。

| 束 | 中身 | 前の束 | パッケージ |
| --- | --- | --- | --- |
| S1 | スキーマのファイル（§3）・検証の関数（§2）・応答がスキーマに合う試験。`docs/api-contract.md` に「形の正はスキーマ」の 1 行を足す | — | 足さない |
| S2 | スキーマと実物（ルート・入力の境目・`docs/api-contract.md` の例・CLI モック）が食い違わない試験 | S1 | 足さない |
| S3 | OpenAPI の検証の道具での確かめ | S1・決めること 2 で B か C | 足す（ユーザーが決めたときだけ） |

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。

S1:

```js
import { runTests, requireTests, mustExist, gitTracked, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const spec = ['openapi', 'rpg-online.v1.json'].join('/');
mustExist([spec]);
gitTracked([spec]);
runTests();
requireTests([
  'スキーマのファイルはOpenAPI 3.1で5つの操作を持つ',
  'スキーマの検証関数は型と必須と範囲と形の外れを見つける',
  'スキーマのErrorCodeの列挙は5つのエラーコードと一致する',
  'GET /healthの応答はスキーマに合う',
  'GET /v1/announcementsの応答はスキーマに合う',
  'GET /v1/rankings/{boardId}の応答はスキーマに合う',
  'POST /v1/rankings/{boardId}の応答はスキーマに合う',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
]);
gitClean(['src/', 'migrations/', ['package', 'json'].join('.'), 'wrangler.jsonc']);
done();
```

S2:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
runTests();
requireTests([
  'スキーマの操作はどれもsrc/worker.tsのルートに当たる',
  'スキーマに無いメソッドとパスはNOT_FOUNDの404を返す',
  'スキーマの入力の制約の境目でAPIの合否がスキーマと一致する',
  'api-contract.mdの要求と応答の例はスキーマに合う',
  'api-contract.mdのエラーコードの一覧はスキーマと一致する',
  'CLIモックの要求の本文はスキーマの入力に合う',
]);
gitClean(['src/', 'migrations/', ['package', 'json'].join('.'), 'wrangler.jsonc']);
done();
```

S3（決めること 2 で B か C に決めたときだけ。`package.json` と `package-lock.json` は `npm install` で対で変える。C の lint の CLI は、ここに `spawnSync` の結果を `check()` で見る行を足す）:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
runTests();
requireTests([
  'OpenAPIのメタスキーマでスキーマのファイルが正しいと判定される',
  '自前の検証関数と検証の道具の判定が一致する',
]);
gitClean(['src/', 'migrations/', 'wrangler.jsonc']);
done();
```

- S1・S2 は `src/` の挙動を変えない束。スキーマに合わずに落ちたら、`docs/guides/decisions/test-plan.md` §8 の形で報告し、§1 の事実（いまの挙動）とスキーマのどちらが正しいかを §5 の決めること 3 で振り分ける（形の誤りならスキーマを直す・挙動の誤りなら別の Issue で `src/` を直す）。
- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだスキーマと試験を作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり・`docs/guides/procedures/issue-goal-setting.md`）。

## 7. UE の C++ クライアントでの使い方

Phase 3 の C++ の HTTP/JSON クライアント層（`docs/guides/decisions/roadmap.md`）は、このスキーマから要求・応答の構造体と JSON の読み書きを作れる（OpenAPI Generator の `cpp-ue4` の生成など。生成の道具を足すかは Phase 3 で決める）。生成しない場合でも、エラーの `ErrorCode` の列挙と各操作の状態コードの組（§3）を C++ の `enum` と分岐の手本にでき、サーバーが欄を足しても `additionalProperties` を無視して読む（互換の決まり）ことをクライアントの試験で確かめられる。CLI モック（`scripts/cli-mock.mjs`）は UE のクライアントの代わりなので、S2 の `CLIモックの要求の本文はスキーマの入力に合う` が UE 側の形の先回りの確かめになる。

## 8. 指示の表

| Issue #11 の指示 | どこで答えるか |
| --- | --- |
| 4 つのエンドポイントとエラーの形を機械で読めるスキーマにする方式・置き場・確かめ方・実装の束を決める。実装はしない | §2・§3・§4・§6 |
| 試験の名前の表は `束・テストの名前・確かめること・層` の列、束の列は `S1`・`S2`… だけ、名前は `it('…')` の文そのまま | §4 |
| いまある試験と同じことを確かめる名前を作らない。スキーマの側から見る試験にする | §4 の頭書きと表 |
| 新しいパッケージが要る案は決めることに案と推しを書くだけ。パッケージを足さずに済む案も 1 つは挙げる | §5 の決めること 1・2（A が足さない案）・§6 の S3 |
| `docs/api-contract.md` とスキーマのどちらを契約の正にするか | §5 の決めること 3 |
| UE の C++ クライアントがスキーマをどう使えるかは 1 段落 | §7 |
| `docs/api-contract.md` を書き換えない・パッケージを足さない・デプロイしない | この設計書では何も変えていない（§6 の S1 で 1 行足す案だけ） |
