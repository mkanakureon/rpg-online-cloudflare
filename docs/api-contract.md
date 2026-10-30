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
- 登録の無い`gameId`は**404 `NOT_FOUND`**（`message`は`Unknown game`）。その機能を使わない設定のゲームも**404 `NOT_FOUND`**（`message`は`Feature not enabled for this game`。ランキングの機能は`rankings`、お知らせは`announcements`）。お知らせ（`GET /v1/announcements`）・スコアの投稿（`POST`）も同じ。登録済みで機能を使う設定のゲームなら、ボードにデータが無くても（存在しないボードでも）**200と空の`items`**を返す。ゲームの登録と使う機能の設定はマイグレーションで入れる（`migrations/0002_games.sql`・`migrations/0003_game_modules.sql`。`demo-rpg`は登録済みで両方の機能を使う）。
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

## エラーレスポンス

```json
{"error":{"code":"INVALID_ARGUMENT","message":"Invalid parameters"}}
```

現PoCの代表コード: `INVALID_ARGUMENT`（400）、`NOT_FOUND`（404）、`NOT_READY_FOR_PRODUCTION`（403）、`INVALID_JSON`（400）、`INTERNAL_ERROR`（500）、`UNAUTHENTICATED`（401）、`TOKEN_EXPIRED`（401）、`PERMISSION_DENIED`（403）。

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
| PUT/GET | `/v1/saves/{slot}` | クラウドセーブ |

※ 認証（ゲストのトークン）の設計の正は`docs/guides/working/account-design.md`、形の正は`openapi/rpg-online.v1.json`。
