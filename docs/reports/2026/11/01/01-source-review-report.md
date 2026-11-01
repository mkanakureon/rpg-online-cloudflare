# ソースコード全体のレビュー（2026-11-01 時点の main）

継ぎ足しで機能を足してきたコードを、まとめて読み直した記録。日付つきの記録なので、ここに書いた行番号・数は書いた時点のもの。

## 1. 対象と確かめ方

| 項目 | 内容 |
|---|---|
| 対象 | `main`（`d7021a3`）の `src/`（3,492 行）・`migrations/`（0001〜0019）・`scripts/` の CLI。いまのブランチ `tmp-b-chain` の偽のコミット（B1・B2）は対象外 |
| 読んだもの | `src/` の全ファイル・全マイグレーション。`scripts/` と `test/` は構成と数だけ |
| 実行 | main の写しで `node scripts/test.mjs` → **`Result: PASS 367/367`**。`npm run typecheck` → 誤りなし |
| 実測した欠陥 | §3.1 は一時の試験で測った（試験のファイルは消した） |

参考: `tmp-b-chain` の作業ツリーでは `Result: FAIL (395/396)`。落ちたのは `test/bans.test.ts` の「O2 スキーマ > PLAYER_BANNEDの応答はスキーマに合う」で、偽の B2 が OpenAPI に `refreshToken` を足したのに試験の一覧が追いついていないため。main の欠陥ではない。

## 2. 全体の評価

土台の決まりは最後まで守られている。

- **入出力と論理の分離**が効いている。`period.ts`・`analytics.ts`・`rate-limit.ts`・`validate.ts` などはふつうの関数で、試験しやすい。
- **書き込みの原子性**の作りが一貫している。「1 文目で記録の行（監査の行・受け取りの行・書き込みの記録）を条件つきで入れ、続く文は `EXISTS (... ref = ?)` のときだけ書く」1 つの batch で、二重の止めと「片方だけ残る」を防いでいる。
- **SQL はどれも `prepare().bind()`**。文に埋める値は定数（`LEDGER_SOURCES`・`RETENTION_OFFSETS`・表の名前）だけ。
- **エラーの形**（`{ error: { code, message } }`）と、DB のエラーを `INTERNAL_ERROR` に包む入口の `try/catch` が 1 か所。
- **`APP_ENV=local` の門**が書き込みの口・トークンの口・管理の口・掃除の全部にかかっている。

一方、継ぎ足しの跡は主に次の 3 つに出ている。

1. 機能ごとに**同じ手続きを写している**（§4）。
2. **ファイルの頭書き・マイグレーションの注記が古いまま**のものがある（§5）。
3. 後から足した機能が、先に作った口の**上限の前提を崩した**所がある（§3.1）。

## 3. 欠陥

### 3.1 イベントの一覧が、開いているイベントが 50 個以上で 500 になる（実測）

- 場所: `src/modules/events/index.ts:117-122`
- 一覧は受け取りの有無を `(event_id = ? AND period_key = ?) OR ...` で引き、引数が `2 + 2 × 開いているイベントの数` になる。D1 の 1 文の引数の上限は 100。
- 管理の口 `PUT /v1/admin/events/{eventId}` にはイベントの数の上限が無い（クエストには `MAX_QUESTS = 200` がある）。管理の人の操作だけで、全プレイヤーの一覧が落ちる状態にできる。
- 測った結果:

  ```text
  PROBE n=49 status=200 {"gameId":"probe-49",...}
  Unhandled Worker error Error: D1_ERROR: too many SQL variables at offset 1948: SQLITE_ERROR
  PROBE n=50 status=500 {"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}
  ```

- `docs/guides/working/architecture.md` §3 の「一覧：ページング／件数上限を必須とする。PoCは最大50件」にも合っていない（イベントの一覧に件数の上限が無い）。
- 直し方の案（推し）: クエストの一覧と同じ形にする。いまの区切りの鍵は種類が少ないので `period_key IN (重ならない鍵)` で引き、JS 側でイベントと突き合わせる。あわせて管理の口に `MAX_EVENTS`（`MAX_QUESTS` と同じ 200）を足し、一覧の件数の上限を決める。

### 3.2 ランキングの同点の順が、低いスコアを出し直すと後ろへ下がる（読みで確認）

- 場所: `src/modules/rankings/index.ts:74-81`
- 並びは `score DESC, updated_at ASC`（先に取った人が上）。しかし `ON CONFLICT` はスコアが上がらないときも `updated_at = datetime('now')` と `display_name` を書き換える。
- 例: A が 100 点を先に、B が 100 点を後で出す → A が上。その後 A が 50 点を出す → A のスコアは 100 のままだが `updated_at` が新しくなり、B より下になる。
- 直し方の案: `updated_at` はスコアが上がったときだけ進める（`updated_at = CASE WHEN excluded.score > ranking_entries.score THEN datetime('now') ELSE ranking_entries.updated_at END`）。表示名を毎回書き換えるかは契約で決める。
- `updated_at` は秒の単位なので、同じ秒の同点は `player_id` の順になる。これは今の契約どおり。

## 4. 継ぎ足しで増えた重複（直すと得なもの）

| 重複 | 写しの数と場所 | まとめ先の案 |
|---|---|---|
| トークンの口の確かめ `checkAccess`（門 → トークン → 利用制限 → BAN → gameId → トークンのゲーム → 登録と設定） | 5（saves・inventory・events・player-data・quests）。違いは利用制限の決まりとモジュールの名前だけ。saves だけ `requireGame` を後で呼ぶ | `src/core/player-access.ts` に `requirePlayerAccess(req, env, url, { rule, module, known })` を 1 つ |
| SHA-256 の 16 進 | 5（`core/idempotency.ts`・`modules/saves/checksum.ts`・`modules/config/etag.ts`・`core/rate-limit.ts` の `ipSubject`・`core/admin/key.ts`） | core の `sha256Hex` 1 つ。モジュールから core は読み込めるので、「モジュールどうしを読み込まない」決まりとはぶつからない |
| `isoSeconds`（UNIX 秒 → ISO の秒まで） | 3（`core/period.ts`・`modules/inventory/shape.ts`・`core/admin/audit.ts`） | `core/period.ts` の 1 つ（または `core/time.ts`） |
| `serverNow()`・`Math.floor(Date.now() / 1000)` | 関数で 4（events・player-data・quests・admin）、直書きで 6 か所ほど | `core/time.ts` の `nowSeconds()` |
| ID の昇順の比べ `(a < b ? -1 : a > b ? 1 : 0)` | 5 か所以上 | `core` の `compareIds` |
| `positiveInteger`・`limit`/`before` の読み取り | `parseHistoryQuery` と `parseAuditQuery` が同じ中身 | `parsePageQuery(url, default, max)` 1 つ |
| 報酬の受け取りの 3 文（受け取りの行・履歴・残高）と `grantsFrom` | 2（events・quests）。違いは条件（期間・達成）だけ | 設計書（quest-design.md §6）が「移さない」と決めているので、いまは残す。3 つ目（例: 購入）を足すときに見直す |
| 「監査の行を 1 文目にして続く文を条件つきにする」形 | 管理の書き込みの口 11 個（`core/admin/routes.ts` 787 行） | 口の区分ごとにファイルを分ける（players・definitions・player-data・analytics）。監査の行の文の組み立ては今のままでよい |

上の 1〜4 行目は挙動を変えないまとめで、試験の合否で確かめられる。

## 5. 古くなった注記

コードと合っていない頭書き・注記。挙動には影響しないが、読む人とエージェントを誤らせる。

| 場所 | 書いてあること | いまの実装 |
|---|---|---|
| `src/core/module.ts:16` | `name` は `'announcements' \| 'rankings' \| 'saves'` | モジュールは 8 つ |
| `src/core/bans.ts:3` | BAN の確かめを呼ぶのは「4 つのモジュール（rankings・saves・inventory・events）」 | player-data・quests を加えた 6 つ |
| `src/core/rate-limit-policy.ts:5-7` | `scope` の使い手の列挙 | 合っているが、`guest-ip`・`guest-game`・`score` の使い手が抜けている |
| `docs/guides/working/architecture.md` §3 の「利用制限」 | 数える口の列挙 | クエストの 2 つの口が抜けている |
| `migrations/0010_events.sql` の event_rewards の注記 | `MAX_REWARD_LINES` は `src/modules/events/limits.ts` | そのファイルは無い。`src/core/inventory.ts` |
| `migrations/0009_inventory.sql` の inventory_ledger の注記 | `delta` は付与だけ・`source_type` は後から `'quest'`・`'admin'` | 管理の増減で負の数を書く。名前は `'quest-claim'` |
| `migrations/0011_admin.sql` の `action`・`target` の注記 | 6 種類 | 11 種類（キー・実績・値・取り消し・クエストが増えた） |
| `migrations/0008_rate_limits.sql` の `scope` の注記 | 4 種類 | 8 種類 |

マイグレーションは書き換えない決まりなので、0008〜0011 の注記の誤りは直さない。正しい値は `src/core/` の定数と設計書が持つ、と各設計書に 1 行あれば足りる。

## 6. 設計のゆれ（決めることの候補）

1. **時刻の持ち方が 3 種類**ある。`datetime('now')` の文字列（games・accounts・game_players・ranking_entries）、ミリ秒つき ISO の文字列（saves）、UNIX 秒の整数（ほかの全部）。応答は ISO にそろっているが、管理の口は `strftime` で直している。新しい表は UNIX 秒にそろえる、と決めて書いておく（既存の表は動かさない）。
2. **ゲストのアカウントが消えない。** `accounts`・`game_players` は掃除の対象外で、トークン（30 日）が切れた後も残る。発行の口は認証が無く、IP ごとに 1 分 10 回まで作れる。保持の日数を決めるか、残す理由を analytics-design.md §6 に書く。
3. **Idempotency-Key の効く期間が 30 日。** `player_data_writes` を 30 日で消すので、31 日目に同じ鍵で送り直すと二重に書く。クライアントの再試行は数分の話なので実害は小さいが、契約（api-contract.md）に期間を書く。
4. **トークンの口は 1 回の要求で DB を 3〜4 往復**する（利用制限と遊んだ記録の batch → BAN → ゲームの登録 → 本体）。BAN の確かめを利用制限の batch に入れれば 1 往復減る。いまの規模では問題にならないので、測ってから決める。
5. **`requireLocalWrite` を読み取りの口にも使っている**（inventory・events・quests の GET など）。挙動は正しいが名前と合わない。`requireLocalOnly` などへ名前を変えるかは好み。
6. **セーブの本文の大きさの確かめ**（`src/modules/saves/index.ts:85-91`）は `Content-Length` が数でないときに素通りし、本文を全部読んでから比べる。Workers の要求の上限（100 MB）の内なので実害は小さい。
7. **管理の `PUT .../ban` の応答だけ `auditId` が無い**（ほかの書き込みの口は返す）。
8. **イベントの一覧は、呼ぶたびにそのゲームの全イベントの報酬を読む**（`src/modules/events/index.ts:38`・`114`。開いているイベントに絞っていない）。クエストの一覧も同じ形。§3.1 を直すときに一緒に絞れる。
9. **`announcements` と `ranking_entries` だけ `games` への外部キーが無い**（0001 で作った表。0002 以降の表は `ON DELETE CASCADE` を持つ）。ゲームの行を消しても、この 2 つの表の行は残る。
10. **解いた実績の `write_ref` が、30 日後に指す先を失う。** `player_achievements.write_ref` は `player_data_writes` の行を指すが、その表は 30 日で消える。管理のプレイヤーの口が返す `writeId` は、その後は引けない ID になる。応答を引くのは同じ batch の中だけなので、プレイヤー向けの挙動は壊れない。
11. **ランキングのボードは登録が要らない。** `boardId` の形さえ合えば、投稿で新しいボードができる。設計どおりか、ボードを宣言させるかは決めていない。
12. **パスは合ってメソッドが違うときも 404**（405 にしない）。`src/core/router.ts` の頭書きに書いてある決まりどおりで、欠陥ではない。

## 7. 直す順の推し

| 順 | 内容 | 大きさ | 確かめ |
|---|---|---|---|
| 1 | §3.1 イベントの一覧の引数の上限（一覧の引き方を変える＋`MAX_EVENTS`） | 小 | 開いているイベント 50 個で 200 になる試験を足す |
| 2 | §3.2 ランキングの同点の順 | 小 | 先に取った人が低いスコアを出し直しても上のままの試験を足す |
| 3 | §5 の `src/` と `architecture.md` の古い注記 | 小 | なし（文書） |
| 4 | §4 の 1〜4 行目のまとめ（`requirePlayerAccess`・`sha256Hex`・時刻の手伝い・比べ） | 中 | 既存の 367 本が通ること |
| 5 | §4 の `core/admin/routes.ts` の分割 | 中 | 既存の試験が通ること |
| 6 | §6 の決めること（時刻の持ち方・アカウントの保持・鍵の期間） | — | ユーザーが決める |

1 と 2 は欠陥で、契約の挙動を変える。3〜5 は挙動を変えない。
