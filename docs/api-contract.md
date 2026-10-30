# 初期API仕様（検討版）

この仕様はMacでの**ローカルPoC**向け。認証はゲストのトークンだけで、ログイン・レート制限・不正対策が未実装のため、書込み系APIは公開用に使用しない。

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
- 確かめの順: `APP_ENV`の守り（403）→ トークン（本文を読む前）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`）→ トークンと本文の突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録（404 `NOT_FOUND`）→ 書き込み。
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
- 確かめの順: `APP_ENV`の守り（403）→ トークン（401。本文を読む前）→ `gameId`の形（400）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`。`message`は`Token does not match game`）→ 本文の大きさ（413）→ 本文の JSON（400 `INVALID_JSON`）→ 欄の形（400 `INVALID_ARGUMENT`）→ `data`の大きさ（413）→ チェックサム（400 `INVALID_ARGUMENT`）→ ゲームの登録と機能の設定（404 `NOT_FOUND`。機能の名前は`saves`）→ 書き込み（409 `SAVE_CONFLICT`・409 `SLOT_LIMIT_EXCEEDED`）。

## GET /v1/saves/{slotId}?gameId=demo-rpg

トークンのプレイヤーのスロットのセーブを読む。見出しは`PUT`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","slotId":"auto","revision":1,"formatVersion":1,"data":"{\"hp\":30,\"map\":\"town\"}","checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}
```

- `PUT`の応答の欄に`data`を足したもの。受け取った`data`でチェックサムを計算し直して比べると、端から端まで壊れていないことが分かる。
- そのスロットにセーブが無ければ**404 `NOT_FOUND`**（`message`は`Save not found`）。端末は`revision`を`0`と覚えて、初めての書き込みに使う。
- 読むのも`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`APP_ENV`の守り → トークン → `gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 読む。

## GET /v1/saves?gameId=demo-rpg

トークンのプレイヤーのセーブの一覧（メタデータだけ）。見出しは`PUT`と同じ`Authorization: Bearer <token>`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","items":[{"slotId":"auto","revision":3,"formatVersion":1,"checksum":"b1d7ec2a63599ea44440bea1e1f2bba35b1091ce69bf3e2ada43afea53a877ca","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}]}
```

- `items`の各行は`GET /v1/saves/{slotId}`の応答から`gameId`と`data`を除いたもの（本体を読まずに`formatVersion`・`size`・`revision`が分かる）。並びは`slotId`の昇順。最大 10 件なのでページングしない。
- 自分（トークンのプレイヤー）のスロットだけが出る。消したスロットは出ない。セーブが 1 つも無ければ**200 と空の`items`**。
- 一覧も`APP_ENV=local`の時だけ（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順は`GET /v1/saves/{slotId}`と同じ（`APP_ENV`の守り → トークン → `gameId`の形 → トークンのゲームとの突き合わせ → ゲームの登録と機能の設定 → 読む）。

## DELETE /v1/saves/{slotId}?gameId=demo-rpg&baseRevision=…

トークンのプレイヤーのスロットのセーブを消す。見出しは`PUT`と同じ`Authorization: Bearer <token>`。`baseRevision`は最後に読んだか書いたリビジョン（1 以上の整数）。

レスポンス例（200）:

```json
{"ok":true,"gameId":"demo-rpg","slotId":"auto"}
```

- `baseRevision`がいまのリビジョンと違えば**409 `SAVE_CONFLICT`**で消さない（別の端末が書いたばかりのセーブを古い画面から消さないため）。`GET`で読み直してから消し直す。
- そのスロットにセーブが無い（消した後も同じ）・他のプレイヤーのスロットは**404 `NOT_FOUND`**（`message`は`Save not found`）。`baseRevision`が無い・1 以上の整数でなければ**400 `INVALID_ARGUMENT`**。
- 消した後は`GET`が 404・一覧に出ない・スロットの数に数えない。同じスロットに`baseRevision: 0`で書き直せるが、`revision`は 1 に戻らず消す前より先へ進む（サーバーは消した印を残す）。だから消す前のリビジョンを覚えた古い端末の書き込みは 409 `SAVE_CONFLICT`になる。
- 書込み系 API なので`APP_ENV=local`の時だけ・トークンがある時だけ通る（ほかは**403 `NOT_READY_FOR_PRODUCTION`**）。確かめの順: `APP_ENV`の守り → トークン → `gameId`の形 → トークンのゲームとの突き合わせ → `baseRevision`の形（400）→ ゲームの登録と機能の設定（404）→ 消す（409・404）。

## GET /v1/config?gameId=demo-rpg&clientVersion=…

ゲームの設定（機能フラグとクライアントの版）を読む。クライアントは起動時に 1 回読む。設計の正は`docs/guides/working/config-design.md`。

レスポンス例（200）:

```json
{"gameId":"demo-rpg","clientVersion":{"minimum":"1.0.0","latest":"1.0.0","update":"none"},"flags":{"demo-flag":true}}
```

- `clientVersion`（問い合わせ）はクライアントのビルドの版。形は`1`・`1.2`・`1.2.3`（数字の区切りが 1〜3 つ。各区切り 1〜9 桁）。英字の付いた版（`1.2.3-beta`）・空の`clientVersion=`は**400 `INVALID_ARGUMENT`**（`message`は`Invalid clientVersion`）。版はドットの区切りごとに数として比べ（`1.10`は`1.9`より新しい）、足りない区切りは 0 とみなす（`1`と`1.0.0`は同じ）。
- `clientVersion.minimum`・`latest`（応答）はゲームごとの最低の版・最新の版。決まりが無ければ`null`。
- `clientVersion.update`: 送った版が最低の版より古ければ`"required"`、最新の版より古ければ`"available"`、ほか（決まりが無いときも）は`"none"`。`clientVersion`を送らなければ`"unknown"`。`"required"`でもエラーにせず 200 で設定を返す（更新の画面を出すかはクライアントが決める）。ほかの API は版で断らない。
- `flags`は機能フラグ（名前 → 真偽値。名前の昇順）。名前も意味もゲームが決め、サーバーの挙動はフラグで変わらない。無ければ`{}`。
- 応答の見出しに`ETag`（本文の SHA-256 の 16 進を`"`で囲んだもの）と`Cache-Control: no-cache`が付く。次から前の`ETag`を`If-None-Match`に付けて読むと、設定が変わっていなければ**304**（本文なし。見出しは`ETag`と`Cache-Control: no-cache`だけ）。変わっていれば 200 と新しい本文・新しい`ETag`。`If-None-Match`は`*`・`,`で区切った複数・`W/`の弱い印を受ける。エラーの応答は`no-store`のまま。
- 読むだけの API なので、**トークンは要らず、`APP_ENV`が`local`でなくても読める**（`Authorization`が付いていても見ない）。設定を書き換える API は無い。設定はマイグレーションで入れる（`migrations/0006_config.sql`。`demo-rpg`は最低の版・最新の版が`1.0.0`、フラグ`demo-flag`が`true`）。
- 設定はだれでも読めるので、**秘密（鍵・内部の URL・未発表の情報）を機能フラグに入れない**。
- 登録の無い`gameId`は**404 `NOT_FOUND`**（`message`は`Unknown game`）。設定配信の機能（`config`）を使わない設定のゲームも**404 `NOT_FOUND`**（`message`は`Feature not enabled for this game`）。確かめの順: `gameId`の形（400）→ `clientVersion`の形（400）→ ゲームの登録と機能の設定（404）→ 読む → `If-None-Match`（304）。`GET`のほかのメソッドは**404 `NOT_FOUND`**（`Endpoint not found`）。

## エラーレスポンス

```json
{"error":{"code":"INVALID_ARGUMENT","message":"Invalid parameters"}}
```

現PoCの代表コード: `INVALID_ARGUMENT`（400）、`NOT_FOUND`（404）、`NOT_READY_FOR_PRODUCTION`（403）、`INVALID_JSON`（400）、`INTERNAL_ERROR`（500）、`UNAUTHENTICATED`（401）、`TOKEN_EXPIRED`（401）、`PERMISSION_DENIED`（403）、`SAVE_CONFLICT`（409）、`PAYLOAD_TOO_LARGE`（413）、`SLOT_LIMIT_EXCEEDED`（409）。

## 互換の決まり

- 要求の知らない欄は無視する（保存しない）。
- `/v1/`の中では、欄は**足すだけ**。消す・意味を変えるときは`/v2/`を足す。

## 将来予定（未実装）

| HTTP | パス案 | 用途 |
| --- | --- | --- |
| GET | `/v1/events` | 期間限定クエスト一覧 |
| POST | `/v1/events/{id}/progress` | 進捗・報酬判定 |
| GET/POST | `/v1/messages` | 酒場掲示板 |
| GET/POST | `/v1/adventurers` | ゴースト冒険者登録・取得 |

※ 認証（ゲストのトークン）の設計の正は`docs/guides/working/account-design.md`、形の正は`openapi/rpg-online.v1.json`。
