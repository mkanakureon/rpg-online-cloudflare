# 初期API仕様（検討版）

この仕様はMacでの**ローカルPoC**向け。ログインは未実装（認証はゲストのトークンだけ）。書き込みの口（ゲストの発行・スコアの投稿）とセーブの操作と所持品の読み取りとイベントの一覧・報酬の受け取りに回数の制限（**429 `RATE_LIMITED`**と`Retry-After`。下の「利用制限」）がある。スコアは値の範囲と回数までしか確かめない（ゲームの中で取れるスコアかは見ない）。書込み系APIは公開用に使用しない。

形（欄・型・範囲・状態コードとエラーコードの組）の正はスキーマ（`openapi/rpg-online.v1.json`）、挙動の説明の正はこの文書。

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
- 確かめの順: `APP_ENV`の守り（403）→ トークン（本文を読む前）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`。ここまで DB を引かない）→ プレイヤーの利用制限（429）→ トークンと本文の突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録（404 `NOT_FOUND`）→ 書き込み。
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
- 確かめの順: `APP_ENV`の守り（403）→ トークン（401。本文を読む前）→ プレイヤーの利用制限（429）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`。`message`は`Token does not match game`）→ 本文の大きさ（413）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`）→ `data`の大きさ（413）→ チェックサム（400 `INVALID_ARGUMENT`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。機能の名前は`saves`）→ 書き込み（409 `SAVE_CONFLICT`・409 `SLOT_LIMIT_EXCEEDED`）。

## GET /v1/saves/{slotId}?gameId=demo-rpg

トークンのプレイヤーのスロットのセーブを読む。見出しは`PUT`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","slotId":"auto","revision":1,"formatVersion":1,"data":"{\"hp\":30,\"map\":\"town\"}","checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}
```

- `PUT`の応答の欄に`data`を足したもの。受け取った`data`でチェックサムを計算し直して比べると、端から端まで壊れていないことが分かる。
- そのスロットにセーブが無ければ**404 `NOT_FOUND`**（`message`は`Save not found`）。端末は`revision`を`0`と覚えて、初めての書き込みに使う。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`APP_ENV`の守り → トークン → プレイヤーの利用制限（429 `RATE_LIMITED`。`PUT`と合わせて数える）→ `gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 読む。

## GET /v1/saves?gameId=demo-rpg

トークンのプレイヤーのセーブの一覧（メタデータだけ）。見出しは`PUT`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"slotId":"auto","revision":3,"formatVersion":1,"checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}]}
```

- `items`の各行は`GET /v1/saves/{slotId}`の応答から`gameId`と`data`を除いたもの（本体を読まずに`formatVersion`・`size`・`revision`が分かる）。並びは`slotId`の昇順。最大 10 件なのでページングしない。
- 自分（トークンのプレイヤー）のスロットだけが出る。消したスロットは出ない。セーブが 1 つも無ければ**200 と空の`items`**。
- 一覧も`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`GET /v1/saves/{slotId}`と同じ（`APP_ENV`の守り → トークン → プレイヤーの利用制限（429 `RATE_LIMITED`。`PUT`と合わせて数える）→ `gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 読む）。

## DELETE /v1/saves/{slotId}?gameId=demo-rpg&baseRevision=…

トークンのプレイヤーのスロットのセーブを消す。見出しは`PUT`と同じ`Authorization: Bearer <token>`。`baseRevision`は最後に読んだか書いたリビジョン（1 以上の整数）。

レスポンス例（200）:

```json
{"ok":true,"gameId":"demo-rpg","slotId":"auto"}
```

- `baseRevision`がいまのリビジョンと違えば**409 `SAVE_CONFLICT`**で消さない（別の端末が書いたばかりのセーブを古い画面から消さないため）。`GET`で読み直してから消し直す。
- そのスロットにセーブが無い（消した後も同じ）・他のプレイヤーのスロットは**404 `NOT_FOUND`**（`message`は`Save not found`）。`baseRevision`が無い・1 以上の整数でなければ**400 `INVALID_ARGUMENT`**。
- 消した後は`GET`が 404・一覧に出ない・スロットの数に数えない。同じスロットに`baseRevision: 0`で書き直せるが、`revision`は 1 に戻らず消す前より先へ進む（サーバーは消した印を残す）。だから消す前のリビジョンを覚えた古い端末の書き込みは 409 `SAVE_CONFLICT`になる。
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン → プレイヤーの利用制限（429 `RATE_LIMITED`。`PUT`と合わせて数え、断ったときは消さない）→ `gameId`の形 → トークンのゲームとの突き合わせ → `baseRevision`の形（400）→ ゲームの登録と機能の設定（404）→ 消す（409・404）。

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
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`APP_ENV`の守り → トークン（401）→ プレイヤーの利用制限（429 `RATE_LIMITED`。受領の履歴・イベントの一覧と受け取りと合わせて数える）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。所持品の機能`inventory`を使わない設定のゲームは`Feature not enabled for this game`）→ 読む。

## GET /v1/inventory/history?gameId=demo-rpg&limit=20&before=42

トークンのプレイヤーの受領の履歴（増減 1 回で 1 行）を新しい順に読む。見出しは`GET /v1/inventory`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"entryId":41,"itemId":"gold","delta":100,"sourceType":"event-claim","sourceId":"<claimId>","createdAt":"2026-10-30T15:30:00Z"}],"nextBefore":41}
```

- 並びは`entryId`の降順（新しい順）。`limit`は 1〜100 の整数（無ければ 20）。`before`は 1 以上の整数で、付けるとその`entryId`より古い行だけを返す。外れは**400 `INVALID_ARGUMENT`**。
- 続きがあれば`nextBefore`（最後の行の`entryId`）が載る。次はそれを`before`に付けて読む。続きが無ければ`nextBefore`の欄ごと載らない。
- `delta`は増減の数（いまは付与だけで正の数）。`sourceType`・`sourceId`は増減の元（イベントの報酬の受け取りは`event-claim`と受け取りの`claimId`）。`createdAt`はサーバーが書いた時刻（ISO 8601・UTC・秒まで）。履歴は API から書き換えも消しもしない。
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
- イベントの定義はマイグレーションで入れる（`migrations/0010_events.sql`。`demo-rpg`はデイリーの`daily-login`・金貨`gold` 100）。イベントを書き換える API は無い。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`GET /v1/inventory`と同じ: `APP_ENV`の守り → トークン（401）→ プレイヤーの利用制限（429 `RATE_LIMITED`。所持品・受領の履歴・受け取りと合わせて数える）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。イベントの機能`events`を使わない設定のゲームは`Feature not enabled for this game`）→ 読む。

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
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン（401。数えない）→ プレイヤーの利用制限（429 `RATE_LIMITED`。一覧・所持品・受領の履歴と合わせて数え、断ったときは何も書かない）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403）→ ゲームの登録と機能の設定（404）→ イベントがあるか（404）→ 期間（409 `EVENT_NOT_ACTIVE`）→ 書く（409 `INVENTORY_LIMIT_EXCEEDED`）。

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

## エラーレスポンス

```json
{"error":{"code":"INVALID_ARGUMENT","message":"Invalid parameters"}}
```

現PoCの代表コード: `INVALID_ARGUMENT`（400）、`NOT_FOUND`（404）、`NOT_READY_FOR_PRODUCTION`（403）、`INVALID_JSON`（400）、`INTERNAL_ERROR`（500）、`UNAUTHENTICATED`（401）、`TOKEN_EXPIRED`（401）、`PERMISSION_DENIED`（403）、`SAVE_CONFLICT`（409）、`PAYLOAD_TOO_LARGE`（413）、`SLOT_LIMIT_EXCEEDED`（409）、`RATE_LIMITED`（429）、`EVENT_NOT_ACTIVE`（409）、`INVENTORY_LIMIT_EXCEEDED`（409）。

## 利用制限

ゲストの発行・スコアの投稿・セーブの操作・所持品の読み取り・イベントの一覧と報酬の受け取りは、決めた秒の窓（固定。窓の始まりは UNIX 秒を窓の長さで割り切った時刻）の中の回数を数え、上限を超えると断る。設計の正は`docs/guides/working/abuse-protection-design.md`。

| 口 | 数える単位 | 上限 |
| --- | --- | --- |
| `POST /v1/accounts/guest` | IP（`CF-Connecting-IP`。見出しが無ければ全員で 1 つ） | 60 秒に 10 回 |
| `POST /v1/accounts/guest` | ゲーム（本文の`gameId`） | 60 秒に 300 回 |
| `POST /v1/rankings/{boardId}` | プレイヤー（トークンのゲームとプレイヤー） | 60 秒に 30 回 |
| `PUT`・`GET`・`DELETE /v1/saves/{slotId}`と`GET /v1/saves` | プレイヤー（トークンのゲームとプレイヤー。4 つの操作を合わせて数え、スコアの投稿とは別に数える） | 60 秒に 60 回 |
| `GET /v1/inventory`・`GET /v1/inventory/history`・`GET /v1/events`・`POST /v1/events/{eventId}/claim` | プレイヤー（トークンのゲームとプレイヤー。報酬の操作として 4 つを合わせて数え、セーブの操作とは別に数える） | 60 秒に 60 回 |

レスポンス例（429。見出し`Retry-After: 37`）:

```json
{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}
```

- `Retry-After`は次に送ってよいまでの秒（窓の終わりまで。1〜60 の整数）。クライアントはこの秒だけ待ってから送り直す。どの単位で断ったか・上限の数は返さない。
- 断った要求も数える。断ったときは行を作らない・変えない。
- `APP_ENV`の守り（403）が先で、そのときは数えない。IP はハッシュ（SHA-256）にして数え、IP をそのまま残さない。
- 二重送信の`Idempotency-Key`の見出しは受け取って無視する（スコアは最高スコアだけ残すので、同じ要求を 2 回送っても記録と応答は同じ。回数は 2 回分数える）。

## 互換の決まり

- 要求の知らない欄は無視する（保存しない）。
- `/v1/`の中では、欄は**足すだけ**。消す・意味を変えるときは`/v2/`を足す。

## 将来予定（未実装）

| HTTP | パス案 | 用途 |
| --- | --- | --- |
| GET/POST | `/v1/messages` | 酒場掲示板 |
| GET/POST | `/v1/adventurers` | ゴースト冒険者登録・取得 |

※ 認証（ゲストのトークン）の設計の正は`docs/guides/working/account-design.md`、形の正は`openapi/rpg-online.v1.json`。
