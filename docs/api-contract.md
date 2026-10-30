# 初期API仕様（検討版）

この仕様はMacでの**ローカルPoC**向け。認証が未実装のため、書込み系APIは公開用に使用しない。

形（欄・型・範囲・状態コードとエラーコードの組）の正はスキーマ（`openapi/rpg-online.v1.json`）、挙動の説明の正はこの文書。

## GET /health

レスポンス例（200）:

```json
{"status":"ok","service":"rpg-online-backend"}
```

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
- `npm run dev`でローカル実行し`APP_ENV=local`を与えた時のみ書込み可能。本番では適切な認証、本人確認、データ検証が必要。

## エラーレスポンス

```json
{"error":{"code":"INVALID_ARGUMENT","message":"Invalid parameters"}}
```

現PoCの代表コード: `INVALID_ARGUMENT`（400）、`NOT_FOUND`（404）、`NOT_READY_FOR_PRODUCTION`（403）、`INVALID_JSON`（400）、`INTERNAL_ERROR`（500）。

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

※ HTTP認証方式と詳細スキーマはPhase 1で確定させる。
