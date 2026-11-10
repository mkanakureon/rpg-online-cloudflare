# セーブ（スロット・リビジョン・チェックサム・形式の版）の設計書

`docs/guides/decisions/roadmap.md` Phase 1 の「セーブ：スロット・リビジョンによる競合の検出・チェックサム・形式の版」の設計書。

セーブの置き場（D1 か R2 か）・API（書く・読む・一覧・消す）・リビジョンによる楽観的な排他（競合は 409）・チェックサム・形式の版・大きさの上限・認証・機能の設定（`game_modules`）への足し方・CLI モックの変え方・確かめ方（試験の名前）・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`）・`docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・`games`・`game_modules`・`requireGame`）・`docs/guides/working/account-design.md`（`requireAuth`・トークン `v1.<本文>.<HMAC>` の `g`・`p`・`PERMISSION_DENIED`・`APP_ENV` の守り）。`tenant_id` を持たない・機能の設定は認可の代わりにしない・登録の無いゲームは 404・本文の ID がトークンと違えば 403 `PERMISSION_DENIED`、は決め直さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§7 の試験の名前を `requireTests` に渡して実装の Issue を V1・V2 の順に回し、**ゲストのトークンを付けて自分のスロットにセーブを書くとリビジョンが返り、読み直すと同じ本体・形の版・チェックサムが返り、古いリビジョンからの書き込みは 409 で断られて上書きされず、他のプレイヤーのセーブには触れられず、CLI モック（`scripts/cli-mock.mjs`）がゲストの発行からセーブの読み書きまでを通せる**のを見て、複数の端末から書いても黙って消えないクラウドセーブが、ゲームの中身を知らない共通のサーバーにできたと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§10 に決めること（案と推し）、§11 に実装の束がある | 機械（Issue #20 の確認コマンド） |
| ADR 0002・`core-foundation-design.md`・`account-design.md`・`game_modules`・`src/modules/saves`・`requireAuth`・`Authorization`・`APP_ENV`・`scripts/cli-mock.mjs`・409・リビジョン・チェックサム・スロット・形式の版が出てくる。置き場の案に D1 と R2 が出てくる | 機械（同上） |
| 機能の一覧や名前の中の数で挙動が変わりうる既存の試験 3 本と、互換を見張る `今のCLIモックと同じ形の要求を受け付ける` に名前で触れている（§8） | 機械（同上） |
| §7 の表の束は `V1`・`V2` だけ・名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§11） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/`・`test/`・`migrations/` の下を除く） | 機械（同上） |
| サーバーがセーブの中身を解釈しない（§2）。読むのも書くのもトークンが要り、他のプレイヤーのセーブを指す方法が無い（§4）。`APP_ENV` の守りを外さない。挙動の変わる既存の試験が §8 に全部挙がり、`docs/guides/decisions/test-plan.md` §11 の手続きで直す形になっている | AI の判定（作っていない判定役が、§2〜§8 と `src/`・`test/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§11 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- V1・V2 はスコアの投稿・お知らせ・ランキング・ゲストの発行の挙動を変えない。§8 に挙げた試験のほかは、いまの試験を 1 行も変えずに通す。
- `今のCLIモックと同じ形の要求を受け付ける` は名前も中身も変えず、全部の束で通す（§8）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束。R2 を足さない）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

`src/`・`migrations/`・`test/`（2026-10-30 の main `8ac12cf`）を読んで確かめた。

| 所 | いま |
| --- | --- |
| 機能の名前 | `src/modules/index.ts` の `modules = [announcements, rankings]`。ルーターが `known` として `requireGame` に渡す |
| ルートの型 | `src/core/module.ts` の `Route.method` は `'GET' \| 'POST'` だけ。ルーターはメソッドとパスの両方が合うルートを上から当て、無ければ 404 `Endpoint not found`（405 にしない） |
| 認証 | `src/core/auth.ts` の `requireAuth(req, env, now)`（`Authorization: Bearer` を確かめ、401 `UNAUTHENTICATED`・`TOKEN_EXPIRED`。DB を引かない）と `requireSamePlayer`（403 `PERMISSION_DENIED`）。トークンの中身は `{ gameId, playerId, exp }` |
| 守り | `src/core/guards.ts` の `requireLocalWrite`: `APP_ENV !== 'local'` なら 403 `NOT_READY_FOR_PRODUCTION`。書き込みのルートは本文を読む前に呼ぶ |
| 表 | `announcements`・`ranking_entries`（`0001`）・`games`（`0002`）・`game_modules`（`0003`。`0003` は既存のゲームに `announcements`・`rankings` の行を入れる）・`accounts`・`game_players`（`0004`） |
| 環境 | `src/core/env.ts` の `Env = { DB; APP_ENV; AUTH_TOKEN_SECRET? }`。`Statement` は `bind`・`all`・`run`。`wrangler.jsonc` に D1 の `DB` だけ（R2・KV は無い） |
| エラーコード | 8 つ（`INVALID_ARGUMENT`・`NOT_FOUND`・`NOT_READY_FOR_PRODUCTION`・`INVALID_JSON`・`INTERNAL_ERROR`・`UNAUTHENTICATED`・`TOKEN_EXPIRED`・`PERMISSION_DENIED`） |
| スキーマの操作 | 5 つ（`getHealth`・`listAnnouncements`・`getRanking`・`submitScore`・`issueGuest`） |
| 契約の「将来予定」 | `docs/api-contract.md` の表に `PUT/GET` `/v1/saves/{slot}`（クラウドセーブ） |
| CLI モック | `scripts/cli-mock.mjs` が `/health` → お知らせ → ゲストの発行 → トークン付きのスコアの投稿 → ランキングの `GET`。本文と見出しは `scripts/cli-requests.mjs`（`guestRequest`・`authHeaders`・`scoreSubmission`。型は `scripts/cli-requests.d.mts`） |

元の文書から引く決まり:

- 構想の §5「セーブデータは共通化の効果が特に大きい」（`docs/inspecs/2026/10/` の人が書いた入力。読むだけ）: 共通のサーバーが持つのは、ゲーム・プレイヤー・スロットの識別・セーブ形式の版・本体とチェックサム・更新時刻とリビジョン・競合とバックアップの情報で足りる。複数の端末からの同時の保存はリビジョンの楽観的な排他で扱う。ゲームの版が変わったときの移し替えも API の契約に入れる。
- 構想の §6「Cloudflare の使い分け」: D1 はアカウント・ゲーム情報・ランキング（必須）、R2 は大きなセーブ・共有データ・ファイル（必要時）。D1 にあらゆる処理を集中させない。
- ADR 0002: ゲーム固有のルールを共通のサーバーに入れない。共通にするのはセーブのような仕組みだけ。作る順はアカウント → セーブ。
- `docs/guides/decisions/operations-security.md` の 8（セーブの競合と容量の制限を決める）と、ログの「トークンやセーブの本文など機密データは記録しない」。

### Cloudflare の上限（2026-10-30 に公式の文書で確かめた）

| 何の | 上限 | 出どころ |
| --- | --- | --- |
| D1 の 1 データベース | 10 GB（Workers Paid）・500 MB（Free） | developers.cloudflare.com/d1/platform/limits/ |
| D1 の文字列・BLOB・1 行 | 2,000,000 バイト | 同上 |
| D1 の SQL の文の長さ | 100,000 バイト | 同上 |
| D1 の 1 つの問い合わせのパラメータ | 100 個 | 同上 |
| Workers の要求の本文 | 100 MB（Free・Pro のゾーン） | developers.cloudflare.com/workers/platform/limits/ |
| Workers の isolate のメモリ | 128 MB | 同上 |
| R2 の 1 オブジェクト | 5 TiB（1 回の PUT は 5 GiB。Worker を通すと要求の本文の上限が先に効く） | developers.cloudflare.com/r2/platform/limits/ |

**要確認**: `bind()` で渡したパラメータの値が D1 の「SQL の文の長さ 100,000 バイト」に数えられるか（公式の文書の表からは読み取れなかった）。§10 の決めること 2 で上限を 64 KiB にしたのは、数えられても収まるため。

## 2. データの形（V1）

### サーバーが持つもの・持たないもの

サーバーは本体（`data`）を**解釈しない**（ADR 0002）。JSON として読まない・欄を見ない・中身で弾かない。持つのは次だけ（Issue の「識別・形式の版・本体・チェックサム・リビジョン・時刻」に、`data` から数えるだけの `size` と、消したことの印 `deleted` を足した。どちらも中身を解釈しない。`size` は大きさの上限と一覧で本体を読まずに大きさを見せるため、`deleted` は §3 の削除でリビジョンを戻さないため）:

| 項目 | API の欄 | 表の列 | 意味 |
| --- | --- | --- | --- |
| ゲーム | `gameId` | `game_id` | トークンの `g` と同じ |
| プレイヤー | （送らない） | `player_id` | トークンの `p`。要求の本文にもパスにも書かない（§4） |
| スロット | パスの `{slotId}` | `slot_id` | `src/core/ids.ts` の `idPattern`（1〜64 文字）。名前はゲームが決める（`auto`・`1` など） |
| 形の版 | `formatVersion` | `format_version` | 1〜2147483647 の整数。意味はゲームが決める。サーバーは保存して返すだけ |
| 本体 | `data` | `data` | 文字列（§10 の決めること 3）。UTF-8 で `MAX_SAVE_BYTES` まで |
| チェックサム | `checksum` | `checksum` | `data` の UTF-8 のバイト列の SHA-256 を小文字の 16 進 64 文字（§5） |
| 大きさ | `size` | `size` | `data` の UTF-8 のバイト数（サーバーが数える） |
| リビジョン | `revision`（書くときは `baseRevision`） | `revision` | 1 から始まり、書くたびに 1 つ進む整数（§3） |
| 時刻 | `updatedAt` | `updated_at` | サーバーの時刻（UTC・ISO 8601・ミリ秒つき）。クライアントの時刻は受け取らない |

### 表（`migrations/` の新しい番号 `0005_saves.sql`）

```sql
CREATE TABLE IF NOT EXISTS saves (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                     -- game_players.player_id（トークンの p）。外部キーは付けない
  slot_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  format_version INTEGER NOT NULL,
  data TEXT NOT NULL,
  checksum TEXT NOT NULL,
  size INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),  -- 1 は消した印（墓石）。V2 の削除で使う
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (game_id, player_id, slot_id)
);
-- それまでに登録したゲームは saves を使う設定にする（0003 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'saves' FROM games;
```

- `games(game_id)` の `ON DELETE CASCADE` は `0003`・`0004` と同じ理由（ゲームの行だけを消す `test/games.test.ts` の `beforeEach` が外部キーで断られないため）。
- `player_id` に `game_players` への外部キーを付けない。トークンは自己完結で `requireAuth` は DB を引かない（`account-design.md` §5）ので、行の無いプレイヤーのトークン（試験の手伝い `test/support/auth.ts` の `tokenFor('demo-rpg', 'p1')` など）で書くと、外部キーの失敗が 500 になるため。`ranking_entries.player_id` と同じ扱い。
- `deleted` は V2 の削除のための列だが、V1 の `0005` で作る（V2 でマイグレーションを足さない）。消すときは行を消さず、`deleted = 1`・`data = ''`・`checksum = ''`・`size = 0` にしてリビジョンを 1 つ進める（墓石）。行を消してリビジョンを 1 からやり直すと、消す前のリビジョンを覚えた端末の書き込みが、書き直された別の版に黙って当たる（消す → 書き直す → 同じ数のリビジョンまで進む → 古い端末の `baseRevision` が合ってしまう）ため。読む・一覧・スロットの数は `deleted = 0` の行だけを見る。墓石は使ったことのあるスロットの名前の数だけ残る（1 行の大きさは `data` が空で小さい）。スロットの名前はクライアントが決めるので、名前を変えて書いては消すと墓石は増える。そこで墓石も数えた行に上限 `MAX_SAVE_ROWS`（100。`src/modules/saves/limits.ts`）を置く。新しい名前の書き込み（その名前の行が無く、消していないスロットが `MAX_SLOTS` 未満）で行が上限に届いていたら、同じ `batch` でそのプレイヤーの一番古い墓石（`updated_at`、同じなら `slot_id` の昇順）を 1 つ消してから書く（使い回し。§3）。生きているスロットは消さず、新しい行が入らない書き込み（409・墓石への書き直し・上書き）は墓石を消さない。使い回された名前に後で書くとリビジョンは 1 から（古い端末の守りが外れるのは、100 個前に消した名前だけ）。決めた経緯は `hardening-design.md` §2.2（G6）。
- 主キーが「ゲーム・プレイヤー・スロット」なので、一覧（§3）は主キーの頭で引ける。索引を足さない。
- `INSERT OR IGNORE` と `IF NOT EXISTS` だけなので、2 回当てても壊れない（`マイグレーションを2回当ててもデータは壊れない` は変わらない）。

### 定数（`src/modules/saves/limits.ts` の 1 か所）

| 名前 | 値 | 理由 |
| --- | --- | --- |
| `MAX_SAVE_BYTES` | 65,536（64 KiB） | §10 の決めること 2 |
| `MAX_REQUEST_BYTES` | `MAX_SAVE_BYTES * 6 + 1024`（394,240 バイト） | 本文を読む前に断る上限。JSON の文字列の逃がしで `data` が膨らむ最悪（制御文字の 1 バイトが `\u00XX` の 6 バイト）と、ほかの欄の分を見込む。これより大きい本文の `data` は必ず `MAX_SAVE_BYTES` を超えるので、正しいセーブを 413 にしない |
| `MAX_SLOTS` | 10（1 プレイヤー・1 ゲームあたり） | §10 の決めること 5 |
| `MAX_SAVE_ROWS` | 100（1 プレイヤー・1 ゲームあたり。墓石も数えた行） | §2 の墓石の使い回し（`hardening-design.md` §2.2 の G6） |

### モジュールのファイル（`src/modules/saves/`）

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/modules/saves/limits.ts` | 上の定数 | V1 |
| `src/modules/saves/validate.ts` | ふつうの関数: `parseSaveWrite(value)`（本文の形）・`utf8Size(text)`・`parseRevision(raw)`（V2 の削除の `baseRevision`） | V1（`parseRevision` は V2） |
| `src/modules/saves/checksum.ts` | `sha256Hex(text)`（`crypto.subtle.digest('SHA-256', …)`。パッケージを足さない） | V1 |
| `src/modules/saves/index.ts` | `saves: GameModule`（`name: 'saves'`）のルートと SQL | V1（一覧と削除は V2） |
| `src/modules/index.ts` | `modules = [announcements, rankings, saves]` | V1 |
| `src/core/module.ts` | `Route.method` に `'PUT' \| 'DELETE'` を足す（ルーターは変えない） | V1 |

## 3. API（V1: 書く・読む。V2: 一覧・消す）

どれも `gameId` は問い合わせ文字列で渡し、トークンの `g` と同じでなければ 403 `PERMISSION_DENIED`。プレイヤーはトークンの `p` だけで決まり、要求に書く欄が無い（§4）。応答の見出しは `src/core/http.ts` の `json` のまま（`cache-control: no-store`）。

### `PUT /v1/saves/{slotId}?gameId=demo-rpg`（V1）

要求（見出し `Authorization: Bearer <token>`・`Content-Type: application/json`）:

```json
{"formatVersion":1,"data":"{\"hp\":30,\"map\":\"town\"}","checksum":"<data の SHA-256 の 16 進>","baseRevision":0}
```

- `baseRevision`: クライアントが最後に読んだか書いたリビジョン。**まだセーブが無いスロットに初めて書くときは `0`**。
- 知らない欄は無視する（保存しない。`docs/api-contract.md` の互換の決まり）。

応答（200）:

```json
{"gameId":"demo-rpg","slotId":"auto","revision":1,"formatVersion":1,"checksum":"…","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}
```

検査の順（上から。最初に当たったもので返す）:

| # | 確かめ | 外れたとき |
| --- | --- | --- |
| 1 | ルート（`^/v1/saves/([a-zA-Z0-9_-]{1,64})$` と `PUT`） | 404 `NOT_FOUND`（`Endpoint not found`） |
| 2 | `requireLocalWrite(env)` | 403 `NOT_READY_FOR_PRODUCTION` |
| 3 | `requireAuth(req, env)` | 401 `UNAUTHENTICATED`・`TOKEN_EXPIRED`（鍵が無ければ 500） |
| 4 | トークンのプレイヤーの利用制限 `consume(env.DB, RATE_LIMITS.saves, '<g>:<p>')`（4 つの操作を合わせて数える。`abuse-protection-design.md`） | 429 `RATE_LIMITED`（`Retry-After`） |
| 5 | 問い合わせの `gameId` が `validId` | 400 `INVALID_ARGUMENT`（`Invalid gameId`） |
| 6 | `gameId` がトークンの `g` と同じ | 403 `PERMISSION_DENIED`（`Token does not match game`） |
| 7 | `Content-Length` があれば `MAX_REQUEST_BYTES` 以下 | 413 `PAYLOAD_TOO_LARGE`（本文を読まない） |
| 8 | `req.text()` のバイト数が `MAX_REQUEST_BYTES` 以下 | 413 `PAYLOAD_TOO_LARGE` |
| 9 | 本文が JSON | 400 `INVALID_JSON` |
| 10 | `parseSaveWrite`: オブジェクトで、`formatVersion` が 1〜2147483647 の整数・`data` が文字列・`checksum` が `^[0-9a-f]{64}$`・`baseRevision` が 0 以上の安全な整数 | 400 `INVALID_ARGUMENT`（どの欄かを `message` に） |
| 11 | `utf8Size(data) <= MAX_SAVE_BYTES` | 413 `PAYLOAD_TOO_LARGE` |
| 12 | `sha256Hex(data) === checksum` | 400 `INVALID_ARGUMENT`（`checksum does not match data`） |
| 13 | `requireGame(env, gameId, 'saves', known)` | 404 `NOT_FOUND`（`Unknown game`・`Feature not enabled for this game`） |
| 14 | 書き込み（下の SQL） | 409 `SAVE_CONFLICT`・409 `SLOT_LIMIT_EXCEEDED`（V2）。DB の失敗は 500 `INTERNAL_ERROR` |

- 2〜4 は本文を読む前（`account-design.md` §5 と同じ理由: 認証されていない要求の本文を読まない）。6 も本文を読む前に決まる。4 で断った書き込みは、リビジョンを進めず行を変えない。
- 7・8 は大きな本文を JSON として読む前に断る（Workers のメモリ 128 MB を、大きな本文の繰り返しで使い切らせない）。

書き込みの SQL（1 つの文で、比べることと書くことを同時にする。D1 の問い合わせは 1 つずつ順に動くので、文の中は割り込まれない）:

- `baseRevision = 0`（初めて。行が無いか、墓石の行）:

  ```sql
  INSERT INTO saves (game_id, player_id, slot_id, revision, format_version, data, checksum, size)
  SELECT ?, ?, ?, 1, ?, ?, ?, ?
  WHERE (SELECT COUNT(*) FROM saves WHERE game_id = ? AND player_id = ? AND deleted = 0) < ?   -- MAX_SLOTS（V2。V1 は WHERE true）
  ON CONFLICT (game_id, player_id, slot_id) DO UPDATE SET
    revision = saves.revision + 1, deleted = 0, format_version = excluded.format_version, data = excluded.data,
    checksum = excluded.checksum, size = excluded.size, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE saves.deleted = 1
  RETURNING revision, updated_at
  ```

  この文の前に、同じ `batch` で墓石の使い回しの文を流す（§2。`?1` gameId・`?2` playerId・`?3` slotId・`?4` `MAX_SAVE_ROWS`・`?5` `MAX_SLOTS`）:

  ```sql
  DELETE FROM saves WHERE game_id = ?1 AND player_id = ?2 AND slot_id = (
      SELECT slot_id FROM saves WHERE game_id = ?1 AND player_id = ?2 AND deleted = 1 ORDER BY updated_at, slot_id LIMIT 1)
    AND NOT EXISTS (SELECT 1 FROM saves WHERE game_id = ?1 AND player_id = ?2 AND slot_id = ?3)
    AND (SELECT COUNT(*) FROM saves WHERE game_id = ?1 AND player_id = ?2) >= ?4
    AND (SELECT COUNT(*) FROM saves WHERE game_id = ?1 AND player_id = ?2 AND deleted = 0) < ?5
  ```

  消すのは、続く `INSERT` が新しい行を入れるときだけ（その名前の行が無く、消していないスロットが `MAX_SLOTS` 未満）。`batch` なので、消すことと書くことは両方通るか、どちらも入らない。

  墓石の行に書き直すときはリビジョンを墓石の次へ進める（1 に戻さない。§2）。生きている行があれば `DO UPDATE` の `WHERE` で何もしない。行が返らなければ、そのスロットに `deleted = 0` の行があるかを引き、あれば 409 `SAVE_CONFLICT`、無ければ 409 `SLOT_LIMIT_EXCEEDED`（V2）。V1 には墓石が無い（消す API が無い）ので、`DO UPDATE` に当たることは無いが、V2 で SQL を変えずに済むよう V1 から同じ文にする。

- `baseRevision >= 1`:

  ```sql
  UPDATE saves SET revision = revision + 1, format_version = ?, data = ?, checksum = ?, size = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE game_id = ? AND player_id = ? AND slot_id = ? AND revision = ? AND deleted = 0
  RETURNING revision, updated_at
  ```

  行が返らなければ 409 `SAVE_CONFLICT`（リビジョンが違う・スロットに行が無い・消されている、のどれも）。

- `RETURNING` を `.all()` で受けるので、`src/core/env.ts` の `Statement` の型を変えない。D1 が `RETURNING` を通すかは V1 の L2 の試験（Miniflare の D1）で確かめる。通らなければ `run()` の後に `SELECT` で引く形に設計を直してから実装する（design-cycle §3）。

### `GET /v1/saves/{slotId}?gameId=demo-rpg`（V1）

応答（200）: `PUT` の応答の欄に `data` を足したもの。

```json
{"gameId":"demo-rpg","slotId":"auto","revision":1,"formatVersion":1,"data":"{\"hp\":30,\"map\":\"town\"}","checksum":"…","size":22,"updatedAt":"2026-10-30T12:00:00.000Z"}
```

検査の順: 1 ルート（404）→ 2 `requireLocalWrite`（403。§10 の決めること 8）→ 3 `requireAuth`（401）→ 4 プレイヤーの利用制限（429 `RATE_LIMITED`）→ 5 `gameId`（400）→ 6 トークンの `g`（403）→ 7 `requireGame(…, 'saves', …)`（404）→ 8 `SELECT … WHERE game_id = ? AND player_id = ? AND slot_id = ? AND deleted = 0`。行が無ければ 404 `NOT_FOUND`（`Save not found`）。

### `GET /v1/saves?gameId=demo-rpg`（V2）

自分（トークンの `p`）のスロットのメタデータの一覧。`data` は入れない（一覧を軽くする）。`deleted = 0` の行だけ。並びは `slot_id` の昇順。最大 `MAX_SLOTS` 件なのでページングしない。

```json
{"gameId":"demo-rpg","items":[{"slotId":"auto","revision":3,"formatVersion":1,"checksum":"…","size":22,"updatedAt":"…"}]}
```

検査の順は `GET /v1/saves/{slotId}` の 1〜7 と同じ。セーブが 1 つも無ければ 200 と空の `items`。

### `DELETE /v1/saves/{slotId}?gameId=demo-rpg&baseRevision=3`（V2）

- 検査の順: 1 ルート → 2 `requireLocalWrite` → 3 `requireAuth` → 4 プレイヤーの利用制限（429 `RATE_LIMITED`）→ 5 `gameId` → 6 トークンの `g` → 7 `parseRevision(baseRevision)` が 1 以上の整数（400 `INVALID_ARGUMENT`）→ 8 `requireGame` → 9 墓石にする `UPDATE saves SET deleted = 1, data = '', checksum = '', size = 0, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE game_id = ? AND player_id = ? AND slot_id = ? AND revision = ? AND deleted = 0 RETURNING slot_id`（行は消さない。§2）。
- 行が返らなければ、そのスロットに `deleted = 0` の行があれば 409 `SAVE_CONFLICT`、無ければ（行が無い・墓石）404 `NOT_FOUND`（`Save not found`）。
- 応答（200）: `{"ok":true,"gameId":"demo-rpg","slotId":"auto"}`。消した後は、`GET` が 404・一覧に出ない・スロットの数に数えない。同じスロットに `baseRevision: 0` で書き直せ、リビジョンは墓石の次へ進む（1 に戻さない）。だから消す前のリビジョンを覚えた古い端末の書き込みは 409 になる。

### 新しいエラーコード（§10 の決めること 6）

| コード | 状態 | いつ | 束 |
| --- | --- | --- | --- |
| `SAVE_CONFLICT` | 409 | `baseRevision` がいまのリビジョンと違う（初めてのつもりが既にある・あるつもりが無い、も含む） | V1 |
| `PAYLOAD_TOO_LARGE` | 413 | 要求の本文が `MAX_REQUEST_BYTES` を超える・`data` が `MAX_SAVE_BYTES` を超える | V1 |
| `SLOT_LIMIT_EXCEEDED` | 409 | 新しいスロットに書くと `MAX_SLOTS` を超える | V2 |

エラーの形は `{ "error": { "code", "message" } }` のまま変えない。409 の応答にいまのリビジョンを入れない（クライアントは `GET` で読み直す。§6）。

### 契約の変わる所（束の実装の Issue の最初のコミットで、試験より先に直す。CLAUDE.md 原則 5。例外を追記しない）

V1:

- `docs/api-contract.md`: `## PUT /v1/saves/{slotId}?gameId=demo-rpg` と `## GET /v1/saves/{slotId}?gameId=demo-rpg` の節を足す（上の要求・応答・トークンが要ること・`APP_ENV=local` の時だけ通ること・409 のときは読み直すこと）。「現PoCの代表コード」の一覧を 10 個に置き換える。「将来予定」の表の `PUT/GET` `/v1/saves/{slot}` の行を消す（実装した行を将来予定に残さない）。
- `openapi/rpg-online.v1.json`: 操作 `putSave`・`getSave`・`SaveWrite`・`SaveMeta`・`Save` を足す。`security` は `bearerToken`。`ErrorCode` に `SAVE_CONFLICT`・`PAYLOAD_TOO_LARGE` を足す。
- `docs/guides/working/api-schema-design.md` §4 の試験の名前 `スキーマのファイルはOpenAPI 3.1で5つの操作を持つ`・`スキーマのErrorCodeの列挙は8つのエラーコードと一致する` を、§7 の V1 の名前に置き換える。`docs/guides/working/core-foundation-design.md` §4 の M1・M3 の行が挙げる `モジュールの一覧はannouncementsとrankingsでルートが重ならない`・`demo-rpgはannouncementsとrankingsの両方を使う設定で登録される` を、§7 の V1 の後を継ぐ名前に置き換え、`test/modules.test.ts`・`test/game-modules.test.ts` の頭書きの「名前の正」に、置き換えた試験はこの設計書 §7 が正だと書き足す（試験と正の文書を食い違わせない。CLAUDE.md 原則 5）。`docs/guides/working/account-design.md` の §6・§9 の名前（`…5つの操作を持つ`・`…8つのエラーコードと一致する`）は、A1・A2 の確認コマンドの記録なので変えない。
- `docs/guides/working/architecture.md` の「4. データ境界」に `saves` を足す（作っている表の一覧を置き換える）。

V2:

- `docs/api-contract.md`: `## GET /v1/saves?gameId=demo-rpg` と `## DELETE /v1/saves/{slotId}?gameId=demo-rpg&baseRevision=…` の節を足す。代表コードを 11 個に置き換える。
- `openapi/rpg-online.v1.json`: 操作 `listSaves`・`deleteSave` を足し、`ErrorCode` に `SLOT_LIMIT_EXCEEDED` を足す。`putSave` の 409 の `x-error-codes` に `SLOT_LIMIT_EXCEEDED` を足す。
- `docs/guides/working/api-schema-design.md` §4 の名前を、§7 の V2 の名前に置き換える。

## 4. 認証と、他のプレイヤーのセーブに触れられないこと

- **全部の操作（読む・書く・一覧・消す）にトークンが要る**（`requireAuth`。`Authorization: Bearer <token>`）。
- プレイヤーは**トークンの `p` だけ**で決まる。パスにも問い合わせにも本文にも `playerId` を書く欄が無いので、他のプレイヤーのセーブを指す方法そのものが無い（スコアの投稿は本文の `playerId` を残して突き合わせた。§10 の決めること 7 で、セーブは欄を作らないほうを選んだ）。
- ゲームは問い合わせの `gameId` で受け取り、トークンの `g` と違えば 403 `PERMISSION_DENIED`（`account-design.md` の決まりと同じ）。`requireGame` の前に確かめる（他のゲームの登録の有無を、トークンの無いゲームについて漏らさない）。
- `game_modules` の `saves` の行は「そのゲームがセーブを使うか」であって認可ではない（`core-foundation-design.md`）。行が無ければ 404 `Feature not enabled for this game`。
- **`APP_ENV === 'local'` の時だけ通す守り（`requireLocalWrite`）は、書く・消すに必ず掛ける。読む・一覧にも掛ける**（§10 の決めること 8）。`wrangler.jsonc` の既定 `APP_ENV=disabled` は変えない。守りを外す条件は `account-design.md` §10 のとおりで、ここでは決めない。
- ログ: `data` と `token` を `console` に出さない（`operations-security.md`）。入口の `try/catch` は例外の中身を応答に入れない（いまのまま）。

## 5. チェックサムと、リビジョン・形式の版の使い方（クライアントの側）

### チェックサム（§10 の決めること 4）

- 算法: SHA-256。入力は `data` の **UTF-8 のバイト列**（JSON に包む前の文字列。逃がしの前）。出力は小文字の 16 進 64 文字。
- **クライアントが計算して送り、サーバーが `crypto.subtle.digest` で計算し直して比べる**。違えば 400 `INVALID_ARGUMENT` で書かない（途中で切れた・壊れた本体を保存しない）。
- 読むときはサーバーが保存した `checksum` を返し、クライアントは受け取った `data` で計算し直して比べる（端から端までの確かめ）。
- 試験の値（どの言語でも同じになることの手本）: `""` → `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`、`"abc"` → `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`。
- **要確認**: Unreal Engine の標準のモジュールだけで SHA-256 を計算できるか（Unity は `System.Security.Cryptography.SHA256`、ブラウザは `crypto.subtle` で計算できる）。Phase 3 の UE のクライアントを作るときに確かめ、無ければ §10 の決めること 4 の B（サーバーが計算する）を足すかを決める。

### リビジョン（楽観的な排他）

1. 端末は起動時に `GET` で読み、`revision` を覚える（無ければ 404 → 覚えるのは `0`）。
2. 保存は `PUT` に覚えた値を `baseRevision` で付ける。200 なら返った `revision` を覚え直す。
3. 409 `SAVE_CONFLICT` なら、別の端末が先に書いている。`GET` で読み直し、どちらを残すか（上書き・相手を取る・プレイヤーに選ばせる）をゲームが決め、読み直した `revision` を `baseRevision` にして書き直す。**サーバーは黙って上書きも統合もしない。**
4. 同じリビジョンから 2 つの書き込みが同時に来ても、通るのは 1 つだけ（§3 の 1 文の `UPDATE … WHERE revision = ?`）。

### 形式の版（移し替えはクライアントの仕事）

- サーバーは `formatVersion` を比べない・弾かない（下げる書き込みも通す。§10 の決めること 9）。保存した値を `GET`・一覧でそのまま返すだけ。
- クライアントは読んだ `formatVersion` が自分の版より古ければ、自分で移し替えて、自分の版で `PUT` する（`baseRevision` は読んだ `revision`）。
- 自分の版より**新しい**ものを読んだクライアント（古い版のゲーム）は、書かずに更新を促す（古い形で上書きしない）。サーバーが返すのはそのための `formatVersion` だけ。
- 一覧（V2）に `formatVersion` を入れるので、本体を読まずに移し替えの要否が分かる。

## 6. CLI モック（`scripts/cli-mock.mjs`）の変え方（V1・V2）

API を変えたら CLI モックも合わせる決まり（CLAUDE.md）なので、**API を足す束ごとに、その束で足した API を CLI モックに足す**。

V1（書く・読む）:

1. `scripts/cli-requests.mjs` に `SMOKE_SLOT_ID = 'cli-smoke'` と `saveData()`（`JSON.stringify({ hp: 30, map: 'town' })`）と `saveWrite(data, checksum, baseRevision)`（`{ formatVersion: 1, data, checksum, baseRevision }` を返す）を足し、`scripts/cli-requests.d.mts` に型を足す。チェックサムは Node.js と Workers のランタイムの両方で動く `crypto.subtle` で、`async function sha256Hex(text)` として同じファイルに置く（Node.js の API を使わない決まりのまま）。いまの `scoreSubmission`・`guestRequest`・`authHeaders` は変えない。
2. `scripts/cli-mock.mjs` は、いまのスコアの流れの後に、同じゲストのトークンで **`PUT /v1/saves/cli-smoke?gameId=demo-rpg`（`baseRevision: 0`）→ `GET /v1/saves/cli-smoke?gameId=demo-rpg` で `data`・`checksum`・`revision` が同じことを確かめる** を足す。ゲストは毎回新しく発行するので、`baseRevision: 0` が毎回通る。`data` は画面に出さない（`size` と `revision` だけ出す）。

V2（一覧・消す）:

3. `scripts/cli-mock.mjs` の V1 の流れの後に、**`GET /v1/saves?gameId=demo-rpg` に `cli-smoke` があることを確かめる → `DELETE /v1/saves/cli-smoke?gameId=demo-rpg&baseRevision=<読んだ revision>` → `GET /v1/saves/cli-smoke` が 404** を足す。

どちらの束も、`npm run cli:smoke` は `npm run dev`（`APP_ENV=local`・既定の鍵）に対して通る。`npm run db:migrate:local` で `0005` が当たっていることが前提。

## 7. 試験の名前の表

置き場は V1 が `test/saves.test.ts`、V2 が `test/saves-manage.test.ts`。ただし、§8 で置き換える試験の後を継ぐものは置き換える試験と同じファイルに置く（機能の一覧は `test/modules.test.ts`、機能の設定は `test/game-modules.test.ts`）。スキーマに合うかを見る試験（`セーブの読み書きの応答はスキーマに合う`・`セーブの一覧と削除の応答はスキーマに合う` と、操作とエラーコードの数の試験）は、手伝いの `expectConforms` がある `test/schema-conformance.test.ts` に置く。CLI モックの流れの試験（`CLIモックと同じ流れで…`）は、互換の試験と並べて `test/failure-server.test.ts` に置く。トークンは `test/support/auth.ts` の `bearer`・`tokenFor` で作る（変えない）。テストの名前は表の文そのまま `it('…')` に書く。名前を変えるときは、この表も同じコミットで直す（`docs/guides/procedures/node-test-procedure.md`）。

| 束 | テストの名前 | 入力 | 期待する結果 | 層 |
| --- | --- | --- | --- | --- |
| V1 | `セーブの本文の検証関数は形の版とdataとチェックサムと前のリビジョンの外れを見つける` | `parseSaveWrite` に、正しい本文と、欄ごとに外れた値（`formatVersion` が 0・1.5・2147483648・`"1"`、`data` が数・無し、`checksum` が 63 文字・大文字・無し、`baseRevision` が -1・1.5・無し）と、配列・`null` | 正しいものだけ `ok: true`。知らない欄は捨てる | L1 |
| V1 | `チェックサムはdataのUTF-8のバイト列のSHA-256の16進で計算する` | `sha256Hex('')`・`sha256Hex('abc')`・`sha256Hex('あ')` | §5 の 2 つの値と、`'あ'`（3 バイト）の値が Web Crypto で `TextEncoder` を通した値と同じ | L1 |
| V1 | `セーブの大きさはdataのUTF-8のバイト数で数える` | `utf8Size('abc')`・`utf8Size('あ')`・`utf8Size('😀')` | 3・3・4 | L1 |
| V1 | `初めてのセーブは前のリビジョン0で書けてリビジョン1が返る` | `p1` のトークンで `PUT /v1/saves/auto?gameId=demo-rpg`（`baseRevision: 0`） | 200・`revision: 1`・`size` が `data` のバイト数・`saves` が 1 行 | L2 |
| V1 | `書いたセーブを読むと同じdataと形の版とチェックサムとリビジョンが返る` | 書いた後に `GET` | 200・`data`・`formatVersion`・`checksum`・`revision`・`updatedAt` が書いた応答と同じ | L2 |
| V1 | `前のリビジョンが合う書き込みはリビジョンを1つ進める` | `baseRevision: 1` で書き、続けて `baseRevision: 2` で書く | 200・`revision` が 2・3。`GET` の `data` が最後のもの | L2 |
| V1 | `前のリビジョンが古い書き込みはSAVE_CONFLICTの409を返し上書きしない` | リビジョン 2 のスロットに `baseRevision: 1` | 409・`SAVE_CONFLICT`・`GET` の `data` と `revision` が変わらない | L2 |
| V1 | `セーブがあるスロットへの前のリビジョン0の書き込みはSAVE_CONFLICTの409を返す` | 書いたスロットに、もう一度 `baseRevision: 0` | 409・`SAVE_CONFLICT`・上書きしない | L2 |
| V1 | `セーブの無いスロットへの前のリビジョン1以上の書き込みはSAVE_CONFLICTの409を返す` | 空のスロットに `baseRevision: 1` | 409・`SAVE_CONFLICT`・行が増えない | L2 |
| V1 | `同じリビジョンから並べて送った2つの書き込みは片方だけが通る` | リビジョン 1 のスロットに、違う `data` の 2 つを `baseRevision: 1` で `Promise.all` | 200 が 1 つ・409 `SAVE_CONFLICT` が 1 つ。`GET` の `revision` が 2 で、`data` が 200 になった方 | L2 |
| V1 | `チェックサムがdataと合わない書き込みはINVALID_ARGUMENTの400を返し書かない` | 正しい形で別の文字列の SHA-256 を付ける | 400・`INVALID_ARGUMENT`・行が増えない | L2 |
| V1 | `上限ちょうどの大きさのセーブは書けて1バイト超えるとPAYLOAD_TOO_LARGEの413を返す` | `data` が `MAX_SAVE_BYTES` バイトと 1 バイト多いもの・`MAX_REQUEST_BYTES` を超える本文 | 200・413 `PAYLOAD_TOO_LARGE`・413。413 のときは行が増えない | L2 |
| V1 | `書いていないスロットを読むとNOT_FOUNDの404を返す` | 何も書かずに `GET` | 404・`NOT_FOUND`（`Save not found`） | L2 |
| V1 | `他のプレイヤーのセーブは読めず上書きもできない` | `p1` が `auto` に書いた後、`p2` のトークンで同じ `auto` を `GET` し、`baseRevision: 0` で `PUT` | `p2` の `GET` は 404。`p2` の `PUT` は `p2` の行を作る（200）。`p1` の `GET` の `data` と `revision` は変わらない | L2 |
| V1 | `トークンのゲームと違うgameIdのセーブの要求はPERMISSION_DENIEDの403を返す` | `other-rpg` を登録し、`demo-rpg` のトークンで `?gameId=other-rpg` の `PUT`・`GET` | どちらも 403・`PERMISSION_DENIED`・行が増えない | L2 |
| V1 | `トークンの無いセーブの読み書きは401を返す` | `Authorization` 無しの `PUT`・`GET`・期限切れのトークンの `GET` | 401・`UNAUTHENTICATED`・`UNAUTHENTICATED`・`TOKEN_EXPIRED`。行が増えない | L2 |
| V1 | `本番の設定ではセーブの読み書きもNOT_READY_FOR_PRODUCTIONの403を返す` | `APP_ENV` が `local` でない env で、正しいトークンの `PUT`・`GET` | どちらも 403・`NOT_READY_FOR_PRODUCTION`（401 でも 200 でもない）・行が増えない | L2 |
| V1 | `savesを使わない設定のゲームのセーブはNOT_FOUNDの404を返し書かない` | `registerGame(db, 'no-saves', ['rankings'])` と、そのゲームのトークンで `PUT`・`GET` | 404・`NOT_FOUND`（`Feature not enabled for this game`）・行が増えない | L2 |
| V1 | `形の版はサーバーが解釈せず書いた値をそのまま返す` | `formatVersion: 7` で書き、`formatVersion: 3` で書き直す（リビジョンは合わせる） | どちらも 200。`GET` の `formatVersion` が 3 | L2 |
| V1 | `ゲームの行を消すとそのゲームのセーブも消える` | `registerGame(db, 'other-rpg', ['saves'])` で登録し（既定の機能は `saves` を含まない）、`other-rpg` のトークンでセーブを書き、`games` から `other-rpg` を消す | `saves` に `other-rpg` の行が残らない。`demo-rpg` の行は残る | L2 |
| V1 | `セーブの書き込みでDBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない` | `prepare` が投げる偽の DB の env で、正しいトークンの `PUT` | 500・`INTERNAL_ERROR`・本文に SQL・`data`・トークンが入らない | L2 |
| V1 | `セーブの読み書きの応答はスキーマに合う` | 200（`PUT`・`GET`）・400・401・403・404・409・413 を起こす | 本文が `putSave`・`getSave` の応答のスキーマに合い、`x-error-codes` にコードがある | L2 |
| V1 | `スキーマのファイルはOpenAPI 3.1で7つの操作を持つ` | `openapi/rpg-online.v1.json` | 操作が `getHealth`・`getRanking`・`getSave`・`issueGuest`・`listAnnouncements`・`putSave`・`submitScore`・`$ref` が全部解ける（§8 で置き換える試験の後を継ぐ） | L1 |
| V1 | `スキーマのErrorCodeの列挙は10個のエラーコードと一致する` | `ErrorCode` | いまの 8 つと `SAVE_CONFLICT`・`PAYLOAD_TOO_LARGE`（§8 で置き換える試験の後を継ぐ） | L1 |
| V1 | `demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される` | `game_modules` の `demo-rpg` の行 | `['announcements', 'rankings', 'saves']`（§8 で置き換える試験の後を継ぐ） | L2 |
| V1 | `モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない` | `modules` | 名前が 3 つ・`メソッド パターン` が重ならない・どれも `/health` に当たらない（§8 で置き換える試験の後を継ぐ） | L1 |
| V1 | `CLIモックと同じ流れでゲストのセーブを書いて読み直せる` | `scripts/cli-requests.mjs` の `guestRequest`・`saveData`・`sha256Hex`・`saveWrite`・`SMOKE_SLOT_ID` でゲストを発行し、`PUT`→`GET`（`scripts/cli-mock.mjs` の V1 の流れ。§6） | 200・`revision: 1`・`GET` の `data`・`checksum`・`revision` が送ったもの | L2 |
| V2 | `セーブの一覧は自分のスロットのメタデータだけをdata無しで返す` | `p1` が `a`・`b`、`p2` が `c` に書き、`p1` のトークンで `GET /v1/saves?gameId=demo-rpg` | 200・`items` が `a`・`b` の順で、`p2` の `c` が無い。各行に `data` が無く、`revision`・`formatVersion`・`checksum`・`size`・`updatedAt` がある | L2 |
| V2 | `セーブの一覧は書いたことの無いプレイヤーには空の一覧を返す` | 何も書かずに一覧 | 200・`items: []` | L2 |
| V2 | `リビジョンが合う削除はスロットを消して同じスロットに前のリビジョン0で書き直せる` | リビジョン 2 のスロットを `baseRevision=2` で `DELETE`、続けて `baseRevision: 0` で `PUT` | 200・`ok: true`。消した後の `GET` が 404・一覧に出ない。その後の `PUT` が 200 で `revision` が 4（墓石の 3 の次。1 に戻らない） | L2 |
| V2 | `消してから書き直したスロットへの消す前のリビジョンからの書き込みはSAVE_CONFLICTの409を返す` | リビジョン 2 のスロットを `baseRevision=2` で消し、`baseRevision: 0` で書き直して、さらに 1 回書く（リビジョン 5）。そのあと消す前に覚えた `baseRevision: 2`・`3` で `PUT` | どちらも 409・`SAVE_CONFLICT`・`GET` の `data` と `revision` が変わらない（消して書き直してもリビジョンが戻らないので、古い端末の上書きが黙って通らない） | L2 |
| V2 | `リビジョンが古い削除はSAVE_CONFLICTの409を返し消さない` | リビジョン 2 のスロットを `baseRevision=1` で `DELETE` | 409・`SAVE_CONFLICT`・`GET` が 200 のまま | L2 |
| V2 | `書いていないスロットの削除はNOT_FOUNDの404を返す` | 空のスロットを `baseRevision=1` で `DELETE`・`baseRevision` 無し・`baseRevision=0` | 404・`NOT_FOUND`・400・400（`INVALID_ARGUMENT`） | L2 |
| V2 | `スロットの数の上限を超える新しいスロットへの書き込みはSLOT_LIMIT_EXCEEDEDの409を返す` | `MAX_SLOTS` 個のスロットを書いた後、新しいスロットに `baseRevision: 0` | 409・`SLOT_LIMIT_EXCEEDED`・行が増えない。別のプレイヤーは同じゲームで書ける | L2 |
| V2 | `上限まで埋まっていても既にあるスロットの上書きは通る` | `MAX_SLOTS` 個を書いた後、そのうち 1 つを正しい `baseRevision` で書く | 200・`revision` が進む | L2 |
| V2 | `他のプレイヤーのセーブは一覧に出ず消せない` | `p1` が `auto` に書き、`p2` のトークンで `DELETE /v1/saves/auto?…&baseRevision=1` | 404（`p2` には無い）・`p1` の `GET` は 200 のまま | L2 |
| V2 | `本番の設定ではセーブの一覧と削除もNOT_READY_FOR_PRODUCTIONの403を返す` | `APP_ENV` が `local` でない env で、正しいトークンの一覧・`DELETE` | どちらも 403・`NOT_READY_FOR_PRODUCTION`・行が減らない | L2 |
| V2 | `セーブの一覧と削除の応答はスキーマに合う` | 200（一覧・削除）・400・404・409（`SAVE_CONFLICT`・`SLOT_LIMIT_EXCEEDED`）を起こす | 本文が `listSaves`・`deleteSave`・`putSave` の応答のスキーマに合い、`x-error-codes` にコードがある | L2 |
| V2 | `スキーマのファイルはOpenAPI 3.1で9つの操作を持つ` | `openapi/rpg-online.v1.json` | V1 の 7 つと `deleteSave`・`listSaves`（V1 の 7 つの操作の試験の後を継ぐ） | L1 |
| V2 | `スキーマのErrorCodeの列挙は11個のエラーコードと一致する` | `ErrorCode` | V1 の 10 個と `SLOT_LIMIT_EXCEEDED`（V1 の 10 個の試験の後を継ぐ） | L1 |
| V2 | `CLIモックと同じ流れでセーブの一覧に出たスロットを消せる` | 同じ関数でゲストを発行して `PUT` した後、一覧→`DELETE`→`GET`（`scripts/cli-mock.mjs` の V2 の流れ。§6） | 一覧に `cli-smoke` がある・`DELETE` が 200・その後の `GET` が 404 | L2 |

数（行）: V1 が 27・V2 が 14。どれも、いまの `test/` の名前と重ならない（2026-10-30 に `test/*.ts` の `it('…')` と突き合わせた）。

## 8. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `demo-rpgはannouncementsとrankingsの両方を使う設定で登録される`（`test/game-modules.test.ts`） | V1 | `0005` が `demo-rpg` に `saves` の行を足すので、行がちょうど 2 つの期待が外れる | 消して、§7 の `demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される` に置き換える（見る範囲は増える） |
| `モジュールの一覧はannouncementsとrankingsでルートが重ならない`（`test/modules.test.ts`） | V1 | 一覧が 3 つになり、名前がちょうど 2 つの期待が外れる | 消して、§7 の `モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない` に置き換える（ルートが重ならない・`/health` に当たらないの確かめはそのまま） |
| `スキーマのファイルはOpenAPI 3.1で5つの操作を持つ`（`test/schema-conformance.test.ts`） | V1 | 操作が 7 つになる | 消して、§7 の `スキーマのファイルはOpenAPI 3.1で7つの操作を持つ` に置き換える。V2 で同じ手続きで `…9つの操作を持つ` に置き換える |
| `スキーマのErrorCodeの列挙は8つのエラーコードと一致する`（同上） | V1 | コードが 10 個になる | 消して、§7 の `…10個のエラーコードと一致する` に置き換える。V2 で `…11個のエラーコードと一致する` に置き換える |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る`（同上） | V1・V2 | 試験の中の `errorCodes` と、起こしたコードの集合が一致するかを見ているので、コードを足すと足りなくなる | 名前を変えず、`errorCodes` に足したコードを足し、`putSave`（・`deleteSave`）でそのコードを起こす行を足す。いまの行と期待は変えない（見る範囲は増える） |
| `今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`） | V1・V2 | **変わらない**。スコアの流れ（ゲストの発行 → トークン付きの投稿 → `GET`）は V1・V2 で変えない。`scripts/cli-requests.mjs` の `guestRequest`・`authHeaders`・`scoreSubmission` も変えない | 名前も中身も変えない。CLI モックに足すセーブの流れは、§7 の新しい試験 `CLIモックと同じ流れでゲストのセーブを書いて読み直せる`（V1）・`CLIモックと同じ流れでセーブの一覧に出たスロットを消せる`（V2）で見る（互換の試験を広げて中身を変えるより、黙って弱める道を作らない） |
| `マイグレーションを2回当ててもデータは壊れない` | V1 | 変わらない（`0005` は `IF NOT EXISTS` と `INSERT OR IGNORE` だけ） | 変えない |
| `機能の設定はゲームごとで他のゲームの設定に引きずられない` ほか、`registerGame` で登録するゲームの試験 | V1 | 変わらない（`test/support/games.ts` の既定の機能は `announcements`・`rankings` のままで、試験のゲームは `saves` を使わない） | 変えない（`test/support/games.ts` も変えない） |

手続き（`docs/guides/decisions/test-plan.md` §11 は「テストを緑に合わせて弱めない・消さない。期待値を実装に合わせて書き換えない（直すのは実装か、設計を直してからテスト）」。上の置き換えは緑に合わせるためでなく**設計（機能の一覧と契約）を先に変えたため**で、§11 の「設計を直してからテスト」の道を通る）:

1. 先に設計を直す: 束の実装の Issue の最初のコミットで、§3 の「契約の変わる所」を `docs/api-contract.md`・`openapi/rpg-online.v1.json`・`docs/guides/working/api-schema-design.md`・`docs/guides/working/architecture.md` に写す（旧文を置き換える。CLAUDE.md 原則 5）。
2. 同じ束の中で試験を置き換える。消す試験（V1 で 4 本・V2 で 2 本）は、名前の数を直した、同じかより広く見る試験に置き換わるので、確かめる範囲は減らない。
3. 確認コマンドで、消した名前が `test/` に残っていないこと・置き換えの名前が通ることを見る（§11）。
4. ほかの試験が落ちたら、期待する結果を直さず `docs/guides/decisions/test-plan.md` §8 の欠陥レポートの形で報告し、設計か実装かを振り分ける（design-cycle §5）。

## 9. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 履歴（前の版を残す・戻す） | `save_revisions(game_id, player_id, slot_id, revision, …)` を足し、§3 の `UPDATE` の前に同じ 1 つの `batch` で前の行を写す。`revision` が 1 つずつ進む整数なので、履歴の鍵にそのまま使える（§10 の決めること 5） |
| `MAX_SAVE_BYTES` を超える大きなセーブ（R2） | §10 の決めること 1 の B。`saves` に `storage TEXT NOT NULL DEFAULT 'd1'` と `object_key` を新しいマイグレーションで足し、`data` を空にする。API の形（`data`・`checksum`・`revision`）は変えない |
| 外部の保存先（Steam Cloud など）との同期 | クライアントが両方に書く。サーバーの `checksum`・`revision`・`updatedAt` で、どちらが新しいかをクライアントが比べられる。サーバーは外部と話さない |
| セーブの共有（他のプレイヤーに見せる） | 別の操作（例: 共有用のスナップショットの発行）として足す。いまの操作には他のプレイヤーを指す欄が無いので、穴を開けずに足せる |
| 管理画面からの修正・復元 | Phase 2 の管理機能。管理用の認可の設計と一緒に、`saves` を直に書く口を作る（`revision` を進めて書けば、端末の側は 409 で気づく） |
| 形式の版の下げを弾く | §10 の決めること 9 の B。`formatVersion` の欄の意味は変わらないので後から足せる |
| `APP_ENV` の守りを外すこと | `account-design.md` §10 の条件。ここでは外さない |

## 10. 決めること

推しの案で §2〜§8 を書いた。ADR 0002・`core-foundation-design.md`・`account-design.md` の決定は前提で、ここに戻さない。新しいパッケージは、どの推しでも足さない。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 置き場 | A: **D1 の `saves` の行に本体（`data`）とメタデータを両方持つ**。B: 本体を R2 に置き、D1 にはメタデータ（リビジョン・チェックサム・R2 の鍵）だけ。`wrangler.jsonc` に `"r2_buckets": [{ "binding": "SAVES", "bucket_name": "rpg-online-saves" }]`、`Env` に `SAVES: R2Bucket` を足し、`npm run cf-typegen` で `worker-configuration.d.ts` を作り直す（この Issue では変えない）。C: R2 だけ（メタデータは R2 のオブジェクトの `customMetadata`・競合は `onlyIf` の条件つきの PUT） | **A**。リビジョンの比べと書き込みを 1 つの SQL の文でできる（§3）。B は R2 に置いてから D1 を書く 2 段になり、途中で落ちると R2 に孤児が残る（掃除の仕組みが要る）。`wrangler.jsonc` を変え、試験の環境に R2 のバインドを足す必要がある。C は一覧に全オブジェクトの列挙が要り、リビジョンを整数で持てない。A の弱みは D1 の大きさ（Paid で 10 GB）で、64 KiB × 10 スロット × 15,000 人ほどで埋まる。そこに近づいたら B に移す（§9。API は変えない） |
| 2 | 大きさの上限 | A: **`data` を 64 KiB（65,536 バイト）まで**。B: 1 MB（D1 の 1 行 2,000,000 バイトの半分）。C: 上限を決めず D1 に任せる | **A**。D1 の「SQL の文の長さ 100,000 バイト」に `bind` の値が数えられるかが要確認（§1）で、数えられても 64 KiB なら収まる。上限を**上げる**のは互換を壊さない（通っていた要求は通る）が、下げると壊すので、小さく始める。いまのクライアントは CLI モックだけで、RPG の進行の状態は 64 KiB に収まる見込み（要確認: 実際のゲームの大きさ。Phase 3 で測る）。B は要確認が外れると本番でだけ落ちる。C は 2 MB 近い本体で Worker のメモリと D1 の容量を圧迫する |
| 3 | 本体の形 | A: JSON の値（オブジェクトなど）をそのまま `data` に入れる。B: base64 の文字列だけ（何でも入る）。C: **文字列（UTF-8）。中身はゲームが決める（JSON の文字列でも、ゲームが base64 にしたバイナリでもよい）** | **C**。サーバーは中身を解釈しない（ADR 0002）。A はサーバーが JSON として読み直して書き出すので、エンジンごとに JSON の書き出し方（欄の順・数の書き方）が違うと、送った物と返る物のバイト列が変わり、チェックサムが合わなくなる。B は JSON のセーブまで base64 にして 1.33 倍に膨らみ、試験と CLI で中身が読めない。C は「送った文字列がそのまま返る」ので、チェックサムが端から端まで同じになる |
| 4 | チェックサムの算法と、誰が計算するか | A: **SHA-256。クライアントが計算して送り、サーバーが `crypto.subtle.digest`（Workers の Web Crypto。パッケージを足さない）で計算し直して違えば 400**。読むときは保存した値を返す。B: サーバーだけが計算して返す（送らなくてよい）。C: CRC32 などの軽い算法（パッケージか自作の表が要る）。D: パッケージ（例: `hash-wasm`）で xxHash など | **A**。途中で切れた・壊れた本体を保存しない（B は壊れた物をそのまま保存して、正しいチェックサムを付けてしまう）。SHA-256 は Web Crypto・Unity・ブラウザに標準で入っている（UE は要確認。§5）。C・D はパッケージか自作が要り、改ざんの検出にもならない。A のチェックサムは「壊れていないか」の確かめで、改ざんの防止ではない（本人のトークンがあれば中身は自由に書ける） |
| 5 | 履歴と、スロットの数の上限 | A: **履歴を残さない（いまの 1 版だけ）。スロットは 1 プレイヤー・1 ゲームに 10 個まで（`MAX_SLOTS`）**。B: 前の 1 版を残す（`save_revisions`）。C: スロットの上限を決めない | **A**。範囲が小さく、`revision` が整数で進むので履歴は後から足せる（§9）。409 で上書きを断るので、黙って消える事故はリビジョンで防げる。B は容量が 2 倍になり、戻す API（と認可）を一緒に設計する必要がある。C は 1 人が D1 を埋められる（`operations-security.md` の 8 の「容量の制限」） |
| 6 | リビジョンの渡し方と、競合の応答 | A: **本文の欄 `baseRevision`（初めては `0`）。消すときは問い合わせの `baseRevision`。競合は 409 と新しいコード `SAVE_CONFLICT`**（応答にいまのリビジョンを入れない）。B: `If-Match: "<revision>"` の見出し（初めては `If-None-Match: *`）と `ETag`。C: 409 を `INVALID_ARGUMENT` などの既存のコードで返す | **A**。要求の形が全部 JSON と OpenAPI のスキーマで見え、`docs/api-contract.md` の書き方（本文の欄）と揃う。B は HTTP の標準だが、標準では外れたとき 412（Precondition Failed）で、Issue の「競合は 409」とずれる。見出しの引用符の扱いもエンジンごとに要る。C はクライアントが競合を他の誤りと分けられない。大きさの 413 も同じ理由で `PAYLOAD_TOO_LARGE` を足し、スロットの上限は V2 で `SLOT_LIMIT_EXCEEDED`（409）を足す（コードは 8 → 10 → 11） |
| 7 | プレイヤーの指し方 | A: **トークンの `p` だけで決め、要求に `playerId` の欄を作らない**。B: スコアの投稿と同じく `playerId` を本文か問い合わせに書き、トークンと違えば 403 | **A**。他のプレイヤーのセーブを指す方法そのものが無くなる（読む API で問い合わせに `playerId` を書くと、試し打ちで存在を探れる）。スコアの投稿は本文の形を変えないために `playerId` を残した（`account-design.md` の決めること 6）が、セーブは新しい API なので残す理由が無い。ゲームは他の API と同じく `gameId` で受けてトークンと比べる（`requireGame` に渡す名前を揃える） |
| 8 | 読む API（`GET`・一覧）にも `APP_ENV` の守りを掛けるか | A: **掛ける**（`local` でなければ 403 `NOT_READY_FOR_PRODUCTION`）。B: 読むのはトークンだけで通す | **A**。セーブはプレイヤーの非公開のデータで、トークンを出すゲストの発行も `local` だけ（`account-design.md` §3）。守りを外す条件（`account-design.md` §10）を満たすまで、セーブの全部を「本番では使えない」にそろえるほうが、どこに穴があるかを考えずに済む。外すときは書き込みと一緒に外す。B は `local` でない環境で鍵（`AUTH_TOKEN_SECRET`）が設定されると、読む口だけが先に開く |
| 9 | 形式の版の扱い | A: **サーバーは比べない・弾かない。保存して返すだけ。移し替えと「新しすぎる版を読んだら書かない」はクライアントの仕事**（§5）。B: いまより小さい `formatVersion` の書き込みを 409 で弾く | **A**。版の意味（どこから互換か）はゲームが決めることで、サーバーが数の大小で決めると、版を戻したいゲーム（不具合のあった版の取り消し）が書けなくなる。古い端末の上書きは、まずリビジョン（読んでから書くまでに別の端末が書けば 409）で防げる。B は後から足せる（§9） |
| 10 | 消す API | A: **作る（V2。`DELETE` に `baseRevision` を付け、合わなければ 409。行は消さず墓石にしてリビジョンを進める）**。B: 作る・行を消してリビジョンを 1 からやり直す。C: 作らない | **A**。スロットに上限（決めること 5）を付けるので、消せないと埋まったスロットを空けられない。リビジョンを付けるので、別の端末が書いたばかりのセーブを古い画面から消す事故を防げる。B は、消す → 書き直す → 同じ数のリビジョンまで進む、の後に、消す前のリビジョンを覚えた端末の書き込みが合ってしまい、黙って上書きする（§2）。墓石は `data` が空で小さいが、名前を変えて書いては消すと増えるので、墓石も数えた行を 100 までにし、届いたら一番古い墓石を使い回す（§2。`hardening-design.md` §2.2 の G6） |
| 11 | 束の分け方 | A: **V1 で書く・読む（とスキーマ・機能の設定・CLI モックの書いて読む流れ）、V2 で一覧・消す・スロットの上限（と CLI モックの一覧と消す流れ）**。B: 1 つの束で全部。C: CLI モックは V2 でまとめて変える | **A**。V1 だけで「書いて読める・競合が 409・他人に触れない」のゴールの芯が確かめられ、1 つの Issue の差分が小さい。スロットの上限は消す API と一緒でないと使えない（決めること 10）ので V2 に寄せる。CLI モックは CLAUDE.md の「API を変えたらここも合わせる」のとおり、API を足した束で合わせる。B は 1 回の無人の回で 41 本の試験と 2 回の契約の変更になる。C は V1 の間、足した API を CLI モックが使わず、決まりとずれる |
| 12 | `saves` を `src/modules/` に置き、`game_modules` で切るか | A: **`src/modules/saves/` のモジュールにし、`game_modules` の `saves` の行で使う・使わないを切る。`0005` で既存のゲーム（`demo-rpg` を含む）を使う設定にする**。B: `src/core/` に置き、全部のゲームで使う。C: モジュールにするが `demo-rpg` には行を足さない | **A**。セーブを使わないゲーム（ランキングだけのブラウザゲームなど）があり得るので切れるほうがよい。トークンを確かめる側（`requireAuth`）は core にあるので、モジュールに置いても困らない。`demo-rpg` を使う設定にするので、`demo-rpgはannouncementsとrankingsの両方を使う設定で登録される` と `モジュールの一覧はannouncementsとrankingsでルートが重ならない` を §8 の手続きで置き換える。C は CLI モックの通しの確かめ（ロードマップの完了条件）が `demo-rpg` で通らない |

## 11. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| V1 | `migrations/` の新しい `0005_saves.sql`・`src/modules/saves/`（`limits.ts`・`validate.ts`・`checksum.ts`・`index.ts` の `PUT`・`GET /v1/saves/{slotId}`）・`src/modules/index.ts` に `saves`・`src/core/module.ts` の `Route.method` に `PUT`・`DELETE`・§3 の V1 の「契約の変わる所」・CLI モックの書いて読む流れ（`scripts/cli-mock.mjs`・`scripts/cli-requests.mjs`・`scripts/cli-requests.d.mts`。§6）・§7 の V1 の試験 | A2（`account-design.md`） | §8 の手続きで 4 本を置き換え・1 本の中身を広げる | 足さない |
| V2 | `GET /v1/saves`・`DELETE /v1/saves/{slotId}`（墓石）・スロットの上限（`MAX_SLOTS`・`SLOT_LIMIT_EXCEEDED`）・§3 の V2 の「契約の変わる所」・CLI モックの一覧と消す流れ（§6）・§7 の V2 の試験 | V1 | §8 の手続きで 2 本を置き換え・1 本の中身を広げる | 足さない |

範囲の外（後の設計書）: §9 の表。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。

`gitClean` は `base` を渡さないと作業ツリーしか見ず、無人の回がコミットした後は変えていても通ってしまう。どの案も先頭の `base` に、**実装の Issue を作るときの main のコミットの SHA** を書き入れ、`gitClean(…, { base })` で比べる（`docs/guides/procedures/issue-goal-setting.md`）。

束は既存のテストのファイル（`test/schema-conformance.test.ts`・`test/modules.test.ts`・`test/game-modules.test.ts`・`test/failure-server.test.ts`）に手を入れるので、そのファイルを `gitClean` で守れない。代わりに、**`base` の `test/*.ts` にあった試験の名前を全部、§8 で置き換える名前を除いて `requireTests` に渡す**（消した・名前を変えた・落ちる試験があれば止まる。`runTests()` は試験を消しても PASS になるため）。中身を広げる `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` は、起こしたコードの集合と `errorCodes` を比べる行が残っているかも見る。

V1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const namesIn = (src) => [...src.matchAll(/\bit\('([^']+)'/g)].map((m) => m[1]);
const files = ['migrations/0005_saves.sql', 'src/modules/saves/index.ts', 'src/modules/saves/validate.ts',
  'src/modules/saves/checksum.ts', 'src/modules/saves/limits.ts', 'test/saves.test.ts'];
mustExist(files);
gitTracked(files);
// パッケージを足さない・Web Crypto で SHA-256 を計算する
check(/crypto\.subtle\.digest/.test(read('src/modules/saves/checksum.ts')), 'チェックサムは Web Crypto の digest で計算する');
// 守りと認証を通す・消した印の列を V1 で作る
const mod = read('src/modules/saves/index.ts');
check(mod.includes('requireLocalWrite') && mod.includes('requireAuth'), 'セーブのルートが APP_ENV の守りとトークンを通す');
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/deleted/.test(read('migrations/0005_saves.sql')), 'saves の表に消した印の列がある（§2）');
// CLI モックがセーブを書いて読む（§6）
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(mock.includes('/v1/saves/') && /crypto\.subtle/.test(read('scripts/cli-requests.mjs')), 'CLI モックがセーブを書いて読み、チェックサムを crypto.subtle で計算する');
// 置き換えた 4 本が残っていない（§8）・残りの既存の試験は全部ある（下の requireTests）
const replaced = ['demo-rpgはannouncementsとrankingsの両方を使う設定で登録される', 'モジュールの一覧はannouncementsとrankingsでルートが重ならない',
  'スキーマのファイルはOpenAPI 3.1で5つの操作を持つ', 'スキーマのErrorCodeの列挙は8つのエラーコードと一致する'];
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
for (const n of replaced) check(!all.includes(n), '置き換えた試験が残っていない: ' + n);
const baseTests = execSync(`git ls-tree --name-only ${base} test/`, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'))
  .flatMap((f) => namesIn(execSync(`git show ${base}:${f}`, { encoding: 'utf8' })));
check(baseTests.length > 0, 'base の試験の名前を読めた');
check(/expect\(\[\.\.\.seen\]\.sort\(\)\)\.toEqual\(\[\.\.\.errorCodes\]\.sort\(\)\)/.test(read('test/schema-conformance.test.ts')), '起こしたコードとエラーコードの一覧を比べる行が残っている');
// 契約を先に直した（§3）
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check(Boolean(spec.paths?.['/v1/saves/{slotId}']?.put && spec.paths?.['/v1/saves/{slotId}']?.get), 'スキーマに PUT・GET /v1/saves/{slotId} がある');
const codes = spec.components?.schemas?.ErrorCode?.enum ?? [];
for (const c of ['SAVE_CONFLICT', 'PAYLOAD_TOO_LARGE']) check(codes.includes(c), 'スキーマの ErrorCode に ' + c + ' がある');
check(read('docs/api-contract.md').includes('/v1/saves/{slotId}'), '契約にセーブの節がある');
runTests();
requireTests([
  'セーブの本文の検証関数は形の版とdataとチェックサムと前のリビジョンの外れを見つける',
  'チェックサムはdataのUTF-8のバイト列のSHA-256の16進で計算する',
  'セーブの大きさはdataのUTF-8のバイト数で数える',
  '初めてのセーブは前のリビジョン0で書けてリビジョン1が返る',
  '書いたセーブを読むと同じdataと形の版とチェックサムとリビジョンが返る',
  '前のリビジョンが合う書き込みはリビジョンを1つ進める',
  '前のリビジョンが古い書き込みはSAVE_CONFLICTの409を返し上書きしない',
  'セーブがあるスロットへの前のリビジョン0の書き込みはSAVE_CONFLICTの409を返す',
  'セーブの無いスロットへの前のリビジョン1以上の書き込みはSAVE_CONFLICTの409を返す',
  '同じリビジョンから並べて送った2つの書き込みは片方だけが通る',
  'チェックサムがdataと合わない書き込みはINVALID_ARGUMENTの400を返し書かない',
  '上限ちょうどの大きさのセーブは書けて1バイト超えるとPAYLOAD_TOO_LARGEの413を返す',
  '書いていないスロットを読むとNOT_FOUNDの404を返す',
  '他のプレイヤーのセーブは読めず上書きもできない',
  'トークンのゲームと違うgameIdのセーブの要求はPERMISSION_DENIEDの403を返す',
  'トークンの無いセーブの読み書きは401を返す',
  '本番の設定ではセーブの読み書きもNOT_READY_FOR_PRODUCTIONの403を返す',
  'savesを使わない設定のゲームのセーブはNOT_FOUNDの404を返し書かない',
  '形の版はサーバーが解釈せず書いた値をそのまま返す',
  'ゲームの行を消すとそのゲームのセーブも消える',
  'セーブの書き込みでDBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない',
  'セーブの読み書きの応答はスキーマに合う',
  'スキーマのファイルはOpenAPI 3.1で7つの操作を持つ',
  'スキーマのErrorCodeの列挙は10個のエラーコードと一致する',
  'demo-rpgはannouncementsとrankingsとsavesを使う設定で登録される',
  'モジュールの一覧はannouncementsとrankingsとsavesでルートが重ならない',
  'CLIモックと同じ流れでゲストのセーブを書いて読み直せる',
  // base にあった既存の試験の全部（置き換えた 4 本を除く。互換の `今のCLIモックと同じ形の要求を受け付ける` を含む）
  ...baseTests.filter((n) => !replaced.includes(n)),
]);
// スコア・お知らせ・認証・既存のマイグレーションと、手を入れない試験のファイルを変えない
gitClean(['src/modules/rankings/', 'src/modules/announcements/', 'src/core/auth.ts', 'src/core/token.ts', 'src/core/guards.ts',
  'src/core/accounts.ts', 'scripts/issue-run/', 'scripts/test.mjs', 'migrations/0001_initial.sql', 'migrations/0002_games.sql',
  'migrations/0003_game_modules.sql', 'migrations/0004_accounts.sql', 'test/failure-input.test.ts', 'test/auth.test.ts',
  'test/accounts.test.ts', 'test/games.test.ts', 'test/health.test.ts', 'test/support/', 'wrangler.jsonc', pkg], { base });
done();
```

V2:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const namesIn = (src) => [...src.matchAll(/\bit\('([^']+)'/g)].map((m) => m[1]);
const files = ['test/saves-manage.test.ts'];
mustExist(files);
gitTracked(files);
// CLI モックが一覧と消す流れを持つ（§6）
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(mock.includes('/v1/saves') && mock.includes('DELETE'), 'CLI モックがセーブの一覧を見て消す');
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
// 置き換えた 2 本が残っていない（§8）・残りの既存の試験は全部ある（下の requireTests）
const replaced = ['スキーマのファイルはOpenAPI 3.1で7つの操作を持つ', 'スキーマのErrorCodeの列挙は10個のエラーコードと一致する'];
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => readFileSync('test/' + f, 'utf8')).join('\n');
for (const n of replaced) check(!all.includes(n), '置き換えた試験が残っていない: ' + n);
const baseTests = execSync(`git ls-tree --name-only ${base} test/`, { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.ts'))
  .flatMap((f) => namesIn(execSync(`git show ${base}:${f}`, { encoding: 'utf8' })));
check(baseTests.length > 0, 'base の試験の名前を読めた');
check(/expect\(\[\.\.\.seen\]\.sort\(\)\)\.toEqual\(\[\.\.\.errorCodes\]\.sort\(\)\)/.test(read('test/schema-conformance.test.ts')), '起こしたコードとエラーコードの一覧を比べる行が残っている');
// 契約を先に直した（§3）
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check(Boolean(spec.paths?.['/v1/saves']?.get && spec.paths?.['/v1/saves/{slotId}']?.delete), 'スキーマに一覧と削除がある');
check((spec.components?.schemas?.ErrorCode?.enum ?? []).includes('SLOT_LIMIT_EXCEEDED'), 'スキーマの ErrorCode に SLOT_LIMIT_EXCEEDED がある');
runTests();
requireTests([
  'セーブの一覧は自分のスロットのメタデータだけをdata無しで返す',
  'セーブの一覧は書いたことの無いプレイヤーには空の一覧を返す',
  'リビジョンが合う削除はスロットを消して同じスロットに前のリビジョン0で書き直せる',
  '消してから書き直したスロットへの消す前のリビジョンからの書き込みはSAVE_CONFLICTの409を返す',
  'リビジョンが古い削除はSAVE_CONFLICTの409を返し消さない',
  '書いていないスロットの削除はNOT_FOUNDの404を返す',
  'スロットの数の上限を超える新しいスロットへの書き込みはSLOT_LIMIT_EXCEEDEDの409を返す',
  '上限まで埋まっていても既にあるスロットの上書きは通る',
  '他のプレイヤーのセーブは一覧に出ず消せない',
  '本番の設定ではセーブの一覧と削除もNOT_READY_FOR_PRODUCTIONの403を返す',
  'セーブの一覧と削除の応答はスキーマに合う',
  'スキーマのファイルはOpenAPI 3.1で9つの操作を持つ',
  'スキーマのErrorCodeの列挙は11個のエラーコードと一致する',
  'CLIモックと同じ流れでセーブの一覧に出たスロットを消せる',
  // base（V1 の後の main）にあった試験の全部（置き換えた 2 本を除く。V1 の試験と互換の試験を含む）
  ...baseTests.filter((n) => !replaced.includes(n)),
]);
// マイグレーション（V2 は表を足さない）・スコア・お知らせ・認証・手を入れない試験のファイルを変えない
gitClean(['migrations/', 'src/modules/rankings/', 'src/modules/announcements/', 'src/core/', 'scripts/issue-run/', 'scripts/test.mjs',
  'test/failure-input.test.ts', 'test/auth.test.ts', 'test/accounts.test.ts', 'test/games.test.ts', 'test/health.test.ts',
  'test/modules.test.ts', 'test/game-modules.test.ts', 'test/support/', 'wrangler.jsonc', pkg], { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり）。
- V1 の `base` の試験の名前は、2026-10-30 の main `8ac12cf` で 75 本（上の `namesIn` で数えた）。V2 の `base` は V1 が入った後の main なので、V1 の試験も自動で入る。
- `今のCLIモックと同じ形の要求を受け付ける` と `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` の**期待する結果の行**が変わっていないか（§8 の「名前も中身も変えない」「行を足すだけ」）は、名前と比べの 1 行までしか確認コマンドで見きれない。判定役が差分で見る。

## 12. 指示の表

| Issue #20 の指示 | どこで答えるか |
| --- | --- |
| 置き場（D1 か R2 か）と大きさの上限。上限の数字は公式の文書で確かめ、確かめられないものは要確認。R2 なら `wrangler.jsonc` に何を足すか | §1 の「Cloudflare の上限」・§2 の定数・§10 の決めること 1・2 |
| API（書く・読む・一覧など） | §3 |
| リビジョンによる楽観的な排他（409）・リビジョンの渡し方・初めての書き込み | §3・§5・§10 の決めること 6 |
| チェックサムの算法と誰が計算するか。パッケージを足さない案（`crypto.subtle.digest`）を 1 つ | §5・§10 の決めること 4 |
| 形式の版（サーバーは解釈しない・移し替えはクライアント・サーバーが何を返すか） | §2・§5・§10 の決めること 9 |
| 本体の形（JSON か base64 か） | §10 の決めること 3 |
| 履歴とスロットの数の上限・消す API | §10 の決めること 5・10・§3 の `DELETE` |
| 認証（読むのも書くのもトークン・他のプレイヤーのセーブを読めない）・`APP_ENV` の守りを外さない・読む API の守りは決めることに | §4・§10 の決めること 7・8 |
| `src/modules/saves/` と `game_modules` の `saves` の行・`demo-rpg` を使う設定にするか・変わる既存の試験の直し方（test-plan §11） | §2・§8・§10 の決めること 12 |
| CLI モックの変え方（どの束で、どう） | §6・§11 の V2 |
| 確かめ方（テストの名前。束は `V1`・`V2`） | §7 |
| 外部の保存先との同期・共有・管理画面からの修正は範囲の外で、後から足せる形 | §9 |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §11 |
