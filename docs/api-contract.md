# 初期API仕様（検討版）

この仕様はMacでの**ローカルPoC**向け。ログインは未実装（認証はゲストのトークンだけ）。書き込みの口（ゲストの発行・スコアの投稿）とセーブの操作と所持品の読み取りとイベントの一覧・報酬の受け取りと管理の API に回数の制限（**429 `RATE_LIMITED`**と`Retry-After`。下の「利用制限」）がある。スコアは値の範囲と回数までしか確かめない（ゲームの中で取れるスコアかは見ない）。書込み系APIは公開用に使用しない。

形（欄・型・範囲・状態コードとエラーコードの組）の正はスキーマ（ゲームのクライアントの口は`openapi/rpg-online.v1.json`、管理の口は`openapi/rpg-online-admin.v1.json`）、挙動の説明の正はこの文書。

## GET /health

レスポンス例（200）:

```json
{"status":"ok","service":"rpg-online-backend"}
```

## POST /v1/accounts/guest

ゲストのアカウントを発行し、そのゲームのプレイヤー ID（`playerId`）とトークンを返す。1 回で、アカウント 1 つとそのゲームのプレイヤー 1 人を作る。設計の正は `docs/guides/working/account-design.md`。

入力例:

```json
{"gameId":"demo-rpg"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f","token":"v1.eyJnIjoiZGVtby1ycGcifQ.c2lnbmF0dXJl","expiresAt":"2026-11-29T00:00:00.000Z"}
```

- `playerId`はゲームごとに分けた公開用の ID（UUID）。内部のアカウント ID は応答にもトークンにも入れない。同じ本文で 2 回呼ぶと、別のアカウントと別の`playerId`になる。
- `token`は`v1.<本文>.<署名>`（HMAC-SHA256）で、期限は 30 日（`expiresAt`）。期限が切れたらゲストを発行し直す（前のプレイヤーは引き継がない）。
- 登録の無い`gameId`は**404 `NOT_FOUND`**（`message`は`Unknown game`）。アカウントはどのゲームにも要る土台なので、ゲームの機能の設定（`game_modules`）は見ない。
- 書込み系 API なので、`npm run dev`でローカル実行し`APP_ENV=local`を与えた時のみ発行できる（ほかは本文を読む前に**403 `NOT_READY_FOR_PRODUCTION`**）。
- 同じ IP（`CF-Connecting-IP`）からは 60 秒の窓に 10 回、同じゲームへは 60 秒の窓に 300 回まで。超えると**429 `RATE_LIMITED`**と`Retry-After`で、行を作らない（下の「利用制限」）。
- 確かめの順: `APP_ENV`の守り（403）→ IP の利用制限（429。本文を読む前）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`）→ ゲームの登録（404 `NOT_FOUND`）→ ゲームの利用制限（429）→ 書き込み。

## GET /v1/announcements?gameId=demo-rpg

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"id":"welcome","title":"ようこそ","body":"ローカル検証用のお知らせです。"}]}
```

## GET /v1/rankings/boss-score?gameId=demo-rpg&limit=10

レスポンス例（200）:

```json
{"gameId":"demo-rpg","boardId":"boss-score","items":[{"playerId":"cli-user-1","displayName":"CLI Tester","score":1200}]}
```

- `limit`: 1～50、デフォルト10。
- 登録の無い`gameId`は**404 `NOT_FOUND`**（`message`は`Unknown game`）。その機能を使わない設定のゲームも**404 `NOT_FOUND`**（`message`は`Feature not enabled for this game`。ランキングの機能は`rankings`、お知らせは`announcements`）。お知らせ（`GET /v1/announcements`）・スコアの投稿（`POST`）も同じ。登録済みで機能を使う設定のゲームなら、ボードにデータが無くても（存在しないボードでも）**200と空の`items`**を返す。ゲームの登録と使う機能の設定はマイグレーションで入れる（`migrations/0002_games.sql`・`migrations/0003_game_modules.sql`・`migrations/0005_saves.sql`・`migrations/0006_config.sql`。`demo-rpg`は登録済みで`announcements`・`rankings`・`saves`・`config`を使う）。
- 現PoCの順位は**高スコア優先のみ**。タイムアタックなど昇順ボードは将来追加。

## POST /v1/rankings/boss-score

見出し: `Authorization: Bearer <token>`（`token`は`POST /v1/accounts/guest`が返したもの）。

入力例:

```json
{"gameId":"demo-rpg","playerId":"cli-user-1","displayName":"CLI Tester","score":1200}
```

レスポンス例（200）:

```json
{"ok":true,"gameId":"demo-rpg","boardId":"boss-score","playerId":"cli-user-1"}
```

- PoCでは同一プレイヤーについて**最高スコアだけを保持**。
- `score`は0～1,000,000,000の整数。
- `npm run dev`でローカル実行し`APP_ENV=local`を与えた時だけ・トークンがある時だけ書込み可能。`APP_ENV`が`local`でなければ、トークンがあっても無くても本文を読む前に**403 `NOT_READY_FOR_PRODUCTION`**。
- 同じプレイヤー（トークンのゲームとプレイヤー）は 60 秒の窓に 30 回まで。超えると**429 `RATE_LIMITED`**と`Retry-After`で、記録を変えない（下の「利用制限」）。トークンの無い・正しくない要求と、本文の形の外れた要求は数えない（401・400 が先）。
- 確かめの順: `APP_ENV`の守り（403）→ トークン（本文を読む前）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`。ここまで DB を引かない）→ プレイヤーの利用制限（429）→ 止めた印（403 `PLAYER_BANNED`）→ トークンと本文の突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録（404 `NOT_FOUND`）→ 書き込み。
- `Authorization`が無い・`Bearer`でない・トークンの形か署名が正しくなければ**401 `UNAUTHENTICATED`**（`message`は`Missing or malformed Authorization`か`Invalid token`。どちらが外れたかの詳しい理由は返さない）。期限が切れていれば**401 `TOKEN_EXPIRED`**（ゲストを発行し直す）。
- 本文の`gameId`・`playerId`がトークンのゲームとプレイヤーと違えば**403 `PERMISSION_DENIED`**（`message`は`Token does not match player`）。本文の形は変わらない（`playerId`も送る）。

## PUT /v1/saves/{slotId}?gameId=demo-rpg

トークンのプレイヤーのスロット（`{slotId}`。名前はゲームが決める・`gameId`と同じ形）にセーブを書く。設計の正は`docs/guides/working/save-design.md`。

見出し: `Authorization: Bearer <token>`（`POST /v1/accounts/guest`が返したもの）。

入力例:

```json
{"formatVersion":1,"data":"{\"hp\":30,\"map\":\"town\"}","checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","baseRevision":0}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","slotId":"auto","revision":1,"formatVersion":1,"checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}
```

- プレイヤーは**トークンのプレイヤーだけ**で決まる（パス・問い合わせ・本文に`playerId`の欄は無い）。他のプレイヤーのセーブは指せない。
- `data`は文字列で、サーバーは解釈しない（JSON の文字列でも、ゲームが base64 にしたバイナリでもよい）。UTF-8 で**65,536 バイトまで**。超えると**413 `PAYLOAD_TOO_LARGE`**（要求の本文が 394,240 バイトを超えるときは本文を読まずに 413）。`size`は`data`の UTF-8 のバイト数（サーバーが数える）。
- `checksum`は`data`の UTF-8 のバイト列の SHA-256 を小文字の 16 進 64 文字にしたもの。クライアントが計算して送り、サーバーが計算し直して違えば**400 `INVALID_ARGUMENT`**で書かない。
- `formatVersion`は 1〜2147483647 の整数で、意味はゲームが決める。サーバーは比べずに保存して返すだけ（古い版の移し替えはクライアントの仕事）。
- `baseRevision`はクライアントが最後に読んだか書いたリビジョン。**まだセーブが無いスロットに初めて書くときは`0`**。いまのリビジョンと違えば**409 `SAVE_CONFLICT`**で上書きしない（初めてのつもりが既にある・あるつもりが無い、も含む）。409 のときは`GET`で読み直し、どちらを残すかをゲームが決めて、読み直した`revision`を`baseRevision`にして書き直す。サーバーは黙って上書きも統合もしない。
- `revision`は 1 から始まり、書くたびに 1 つ進む。`updatedAt`はサーバーの時刻（クライアントの時刻は受け取らない）。
- スロットは 1 プレイヤー・1 ゲームに**10 個まで**。新しいスロットに書くと超えるときは**409 `SLOT_LIMIT_EXCEEDED`**で書かない（消したスロットは数えない。既にあるスロットの上書きは上限まで埋まっていても通る）。`DELETE`で要らないスロットを消してから書く。
- 書込み系 API なので、`npm run dev`でローカル実行し`APP_ENV=local`を与えた時だけ・トークンがある時だけ通る。`APP_ENV`が`local`でなければ、トークンがあっても無くても**403 `NOT_READY_FOR_PRODUCTION`**。
- 同じプレイヤー（トークンのゲームとプレイヤー）のセーブの操作（書く・読む・一覧・消す）は合わせて 60 秒の窓に 60 回まで。超えると**429 `RATE_LIMITED`**と`Retry-After`で、書かない（リビジョンを進めない。下の「利用制限」）。トークンの無い・正しくない要求は数えない（401 が先）。
- 確かめの順: `APP_ENV`の守り（403）→ トークン（401。本文を読む前）→ プレイヤーの利用制限（429）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`。`message`は`Token does not match game`）→ 本文の大きさ（413）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`）→ `data`の大きさ（413）→ チェックサム（400 `INVALID_ARGUMENT`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。機能の名前は`saves`）→ 書き込み（409 `SAVE_CONFLICT`・409 `SLOT_LIMIT_EXCEEDED`）。

## GET /v1/saves/{slotId}?gameId=demo-rpg

トークンのプレイヤーのスロットのセーブを読む。見出しは`PUT`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","slotId":"auto","revision":1,"formatVersion":1,"data":"{\"hp\":30,\"map\":\"town\"}","checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}
```

- `PUT`の応答の欄に`data`を足したもの。受け取った`data`でチェックサムを計算し直して比べると、端から端まで壊れていないことが分かる。
- そのスロットにセーブが無ければ**404 `NOT_FOUND`**（`message`は`Save not found`）。端末は`revision`を`0`と覚えて、初めての書き込みに使う。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`APP_ENV`の守り → トークン → プレイヤーの利用制限（429 `RATE_LIMITED`。`PUT`と合わせて数える）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 読む。

## GET /v1/saves?gameId=demo-rpg

トークンのプレイヤーのセーブの一覧（メタデータだけ）。見出しは`PUT`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"slotId":"auto","revision":3,"formatVersion":1,"checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}]}
```

- `items`の各行は`GET /v1/saves/{slotId}`の応答から`gameId`と`data`を除いたもの（本体を読まずに`formatVersion`・`size`・`revision`が分かる）。並びは`slotId`の昇順。最大 10 件なのでページングしない。
- 自分（トークンのプレイヤー）のスロットだけが出る。消したスロットは出ない。セーブが 1 つも無ければ**200 と空の`items`**。
- 一覧も`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`GET /v1/saves/{slotId}`と同じ（`APP_ENV`の守り → トークン → プレイヤーの利用制限（429 `RATE_LIMITED`。`PUT`と合わせて数える）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 読む）。

## DELETE /v1/saves/{slotId}?gameId=demo-rpg&baseRevision=…

トークンのプレイヤーのスロットのセーブを消す。見出しは`PUT`と同じ`Authorization: Bearer <token>`。`baseRevision`は最後に読んだか書いたリビジョン（1 以上の整数）。

レスポンス例（200）:

```json
{"ok":true,"gameId":"demo-rpg","slotId":"auto"}
```

- `baseRevision`がいまのリビジョンと違えば**409 `SAVE_CONFLICT`**で消さない（別の端末が書いたばかりのセーブを古い画面から消さないため）。`GET`で読み直してから消し直す。
- そのスロットにセーブが無い（消した後も同じ）・他のプレイヤーのスロットは**404 `NOT_FOUND`**（`message`は`Save not found`）。`baseRevision`が無い・1 以上の整数でなければ**400 `INVALID_ARGUMENT`**。
- 消した後は`GET`が 404・一覧に出ない・スロットの数に数えない。同じスロットに`baseRevision: 0`で書き直せるが、`revision`は 1 に戻らず消す前より先へ進む（サーバーは消した印を残す）。だから消す前のリビジョンを覚えた古い端末の書き込みは 409 `SAVE_CONFLICT`になる。
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン → プレイヤーの利用制限（429 `RATE_LIMITED`。`PUT`と合わせて数え、断ったときは消さない）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形 → トークンのゲームとの突き合わせ → `baseRevision`の形（400）→ ゲームの登録と機能の設定（404）→ 消す（409・404）。

## GET /v1/inventory?gameId=demo-rpg

トークンのプレイヤーの通貨と所持品の残高を読む。見出しは`Authorization: Bearer <token>`（`POST /v1/accounts/guest`が返したもの）。設計の正は`docs/guides/working/event-reward-design.md`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","currencies":[{"itemId":"gold","amount":100}],"items":[{"itemId":"potion","amount":3}]}
```

- `currencies`は種類が通貨の品目、`items`は種類が所持品の品目。どちらも品目の ID の昇順。残高の行が無い品目は載せない（何も受け取っていなければ両方とも空の配列）。
- 品目の ID と種類（通貨か所持品か）はサーバーの表`inventory_items`（`migrations/0009_inventory.sql`。`demo-rpg`は`gold`〔通貨〕と`potion`〔所持品〕）にある。品目の名前・絵・効果・値段はマスターデータに置き、サーバーは解釈しない。
- 残高は 0〜1,000,000,000（`MAX_ITEM_AMOUNT`）。クライアントが残高を増やす・減らす口は無い（増やすのはサーバーだけ）。
- 自分（トークンのプレイヤー）の残高だけが出る。プレイヤーはトークンだけで決まり、問い合わせの`playerId`は読まない。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`APP_ENV`の守り → トークン（401）→ プレイヤーの利用制限（429 `RATE_LIMITED`。受領の履歴・イベントの一覧と受け取りと合わせて数える）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。所持品の機能`inventory`を使わない設定のゲームは`Feature not enabled for this game`）→ 読む。

## GET /v1/inventory/history?gameId=demo-rpg&limit=20&before=42

トークンのプレイヤーの受領の履歴（増減 1 回で 1 行）を新しい順に読む。見出しは`GET /v1/inventory`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"entryId":41,"itemId":"gold","delta":100,"sourceType":"event-claim","sourceId":"<claimId>","createdAt":"2026-10-30T15:30:00Z"}],"nextBefore":41}
```

- 並びは`entryId`の降順（新しい順）。`limit`は 1〜100 の整数（無ければ 20）。`before`は 1 以上の整数で、付けるとその`entryId`より古い行だけを返す。外れは**400 `INVALID_ARGUMENT`**。
- 続きがあれば`nextBefore`（最後の行の`entryId`）が載る。次はそれを`before`に付けて読む。続きが無ければ`nextBefore`の欄ごと載らない。
- `delta`は増減の数（いまは付与だけで正の数）。`sourceType`・`sourceId`は増減の元（イベントの報酬の受け取りは`event-claim`、クエストの報酬の受け取りは`quest-claim`と、それぞれ受け取りの`claimId`）。`createdAt`はサーバーが書いた時刻（ISO 8601・UTC・秒まで）。履歴は API から書き換えも消しもしない。
- 確かめの順は`GET /v1/inventory`と同じで、ゲームの登録と機能の設定（404）の後に`limit`・`before`の形を見る（400）。

## GET /v1/events?gameId=demo-rpg

いま開いているイベントの一覧と、トークンのプレイヤーがいまの区切りで報酬を受け取り済みかを読む。見出しは`Authorization: Bearer <token>`。設計の正は`docs/guides/working/event-reward-design.md`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","serverTime":"2026-10-30T15:30:00Z","items":[{"eventId":"daily-login","kind":"daily","startsAt":"2026-01-01T00:00:00Z","endsAt":"2100-01-01T00:00:00Z","periodKey":"2026-10-30","nextResetAt":"2026-10-31T00:00:00Z","rewards":[{"itemId":"gold","amount":100}],"claimed":false}]}
```

- 載るのは**サーバーの時刻でいま開いているイベントだけ**（`startsAt`以上・`endsAt`未満）。並びは`eventId`の昇順。終わったイベント・まだ始まらないイベントは載らない。
- `serverTime`はサーバーの時刻。クライアントは残り時間の表示にこれと`nextResetAt`・`endsAt`を使い、**端末の時刻で期間を決めない**。サーバーはクライアントの時刻（本文・問い合わせ・`Date`の見出し）を読まない。
- `kind`は区切り: `once`（期間の全体で 1 回）・`daily`（イベントの時差の 0 時で変わる）・`weekly`（イベントの時差の月曜 0 時で変わる）。時差はイベントごとの固定の分（既定 0 = UTC。夏時間は持たない）。
- `periodKey`はいまの区切り（`once`・デイリーはその日`YYYY-MM-DD`・週間はその週の月曜の日付）。`nextResetAt`は次の区切りの時刻で、`endsAt`を越えない。一度きりのイベントには載らない。時刻はどれも ISO 8601 の UTC（秒まで）。
- `rewards`は受け取ると付与される品目と数（品目の ID の昇順）。`claimed`はトークンのプレイヤーがいまの区切りで受け取ったか（ほかのプレイヤーの受け取りは数えない）。
- イベントと品目の定義は管理の口（`PUT /v1/admin/events/{eventId}`・`PUT /v1/admin/items/{itemId}`。下の「管理の API」）で入れる・置き換える。`demo-rpg`の手本はマイグレーションで入っている（`migrations/0010_events.sql`。デイリーの`daily-login`・金貨`gold` 100）。ゲームのクライアントの口にイベントを書き換える口は無い。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`GET /v1/inventory`と同じ: `APP_ENV`の守り → トークン（401）→ プレイヤーの利用制限（429 `RATE_LIMITED`。所持品・受領の履歴・受け取りと合わせて数える）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。イベントの機能`events`を使わない設定のゲームは`Feature not enabled for this game`）→ 読む。

## POST /v1/events/{eventId}/claim?gameId=demo-rpg

イベントの報酬を、いまの区切りの分だけ受け取る。見出しは`Authorization: Bearer <token>`。本文は要らない（送っても読まない）。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","eventId":"daily-login","periodKey":"2026-10-30","claimId":"<claimId>","claimedAt":"2026-10-30T15:30:00Z","grants":[{"itemId":"gold","amount":100}]}
```

- 受け取ると、`grants`の品目がトークンのプレイヤーの所持品に足され、受領の履歴（`GET /v1/inventory/history`）に品目ごとに 1 行（`sourceType: "event-claim"`・`sourceId`が`claimId`）残る。受け取りの行・履歴・残高は 1 つのまとまり（D1 の`batch`）で書くので、片方だけ残らない。応答に残高は入らない（`GET /v1/inventory`で読む）。
- **同じ区切りの 2 回目以降は 200 で 1 回目と同じ本文**（同じ`claimId`・`claimedAt`・`grants`）を返し、残高も履歴も増えない。並べて送っても付与は 1 回分（プレイヤー・イベント・区切りの一意の鍵で止める）。届かなかった要求は同じ要求を送り直すだけでよい。2 回目かを知りたいクライアントは`claimId`を比べる。`Idempotency-Key`の見出しは読まない（無くても冪等）。
- デイリー・週間は区切りが変わればもう一度受け取れる（新しい`claimId`）。区切りをまたいだ送り直しは新しい区切りの受け取りになる。
- 期間はサーバーの時刻だけで決める。期間の外（終わった・まだ始まらない）は**409 `EVENT_NOT_ACTIVE`**で、何も書かない。終わる直前に送って届かず、終わった後に送り直したときも 409 になる（同じ本文の 200 にはならない）。受け取れていたかは`GET /v1/inventory/history`の`sourceType: "event-claim"`の行で確かめる。
- 付与すると残高が 1,000,000,000（`MAX_ITEM_AMOUNT`）を超える品目があれば**409 `INVENTORY_LIMIT_EXCEEDED`**で、何も書かない（どの品目も足さない）。
- そのゲームに無いイベントは**404 `NOT_FOUND`**（`message`は`Unknown event`）。`eventId`の形（`^[a-zA-Z0-9_-]{1,64}$`）が外れていればどのルートにも当たらず**404 `NOT_FOUND`**（`Endpoint not found`）。
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン（401。数えない）→ プレイヤーの利用制限（429 `RATE_LIMITED`。一覧・所持品・受領の履歴と合わせて数え、断ったときは何も書かない）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403）→ ゲームの登録と機能の設定（404）→ イベントがあるか（404）→ 期間（409 `EVENT_NOT_ACTIVE`）→ 書く（409 `INVENTORY_LIMIT_EXCEEDED`）。

## GET /v1/player-data?gameId=demo-rpg

トークンのプレイヤーのプレイヤーデータ（統計値と進行状態。ゲームが宣言したキーごとの 0 以上の整数）と解いた実績を読む。見出しは`Authorization: Bearer <token>`。設計の正は`docs/guides/working/player-data-design.md`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","values":[{"key":"chapter","mode":"set","value":2,"updatedAt":"2026-10-31T15:30:00Z"},{"key":"slimes-defeated","mode":"add","value":3,"updatedAt":"2026-10-31T15:30:00Z"}],"achievements":[{"achievementId":"first-slime","unlockedAt":"2026-10-31T15:30:00Z"}]}
```

- `values`はトークンのプレイヤーが書いたことのあるキーだけ（キーの昇順）。何も書いていなければ空の配列。ほかのプレイヤーの値は載らない（本文・問い合わせの`playerId`は受け取らない）。
- `mode`はキーの宣言の書き方（`add`・`max`は統計値、`set`・`flag`は進行状態）。`updatedAt`は最後に変わった時刻（サーバーの時刻。ISO 8601 の UTC・秒まで）。
- `achievements`はトークンのプレイヤーが解いた実績の全部（実績の ID の昇順）。何も解いていなければ空の配列。`unlockedAt`は解いた時刻（サーバーの時刻）。一度解いた実績は、値が下がっても（`set`のキーを下げても）消えない。
- キーと実績の意味（名前・説明・絵）はサーバーが持たない（マスターデータに置き、クライアントがキー・実績の ID で引く）。サーバーが持つのはキーの宣言（書き方・値の上限・1 回の増加の上限）と実績の宣言（見るキーと閾値）だけ。`demo-rpg`の手本の宣言はマイグレーションで入っている（`migrations/0013_player_data.sql`。`slimes-defeated`〔`add`〕・`highest-floor`〔`max`〕・`chapter`〔`set`〕・`boss-1-defeated`〔`flag`〕。`migrations/0014_achievements.sql`。実績`first-slime`〔`slimes-defeated`が 1 以上〕・`boss-1`〔`boss-1-defeated`が 1 以上〕）。
- セーブと同じ値を持つときは、プレイヤーデータを正にする（起動の時にここで読み、セーブの中の同じ値と違えばこちらで上書きする）。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`APP_ENV`の守り → トークン（401。数えない）→ プレイヤーの利用制限（429 `RATE_LIMITED`。書き込みと合わせて数える）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。機能`player-data`を使わない設定のゲームは`Feature not enabled for this game`）→ 読む。

## POST /v1/player-data?gameId=demo-rpg

トークンのプレイヤーのプレイヤーデータを、宣言したキーの書き方で書く。見出しは`Authorization: Bearer <token>`と`Idempotency-Key`（必須。`^[a-zA-Z0-9_-]{8,64}$`）。

リクエスト例:

```json
{"changes":[{"key":"slimes-defeated","value":3},{"key":"highest-floor","value":12},{"key":"boss-1-defeated","value":1}]}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","writeId":"<writeId>","values":[{"key":"boss-1-defeated","value":1},{"key":"highest-floor","value":12},{"key":"slimes-defeated","value":3}],"unlocked":[{"achievementId":"boss-1","unlockedAt":"2026-10-31T15:30:00Z"},{"achievementId":"first-slime","unlockedAt":"2026-10-31T15:30:00Z"}]}
```

- `changes`は 1〜20 行（`MAX_CHANGES_PER_WRITE`）。キーは ID の形（`^[a-zA-Z0-9_-]{1,64}$`）で重ならない。`value`は整数。外れは**400 `INVALID_ARGUMENT`**。本文が JSON でなければ**400 `INVALID_JSON`**。
- 書き方はキーの宣言で決まり、クライアントは選べない:

  | 書き方 | 送る`value` | 書いた後の値 | 受け付ける`value` |
  | --- | --- | --- | --- |
  | `add`（統計値） | 増やす数 | 前の値 +`value` | 1 以上、キーの 1 回の増加の上限以下 |
  | `max`（統計値） | 新しい記録 | 前の値と`value`の大きいほう | 0 以上、キーの値の上限以下 |
  | `set`（進行状態） | 新しい値 | `value`（下げられる） | 0 以上、キーの値の上限以下 |
  | `flag`（進行状態） | 1 | 1（一度立てたら下がらない） | 1 だけ |

  範囲の外は**400 `INVALID_ARGUMENT`**で、何も書かない。値の上限は 1,000,000,000（`MAX_PLAYER_DATA_VALUE`）を超えない。
- 宣言の無いキーが 1 つでもあれば**404 `NOT_FOUND`**（`message`は`Unknown key`）で、ほかのキーも書かない。
- `add`の結果がキーの値の上限を超えるときは**409 `PLAYER_DATA_LIMIT_EXCEEDED`**で、その書き込みを全部断る（上限で丸めない。ほかのキーも書かない）。
- `values`は送ったキーの書いた後の値（キーの昇順）。`max`で前の値のほうが大きければ前の値のまま返る。1 回の書き込みは全部書くか、どれも書かないか（D1 の`batch`）。
- 実績はサーバーが解く: 書き込みの中で、書いた後のキーの値が実績の閾値以上で、まだ解いていない実績を解く（同じ`batch`）。`unlocked`はこの書き込みで解いた実績だけ（実績の ID の昇順。無ければ空の配列。前に解いた実績は載せず、`GET`の`achievements`で読む）。一度解いた実績は二重に解けず、解いた時刻も変わらない。実績の宣言を足した・閾値を下げたときは、そのプレイヤーが次に書き込んだときに判定する（さかのぼって解かない）。実績を解いたと申告する口は無く、本文の`achievements`・`unlocked`などの欄は読まない。
- **`Idempotency-Key`が無い・形の外れは 400 `INVALID_ARGUMENT`**（`add`以外のキーだけの書き込みも必須）。同じプレイヤーが同じ鍵と同じ中身（`gameId`と`changes`。`changes`の並びは比べない）をもう一度送ると、何も書かずに**200 で 1 回目と同じ本文**（同じ`writeId`・`values`・`unlocked`〔解いた実績と時刻〕）を返す（並べて送っても 1 回分）。同じ鍵で違う中身は**422 `IDEMPOTENCY_KEY_REUSED`**（何も書かない）。鍵の範囲はプレイヤーごとで、ほかのプレイヤーが同じ鍵を使っても別の書き込みになる。クライアントは書き込みごとに新しい鍵（`crypto.randomUUID()`など）を作り、届かなかった要求の送り直しだけ同じ鍵を使う。鍵は書き込みの記録と一緒に残る。
- 時刻はサーバーが付ける（本文・`Date`の見出しの時刻は読まない）。値は**自己申告**として扱う（サーバーはゲームの中で取れた値かを確かめられない。守るのは宣言・範囲・1 回の増加の上限・書き方・利用制限だけ）。
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `GET /v1/player-data`と同じ（`APP_ENV`の守り → トークン → プレイヤーの利用制限 → 止めた印 →`gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定）→ `Idempotency-Key`の形（400）→ 本文の JSON（400 `INVALID_JSON`）→ `changes`の形（400）→ キーの宣言（404）→ 書き方ごとの範囲（400）→ 書く（409 `PLAYER_DATA_LIMIT_EXCEEDED`・422 `IDEMPOTENCY_KEY_REUSED`）。

## GET /v1/quests?gameId=demo-rpg

いま開いているクエストの一覧と、トークンのプレイヤーの進捗・達成・いまの区切りで報酬を受け取り済みかを読む。見出しは`Authorization: Bearer <token>`。設計の正は`docs/guides/working/quest-design.md`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","serverTime":"2026-10-31T15:30:00Z","items":[{"questId":"daily-slimes","kind":"daily","startsAt":"2026-01-01T00:00:00Z","endsAt":"2100-01-01T00:00:00Z","periodKey":"2026-10-31","nextResetAt":"2026-11-01T00:00:00Z","key":"slimes-defeated","threshold":3,"progress":1,"completed":false,"claimed":false,"rewards":[{"itemId":"potion","amount":1}]},{"questId":"first-hunt","kind":"once","startsAt":"2026-01-01T00:00:00Z","endsAt":"2100-01-01T00:00:00Z","periodKey":"once","key":"slimes-defeated","threshold":1,"progress":1,"completed":true,"claimed":false,"rewards":[{"itemId":"gold","amount":50}]}]}
```

- 載るのは**サーバーの時刻でいま開いているクエストだけ**（`startsAt`以上・`endsAt`未満）。並びは`questId`の昇順。受け取った後も期間の内なら載る（`claimed: true`）。`kind`は区切りで、一度きり（`once`）・デイリー（`daily`）・週間（`weekly`）。`periodKey`はいまの区切り（一度きりは`once`、デイリーはクエストの時差の日付、週間は時差でその日を含む週の月曜の日付）で、サーバーの時刻で決める（`GET /v1/events`と同じ決め方）。`nextResetAt`は次の区切りの時刻（デイリーは次の時差の 0 時、週間は次の時差の月曜 0 時。クエストの`endsAt`を越えない）で、一度きりのクエストには載らない。
- `key`は進捗に使うプレイヤーデータのキー、`threshold`は達成に要る数。`progress`は進捗の数で、一度きりのクエストはトークンのプレイヤーのキーのいまの値（`GET /v1/player-data`の`values`と同じ値。書いたことが無ければ 0）、デイリー・週間のクエストは**いまの区切りの中でキーに足した分**（区切りが変わると 0 から数え直す。前の区切りの分は数えない）。区切りの中の分は、区切りで数える宣言のある`add`のキーへの書き込み（`POST /v1/player-data`）が同じまとまりで数え、宣言の後の書き込みだけを数える（さかのぼらない）。送り直し（同じ`Idempotency-Key`）・409 の書き込みは数えない。`GET /v1/player-data`の`values`は合計のままで、区切りの中の分はここの`progress`でだけ見える。閾値で丸めない（「3 / 3」のような表示はクライアントが丸める）。
- `completed`は`progress`が`threshold`以上か（サーバーがその時の値で決める）。値が下がれば（`set`のキーを下げる・管理の直し）、受け取る前のクエストは`false`に戻る。`claimed`はトークンのプレイヤーがいまの区切りで受け取ったか（ほかのプレイヤーの受け取りは数えない）。
- `serverTime`はサーバーの時刻（`GET /v1/events`と同じ。端末の時刻で期間を決めない）。`rewards`は受け取ると付与される品目と数（品目の ID の昇順）。
- クエストの名前・説明・物語はサーバーが持たない（マスターデータに置き、クライアントが`questId`で引く）。サーバーが持つのは区切り・期間・見るキーと閾値・報酬だけ。`demo-rpg`の手本はマイグレーションで入っている（`migrations/0015_quests.sql`の一度きりの`first-hunt`〔`slimes-defeated`が 1 以上〕・金貨`gold` 50 と、`migrations/0016_player_data_periods.sql`のデイリーの`daily-slimes`〔その日に`slimes-defeated`を 3 足す〕・薬`potion` 1）。ゲームのクライアントの口にクエストを書き換える口は無い。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン（401。数えない）→ プレイヤーの利用制限（429 `RATE_LIMITED`。受け取りと合わせて数える）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。機能`quests`を使わない設定のゲームは`Feature not enabled for this game`）→ 読む。`player-data`・`inventory`を使わない設定のゲームでも通る（進捗が書かれないので達成しない・受け取った品目を`GET /v1/inventory`で読めない、というだけ）。

## POST /v1/quests/{questId}/claim?gameId=demo-rpg

達成したクエストの報酬を、いまの区切りの分だけ受け取る。見出しは`Authorization: Bearer <token>`。本文は要らない（送っても読まない。「達成した」の申告・進捗・時刻の欄も読まない）。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","questId":"first-hunt","periodKey":"once","claimId":"<claimId>","claimedAt":"2026-10-31T15:30:00Z","grants":[{"itemId":"gold","amount":50}]}
```

- 達成はサーバーが受け取りの時に判定する: トークンのプレイヤーの進捗（一度きりはキーの値、デイリー・週間はいまの区切りの中で足した分。`GET /v1/quests`の`progress`と同じ）が`threshold`以上のときだけ受け取れる。デイリー・週間のクエストは区切りごとに 1 回受け取れる（`periodKey`はサーバーの時刻で決めたいまの区切り）。値は**自己申告**のプレイヤーデータなので、守りはプレイヤーデータの守り（宣言・範囲・1 回の増加の上限・書き方・利用制限）のまま。
- 受け取ると、`grants`の品目がトークンのプレイヤーの所持品に足され、受領の履歴（`GET /v1/inventory/history`）に品目ごとに 1 行（`sourceType: "quest-claim"`・`sourceId`が`claimId`）残る。受け取りの行・履歴・残高は 1 つのまとまり（D1 の`batch`）で書くので、片方だけ残らない。応答に残高は入らない（`GET /v1/inventory`で読む）。
- **同じ区切りの 2 回目以降は 200 で 1 回目と同じ本文**（同じ`claimId`・`claimedAt`・`grants`）を返し、残高も履歴も増えない。並べて送っても付与は 1 回分（プレイヤー・クエスト・区切りの一意の鍵で止める）。受け取った後に値が下がっても、期間が終わっても、同じ本文の 200 になる。届かなかった要求は同じ要求を送り直すだけでよい。`Idempotency-Key`の見出しは読まない（無くても冪等）。
- 期間はサーバーの時刻だけで決める。受け取っていないクエストで期間の外（終わった・まだ始まらない）は**409 `QUEST_NOT_ACTIVE`**、進捗が閾値に届いていなければ**409 `QUEST_NOT_COMPLETED`**、付与すると残高が 1,000,000,000（`MAX_ITEM_AMOUNT`）を超える品目があれば**409 `INVENTORY_LIMIT_EXCEEDED`**で、どれも何も書かない（もう一度送れる）。
- そのゲームに無いクエストは**404 `NOT_FOUND`**（`message`は`Unknown quest`）。`questId`の形（`^[a-zA-Z0-9_-]{1,64}$`）が外れていればどのルートにも当たらず**404 `NOT_FOUND`**（`Endpoint not found`）。
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン（401。数えない）→ プレイヤーの利用制限（429 `RATE_LIMITED`。一覧と合わせて数え、断ったときは何も書かない）→ 止めた印（403 `PLAYER_BANNED`）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403）→ ゲームの登録と機能の設定（404）→ クエストがあるか（404）→ 書く（期間・進捗・上限は書く文の条件で見る。409 `QUEST_NOT_ACTIVE`・`QUEST_NOT_COMPLETED`・`INVENTORY_LIMIT_EXCEEDED`）。

## GET /v1/config?gameId=demo-rpg&clientVersion=…

ゲームの設定（機能フラグ・クライアントの版・マスターデータのキーと大きさの一覧）を読む。クライアントは起動時に 1 回読む。設計の正は`docs/guides/working/config-design.md`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","clientVersion":{"minimum":"1.0.0","latest":"1.0.0","update":"none"},"flags":{"demo-flag":true}}
```

マスターデータのあるゲームの例（200。`my-rpg`は説明のための名前）:

```json
{"gameId":"my-rpg","clientVersion":{"minimum":"1.0.0","latest":"1.0.0","update":"none"},"flags":{"demo-flag":true},"masterData":[{"key":"items","size":23}]}
```

- `clientVersion`（問い合わせ）はクライアントのビルドの版。形は`1`・`1.2`・`1.2.3`（数字の区切りが 1〜3 つ。各区切り 1〜9 桁）。英字の付いた版（`1.2.3-beta`）・空の`clientVersion=`は**400 `INVALID_ARGUMENT`**（`message`は`Invalid clientVersion`）。版はドットの区切りごとに数として比べ（`1.10`は`1.9`より新しい）、足りない区切りは 0 とみなす（`1`と`1.0.0`は同じ）。
- `clientVersion.minimum`・`latest`（応答）はゲームごとの最低の版・最新の版。決まりが無ければ`null`。
- `clientVersion.update`: 送った版が最低の版より古ければ`"required"`、最新の版より古ければ`"available"`、ほか（決まりが無いときも）は`"none"`。`clientVersion`を送らなければ`"unknown"`。`"required"`でもエラーにせず 200 で設定を返す（更新の画面を出すかはクライアントが決める）。ほかの API は版で断らない。
- `flags`は機能フラグ（名前 → 真偽値。名前の昇順）。名前も意味もゲームが決め、サーバーの挙動はフラグで変わらない。無ければ`{}`。
- `masterData`はマスターデータのキーとバイト数（`size`。UTF-8）の一覧（キーの昇順）。中身は入らず、キーごとに`GET /v1/config/master/{key}`で読む。マスターデータが 1 つも無いゲームでは`masterData`の欄そのものが載らない（`demo-rpg`はいまマスターデータを持たないので載らない）。マスターデータが変わると`size`が変わりうるので、設定の`ETag`も変わる。
- 応答の見出しに`ETag`（本文の SHA-256 の 16 進を`"`で囲んだもの）と`Cache-Control: no-cache`が付く。次から前の`ETag`を`If-None-Match`に付けて読むと、設定が変わっていなければ**304**（本文なし。見出しは`ETag`と`Cache-Control: no-cache`だけ）。変わっていれば 200 と新しい本文・新しい`ETag`。`If-None-Match`は`*`・`,`で区切った複数・`W/`の弱い印を受ける。エラーの応答は`no-store`のまま。
- 読むだけの API なので、**トークンは要らず、`APP_ENV`が`local`でなくても読める**（`Authorization`が付いていても見ない）。設定を書き換える API は無い。設定はマイグレーションで入れる（`migrations/0006_config.sql`。`demo-rpg`は最低の版・最新の版が`1.0.0`、フラグ`demo-flag`が`true`）。
- 設定はだれでも読めるので、**秘密（鍵・内部の URL・未発表の情報）を機能フラグ・マスターデータに入れない**。
- 登録の無い`gameId`は**404 `NOT_FOUND`**（`message`は`Unknown game`）。設定配信の機能（`config`）を使わない設定のゲームも**404 `NOT_FOUND`**（`message`は`Feature not enabled for this game`）。確かめの順: `gameId`の形（400）→ `clientVersion`の形（400）→ ゲームの登録と機能の設定（404）→ 読む → `If-None-Match`（304）。`GET`のほかのメソッドは**404 `NOT_FOUND`**（`Endpoint not found`）。

## GET /v1/config/master/{key}?gameId=…

マスターデータを 1 キー読む。キーは設定（`GET /v1/config`）の`masterData`に載ったもの。設計の正は`docs/guides/working/config-design.md`。

レスポンス例（200）:

```json
{"gameId":"my-rpg","key":"items","data":"{\"potion\":{\"price\":50}}"}
```

- `data`は入れた文字列そのまま。**サーバーは中身を解釈しない**（JSON として読まない・欄を見ない）。送った物と返る物のバイト列は変わらない。中身の形はゲームが決める。
- 1 キーの`data`は UTF-8 で **65,536 バイト（64 KiB）まで**（表の`CHECK`と`src/modules/config/limits.ts`の`MAX_MASTER_DATA_BYTES`）。マスターデータを書き換える API は無く、マイグレーションで入れる（表は`migrations/0007_config_master_data.sql`の`config_master_data`。超える行はマイグレーションが断られる）。
- 応答の見出しに`ETag`（本文の SHA-256 の 16 進を`"`で囲んだもの）と`Cache-Control: no-cache`が付く。前の`ETag`を`If-None-Match`に付けて読むと、変わっていなければ**304**（本文なし。見出しは`ETag`と`Cache-Control: no-cache`だけ）。`ETag`はキーごとなので、変わったキーだけ取り直せる。
- **トークンは要らず、`APP_ENV`が`local`でなくても読める**（設定と同じ）。秘密を入れない。
- 確かめの順: キーの形（`^[a-zA-Z0-9_-]{1,64}$`。外れは**404 `NOT_FOUND`**・`Endpoint not found`）→ `gameId`の形（**400 `INVALID_ARGUMENT`**）→ ゲームの登録と機能の設定（**404 `NOT_FOUND`**・`Unknown game`・`Feature not enabled for this game`）→ そのゲームにキーが無ければ**404 `NOT_FOUND`**（`message`は`Master data not found`。他のゲームのキーも読めない）→ `If-None-Match`（304）。`GET`のほかのメソッドは**404 `NOT_FOUND`**（`Endpoint not found`）。

## 管理の API（ゲームのクライアントは使わない）

運営する人が 1 人のプレイヤーの状態と監査のログを読み、プレイヤーを止め（BAN し）、所持品と通貨を付与・取り消し、スコアを消し、品目とイベントの定義を入れ、プレイヤーデータのキーと実績を宣言し、プレイヤーデータの値を直し、解いた実績を取り消す口。**ゲームのクライアント（CLI モック・UE・Unity・ブラウザ）は使わず、管理の鍵を持たせない**。形の正は`openapi/rpg-online-admin.v1.json`（ゲームのクライアントのスキーマ`openapi/rpg-online.v1.json`には入れない）、設計の正は`docs/guides/working/admin-design.md`。

- 見出しは`Authorization: Bearer <管理の鍵>`。管理の鍵は Worker ごとに 1 つの`ADMIN_API_KEY`（32 文字以上）。ローカルは人が`.dev.vars`（git に入らない）に`ADMIN_API_KEY=<32 文字以上>`を書き、staging・production は`wrangler secret put ADMIN_API_KEY`で渡す。鍵の値をファイル（`wrangler.jsonc`・ソース・試験・文書）に書かない。
- **`local`でも既定の鍵を持たない**。`ADMIN_API_KEY`が無いか 32 文字未満の環境では、管理の口はどれも**500 `INTERNAL_ERROR`**（鍵の名前・値は返さない）。
- 鍵が無い・`Bearer`でない・違う（プレイヤーのトークンも含む）は、どれも**401 `UNAUTHENTICATED`**（`message`は`Invalid admin credentials`。外れた理由は返さない）。鍵は SHA-256 にしてから時間の一定な比べで確かめる。鍵を取り替えると、前の鍵はその時から 401（前の鍵を並べて受ける期間は無い）。
- 読むのも`APP_ENV=local`の時だけ（ほかは正しい鍵があっても**403 `NOT_READY_FOR_PRODUCTION`**）。
- 確かめの順（どの口も同じ）: `APP_ENV`の守り（403）→ 管理の鍵の有無（500）→ 管理の利用制限（IP ごと。**429 `RATE_LIMITED`**と`Retry-After`。正しい鍵でも数え、鍵を確かめる前に断る）→ 管理の鍵（401）→ `gameId`の形（**400 `INVALID_ARGUMENT`**）→ ゲームの登録（**404 `NOT_FOUND`**・`Unknown game`。機能の設定は見ない）→ 口ごとの確かめ。
- 書き込みの口（BAN・BAN を解く・所持品と通貨の増減・スコアを消す・品目とイベントの定義・プレイヤーデータのキーと実績の宣言・値を置く・実績の取り消し）は、口ごとの確かめの前に見出し`X-Admin-Actor`（操作した人のラベル。`^[a-zA-Z0-9_.@-]{1,64}$`。自己申告で、そのまま監査のログに残る）と、本文（JSON でなければ**400 `INVALID_JSON`**）の`reason`（1〜200 文字。空白だけは外れ）を確かめる。外れは**400 `INVALID_ARGUMENT`**。
- 書き込みの口は、操作 1 回で監査のログに 1 行（誰が・いつ・何を・前と後）を残し、書き込みと監査の行を 1 つの`batch`に入れる（片方だけ残らない）。読み取りの口は監査のログに残さない。
- データ修正は行を直に書き換えず、履歴に残る形にする（所持品と通貨は受領の履歴に`sourceType: "admin"`の行。スコアは消して前のスコアを監査に残す。プレイヤーデータは台帳を持たないので、値を置く・実績を取り消すときの前と後を監査に残し、監査のログが直しの履歴になる）。セーブは直さない（読むだけ）。
- ローカルの管理コマンド`node scripts/admin-cli.mjs <操作>`（`player`・`audit`・`grant`・`revoke`・`ban`・`unban`・`delete-score`・`put-item`・`put-event`・`put-data-key`・`put-achievement`・`set-data`・`revoke-achievement`・`smoke`）がこれらの口を呼ぶ。鍵は環境変数`ADMIN_API_KEY`から読み、無ければ行き先が`127.0.0.1`・`localhost`のときだけ`.dev.vars`の`ADMIN_API_KEY`の行を読む（読むだけ）。`X-Admin-Actor`は`--actor`（既定は`local-admin`）。CLI モック（`scripts/cli-mock.mjs`）は管理の口を呼ばない。

### GET /v1/admin/players/{playerId}?gameId=demo-rpg

1 人のプレイヤーの所持品・受領の履歴・セーブの一覧・スコア・プレイヤーデータを読む。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"<playerId>","createdAt":"2026-10-31T01:02:03Z","ban":{"reason":"チートの疑い","bannedAt":"2026-10-31T02:00:00Z","expiresAt":null},"balances":[{"itemId":"gold","kind":"currency","amount":100}],"history":[{"entryId":7,"itemId":"gold","delta":100,"sourceType":"event-claim","sourceId":"<claimId>","createdAt":"2026-10-31T01:05:00Z"}],"saves":[{"slotId":"auto","revision":3,"size":120,"deleted":false,"updatedAt":"2026-10-31T01:06:00.123Z"}],"rankings":[{"boardId":"boss-score","score":1200,"displayName":"Hero"}],"playerData":{"values":[{"key":"slimes-defeated","mode":"add","value":3,"updatedAt":"2026-10-31T01:07:00Z"}],"achievements":[{"achievementId":"first-slime","unlockedAt":"2026-10-31T01:07:00Z","writeId":"<writeId>"}]}}
```

- `createdAt`はプレイヤーを作った時刻（ISO 8601・UTC・秒まで）。
- `ban`は止めた印（`reason`・`bannedAt`・`expiresAt`。時刻は ISO 8601・UTC・秒まで、`expiresAt`は期限が無ければ`null`）。**止めていなければ（印が無い・期限が過ぎた）欄ごと載らない**。
- `balances`は残高のある品目（品目の ID の昇順。`kind`は`currency`か`item`）。`history`は受領の履歴の新しい順に 20 行まで（`GET /v1/inventory/history`の行と同じ欄）。`saves`はスロットの ID の昇順で、消した印のある行も`deleted: true`で載る（`updatedAt`はセーブの API と同じ値）。`rankings`はボードの ID の昇順。
- `playerData`はいつも載る。`values`はプレイヤーが書いたことのあるキーの値（キーの昇順。`mode`はキーの宣言の書き方、`updatedAt`は最後に変わった時刻）、`achievements`は解いた実績（実績の ID の昇順。`writeId`は解いた書き込みの`writeId`〔`POST /v1/player-data`の応答と同じ値〕）。無ければどちらも空の配列。プレイヤーデータの機能の設定は見ない。
- **セーブの本文（`data`）とチェックサムは返さない**。
- そのゲームに無いプレイヤー（`game_players`に行が無い）は**404 `NOT_FOUND`**（`message`は`Unknown player`）。`playerId`の形（`^[a-zA-Z0-9_-]{1,64}$`）が外れていればどのルートにも当たらず**404 `NOT_FOUND`**（`Endpoint not found`）。

### GET /v1/admin/audit?gameId=demo-rpg&limit=20&before=42

ゲームの監査のログ（管理の書き込みの操作 1 回で 1 行）を新しい順に読む。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"auditId":42,"actor":"local-admin","action":"inventory.adjust","target":"player:<playerId>","before":{"itemId":"gold","amount":120},"after":{"itemId":"gold","amount":100},"reason":"二重に配った分を戻す","createdAt":"2026-10-31T01:10:00Z"}],"nextBefore":42}
```

- 並びは`auditId`の降順（新しい順）。`limit`は 1〜100 の整数（無ければ 20）。`before`は 1 以上の整数で、付けるとその`auditId`より古い行だけを返す。外れは**400 `INVALID_ARGUMENT`**。続きがあれば`nextBefore`（最後の行の`auditId`）が載り、無ければ欄ごと載らない（受領の履歴と同じ）。
- `actor`は書き込みの口の`X-Admin-Actor`（自己申告のラベル）。`before`・`after`は操作の前と後の状態（保存した JSON を読み直した値。無ければ`null`）。`createdAt`はサーバーの時刻（ISO 8601・UTC・秒まで）。トークン・管理の鍵・セーブの本文・IP は記録しない。
- 監査のログは API から書き換えも消しもしない。保持の期間は 365 日（消す仕組みは後で足す。それまでは残る）。いま行を書く口は BAN と BAN を解く口（`action`は`player.ban`・`player.unban`、`target`は`player:<playerId>`）・所持品と通貨の増減（`inventory.adjust`・`player:<playerId>`）・スコアを消す口（`ranking.delete`・`ranking:<boardId>:<playerId>`）・品目の定義（`item.put`・`item:<itemId>`）・イベントの定義（`event.put`・`event:<eventId>`）・プレイヤーデータのキーの宣言（`player-data-key.put`・`player-data-key:<key>`）・実績の宣言（`achievement.put`・`achievement:<achievementId>`）・プレイヤーデータの値を置く口（`player-data.set`・`player:<playerId>`）・実績の取り消し（`achievement.revoke`・`player:<playerId>`）。

### PUT /v1/admin/players/{playerId}/ban?gameId=demo-rpg

1 人のプレイヤー（ゲームごと）を止める。止めたプレイヤーのトークンの要求は**403 `PLAYER_BANNED`**になる（上の「エラーレスポンス」）。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"reason":"チートの疑い","expiresAt":"2026-11-07T00:00:00Z"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"<playerId>","bannedAt":"2026-10-31T02:00:00Z","expiresAt":"2026-11-07T00:00:00Z"}
```

- `expiresAt`は任意（ISO 8601 の UTC。ミリ秒は切り捨て）。その時刻から止めない。無いか`null`ならずっと止める（応答の`expiresAt`は`null`）。今より後でない・形の外れは**400 `INVALID_ARGUMENT`**。
- 印があれば理由と期限と`bannedAt`を置き換える（2 回送っても印は 1 つ）。
- そのゲームに無いプレイヤーは**404 `NOT_FOUND`**（`message`は`Unknown player`。印を作らない）。
- 監査のログに`player.ban`の 1 行（`before`は前の印`{"reason","expiresAt"}`か`null`、`after`は新しい印`{"reason","expiresAt"}`）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`・`expiresAt`（400）→ プレイヤー（404）→ 書く。

### DELETE /v1/admin/players/{playerId}/ban?gameId=demo-rpg

1 人のプレイヤーの止めた印を消す（解く）。解いた後は同じトークンでまた通る。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"reason":"誤りだった"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"<playerId>","banned":false}
```

- 印が無くても 200（同じ結果）。そのゲームに無いプレイヤーは**404 `NOT_FOUND`**（`Unknown player`）。
- 監査のログに`player.unban`の 1 行（`before`は消した印`{"reason","expiresAt"}`か`null`、`after`は`null`）。
- 確かめの順は`PUT`と同じ（`expiresAt`は無い）。

### POST /v1/admin/players/{playerId}/inventory?gameId=demo-rpg

1 人のプレイヤーの所持品・通貨を 1 品目だけ増やす（付与）・減らす（取り消し）。受領の履歴に`sourceType: "admin"`の行（`sourceId`はこの操作の監査の行の参照）が残り、残高は 0 未満にも上限（1,000,000,000）より大きくもならない。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`・**`Idempotency-Key: <鍵>`（必須。`^[a-zA-Z0-9_-]{8,64}$`）**。

入力例:

```json
{"itemId":"gold","delta":-20,"reason":"二重に配った分を戻す"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"<playerId>","itemId":"gold","delta":-20,"amount":100,"auditId":42}
```

- `delta`は 0 でない整数（正は付与・負は取り消し）で、絶対値が 1,000,000,000 以下。外れは**400 `INVALID_ARGUMENT`**。`itemId`の形（`^[a-zA-Z0-9_-]{1,64}$`）の外れも 400。
- `amount`は後の残高。0 になった品目は残高の行が消え、所持品の一覧に出ない。`auditId`は監査の行の番号。
- `Idempotency-Key`が無い・形の外れは**400 `INVALID_ARGUMENT`**。同じゲームで同じ鍵と同じ中身（`itemId`・`delta`・`reason`・プレイヤー。`X-Admin-Actor`は比べない）をもう一度送ると、何も書かずに**200 で 1 回目と同じ本文**を返す（並べて送っても 1 回分）。同じ鍵で違う中身は**422 `IDEMPOTENCY_KEY_REUSED`**（何も書かない）。鍵は監査の行と一緒に残り（365 日）、修正ごとに新しい鍵を作る。
- 知らない品目は**404 `NOT_FOUND`**（`Unknown item`）、そのゲームに無いプレイヤーは**404 `NOT_FOUND`**（`Unknown player`）。
- 取り消しで残高が 0 未満になるときは**409 `INSUFFICIENT_BALANCE`**、付与で上限を超えるときは**409 `INVENTORY_LIMIT_EXCEEDED`**。どれも何も書かない（同じ鍵で流し直せる）。
- 監査のログに`inventory.adjust`の 1 行（`before`は`{"itemId","amount"}`の前の残高、`after`は後の残高。残高の行が無ければ`amount`は 0）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`（400）→ `Idempotency-Key`（400）→ `itemId`・`delta`（400）→ 書く（同じ鍵の行 → 品目・プレイヤー（404）→ 残高（409）の順で見分ける）。

### DELETE /v1/admin/rankings/{boardId}/entries/{playerId}?gameId=demo-rpg

1 つのボードの 1 人のスコアを消す（最高スコアだけを残す表なので、下げる・書き換える口は無い）。消した後もプレイヤーはまた投稿できる。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"reason":"不正なスコア"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","boardId":"boss-score","playerId":"<playerId>","deleted":true,"auditId":43}
```

- スコアの行が無ければ**404 `NOT_FOUND`**（`Unknown ranking entry`。監査のログに残さない）。2 回目は 404（もう無い）。`Idempotency-Key`は要らない。
- ランキングの行だけを見る（そのゲームに無いプレイヤーの行も消せる）。
- 監査のログに`ranking.delete`の 1 行（`before`は消した行の`{"score","displayName"}`、`after`は`null`）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`（400）→ 書く。

### PUT /v1/admin/items/{itemId}?gameId=demo-rpg

品目（所持品・通貨の種類）を 1 つ入れる。品目を消す口は無い。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"kind":"currency","reason":"11 月のイベントの通貨"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","itemId":"gem","kind":"currency"}
```

- `kind`は`currency`（通貨）か`item`（所持品）。外れは**400 `INVALID_ARGUMENT`**。
- 無ければ作る。あって`kind`が同じなら何も変えずに 200（監査の行は残す）。**あって`kind`が違えば 400 `INVALID_ARGUMENT`**（残高と報酬が種類を前提にしているので、種類は後から変えられない）。
- 監査のログに`item.put`の 1 行（`before`は前の`{"kind"}`か`null`、`after`は`{"kind"}`）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`・`kind`（400）→ 種類の違い（400）→ 書く。

### PUT /v1/admin/events/{eventId}?gameId=demo-rpg

イベントの定義（区切り・期間・時差・報酬）を入れる・置き換える。マイグレーションを書かずに新しいイベントを入れられる。イベントを消す口は無い（終えるときは`endsAt`をいまにする）。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"kind":"daily","startsAt":"2026-11-01T00:00:00Z","endsAt":"2026-12-01T00:00:00Z","resetOffsetMinutes":540,"rewards":[{"itemId":"gold","amount":100}],"reason":"11 月のログインボーナス"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","eventId":"login-2026-11","kind":"daily","startsAt":"2026-11-01T00:00:00Z","endsAt":"2026-12-01T00:00:00Z","resetOffsetMinutes":540,"rewards":[{"itemId":"gold","amount":100}]}
```

- `kind`は`once`・`daily`・`weekly`。`startsAt`・`endsAt`は ISO 8601 の UTC（ミリ秒は切り捨て）で、`startsAt < endsAt`。`resetOffsetMinutes`は区切りの時差（分。-720〜840 の整数。無ければ 0）。`rewards`は 1〜10 行で、品目が重ならず、`amount`は 1〜1,000,000,000 の整数。外れは**400 `INVALID_ARGUMENT`**。
- 報酬の品目がそのゲームに無ければ**404 `NOT_FOUND`**（`Unknown item`。何も書かない）。先に品目の口で入れる。
- 無ければ作り、あれば置き換える（報酬の行は送った中身だけになる）。**受け取りが 1 つでもあるイベントは`kind`・`startsAt`・`resetOffsetMinutes`を変えられない**（**400 `INVALID_ARGUMENT`**。区切りの意味が変わり、二重の受け取りの止めが崩れるため）。`endsAt`と`rewards`は変えられ、変えた後の受け取りから新しい中身になる。
- 応答の`startsAt`・`endsAt`は秒まで、`rewards`は品目の ID の昇順（イベントの一覧と同じ欄の名前）。
- 監査のログに`event.put`の 1 行（`before`は前の定義`{"kind","startsAt","endsAt","resetOffsetMinutes","rewards"}`か`null`、`after`は入れた定義）。監査の行・イベント・報酬の行は 1 つの`batch`で書く。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`・定義の本文（400）→ 報酬の品目（404）→ 受け取りのあるイベントの守り（400）→ 書く。

### PUT /v1/admin/player-data/keys/{key}?gameId=demo-rpg

プレイヤーデータのキーを 1 つ宣言する（書き方と上限）。無ければ作り、あれば置き換える。キーを消す口は無い（使わなくなったキーはそのまま残る）。設計の正は`docs/guides/working/player-data-design.md` §8。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"mode":"add","maxValue":1000000000,"maxDelta":100,"reason":"倒した数を数える"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","key":"slimes-defeated","mode":"add","maxValue":1000000000,"maxDelta":100}
```

- `mode`は`add`・`max`・`set`・`flag`（`POST /v1/player-data`の表の書き方）。`maxValue`は 1〜1,000,000,000 の整数で、`flag`は 1 だけ。`maxDelta`（1 回の増加の上限。1〜1,000,000,000 の整数）は`add`のときだけ必須で、ほかの書き方では送らない（応答は`null`）。外れは**400 `INVALID_ARGUMENT`**。
- プレイヤーの値の行が 1 つでもあるキーの`mode`は変えられない（**400 `INVALID_ARGUMENT`**）。`maxValue`・`maxDelta`は変えられる（前に書いた値が新しい上限を超えても消さない。次の書き込みから効く）。
- 1 ゲームの宣言は 200 個まで（`MAX_PLAYER_DATA_KEYS`）。超える新しいキーは**400 `INVALID_ARGUMENT`**。
- 監査のログに`player-data-key.put`の 1 行（`before`は前の宣言`{"mode","maxValue","maxDelta"}`か`null`、`after`は入れた宣言）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`・宣言の本文（400）→ 値のあるキーの`mode`（400）→ 宣言の数（400）→ 書く。

### PUT /v1/admin/achievements/{achievementId}?gameId=demo-rpg

実績を 1 つ宣言する（見るキーと閾値）。無ければ作り、あれば置き換える。実績の宣言を消す口は無い。キーの値が閾値以上になった書き込み（`POST /v1/player-data`）で解ける（宣言の時にさかのぼって解かない）。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"key":"slimes-defeated","threshold":10,"reason":"10 体倒した実績"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","achievementId":"slime-hunter","key":"slimes-defeated","threshold":10}
```

- `key`は ID の形、`threshold`は 1〜1,000,000,000 の整数。外れは**400 `INVALID_ARGUMENT`**。
- 宣言の無いキーは**404 `NOT_FOUND`**（`Unknown key`。何も書かない）。先にキーを宣言する。
- 解いたプレイヤーがいる実績の`key`は変えられない（**400 `INVALID_ARGUMENT`**）。`threshold`は変えられる（解いた人の行は消さない）。
- 監査のログに`achievement.put`の 1 行（`before`は前の宣言`{"key","threshold"}`か`null`、`after`は入れた宣言）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`・宣言の本文（400）→ キーの宣言（404）→ 解いた人のいる実績の`key`（400）→ 書く。

### PUT /v1/admin/players/{playerId}/player-data/{key}?gameId=demo-rpg

1 人のプレイヤーの 1 つのキーの値を置く（不正な値を戻すなど）。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"value":0,"reason":"不正な連打の分を戻す"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"<playerId>","key":"slimes-defeated","value":0,"auditId":44}
```

- `value`は 0 以上の整数で、キーの書き方に関わらず 0〜キーの`maxValue`（`add`でも減らせ、`flag`も 0 に戻せる）。外れは**400 `INVALID_ARGUMENT`**。
- そのゲームに無いプレイヤーは**404 `NOT_FOUND`**（`Unknown player`）、宣言の無いキーは**404 `NOT_FOUND`**（`Unknown key`）。
- **実績は判定しない**（閾値を超える値に置いても解かず、解いた人の値を下げても取り消さない。取り消すのは下の口）。値の`updatedAt`はサーバーの時刻になる。`Idempotency-Key`は要らない（何度送っても同じ値）。
- 監査のログに`player-data.set`の 1 行（`before`は前の`{"key","value"}`か、値の行が無ければ`null`、`after`は`{"key","value"}`）。`auditId`はその行の番号。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`・`value`（400）→ プレイヤー（404）→ キー（404）→ キーの`maxValue`（400）→ 書く。

### DELETE /v1/admin/players/{playerId}/achievements/{achievementId}?gameId=demo-rpg

1 人のプレイヤーの解いた実績を取り消す（誤って解けた実績を消す）。取り消した後に値が閾値以上の書き込みをすると、また解ける。

見出し: `Authorization: Bearer <管理の鍵>`・`X-Admin-Actor: <ラベル>`。

入力例:

```json
{"reason":"不正な値で解けた"}
```

レスポンス例（200）:

```json
{"gameId":"demo-rpg","playerId":"<playerId>","achievementId":"first-slime","revoked":true,"auditId":45}
```

- 解いた行が無ければ**404 `NOT_FOUND`**（`Unknown achievement`。監査のログに残さない）。2 回目は 404（もう無い）。`Idempotency-Key`は要らない。
- 監査のログに`achievement.revoke`の 1 行（`before`は消した行の`{"achievementId","unlockedAt"}`、`after`は`null`）。
- 確かめの順: 管理の口の共通の確かめ → `X-Admin-Actor`（400）→ 本文の JSON（400 `INVALID_JSON`）→ `reason`（400）→ 書く。

## エラーレスポンス

```json
{"error":{"code":"INVALID_ARGUMENT","message":"Invalid parameters"}}
```

現PoCの代表コード: `INVALID_ARGUMENT`（400）、`NOT_FOUND`（404）、`NOT_READY_FOR_PRODUCTION`（403）、`INVALID_JSON`（400）、`INTERNAL_ERROR`（500）、`UNAUTHENTICATED`（401）、`TOKEN_EXPIRED`（401）、`PERMISSION_DENIED`（403）、`SAVE_CONFLICT`（409）、`PAYLOAD_TOO_LARGE`（413）、`SLOT_LIMIT_EXCEEDED`（409）、`RATE_LIMITED`（429）、`EVENT_NOT_ACTIVE`（409）、`INVENTORY_LIMIT_EXCEEDED`（409）、`PLAYER_BANNED`（403）、`PLAYER_DATA_LIMIT_EXCEEDED`（409）、`IDEMPOTENCY_KEY_REUSED`（422）、`QUEST_NOT_COMPLETED`（409）、`QUEST_NOT_ACTIVE`（409）。

管理の口だけのコード（ゲームのクライアントの口は返さない。形の正は`openapi/rpg-online-admin.v1.json`）: `INSUFFICIENT_BALANCE`（409）。

- **`PLAYER_BANNED`（403）**: トークンの要る口（スコアの投稿・セーブの 4 つ・所持品・受領の履歴・イベントの一覧と受け取り・プレイヤーデータの読み書き・クエストの一覧と受け取り）で、トークンのプレイヤーが管理の口（`PUT /v1/admin/players/{playerId}/ban`）で止められているとき。`message`は`Player is banned`で、止めた理由・期限は返さない。トークンは正しいので、ゲストを発行し直しても同じプレイヤーには戻らない（別の`playerId`の新しいゲストになる）。確かめるのはプレイヤーの利用制限の後（止めた人の要求も数える）で、トークンの無い要求（401）・本文の形の外れ（400）はそれより先に断る。止めた人の要求は何も書かない。トークンを読まない口（お知らせ・ランキングの`GET`・設定）は止めない。
- **`INSUFFICIENT_BALANCE`（409。管理の口だけ）**: 管理の所持品と通貨の増減で、取り消すと残高が 0 未満になるとき。何も書かない。
- **`PLAYER_DATA_LIMIT_EXCEEDED`（409）**: プレイヤーデータの書き込み（`POST /v1/player-data`）で、`add`のキーの書いた後の値がキーの値の上限を超えるとき。その書き込みを全部断り、何も書かない。
- **`IDEMPOTENCY_KEY_REUSED`（422）**: 同じ`Idempotency-Key`を違う中身に使ったとき。プレイヤーデータの書き込み（同じプレイヤーの鍵）と、管理の所持品と通貨の増減（同じゲームの鍵）が返す。何も書かない。
- **`QUEST_NOT_COMPLETED`（409）**: クエストの受け取り（`POST /v1/quests/{questId}/claim`）で、トークンのプレイヤーの進捗（プレイヤーデータの値）がクエストの閾値に届いていないとき。何も書かない。
- **`QUEST_NOT_ACTIVE`（409）**: クエストの受け取りで、サーバーの時刻でクエストの期間の外（終わった・まだ始まらない）のとき。何も書かない。イベントの`EVENT_NOT_ACTIVE`とは別のコード（クライアントがコードだけで画面を出し分けられる）。

## 利用制限

ゲストの発行・スコアの投稿・セーブの操作・所持品の読み取り・イベントの一覧と報酬の受け取り・プレイヤーデータの読み書き・クエストの一覧と報酬の受け取り・管理の API は、決めた秒の窓（固定。窓の始まりは UNIX 秒を窓の長さで割り切った時刻）の中の回数を数え、上限を超えると断る。設計の正は`docs/guides/working/abuse-protection-design.md`。

| 口 | 数える単位 | 上限 |
| --- | --- | --- |
| `POST /v1/accounts/guest` | IP（`CF-Connecting-IP`。見出しが無ければ全員で 1 つ） | 60 秒に 10 回 |
| `POST /v1/accounts/guest` | ゲーム（本文の`gameId`） | 60 秒に 300 回 |
| `POST /v1/rankings/{boardId}` | プレイヤー（トークンのゲームとプレイヤー） | 60 秒に 30 回 |
| `PUT`・`GET`・`DELETE /v1/saves/{slotId}`と`GET /v1/saves` | プレイヤー（トークンのゲームとプレイヤー。4 つの操作を合わせて数え、スコアの投稿とは別に数える） | 60 秒に 60 回 |
| `GET /v1/inventory`・`GET /v1/inventory/history`・`GET /v1/events`・`POST /v1/events/{eventId}/claim` | プレイヤー（トークンのゲームとプレイヤー。報酬の操作として 4 つを合わせて数え、セーブの操作とは別に数える） | 60 秒に 60 回 |
| `GET`・`POST /v1/player-data`（単位の名前`player-data`） | プレイヤー（トークンのゲームとプレイヤー。2 つの操作を合わせて数え、セーブ・報酬の操作とは別に数える） | 60 秒に 60 回 |
| `GET /v1/quests`・`POST /v1/quests/{questId}/claim`（単位の名前`quests`） | プレイヤー（トークンのゲームとプレイヤー。2 つの操作を合わせて数え、報酬・プレイヤーデータの操作とは別に数える） | 60 秒に 60 回 |
| 管理の API（`/v1/admin/...`。単位の名前`admin`） | IP（`CF-Connecting-IP`。見出しが無ければ全員で 1 つ。管理の口を全部合わせて数え、正しい鍵でも数える） | 60 秒に 60 回 |

レスポンス例（429。見出し`Retry-After: 37`）:

```json
{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}
```

- `Retry-After`は次に送ってよいまでの秒（窓の終わりまで。1〜60 の整数）。クライアントはこの秒だけ待ってから送り直す。どの単位で断ったか・上限の数は返さない。
- 断った要求も数える。断ったときは行を作らない・変えない。
- `APP_ENV`の守り（403）が先で、そのときは数えない。IP はハッシュ（SHA-256）にして数え、IP をそのまま残さない。
- `Idempotency-Key`の見出しが必須なのは、プレイヤーデータの書き込み（`POST /v1/player-data`。上の節）と管理の所持品と通貨の増減の口（上の「管理の API」）だけ。ほかのゲームのクライアントの口は受け取って無視する（スコアは最高スコアだけ残すので、同じ要求を 2 回送っても記録と応答は同じ。回数は 2 回分数える）。

## 互換の決まり

- 要求の知らない欄は無視する（保存しない）。
- `/v1/`の中では、欄は**足すだけ**。消す・意味を変えるときは`/v2/`を足す。

## 将来予定（未実装）

| HTTP | パス案 | 用途 |
| --- | --- | --- |
| GET/POST | `/v1/messages` | 酒場掲示板 |
| GET/POST | `/v1/adventurers` | ゴースト冒険者登録・取得 |

※ 認証（ゲストのトークン）の設計の正は`docs/guides/working/account-design.md`、形の正は`openapi/rpg-online.v1.json`。
