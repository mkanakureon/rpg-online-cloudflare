# クライアント統合（Unreal・Unity・ブラウザ）の設計書

`roadmap.md`（`docs/guides/decisions/roadmap.md`）Phase 3「クライアント統合（Unreal・Unity・ブラウザ）」の設計書。
3 つのクライアントで共通の決まり（タイムアウト・再試行・`Retry-After`・エラーコードの表・ページング・トークンの期限・`serverTime`）、その決まりの置き場と確かめ方、ブラウザの SDK とサンプル、Unreal・Unity のクライアント層、失敗ケースの束 K4、Steam などのプラットフォームの認証、実装の束を決める。
Phase 1 の残り「エラーコード、タイムアウト、ページングを確定」も、クライアントの再試行の前提として §2 で決める。
**この設計書では実装しない**（`src/`・`test/`・`openapi/`・`scripts/`・SDK とサンプルのコード・新しいフォルダーは次の Issue）。

用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。
契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）。いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§9 の試験の名前を `requireTests` に渡して実装の Issue を B1〜B6 の順に回し、**CLI モック（`scripts/cli-mock.mjs`）と 3 つのクライアント（ブラウザ・Unity・Unreal）が、同じ API シナリオ（§4）を、同じタイムアウト・再試行・エラーの扱い（§2）で通す**のを見て、Phase 3 の完了条件「CLI モックと 3 つのクライアントが同一の API シナリオを実行できる」に届いたと分かる。
ブラウザと CLI モックは Mac の無人の回で機械が確かめ、Unity・Unreal は決まりの値が同じことを Mac で機械が確かめ、シナリオの実行とゲームが止まらないことを専用 PC で人が見る。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§11 に決めること（案と推しつき）、§13 に範囲の外、§12 に実装の束がある | 機械（Issue #50 の確認コマンド） |
| 元にした文書・仕組み・扱うことの語が出てくる。Phase 4 に触れている | 機械（同上） |
| 名前の中の数や機能の一覧で挙動が変わりうる既存の試験に、名前で触れている（§10） | 機械（同上） |
| §9 の試験の名前の表の束は `B1`・`B2`… だけ・名前に重複が無い・いまの `test/` の名前と重ならない | 機械（同上） |
| §12 に束ごとの確認コマンドの案があり、`requireTests` と `gitClean(…, { base })` を使う | 機械（同上） |
| 指している `docs/`・`scripts/`・`openapi/` のパスが実在する | 機械（同上） |
| §2 の決まりが `docs/api-contract.md`・`src/` のいまの挙動に合う（違う所は §11 に挙がっている） | AI の判定（作っていない判定役が、表と契約・ソースを並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§12 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 専用 PC で人が見る行（§9 の H1〜H6）は、機械の合否と分けて、ユーザーが観測の記録で決める（`CLAUDE.md` 原則 4）。
- `APP_ENV === 'local'` のときだけ書き込みを通す守りを外さない。デプロイしない。npm の包みを公開しない（`CLAUDE.md` の「守るもの」）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

| 元 | 事実（この設計の前提） |
| --- | --- |
| ADR 0001（`docs/adr/0001-mac-first-cli.md`） | Mac でサーバーを先に作り、CLI モックで確かめる。UE の通信タイムアウト・非同期 UI・回線断は「UE 統合時に別途テストする」とトレードオフに書いてある |
| ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`） | クライアントは Unreal・Unity・ブラウザ（TypeScript）の 3 つ。どれも同じ HTTP/JSON の API を呼ぶ。サーバーにエンジンのクラスや UI を持ち込まない |
| `roadmap.md` | Phase 1 の「エラーコード、タイムアウト、ページングを確定」が未チェック。Phase 3 の 5 項目（ブラウザの SDK とサンプル・Unreal の C++ 層とイベントコマンドの橋渡し・Unity の C# 層・通信エラーとリトライと非同期の確かめ・Steam 等のアダプター）。作業機は Mac・UE 専用 PC・Unity 専用 PC |
| `architecture.md` §5（`docs/guides/working/architecture.md`） | イベントコマンド `online.ranking.submit` の構想（`params` の `scoreVariable`・`responseVariable`）。「安全な GET は再試行可能。POST には冪等キー」「スキーマ違反はエラー変数に落とす」「オフラインでもゲーム進行を妨げない」「クライアントに保存した長期の秘密鍵を安全とみなさない」 |
| `api-schema-design.md`（`docs/guides/working/api-schema-design.md`） | 形の正は `openapi/rpg-online.v1.json`（OpenAPI 3.1 の JSON・パッケージを足さない自前の検証関数 `test/support/schema-check.ts`）。各応答に返りうるコードの `x-error-codes` がある（103 か所）。操作は 19 個・`ErrorCode` の列挙は 19 個 |
| `docs/api-contract.md` のエラー | 形は `{"error":{"code","message"}}`。ゲームのクライアントの口のコードは 19 個（`INVALID_ARGUMENT`・`NOT_FOUND`・`NOT_READY_FOR_PRODUCTION`・`INVALID_JSON`・`INTERNAL_ERROR`・`UNAUTHENTICATED`・`TOKEN_EXPIRED`・`PERMISSION_DENIED`・`SAVE_CONFLICT`・`PAYLOAD_TOO_LARGE`・`SLOT_LIMIT_EXCEEDED`・`RATE_LIMITED`・`EVENT_NOT_ACTIVE`・`INVENTORY_LIMIT_EXCEEDED`・`PLAYER_BANNED`・`PLAYER_DATA_LIMIT_EXCEEDED`・`IDEMPOTENCY_KEY_REUSED`・`QUEST_NOT_COMPLETED`・`QUEST_NOT_ACTIVE`）。DB の失敗は中身を返さず 500 `INTERNAL_ERROR`。`message` の文は決めない（クライアントは `code` で分ける） |
| `abuse-protection-design.md`（`docs/guides/working/abuse-protection-design.md`） | 429 `RATE_LIMITED` と `Retry-After`（窓の終わりまでの秒。1〜60 の整数。`src/core/rate-limit.ts` の `retryAfterSeconds`）。断った要求も数える。CLI モックは 429 で再試行せず止まる（§11）。`Idempotency-Key` の後から足す形の期限は「**要確認**: クライアントの再試行の長さ。Phase 3」と残っている |
| `account-design.md`（`docs/guides/working/account-design.md`） | トークンは `v1.<本文>.<HMAC-SHA256>`、期限 30 日（`src/core/token.ts` の `TOKEN_TTL_SECONDS`）、更新の口は作らない（§8 の決めること 3。B の更新の口は引き継ぎと一緒に設計する）。期限切れは 401 `TOKEN_EXPIRED`、壊れた・無いトークンは 401 `UNAUTHENTICATED`。外部の認証（Steam など）は `account_identities(provider, subject, account_id)` を足す形（§11） |
| `event-reward-design.md`（`docs/guides/working/event-reward-design.md`）・`quest-design.md` | 報酬の受け取りは一意の鍵（プレイヤー・イベントかクエスト・区切り）で、同じ区切りの 2 回目は 200 で 1 回目と同じ本文。区切りをまたいだ送り直しは 409 になりうるので、受領の履歴で確かめる |
| `player-data-design.md`（`docs/guides/working/player-data-design.md`） | `POST /v1/player-data` は `Idempotency-Key` が必須（`^[a-zA-Z0-9_-]{8,64}$`）。同じ鍵と同じ中身は 200 で同じ本文、違う中身は 422 `IDEMPOTENCY_KEY_REUSED`。鍵の期限は 30 日（掃除が消す）。クライアントは書き込みごとに新しい鍵を作り、送り直しだけ同じ鍵 |
| `save-design.md`（`docs/guides/working/save-design.md`） | セーブの `PUT`・`DELETE` は `baseRevision` で競合を止める。2 回目の `PUT` は 409 `SAVE_CONFLICT`、2 回目の `DELETE` は 404 `NOT_FOUND`。一覧は最大 10 件でページングしない |
| `operations-security.md`（`docs/guides/decisions/operations-security.md`） | 公開前に本人確認（Steam 向けなら Steam 認証のサーバー側の検証）・認可・レート制限・秘密情報を Git に入れない |
| `failure-case-test-plan.md`（`docs/guides/working/failure-case-test-plan.md`） | 束 K4（時期 `UE統合後`）の 4 本: ケース 1 の `CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する`（L2）・`UEクライアントは500を受けたら再試行して利用者に通信エラーを出す`（L3）、ケース 6 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う`（L3）、ケース 7 の `旧CLIはスキーマ変更後のAPIでもランキングを送って読める`（L2） |
| `scripts/cli-requests.mjs`・`scripts/cli-requests.d.mts` | CLI モックの要求の形の関数（Node.js の API を使わない ES モジュール・型は `.d.mts`）。テスト `今のCLIモックと同じ形の要求を受け付ける`・`CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` が同じ関数を使う |
| `scripts/cli-mock.mjs` | `fetch` を直に呼ぶ `call()`。**タイムアウトも再試行も無い**（応答が来なければ待ち続ける）。429 は `Retry-After` を出して止まる |
| `src/`（CORS） | `Access-Control-*` の見出しも `OPTIONS` の口も**無い**。ブラウザで別のオリジン（ページの置き場）から `127.0.0.1:8787` を呼ぶと、`Authorization` の付いた要求は事前確認（preflight）で断られる。`Retry-After`・`ETag` は公開の見出しにしないとページの JavaScript から読めない（§5.6） |
| `src/`（ページング） | 続きのある一覧は受領の履歴（`GET /v1/inventory/history`）と管理の監査のログ（管理の口）だけで、どちらも `limit`（1〜100・既定 20）・`before`・`nextBefore`。ランキングは `limit`（1〜50・既定 10）の上位だけ。お知らせは 50 件まで。セーブの一覧は 10 件まで。イベント・クエスト・プレイヤーデータは全部を返す |
| `src/`（`serverTime`） | ゲームのクライアントの口で `serverTime` を返すのは `GET /v1/events` と `GET /v1/quests` だけ |
| `CLAUDE.md`・`package.json` | 守るもの: デプロイ・公開をしない、`APP_ENV` の既定を変えない、`package.json` と `package-lock.json` は対で動かす。`typecheck` の対象は `tsconfig.json` の `src/**`・`test/**` だけ。依存は devDependencies の 4 つ（vitest・vitest-plugin・typescript・wrangler） |

## 2. 3 つのクライアントで共通の決まり

ここに書く値と表は、§3 の置き場（スキーマの拡張）へ B1 で写し、以後はそちらが正。CLI モックもこの決まりで動く（CLI モックは 3 つのクライアントの代わりなので）。

### 2.1 タイムアウトと再試行（§11 の決めること 1）

| 値 | 決まり |
| --- | --- |
| 1 回の要求のタイムアウト | **10 秒**（接続から本文を読み終えるまで） |
| 試す回数 | **最大 3 回**（初回 + 再試行 2 回） |
| 再試行の間隔 | 指数の待ち: 1 回目の再試行の前に 1 秒、2 回目の前に 2 秒（基本 1 秒 × 2 の n 乗・上限 8 秒）。**揺らぎ（全幅の jitter）**を入れ、実際の待ちは 0〜その秒の一様乱数 |
| 1 つの操作の全体の上限 | 試す回数と間隔から決まる（10 + 1 + 10 + 2 + 10 = 約 33 秒）。これを超えて待たない |

- 再試行**する**状態: 回線断（接続できない・途中で切れた）・タイムアウト・500 `INTERNAL_ERROR`・502・503・504（Cloudflare の手前が返す JSON でない応答を含む）・429 `RATE_LIMITED`（§2.3 の別の決まり）。
- 再試行**しない**状態: 400・401・403・404・409・413・422（同じ要求を送り直しても結果は変わらない）。304 は成功。
- 再試行してよいのは、§2.2 の操作の再試行の種類が許すときだけ。

### 2.2 操作ごとの再試行の種類（§11 の決めること 2）

送り直しの決まりは口ごとにもう決まっている（`architecture.md` §3・`player-data-design.md` §6・`event-reward-design.md`・`save-design.md`）。それを 5 つの種類にまとめ、操作ごとに 1 つ付ける。

| 種類 | 意味 | クライアントの自動の再試行 |
| --- | --- | --- |
| `safe` | 読むだけ（`GET`） | する |
| `natural-key` | 一意の鍵か `MAX` で、同じ要求を 2 回送っても記録と応答が同じ | する（同じ要求をそのまま） |
| `idempotency-key` | `Idempotency-Key` で二重にならない | する（**同じ鍵**と同じ本文で） |
| `new-resource` | 送り直すと新しいものができるが、余った 1 つは害が無い | する（利用制限の範囲で） |
| `revision` | `baseRevision` で止まり、送り直すと 409 か 404 になる | **しない**。結果が分からない（タイムアウト・回線断・500）ときは `GET` で読み直して確かめる |

| 操作（`operationId`） | 口 | 種類 | 送り直しの結果 |
| --- | --- | --- | --- |
| `getHealth` | `GET /health` | `safe` | — |
| `issueGuest` | `POST /v1/accounts/guest` | `new-resource` | 別のプレイヤーができる。前の応答が届かなかった方は使われずに残る（IP ごと 60 秒に 10 回で抑える） |
| `listAnnouncements` | `GET /v1/announcements` | `safe` | — |
| `getRanking` | `GET /v1/rankings/{boardId}` | `safe` | — |
| `submitScore` | `POST /v1/rankings/{boardId}` | `natural-key` | 最高スコアだけ残るので同じ（回数は 2 回分数える） |
| `listSaves`・`getSave` | `GET /v1/saves`・`GET /v1/saves/{slotId}` | `safe` | — |
| `putSave` | `PUT /v1/saves/{slotId}` | `revision` | 2 回目は 409 `SAVE_CONFLICT`。読み直して `revision` と `checksum` が送ったものなら成功とみなす |
| `deleteSave` | `DELETE /v1/saves/{slotId}` | `revision` | 2 回目は 404。読み直して 404 なら成功とみなす |
| `getConfig`・`getMasterData` | `GET /v1/config`・`GET /v1/config/master/{key}` | `safe` | — |
| `getInventory`・`listInventoryHistory` | `GET /v1/inventory`・`GET /v1/inventory/history` | `safe` | — |
| `listEvents` | `GET /v1/events` | `safe` | — |
| `claimEventReward` | `POST /v1/events/{eventId}/claim` | `natural-key` | 同じ区切りなら 200 で同じ本文。区切りをまたぐと 409 になりうる（受領の履歴で確かめる） |
| `getPlayerData` | `GET /v1/player-data` | `safe` | — |
| `writePlayerData` | `POST /v1/player-data` | `idempotency-key` | 同じ鍵と同じ本文なら 200 で同じ本文。鍵の期限 30 日 |
| `listQuests` | `GET /v1/quests` | `safe` | — |
| `claimQuest` | `POST /v1/quests/{questId}/claim` | `natural-key` | `claimEventReward` と同じ |

- 操作は 19 個（`openapi/rpg-online.v1.json` の全部）。管理の口（`openapi/rpg-online-admin.v1.json`）はゲームのクライアントが呼ばないので範囲の外（管理の CLI の決まりは `admin-design.md`）。
- `Idempotency-Key` を `writePlayerData` 以外の口に付けても、サーバーは読んで無視する（`docs/api-contract.md` の「利用制限」）。クライアントは付けない。

### 2.3 429 の `Retry-After`（§11 の決めること 3）

- 429 `RATE_LIMITED` を受けたら、`Retry-After` の秒（1〜60）だけ**非同期で**待ち、**1 回だけ**送り直す（§2.2 の種類が自動の再試行を許すときだけ）。この 1 回は §2.1 の 3 回とは別に数えない（同じ 3 回の中の 1 回）。
- 待つ上限は **60 秒**（サーバーの窓の最大）。見出しが無い・数でない・60 を超えるときは待たずに、呼び出し側へ `RATE_LIMITED` を返す（画面の文の種類は「混み合っています」）。
- 2 回目も 429 なら、それ以上送らずに返す（断った要求も数えるので、続けて送ると窓が明けない）。

### 2.4 500 `INTERNAL_ERROR`・回線断・JSON でない応答（§11 の決めること 4）

- 500 `INTERNAL_ERROR`・502〜504・回線断・タイムアウトは、どれも画面の文の種類「通信エラー」に落とす。中身（`message`・JSON でない本文）は画面に出さない。
- 種類が `revision` の操作は自動で送り直さず、「結果が分からない」として返す。SDK は読み直しの関数（`getSave` で `revision` と `checksum` を比べる）を用意し、ゲームが呼ぶ。
- 本文が JSON でない・`error.code` が無い応答は、状態コードだけで扱う（5xx なら通信エラー、4xx なら「不明な誤り」で再試行しない）。
- 3 回とも失敗したら、ゲームは止めずにエラーを返す（`architecture.md` §5 の「エラー変数に落とす」）。オフラインの未送信の待ち行列は Phase 3 では作らない（§13）。

### 2.5 エラーコードの表（§11 の決めること 5）

19 個のコードと、コードの無い失敗。**画面の文の種類**はゲームが文を選ぶ分類で、文そのものはゲームが持つ（多言語のため。サーバーの `message` は人が読むためで画面に出さない）。

| コード | 状態 | 画面の文の種類 | 自動の再試行 | ゲームの次の一手 |
| --- | --- | --- | --- | --- |
| `INVALID_ARGUMENT` | 400 | `client-bug`（不具合） | しない | 開発者の誤り。ログに残す |
| `INVALID_JSON` | 400 | `client-bug` | しない | 同上 |
| `PERMISSION_DENIED` | 403 | `client-bug` | しない | トークンと別のゲーム・プレイヤーを送った。ログに残す |
| `IDEMPOTENCY_KEY_REUSED` | 422 | `client-bug` | しない | 鍵を書き込みごとに作り直していない |
| `PAYLOAD_TOO_LARGE` | 413 | `client-bug` | しない | セーブが 64 KiB を超えた |
| `NOT_FOUND` | 404 | `not-found` | しない | 口ごとの分岐（セーブが無い・登録の無いゲーム） |
| `NOT_READY_FOR_PRODUCTION` | 403 | `unavailable`（サービス準備中） | しない | ローカルでない環境。書き込みを諦める |
| `INTERNAL_ERROR` | 500 | `network`（通信エラー） | 種類が許せば する | §2.4 |
| `RATE_LIMITED` | 429 | `busy`（混み合っています） | `Retry-After` で 1 回 | §2.3 |
| `UNAUTHENTICATED` | 401 | `session`（もう一度始める） | しない | トークンが無い・壊れた。§2.7 |
| `TOKEN_EXPIRED` | 401 | `session` | しない | §2.7 |
| `PLAYER_BANNED` | 403 | `banned`（利用停止） | しない | 理由と期限は返らない。発行し直しても戻らない |
| `SAVE_CONFLICT` | 409 | `conflict`（別の端末で更新） | しない | 読み直してプレイヤーに選ばせる |
| `SLOT_LIMIT_EXCEEDED` | 409 | `limit`（上限） | しない | スロットを消してもらう |
| `INVENTORY_LIMIT_EXCEEDED` | 409 | `limit` | しない | 受け取れない |
| `PLAYER_DATA_LIMIT_EXCEEDED` | 409 | `limit` | しない | 値が上限 |
| `EVENT_NOT_ACTIVE` | 409 | `expired`（期間の外） | しない | 一覧を読み直す |
| `QUEST_NOT_ACTIVE` | 409 | `expired` | しない | 一覧を読み直す |
| `QUEST_NOT_COMPLETED` | 409 | `not-ready`（条件を満たしていない） | しない | 一覧を読み直す |
| （コード無し）回線断・タイムアウト・502〜504・JSON でない 5xx | — | `network` | 種類が許せば する | §2.4 |
| （コード無し）JSON でない 4xx・表に無いコード | — | `unknown` | しない | ログに残す。新しいサーバーが足したコードは `unknown` に落ちる（互換） |

- 種類は 11（`client-bug`・`not-found`・`unavailable`・`network`・`busy`・`session`・`banned`・`conflict`・`limit`・`expired`・`not-ready`）と `unknown`。
- コードを足すとき（サーバーの束）は、この表（§3 の置き場）にも同じコミットで行を足す。B1 の試験 `スキーマのエラーコードの表はErrorCodeの列挙と同じコードを持つ` が、列挙と表の数と中身が揃っていることを見張る（いまの列挙の数は既存の試験 `スキーマのErrorCodeの列挙は19個のエラーコードと一致する` が見張る）。

### 2.6 ページング（§11 の決めること 6。Phase 1 の残りの確定）

**いまの形をそのまま確定し、揃え直さない。** 一覧の口は 2 つの形のどちらかに入る。

| 形 | 口 | 決まり |
| --- | --- | --- |
| 続きを読む（カーソル） | `GET /v1/inventory/history`（と管理の監査のログ） | `limit`（1〜100・既定 20）と `before`（1 以上の整数）。続きがあれば応答に `nextBefore`、無ければ欄ごと無い。次は `before=nextBefore` で読む。並びは新しい順。外れは 400 `INVALID_ARGUMENT` |
| 上限で切る（続き無し） | ランキング（`limit` 1〜50・既定 10）・お知らせ（50 件）・セーブの一覧（10 件）・イベント・クエスト・プレイヤーデータ（宣言の数で決まる） | 続きの欄は無い。全部か上位だけ |

- クライアントの SDK は、続きを読む形の口に「最後まで読む」関数を 1 つ持つ（`nextBefore` が無くなるまで。1 回の呼び出しで読む上限のページ数を引数に取る）。
- 新しく続きのある一覧を足すときは、カーソルの形（`limit`・`before`・`nextBefore`）だけを使う（`offset` は使わない。行が増えるとずれるため）。この 1 行を B1 で `docs/api-contract.md` の「互換の決まり」の近くへ写す。

### 2.7 トークンと期限（§11 の決めること 7）

- クライアントはゲストの発行の応答の `token` と `expiresAt` を保存する（ブラウザは `localStorage`、Unity・Unreal はそれぞれの保存先〔**要確認**: 各エンジンの保存の API〕）。トークンを画面・ログに出さない（`scripts/cli-mock.mjs` が `[redacted]` にしているのと同じ）。クライアントに保存したトークンは長期の秘密として安全とはみなさない（`architecture.md` §5）。
- **推し: B3 でトークンの更新の口 `POST /v1/accounts/token` を足す**（§11 の決めること 7 の B）。期限の前の正しいトークンを `Authorization: Bearer` で送ると、同じ `g`・`p` で期限を 30 日先にした新しいトークンを返す。SDK は期限まで 7 日を切ったら、次の要求の前に更新する。更新の口の利用制限はプレイヤーごと（トークンのゲームとプレイヤー）に 60 秒に 10 回（`src/core/rate-limit-policy.ts` に単位を 1 つ足す。B3）。確かめの順はほかのトークンの口と同じ（`APP_ENV` の守り → トークン → 利用制限 → 止めた印）で、止めたプレイヤーは 403 `PLAYER_BANNED`。
- 期限が切れた（401 `TOKEN_EXPIRED`）・壊れた（401 `UNAUTHENTICATED`）トークンは更新できない。SDK は自動でゲストを発行し直さず、呼び出し側に `session` を返す。ゲームが「新しく始める」をプレイヤーに見せてから発行し直す（前のプレイヤーは引き継がない。`docs/api-contract.md`）。
- 更新の口が無いままだと、30 日を越えて遊ぶ人は全員別のプレイヤーになり、継続率の D30 が実際より低く出る（`analytics-design.md` の偏り）。更新の口はこれを 30 日の間に一度でも遊んだ人について消す。端末をまたぐ引き継ぎは更新の口では解けず、Phase 4 以降（§13）。

### 2.8 時刻（`serverTime`）の使い方（§11 の決めること 8）

- 期間の内か外か・受け取れるかはサーバーが決める。クライアントは端末の時刻で判断しない（受け取りを押せるかの表示も、一覧の `claimed`・`completed` で決める）。
- 残り時間の表示: 一覧（`GET /v1/events`・`GET /v1/quests`）を受け取った瞬間に、差 = `serverTime` − 端末の今を覚え、残り = `endsAt`（または `nextResetAt`）−（端末の今 + 差）で出す。差は一覧を読むたびに取り直す。
- `nextResetAt` を過ぎたら一覧を読み直す（区切りが変わって `claimed` が戻る）。
- `serverTime` をほかの口に足さない（いまの 2 つの一覧で足りる。時刻の差を測りたいだけの口は作らない）。

## 3. 共通の決まりの置き場と、同じ値の確かめ方（§11 の決めること 9）

**推し: 形の正のスキーマ `openapi/rpg-online.v1.json` に、OpenAPI の拡張（`x-` で始まる欄）として持つ。**

- 最上位に `x-client-policy`（§2.1 の値・§2.3 の上限・§2.5 の表）を 1 つ。
- 各操作（操作のオブジェクト）に `x-retry`（§2.2 の種類）。いまの応答ごとの `x-error-codes` と同じく、拡張の欄で持つ。
- `components.schemas` の中には置かない（自前の検証関数 `test/support/schema-check.ts` は知らない語で例外を投げる決まりで、スキーマの木の外なら影響しない）。

形（B1 で入れる。値は §2）:

```json
{
  "x-client-policy": {
    "timeoutSeconds": 10,
    "maxAttempts": 3,
    "backoff": { "baseSeconds": 1, "factor": 2, "maxSeconds": 8, "jitter": "full" },
    "retryAfter": { "maxWaitSeconds": 60, "maxRetries": 1 },
    "retryStatuses": [429, 500, 502, 503, 504],
    "tokenRefreshBeforeSeconds": 604800,
    "errorCatalog": {
      "INVALID_ARGUMENT": { "category": "client-bug", "retry": false },
      "RATE_LIMITED": { "category": "busy", "retry": true }
    }
  }
}
```

（`errorCatalog` は 19 行全部。上は 2 行だけ写した。）

3 つのクライアントが同じ値を使うことの確かめ方:

| クライアント | 値の持ち方 | 確かめ（Mac の vitest） |
| --- | --- | --- |
| CLI モック・ブラウザの SDK | SDK の定数のモジュール（JSON を読まずに書き写す。ブラウザで JSON を取りに行かないため） | `SDKの決まりの値はスキーマのクライアントの決まりと一致する`（SDK の定数とスキーマを並べて比べる） |
| Unity | C# の定数のクラス 1 つ | `Unityのクライアント層の決まりの値はスキーマと一致する`（C# のファイルを文字列として読み、決めた形の行から値を取り出して比べる） |
| Unreal | C++ の定数のヘッダー 1 つ | `Unrealのクライアント層の決まりの値はスキーマと一致する`（同上） |

- 値を変えるときは、スキーマと 3 つの定数を同じコミットで直す。どれかを忘れると Mac の試験が落ちる。
- 案 B（別の JSON の表）・C（文書だけ）は §11 の決めること 9。

## 4. 同一の API シナリオ

Phase 3 の完了条件の「同一の API シナリオ」は、**いまの CLI モックの通し**（`scripts/cli-mock.mjs` の順）に B3 の更新を足したもの。手順の名前を 3 つのクライアントで揃える。

| # | 手順 | 操作 |
| --- | --- | --- |
| 1 | 生きているか | `getHealth` |
| 2 | 設定を読み、`ETag` で 304 を受ける | `getConfig` ×2 |
| 3 | 設定に載ったマスターデータを 1 つ読む | `getMasterData` |
| 4 | お知らせを読む | `listAnnouncements` |
| 5 | ゲストを発行する | `issueGuest` |
| 6 | トークンを更新する（B3 から） | 新しい `POST /v1/accounts/token` |
| 7 | スコアを送って上位に載るのを見る | `submitScore`・`getRanking` |
| 8 | セーブを書いて読み、一覧に出たのを消す | `putSave`・`getSave`・`listSaves`・`deleteSave` |
| 9 | イベントの報酬を 2 回受け取り、1 回分だけ増えたのを見る | `listEvents`・`claimEventReward` ×2・`getInventory`・`listInventoryHistory` |
| 10 | 統計値を同じ `Idempotency-Key` で 2 回送り、1 回分だけ増えて実績が解けたのを見る | `getPlayerData`・`writePlayerData` ×2 |
| 11 | クエストを 2 回受け取り、同じ本文なのを見る | `listQuests`・`claimQuest` ×2 |

- 手順の一覧は B2 で SDK の中に 1 か所（シナリオの関数）で持ち、CLI モックとブラウザのサンプルがそれを呼ぶ。Unity・Unreal は同じ手順の名前で書き、Mac の試験が手順の名前の数を比べる（§9 の B5・B6）。
- 書き込みは `APP_ENV=local` のローカルの Worker（`127.0.0.1:8787`）に当てる前提。デプロイしない。

## 5. ブラウザ（TypeScript）の SDK とサンプル

### 5.1 置き場（§11 の決めること 10）

- **推し: このリポジトリの `clients/browser/`**（新しいフォルダー。B2 で作る）。npm の包みとして**公開しない**（`CLAUDE.md` の「公開をしない」）。`package.json` を足さない。
- 中身: SDK の本体 `clients/browser/rpg-online-client.mjs`（依存の無い ES モジュール）と型 `clients/browser/rpg-online-client.d.mts`、サンプル `clients/browser/sample/`（§5.5）。
- Unity・Unreal も同じ `clients/` の下に置く（§6.1）。

### 5.2 型（§11 の決めること 11）

- **推し: 型は手で書く**（`.d.mts`。`scripts/cli-requests.d.mts` と同じやり方）。スキーマから型を作る道具（`openapi-typescript` など）はパッケージの追加が要るので使わない。
- 手で書いた型がスキーマと食い違わないことは、B2 の試験 `SDKの応答の型はスキーマの応答と同じ欄を持つ` が見る（SDK で 19 の操作を呼び、応答を `test/support/schema-check.ts` の検証関数でスキーマに当てる。型の欄の名前の一覧は `.d.mts` を文字列として読んで比べる）。
- 本体を `.mjs` にするのは、ビルドの道具無しでブラウザ・Node.js（CLI モック）・Workers のランタイム（vitest）のどれでもそのまま読めるため。TypeScript の利用者は `.d.mts` で型が付く。`tsconfig.json` の `include` に `clients/**/*.d.mts` を足すのは B2（`npm run typecheck` で型の宣言も確かめる）。

### 5.3 いまの `scripts/cli-requests.mjs` との関係（§11 の決めること 12）

- **推し: CLI モックの送り方（`call()`）を SDK に置き換える。要求の形の関数（`scripts/cli-requests.mjs`）は残す。**
  - CLI モックはタイムアウトと再試行を SDK から得る（K4 の `CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する` をここで作る）。
  - 互換の試験 `今のCLIモックと同じ形の要求を受け付ける` と、ほかの CLI モックの流れの試験は `scripts/cli-requests.mjs` を読み続けるので、名前も中身も変わらない。
  - SDK の要求の形は `scripts/cli-requests.mjs` を読み込まない（`clients/` から `scripts/` へ依存しない）。同じ形であることは B2 の試験 `SDKでCLIモックと同じシナリオを通せる` が Worker に当てて見る。
- CLI モックは画面の文の種類（§2.5）と理由を出して終了コード 1 で止まる。

### 5.4 SDK の作り

- `createClient({ baseUrl, gameId, fetch, sleep, now, random, storage })`。時計・待ち・乱数・`fetch` を差し替えられる（試験でタイムアウトと待ちを実時間を使わずに確かめる）。タイムアウトは `AbortController` で切る（**要確認**: Workers のランタイムでの `AbortSignal.timeout` の有無。差し替えた `sleep` で切れば試験は依らない）。
- 操作ごとの関数（19 個 + 更新）は `Promise` を返す（非同期）。失敗は例外でなく `{ ok: false, error: { code, category, status, retryable } }` の結果で返す（ゲームが分岐しやすく、例外を隠さない）。
- 再試行は §2 の決まりと §3 の定数だけで決め、操作の関数には書かない（1 か所）。
- `writePlayerData` は呼び出しごとに新しい `Idempotency-Key`（`crypto.randomUUID()`）を作り、再試行では同じ鍵を使う。
- トークンは `storage` に置き、ログに出さない。

### 5.5 サンプルの形（§11 の決めること 13）

- **推し: ブラウザで開く 1 枚のページ** `clients/browser/sample/index.html`（ビルド無し。`<script type="module">` で SDK を読む）。ボタン 1 つで §4 のシナリオを流し、手順ごとの状態コード・画面の文の種類を表に出す。トークンとセーブの本体は出さない。
- ページは任意の静的なサーバー（**要確認**: Node.js 22 にパッケージ無しで使える静的サーバーは無い。`npx` で取ってくるのはインターネットからの実行になるので無人の回ではしない）か、Worker と同じオリジンで出す。どちらを推すかは §5.6 と一緒に §11 の決めること 14。
- 機械の確かめ: B4 の試験がページの HTML を文字列として読み、SDK を読み込んでいること・シナリオの関数を呼んでいることを見る。実際に開いて押すのは人（§9 の H1）。

### 5.6 ブラウザから呼ぶための CORS（§11 の決めること 14）

いまの Worker は CORS の見出しを返さない（§1）。ブラウザのサンプルが動くには次のどれかが要る。

- **推し: A. `APP_ENV=local` のときだけ、決めたオリジン（`http://127.0.0.1:<port>`・`http://localhost:<port>`）に CORS を返す**（B4・`src/core/` に 1 か所）。`OPTIONS` の事前確認に 204、`Access-Control-Allow-Headers` に `Authorization`・`Content-Type`・`Idempotency-Key`・`If-None-Match`、`Access-Control-Expose-Headers` に `Retry-After`・`ETag`。`local` でない環境では何も足さない（`APP_ENV` の守りと同じ向き）。
- B. Worker がサンプルのページも出す（同じオリジンなので CORS が要らない。ただし Worker に静的なファイルの口が増え、`wrangler.jsonc` を変える）。
- C. CORS を足さず、サンプルは Node.js からだけ動かす（ブラウザで確かめたことにならない）。

## 6. Unreal（C++）・Unity（C#）のクライアント層

### 6.1 置き場（§11 の決めること 15）

- **推し: このリポジトリの `clients/unity/`（UPM の包みの形のフォルダー）と `clients/unreal/`（プラグインの形のフォルダー）にソースだけを置く。** ビルドの成果物・エンジンのプロジェクト全体は置かない（専用 PC のプロジェクトがこのフォルダーを参照する）。
- 理由: 共通の決まり（§3）と同じコミットで 3 つのクライアントを直せる・Mac の試験が C# と C++ の定数を読める。別のリポジトリにすると、値の食い違いを Mac の無人の回で見つけられない。
- 包みの形（UPM の `package.json` の欄・UE のプラグインの `.uplugin` の欄）は **要確認**（専用 PC の版に合わせる。UPM の `package.json` はリポジトリ直下の `package.json` とは別のファイルで、`CLAUDE.md` の「`package.json` と `package-lock.json` は対」の対象外。B5 で書き添える）。

### 6.2 Mac でできること・専用 PC でしかできないこと

| | Mac（無人の回・機械） | 専用 PC（人） |
| --- | --- | --- |
| 決まりの値がスキーマと同じ | C# の定数・C++ のヘッダーを文字列で読んで比べる（B5・B6） | — |
| エラーコードの表の全部のコードを持つ | 同上 | — |
| シナリオの手順の名前が揃う | 同上 | — |
| ビルドが通る | できない（エンジンが無い） | Unity・UE のエディタでビルド |
| §4 のシナリオを通す | できない | Mac で起動したローカルの Worker に、同じ LAN から当てる（**要確認**: `wrangler dev` を `127.0.0.1` 以外で待たせる設定。`package.json` の `dev` を変えずに済む引数があるか。無ければ専用 PC の中で Worker を起動する） |
| ゲームが止まらない・通信エラーが画面に出る | できない | §9 の H2〜H6 |

人が専用 PC で見る手順は、B5・B6 で `docs/guides/procedures/` に 1 本ずつ書き（手順の置き場。ファイルの名前はその束で決める）、見た結果は `docs/reports/` に残す。

### 6.3 非同期の作り（ゲーム進行を止めない）

| | Unity | Unreal |
| --- | --- | --- |
| HTTP | `UnityWebRequest`（**要確認**: 専用 PC の Unity の版。`timeout` の欄は秒） | `FHttpModule` と `IHttpRequest`（**要確認**: 専用 PC の UE の版。`SetTimeout` の有無と意味） |
| 待ち方 | `async`／`await`（**要確認**: `Awaitable` が使える版か。古ければコルーチン） | 完了のコールバック（`OnProcessRequestComplete`。**要確認**: ゲームのスレッドで呼ばれるか）と、再試行の待ちはタイマー |
| JSON | **要確認**: `JsonUtility` で足りるか（辞書・最上位の配列が読めない）。足りなければ Newtonsoft の公式の包み | `FJsonObject`・`FJsonObjectConverter`（**要確認**: モジュールの名前と版） |
| 結果の形 | §5.4 と同じ `{ ok, error: { code, category, status, retryable } }` に当たる構造体 | 同左 |

- どちらも、要求の送信・待ち・再試行の間にゲームのフレームを止めない（メインのスレッドで同期の待ちをしない）。
- 再試行の決まりは定数のクラス（ヘッダー）1 か所から読む（§3）。

### 6.4 Unreal の RPG 制作ツールのイベントコマンドとの橋渡し（`architecture.md` §5）

- イベントコマンドは `online.<機能>.<操作>` の名前で、§4 のシナリオの操作に 1 つずつ当てる（例: `online.ranking.submit` → `submitScore`）。一覧は B6 で `clients/unreal/` の中に 1 か所。
- `params` の変数の番号: 入力の値（`scoreVariable` など）と、結果を書く変数 `responseVariable`（成功なら 0、失敗なら画面の文の種類の番号。§2.5 の 12 の種類に番号を振る）。
- コマンドの実行はイベントの「待ち」の状態に入り、応答（再試行を含む全部）が来たら次のコマンドへ進む。待ちの間もマップの描画・入力は止めない（**要確認**: 制作ツールのイベント実行機構に、非同期の完了を待つコマンドの仕組みがあるか）。
- サーバーにエンジンのクラスや UI（Slate／UMG）を持ち込まない。橋渡しは全部クライアントの側。

## 7. 失敗ケースの試験の束 K4 の扱い（§11 の決めること 16）

`failure-case-test-plan.md` の K4 の 4 本は、**名前を変えずに**この設計の束で作る（`failure-case-test-plan.md` の行は置き換えない）。

| K4 の名前 | 層 | 作る束 | 確かめ方 |
| --- | --- | --- | --- |
| `CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する` | L2 | B2 | 応答しない偽の `fetch` と差し替えた時計で、SDK 経由の CLI モックの送り方を呼ぶ。3 回送って、画面の文の種類 `network` と理由を出し、終了コード 1 にする関数の結果を見る。「決めた回数」は §2.1 の 3 回・「時間」は 10 秒 |
| `旧CLIはスキーマ変更後のAPIでもランキングを送って読める` | L2 | B2 | B1 で `openapi/rpg-online.v1.json` に欄を足した後に、B1 より前の CLI モックの要求の形（試験の中に写した固定の本文）でゲストの発行・スコアの投稿・読み取りを Worker に当てて 200 を見る |
| `UEクライアントは500を受けたら再試行して利用者に通信エラーを出す` | L3 | B6 | 人（§9 の H5）。Mac の機械の確かめは B6 の `Unrealのクライアント層の決まりの値はスキーマと一致する` まで |
| `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う` | L3 | B6 | 人（§9 の H6）。サーバーの側は `test/events.test.ts` の既存の試験が先に固めている |

- Unity にも同じ 2 つの観点を人の確かめ（H3・H4）として足す（L3。試験の名前は付けない）。
- ブラウザの同じ観点は、SDK の L2 の試験（B2）で機械が見る。

## 8. Steam などのプラットフォームの認証（§11 の決めること 17）

- **推し: Phase 3 では作らず、境目と置き場だけを決める。** いま Steam で出すゲームが決まっておらず、ゲストのトークンで Phase 3 の完了条件に届く。
- 境目:
  - サーバー: `account-design.md` §11 の `account_identities(provider, subject, account_id)` を足し、新しい口がプラットフォームの証明を**サーバー側で**確かめてから、いまと同じ形のトークンを発行する。置き場は `src/core/` の下のプロバイダーごとのファイル（ゲームごとの機能にしない）。
  - クライアント: 各クライアント層に「プラットフォームの証明を取る」差し替え口を 1 つ（既定は無し＝ゲスト）。Steam の証明（**要確認**: `ISteamUser::GetAuthTicketForWebApi` と Web API の `ISteamUserAuth/AuthenticateUserTicket` の今の名前と使い方）を取る実装は Unreal・Unity の層の中。
  - 秘密: Steam の Web API の鍵はサーバーの秘密（`wrangler secret`）にだけ置き、クライアントに入れない（`operations-security.md` の 7）。
- 作るのは、Steam で出すゲームが決まったとき（Phase 4 以降の別の設計書）。

## 9. 試験の名前の表

層は `docs/guides/decisions/test-plan.md` §3。置き場は `test/` の下で束ごとに 1 ファイル（例: B1 は `test/client-policy.test.ts`、B2 は `test/browser-sdk.test.ts`）。名前は `it('…')` の文そのまま。

| 束 | テストの名前 | 層 | 入力 | 期待する結果 |
| --- | --- | --- | --- | --- |
| B1 | `スキーマのクライアントの決まりはタイムアウトと再試行の回数と間隔を持つ` | L1 | `openapi/rpg-online.v1.json` の `x-client-policy` | §2.1・§2.3 の値（10 秒・3 回・1 秒×2・上限 8 秒・全幅の揺らぎ・待つ上限 60 秒・1 回） |
| B1 | `スキーマの全部の操作が再試行の種類を持つ` | L1 | 19 の操作 | どれも `x-retry` が 5 つの種類のどれか。§2.2 の表と同じ |
| B1 | `スキーマのエラーコードの表はErrorCodeの列挙と同じコードを持つ` | L1 | `errorCatalog` と `ErrorCode` の列挙 | 同じ集合。種類は §2.5 の 11 のどれか |
| B1 | `Idempotency-Keyが必須の操作だけが再試行の種類idempotency-keyを持つ` | L1 | 見出しの `Idempotency-Key` が `required` の操作 | `writePlayerData` だけで、`x-retry` が `idempotency-key` |
| B1 | `再試行してよいエラーコードはRATE_LIMITEDとINTERNAL_ERRORだけ` | L1 | `errorCatalog` | `retry: true` はその 2 つ |
| B2 | `SDKの決まりの値はスキーマのクライアントの決まりと一致する` | L1 | SDK の定数と `x-client-policy` | 全部の値と表が同じ |
| B2 | `SDKはタイムアウトした安全な読み取りを決めた回数まで再試行する` | L1 | 応答しない偽の `fetch`・差し替えた時計で `getRanking` | 3 回送り、`network` の結果。待ちは 10 秒で切れる |
| B2 | `SDKは再試行の待ちを指数で伸ばし上限で止める` | L1 | 乱数を 1 に固定し 500 を続けて返す偽の `fetch` | 待ちが 1 秒・2 秒。4 回目は送らない |
| B2 | `SDKは429を受けたらRetry-Afterの秒だけ待って1回だけ送り直す` | L1 | 429・`Retry-After: 7` の後に 200 | 7 秒待って 2 回目で成功。429 が続けば 2 回で止まる |
| B2 | `SDKはRetry-Afterが無いか上限を超えたら待たずにRATE_LIMITEDを返す` | L1 | 見出し無し・`Retry-After: 61`・`abc` | 待たずに `busy` の結果。送るのは 1 回 |
| B2 | `SDKはセーブの書き込みを500でも自動で送り直さない` | L1 | `putSave` に 500 | 1 回だけ送り、`retryable: false` で結果が分からないと返す |
| B2 | `SDKはプレイヤーデータの書き込みの送り直しに同じIdempotency-Keyを使う` | L1 | 1 回目タイムアウト・2 回目 200 | 2 回の要求の `Idempotency-Key` が同じ。次の呼び出しは別の鍵 |
| B2 | `SDKは400と401と403と404と409と413と422を再試行しない` | L1 | それぞれの状態の偽の応答 | どれも 1 回だけ送る |
| B2 | `SDKはエラーのcodeを画面の文の種類に分け知らないコードはunknownにする` | L1 | 19 のコードと `NEW_CODE`・JSON でない 502 | 表の種類。`NEW_CODE` は `unknown`、502 は `network` |
| B2 | `SDKは受領の履歴をnextBeforeが無くなるまで読む` | L2 | 履歴が 45 行のプレイヤーで `limit=20` | 3 回読み、45 行が新しい順・重ならない |
| B2 | `SDKの応答の型はスキーマの応答と同じ欄を持つ` | L2 | SDK で 19 の操作を Worker に当てる | 応答がスキーマに合い、`.d.mts` の欄の名前がスキーマと同じ |
| B2 | `SDKでCLIモックと同じシナリオを通せる` | L2 | SDK のシナリオの関数を Worker に当てる | §4 の手順が全部成功 |
| B2 | `SDKはトークンを結果とログに出さない` | L1 | 発行と失敗の結果・差し替えたログ | トークンの文字列がどこにも無い |
| B3 | `期限の前のトークンを更新すると同じプレイヤーの新しいトークンを返す` | L2 | 発行したトークンで `POST /v1/accounts/token` | 200。`playerId` が同じ・`expiresAt` が先・新しいトークンで書ける |
| B3 | `期限切れのトークンは更新できずTOKEN_EXPIREDの401を返す` | L2 | 期限の過ぎたトークン | 401 `TOKEN_EXPIRED` |
| B3 | `トークンの更新はAPP_ENVがlocalでなければ403を返す` | L2 | `APP_ENV=disabled` | 403 `NOT_READY_FOR_PRODUCTION` |
| B3 | `SDKは期限まで7日を切ったトークンを更新してから送る` | L1 | `expiresAt` が 6 日後のトークンで `getInventory` | 更新 → 読む、の順に 2 回送る |
| B3 | `SDKはTOKEN_EXPIREDを受けたらゲストを発行し直さずsessionを返す` | L1 | 401 `TOKEN_EXPIRED` | `session` の結果。発行の口を呼ばない |
| B4 | `ローカルではブラウザの事前確認にCORSの見出しを返す` | L2 | `APP_ENV=local`・決めたオリジンの `OPTIONS` | 204。許す見出しに `Authorization`・`Idempotency-Key` |
| B4 | `CORSの応答はRetry-AfterとETagをページから読めるように出す` | L2 | 決めたオリジンからの `GET /v1/config`・429 | `Access-Control-Expose-Headers` に `Retry-After`・`ETag` |
| B4 | `ローカルでない環境と決めていないオリジンにはCORSの見出しを返さない` | L2 | `APP_ENV=disabled`・別のオリジン | `Access-Control-*` が無い |
| B4 | `ブラウザのサンプルはSDKを読み込みシナリオの関数を呼ぶ` | L1 | `clients/browser/sample/index.html` を文字列で | SDK の読み込みとシナリオの関数の呼び出しがある。トークンを画面に出す行が無い |
| B5 | `Unityのクライアント層の決まりの値はスキーマと一致する` | L1 | C# の定数のクラスを文字列で | `x-client-policy` と同じ値 |
| B5 | `Unityのクライアント層はエラーコードの表の全部のコードを持つ` | L1 | 同上 | `errorCatalog` の全部のコードと種類 |
| B5 | `Unityのクライアント層はシナリオの全部の手順を持つ` | L1 | C# のシナリオのファイル | §4 の手順の名前が全部ある |
| B6 | `Unrealのクライアント層の決まりの値はスキーマと一致する` | L1 | C++ の定数のヘッダーを文字列で | `x-client-policy` と同じ値 |
| B6 | `Unrealのクライアント層はエラーコードの表の全部のコードを持つ` | L1 | 同上 | `errorCatalog` の全部のコードと種類 |
| B6 | `Unrealのイベントコマンドの一覧はシナリオの全部の操作を持つ` | L1 | イベントコマンドの一覧 | §4 の操作がどれもコマンドに当たる |

人が専用 PC・ブラウザで見るもの（L3。機械の合否と分ける。`requireTests` に入れない）:

| 印 | 見ること | 束 |
| --- | --- | --- |
| H1 | ブラウザでサンプルを開き、§4 のシナリオが全部成功の表になる。Worker を止めて押すと `network` が出てページは固まらない | B4 |
| H2 | Unity のエディタで §4 のシナリオが通る | B5 |
| H3 | Unity: 500 を受けると再試行のあと通信エラーが出て、ゲームのフレームは止まらない | B5 |
| H4 | Unity: 端末の時計を 1 日ずらしても、イベントの期間の内外と残り時間がサーバーの時刻で出る | B5 |
| H5 | UE: K4 の `UEクライアントは500を受けたら再試行して利用者に通信エラーを出す` | B6 |
| H6 | UE: K4 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う`。あわせてイベントコマンドでシナリオが通る | B6 |

## 10. 挙動が変わりうる既存の試験と、直す手続き

名前の中の数や機能の一覧で挙動が変わりうる既存の試験。変えるときは `docs/guides/decisions/test-plan.md` §11 のとおり、設計（この節）を先に直してから試験を直す。黙って弱めない。

| 既存の試験 | 変わる束 | 変わり方 |
| --- | --- | --- |
| `スキーマのファイルはOpenAPI 3.1で19個の操作を持つ` | B3 | トークンの更新の操作（`refreshToken`）を足すので 20 個。名前を `スキーマのファイルはOpenAPI 3.1で20個の操作を持つ` に、期待の一覧に `refreshToken` を足す（同じコミットでこの表も直す）。B1 の `x-` の欄は操作を足さないので変えない |
| `スキーマのErrorCodeの列挙は19個のエラーコードと一致する` | — | どの束もコードを足さない（更新の口は既存の `TOKEN_EXPIRED`・`UNAUTHENTICATED`・`RATE_LIMITED` を使う）。変わらない。足すときは §2.5 の表と B1 の `スキーマのエラーコードの表はErrorCodeの列挙と同じコードを持つ` も同じコミットで直す |
| `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsを使う設定で登録される` | — | 更新の口と CORS は `src/core/` に置き、ゲームの機能（`game_modules`）を足さない。変わらない |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない` | — | 同上。モジュールを足さない。CORS の `OPTIONS` はルーターの前で答える（モジュールのルートにしない） |
| `今のCLIモックと同じ形の要求を受け付ける` | B2 | 変わらない。CLI モックの送り方を SDK にしても、要求の形は `scripts/cli-requests.mjs` のまま。互換を見張り続ける |
| `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` | B3 | CLI モックの通しにトークンの更新（§4 の 6）を足すので、試験の流れにも更新を 1 回足す。更新の口の利用制限（プレイヤーごと 60 秒に 10 回）に 2 回の通しで掛からないことを見る |

## 11. 決めること

ADR 0001・ADR 0002 と、これまでの 12 の設計書の決定は前提で、ここに戻さない。推しの案で §2〜§10 を書いた。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | タイムアウトと再試行 | A: **10 秒・最大 3 回・指数の待ち（1 秒×2・上限 8 秒）・全幅の揺らぎ**。B: 30 秒・最大 5 回・固定 2 秒。C: 再試行しない（ゲームが決める） | **A**。1 つの操作が約 33 秒で必ず終わり、ゲームの待ちの表示が長くなりすぎない。揺らぎは、障害の明けに全員が同じ秒で送り直して利用制限に当たるのを避ける。B は 1 操作が 2 分を超える。C は 3 つのクライアントで扱いが割れる |
| 2 | 再試行してよい操作の分け方 | A: **5 つの種類（§2.2）を操作ごとに付け、`revision` だけ自動で送り直さない**。B: `GET` だけ再試行。C: 全部再試行 | **A**。送り直しの決まりは口ごとにもう決まっていて（`Idempotency-Key`・一意の鍵・`MAX`）、それを写すだけ。B は報酬の受け取りの再試行を捨て、届かなかった受け取りをプレイヤーが押し直すことになる。C はセーブで 409 を出す |
| 3 | 429 の `Retry-After` | A: **60 秒まで待って 1 回だけ送り直す。見出しが無い・超えるときは待たない**。B: 待たずにすぐ返す（いまの CLI モック）。C: 待つ上限を 10 秒にする | **A**。サーバーの窓の最大が 60 秒で、断った要求も数えるので、決めた秒を待つのが一番早く通る。待ちは非同期でゲームを止めない。B はゲームが自分で待ちを作ることになり 3 つで割れる。C は窓の後半の 429 をほとんど返すだけ |
| 4 | 500・回線断の扱い | A: **`network` にまとめ、種類が許す操作だけ再試行。`revision` は読み直しの関数を用意する**。B: 500 は再試行しない（サーバーの不具合とみなす） | **A**。D1 の一時の失敗も 500 になり、読み取りと冪等な書き込みは送り直して害が無い。B は一時の失敗をそのままプレイヤーに見せる |
| 5 | エラーコードの表の持ち方と見張り | A: **§2.5 の表を §3 の置き場（スキーマの拡張）に持ち、`ErrorCode` の列挙と同じ集合を B1 の試験が見張る**。B: 文書の表だけ。C: SDK のコードの中だけ | **A**。コードを足した束で表を忘れると試験が落ちる。B は数のずれを機械で見つけられない。C は Unity・Unreal と食い違う |
| 6 | ページング | A: **いまの形を確定（続きのある一覧は `limit`・`before`・`nextBefore`、ほかは上限で切る）。新しい一覧はカーソルの形だけ**。B: 全部の一覧にカーソルを足して揃える。C: `offset` に揃える | **A**。いまの 2 つの口は同じ形で、ほかの一覧は件数が上限で決まる。B は `/v1/` の応答に欄を足す仕事が増えるだけで使い手がいない。C は行が増えるとずれる |
| 7 | トークンの期限が切れたとき | A: いまのまま（ゲストを発行し直す・前のプレイヤーを引き継がない）。B: **B3 で更新の口 `POST /v1/accounts/token` を足す（期限の前のトークンだけ。期限を 30 日先にする）**。C: Phase 4 以降に回す | **B**。クライアントを作る Phase 3 で SDK の形に入れておけば、3 つのクライアントを後で直さずに済む。30 日の間に一度遊べば同じプレイヤーのまま続き、D30 の偏りが消える。サーバーの変更は `src/core/` の口 1 つとスキーマの操作 1 つで、エラーコードは足さない。A・C は 30 日を越えて遊ぶ人を全員別人にする。端末をまたぐ引き継ぎは B でも解けない（§13） |
| 8 | `serverTime` | A: **いまの 2 つの一覧の `serverTime` で差を取り、表示だけに使う。判定はサーバー**。B: 全部の応答に `serverTime` を足す | **A**。期間の要る画面はイベントとクエストだけ。B は `/v1/` の全部の応答とスキーマを変える |
| 9 | 共通の決まりをどこにどう持つか | A: **スキーマ `openapi/rpg-online.v1.json` の拡張（最上位の `x-client-policy`・操作ごとの `x-retry`）**。B: 別の JSON の表（`clients/` の下）。C: 文書だけ | **A**。形の正のファイルに並べるので、`x-error-codes` と `x-retry` を同じ場所で読める（`CLAUDE.md` 原則 5 の一か所）。拡張の欄は OpenAPI の決まりの中で、ほかの道具が読んでも害が無い。B は正が 2 つになる。C は 3 つの値の食い違いを機械で見つけられない |
| 10 | ブラウザの SDK の置き場と公開 | A: **このリポジトリの `clients/browser/`・npm の包みとして公開しない**。B: `packages/` に npm の包みの形で置き、公開は Phase 4 で決める。C: 別のリポジトリ | **A**。`CLAUDE.md` の「公開をしない」。`package.json` を足さず、Phase 4（配布）で包みにするかを決め直す。ADR 0002 の「モノレポは二つ目の使い手ができた時」にも合う |
| 11 | SDK の型 | A: **手で書く（`.d.mts`）。スキーマとの食い違いは試験で見る**。B: スキーマから作る道具を devDependencies に足す | **A**。パッケージを足さない。操作は 20 個で手で保てる。B を選ぶなら B2 の前に、何を・なぜ足すかを決め、`package.json` と `package-lock.json` を対で動かす |
| 12 | CLI モックと SDK の関係 | A: **CLI モックの送り方（`call()`）を SDK にし、要求の形の関数 `scripts/cli-requests.mjs` は残す**。B: CLI モックはそのまま、SDK は別に作る。C: `scripts/cli-requests.mjs` も消して SDK に寄せる | **A**。CLI モックが 3 つのクライアントの代わりとして同じ再試行で動き、K4 の 1 本目がそのまま作れる。互換の試験は `scripts/cli-requests.mjs` を見張り続ける。B は再試行が 2 つになる。C は既存の CLI の試験を全部直す |
| 13 | サンプルの形 | A: **ビルドの要らない 1 枚のページ（`clients/browser/sample/index.html`）**。B: 小さなゲーム（Phase 4 の同梱のサンプルゲームに近いもの） | **A**。シナリオを押して結果の表を見るのが Phase 3 の確かめに足りる。B は Phase 4 の「サンプルゲームを同梱」で作る |
| 14 | ブラウザから呼ぶための CORS | A: **`APP_ENV=local` のときだけ決めたオリジンに CORS を返す（`src/core/` に 1 か所。`Retry-After`・`ETag` を公開の見出しに）**。B: Worker がサンプルのページも出す。C: 足さない | **A**。サーバーの変更は小さく、`local` でない環境には何も足さない。B は `wrangler.jsonc` と Worker の口が増える。C ではブラウザで確かめたことにならない。本番のオリジンの決め方は Phase 4 |
| 15 | Unreal・Unity のクライアント層の置き場 | A: **このリポジトリの `clients/unity/`・`clients/unreal/`（ソースだけ）**。B: 別のリポジトリ。C: 専用 PC のゲームのプロジェクトの中 | **A**。決まりの値を同じコミットで直せ、Mac の無人の回で食い違いを見つけられる。B・C は Mac から値を比べられない |
| 16 | 失敗ケースの束 K4 | A: **名前を変えず、L2 の 2 本は B2、L3 の 2 本は B6 の人の確かめにする。Unity の同じ観点は人の確かめ H3・H4 を足す**。B: UE の 2 本を「クライアント」の名前に変えて 3 つで共通にする | **A**。`failure-case-test-plan.md` の行を置き換えずに済む。3 つで共通の観点は §9 の表で別の行として持つ |
| 17 | Steam などのプラットフォームの認証 | A: **Phase 3 では作らず、境目と置き場（§8）だけ決める**。B: Phase 3 で Steam のアダプターを作る | **A**。Steam で出すゲームが決まっていない。境目（`account_identities`・サーバー側の検証・クライアントの差し替え口）を決めておけば、後で足してもトークンの形と API の残りは変わらない |
| 18 | パッケージの追加 | A: **足さない**。B: 型を作る道具・静的なサーバーを足す | **A**。どの束も足さずに作れる（§5.2・§5.5）。足すなら、その束の Issue で何を・なぜかを書いて決める |

## 12. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る（B1 が決まりの置き場を作る）。B5 と B6 は B2 の後ならどちらからでもよい。

| 束 | 中身 | 前の束 | 変えるもの | 人の確かめ |
| --- | --- | --- | --- | --- |
| B1 | スキーマの `x-client-policy`・`x-retry`（§3）と試験。`docs/api-contract.md` に「クライアントの決まり」の節（値の正はスキーマと書く）とページングの 1 行。ロードマップの Phase 1 の「エラーコード、タイムアウト、ページングを確定」に印 | — | `openapi/`・`test/`・`docs/` | — |
| B2 | ブラウザの SDK（`clients/browser/`）・CLI モックの送り方を SDK に・K4 の L2 の 2 本 | B1 | `clients/`・`scripts/cli-mock.mjs`・`test/`・`tsconfig.json` | — |
| B3 | トークンの更新の口（`src/core/`・スキーマ・契約・`account-design.md` の決めること 3 の決め直し）と SDK の更新・CLI モックの通しに 1 手順 | B2 | `src/`・`openapi/`・`scripts/`・`clients/`・`test/`・`docs/` | — |
| B4 | ローカルだけの CORS とブラウザのサンプル | B3 | `src/`・`clients/`・`test/` | H1 |
| B5 | Unity のクライアント層（`clients/unity/`）と専用 PC の手順書 | B3 | `clients/`・`test/`・`docs/` | H2〜H4 |
| B6 | Unreal のクライアント層とイベントコマンドの橋渡し（`clients/unreal/`）と専用 PC の手順書 | B3 | `clients/`・`test/`・`docs/` | H5・H6 |

- どの束も `package.json`・`wrangler.jsonc`・`migrations/` を変えない（B3 の更新の口は表を足さない。トークンは自己完結の形のまま）。
- `APP_ENV` の守りを外さない。デプロイ・公開をしない。開発サーバーは無人の回で起動しない（通しの確かめはその回の後に会話の側で `npm run cli:smoke`）。
- 人の確かめ（H）は束の合格の条件に「ユーザーの最終判定」として書き、機械の確認コマンドには入れない。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。`base` はその Issue を作った時点の main のコミット。

B1:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  'スキーマのクライアントの決まりはタイムアウトと再試行の回数と間隔を持つ',
  'スキーマの全部の操作が再試行の種類を持つ',
  'スキーマのエラーコードの表はErrorCodeの列挙と同じコードを持つ',
  'Idempotency-Keyが必須の操作だけが再試行の種類idempotency-keyを持つ',
  '再試行してよいエラーコードはRATE_LIMITEDとINTERNAL_ERRORだけ',
  'スキーマのファイルはOpenAPI 3.1で19個の操作を持つ',
  'スキーマのErrorCodeの列挙は19個のエラーコードと一致する',
]);
gitClean(['src/', 'migrations/', 'scripts/', 'wrangler.jsonc'], { base });
done();
```

B2:

```js
import { runTests, requireTests, mustExist, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
mustExist([['clients', 'browser', 'rpg-online-client.mjs'].join('/'), ['clients', 'browser', 'rpg-online-client.d.mts'].join('/')]);
runTests();
requireTests([
  'SDKの決まりの値はスキーマのクライアントの決まりと一致する',
  'SDKはタイムアウトした安全な読み取りを決めた回数まで再試行する',
  'SDKは再試行の待ちを指数で伸ばし上限で止める',
  'SDKは429を受けたらRetry-Afterの秒だけ待って1回だけ送り直す',
  'SDKはRetry-Afterが無いか上限を超えたら待たずにRATE_LIMITEDを返す',
  'SDKはセーブの書き込みを500でも自動で送り直さない',
  'SDKはプレイヤーデータの書き込みの送り直しに同じIdempotency-Keyを使う',
  'SDKは400と401と403と404と409と413と422を再試行しない',
  'SDKはエラーのcodeを画面の文の種類に分け知らないコードはunknownにする',
  'SDKは受領の履歴をnextBeforeが無くなるまで読む',
  'SDKの応答の型はスキーマの応答と同じ欄を持つ',
  'SDKでCLIモックと同じシナリオを通せる',
  'SDKはトークンを結果とログに出さない',
  'CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する',
  '旧CLIはスキーマ変更後のAPIでもランキングを送って読める',
  '今のCLIモックと同じ形の要求を受け付ける',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'wrangler.jsonc'], { base });
done();
```

B3:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  '期限の前のトークンを更新すると同じプレイヤーの新しいトークンを返す',
  '期限切れのトークンは更新できずTOKEN_EXPIREDの401を返す',
  'トークンの更新はAPP_ENVがlocalでなければ403を返す',
  'SDKは期限まで7日を切ったトークンを更新してから送る',
  'SDKはTOKEN_EXPIREDを受けたらゲストを発行し直さずsessionを返す',
  'スキーマのファイルはOpenAPI 3.1で20個の操作を持つ',
  'スキーマのErrorCodeの列挙は19個のエラーコードと一致する',
  'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsを使う設定で登録される',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない',
  '今のCLIモックと同じ形の要求を受け付ける',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
]);
gitClean(['migrations/', 'wrangler.jsonc'], { base });
done();
```

B4:

```js
import { runTests, requireTests, mustExist, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
mustExist([['clients', 'browser', 'sample', 'index.html'].join('/')]);
runTests();
requireTests([
  'ローカルではブラウザの事前確認にCORSの見出しを返す',
  'CORSの応答はRetry-AfterとETagをページから読めるように出す',
  'ローカルでない環境と決めていないオリジンにはCORSの見出しを返さない',
  'ブラウザのサンプルはSDKを読み込みシナリオの関数を呼ぶ',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない',
]);
gitClean(['migrations/', 'openapi/', 'wrangler.jsonc'], { base });
done();
```

B5:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  'Unityのクライアント層の決まりの値はスキーマと一致する',
  'Unityのクライアント層はエラーコードの表の全部のコードを持つ',
  'Unityのクライアント層はシナリオの全部の手順を持つ',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'scripts/', 'wrangler.jsonc'], { base });
done();
```

B6:

```js
import { runTests, requireTests, gitClean, done } from './scripts/issue-run/check-lib.mjs';
const base = '<Issue を作った時点の main>';
runTests();
requireTests([
  'Unrealのクライアント層の決まりの値はスキーマと一致する',
  'Unrealのクライアント層はエラーコードの表の全部のコードを持つ',
  'Unrealのイベントコマンドの一覧はシナリオの全部の操作を持つ',
]);
gitClean(['src/', 'migrations/', 'openapi/', 'scripts/', 'wrangler.jsonc'], { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（`CLAUDE.md` の進め方の決まり）。
- 束の Issue には、`package.json` を変えないことの確かめを、守るファイルにならない書き方（`['package', 'json'].join('.')`）で別の `gitClean` に足す。

## 13. 範囲の外

| 範囲の外 | いつ・どこで |
| --- | --- |
| npm の包みの公開・SDK の版の付け方 | Phase 4（配布／OSS 公開）。`CLAUDE.md` の「公開をしない」はそれまで有効 |
| 本番の CORS のオリジン・デプロイの手順 | Phase 4。この設計では `APP_ENV=local` の外に何も足さない |
| サンプルゲーム・管理画面 | Phase 4 の「管理画面・設定画面・サンプルゲームを同梱」 |
| 端末をまたぐ引き継ぎ・ログイン | Phase 4 以降（`account-design.md` §11。引き継ぎの秘密か外部 ID） |
| Steam などのプラットフォームの認証の実装 | Steam で出すゲームが決まったとき（§8） |
| オフラインの未送信の待ち行列 | 要る機能（オフラインで貯めた統計値を後で送る など）が出たとき。`Idempotency-Key` のある書き込みなら、待ち行列に鍵ごと残す形で足せる |
| 管理の口のクライアント | 管理の CLI（`admin-design.md`）。ゲームのクライアントは管理の口を呼ばない |
| リアルタイム（WebSocket） | 「後で」の P2（`roadmap.md`） |
| Unity・UE の版・ビルドの道具の決定 | 専用 PC の今の版に合わせる（**要確認**。B5・B6 の Issue で書く） |

## 14. 指示の表

| Issue #50 の指示 | どこで答えるか |
| --- | --- |
| タイムアウトの時間と再試行の回数・間隔（指数か固定か・揺らぎ） | §2.1・§11 の 1 |
| 再試行してよい要求・状態、書き込みで再試行してよい口とそうでない口 | §2.1・§2.2・§11 の 2 |
| 429 の `Retry-After`（待つ上限・超えたとき） | §2.3・§11 の 3 |
| 500 `INTERNAL_ERROR`・回線断 | §2.4・§11 の 4 |
| エラーコードを画面の文に出し分ける表・置き場・数の見張り | §2.5・§3・§11 の 5 |
| ページングの確定（Phase 1 の残り） | §2.6・§11 の 6 |
| トークンの期限（30 日・更新の口）と切れたときの扱い・D30 の偏り | §2.7・§11 の 7 |
| 時刻（`serverTime`）の使い方 | §2.8・§11 の 8 |
| 共通の決まりを機械で読める形にするか・3 つが同じ値を使うことの確かめ | §3・§11 の 9 |
| ブラウザの SDK の置き場・公開・型・CLI モックとの関係・試験・サンプル | §5・§11 の 10〜14 |
| Unreal・Unity の置き場・Mac と専用 PC の境目・非同期・イベントコマンドの橋渡し | §6・§11 の 15 |
| 失敗ケースの束 K4 の扱い | §7・§11 の 16 |
| Steam などのプラットフォームの認証 | §8・§11 の 17 |
| 実装の束の順と確かめ方（機械と人） | §9・§12 |
| 名前の中の数や機能の一覧で変わりうる既存の試験に名前で触れる | §10 |
| 新しいパッケージは足さない案を推しに | §11 の 18 |
| エンジンの版・機能・Cloudflare の機能は公式で確かめたか「要確認」 | §5.4・§5.5・§6・§8・§13（どれも「要確認」と書いた。この回では公式の文書を引いていない） |
| 実装しない・`src/` などを変えない | この設計書は `docs/` の 1 ファイルだけ |
