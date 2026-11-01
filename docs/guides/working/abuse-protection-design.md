# 利用制限とスコアの不正対策の設計書

`docs/guides/decisions/roadmap.md` Phase 1 の「スコア不正対策と利用制限の適用範囲を決定」の設計書。

どの API に・何を単位に（プレイヤー・IP・ゲーム）・何回までの利用制限を掛けるか（429 と `Retry-After`）・数える場所（D1・Durable Objects・Workers の Rate Limiting・WAF の規則）・二重送信（`Idempotency-Key`）の扱い・認証の無い書き込みの口（ゲストの発行）の守り方・スコアの不正対策でサーバーがやること／やらないこと・確かめ方（試験の名前）・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`。ゲーム固有のルールを共通のサーバーに入れない）と、これまでの設計書の決定: `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・`tenant_id` を持たない・機能の設定は認可の代わりにしない）・`docs/guides/working/account-design.md`（トークン `v1.<本文>.<HMAC>`・トークンの `p`・§10 の `APP_ENV` の守りを外す条件）・`docs/guides/working/save-design.md`（リビジョンで競合を止める・スロットの上限）・`docs/guides/working/config-design.md`（設定を読む API に守りを掛けない）。これらは「決めること」に戻さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。失敗ケースの試験の名前の正は `docs/guides/working/failure-case-test-plan.md`（K3 の残りの 2 本は §7 で名前で割り当てるだけで、§7 の表に写さない）。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§7 の試験の名前を `requireTests` に渡して実装の Issue を R1・R2 の順に回し、**同じ IP からゲストを発行し続ける・同じプレイヤーがスコアやセーブを連投すると 429 と `Retry-After` が返って行が増えず、CLI モック（`scripts/cli-mock.mjs`）の通しの流れは制限に掛からない**のを見て、`account-design.md` §10 の「守りを外す条件」のうち利用制限の部分（条件 2・3）が満たされ、サーバーがスコアについてどこまで守り、どこから守らないかが分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§10 に決めること（案と推し）、§11 に実装の束がある | 機械（Issue #26 の確認コマンド） |
| ADR 0002・元の設計書 4 つ・`operations-security.md`・`failure-case-test-plan.md`・429・`Retry-After`・`Idempotency-Key`・Durable Objects・D1・`APP_ENV`・`scripts/cli-mock.mjs`・`CLAUDE.md` が出てくる。ゲストの発行の扱い（§4）とスコアの不正対策の範囲（§6）が出てくる | 機械（同上） |
| K3 の残りの 2 本に名前で触れ、§7 の表に写していない。`スキーマのErrorCodeの列挙は11個のエラーコードと一致する`・`今のCLIモックと同じ形の要求を受け付ける` に名前で触れている（§8） | 機械（同上） |
| §7 の表の束は `R1`・`R2`。名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§11） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/`・`test/`・`migrations/` の下を除く） | 機械（同上） |
| サーバーがゲーム固有のスコアの確かめをしない（§6・ADR 0002）。`APP_ENV` の守りを外さない（§9）。Cloudflare の数字は確かめた所と「要確認」が分かれている（§1） | AI の判定（作っていない判定役が、§1〜§9 と `src/`・公式の文書を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§11 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 挙動の変わる既存の試験は §8 の手続きだけで直す。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束。§10 の決めること 1 の推しは新しいバインディングを要らない）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（§9）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

2026-10-30 の main（`09b7f3c`）の `src/`・`migrations/`・`test/`・`wrangler.jsonc` を読んで確かめた。

| 所 | いま |
| --- | --- |
| 書き込みの口 | `POST /v1/accounts/guest`（`src/core/accounts.ts`。**トークン無しで行を作る唯一の口**）・`POST /v1/rankings/{boardId}`・`PUT`／`DELETE /v1/saves/{slotId}`。どれも本文を読む前に `requireLocalWrite`（`APP_ENV !== 'local'` なら 403 `NOT_READY_FOR_PRODUCTION`） |
| トークンの要る読み取り | `GET /v1/saves/{slotId}`・`GET /v1/saves`（`requireLocalWrite` → `requireAuth` の順） |
| 公開の読み取り | `GET /health`・`/v1/announcements`・`/v1/rankings/{boardId}`・`/v1/config`・`/v1/config/master/{key}`。トークンも守りも無い（`config-design.md` §4） |
| ゲストの発行 | 1 回で `accounts` と `game_players` に 1 行ずつ（`batch`）。同じ本文で何度でも作れる。制限は無い |
| スコア | `parseScoreSubmission` が `Number.isSafeInteger` かつ 0〜1,000,000,000 を確かめ、DB にも `CHECK`。書き込みは `MAX(既存, 新しい)` で最高スコアだけ残る。プレイヤーはトークンの `p` と本文の `playerId` の突き合わせ（`requireSamePlayer`） |
| セーブ | `baseRevision` が合わなければ 409 `SAVE_CONFLICT`。同じ要求の 2 回目は 409 になる（行は 1 回分）。スロットは 1 プレイヤー 10 個（`src/modules/saves/limits.ts`） |
| 回数の制限 | どこにも無い。429 を返す所も、`Retry-After` も、`Idempotency-Key` を読む所も無い |
| エラーコード | 11 個（`test/schema-conformance.test.ts` の `errorCodes`。試験 `スキーマのErrorCodeの列挙は11個のエラーコードと一致する` が `openapi/rpg-online.v1.json` の `ErrorCode` と突き合わせる） |
| 応答の見出し | `src/core/http.ts` の `error(code, message, status)` は見出しを足せない（`content-type`・`cache-control` だけ） |
| `Env` | `src/core/env.ts` の `{ DB; APP_ENV; AUTH_TOKEN_SECRET? }`。`wrangler.jsonc` のバインディングは D1 の `DB` だけ |
| 試験の D1 | `test/apply-migrations.ts` が 1 回当てる。行はファイルの中の試験で共有され、ファイルごとの `beforeEach` が `DELETE` で消している（例: `test/auth.test.ts`） |

Cloudflare の機能（**公式の文書と、リポジトリに入っている wrangler 4.152.0 の `config-schema.json`・miniflare で確かめた**。2026-10-30）:

- **Workers の Rate Limiting のバインディング**: `wrangler.jsonc` の `ratelimits` に `name`・`namespace_id`・`simple: { limit, period }` を書く。`period` は **10 か 60 秒だけ**（公式の文書と `config-schema.json` の `enum: [10, 60]`）。公式の文書は「数は近似で、Cloudflare の拠点ごとに別に数える」「結果整合で、更新が届く前に上限を超えて通ることがある」「厳密な全体の上限には Durable Objects で作るのを勧める」「IP を鍵にするのは勧めない（多くの人が同じ IP を使う）」と書いている。miniflare（`node_modules/miniflare/dist/src/workers/ratelimit/`）にローカルの実装があるが、vitest の中で数が試験ごとに戻るかは**要確認**。
- **Durable Objects**: 1 つの鍵を 1 つのオブジェクトが順に処理するので厳密に数えられる。`wrangler.jsonc` に `durable_objects.bindings` と `migrations`（`new_sqlite_classes`）が要る。料金と無料枠は `docs/guides/decisions/operations-security.md` の方針どおりここに固定しない（**要確認**: 公式の価格表）。
- **WAF の利用制限の規則（ダッシュボード）**: Worker の手前で IP やパスごとに断れる。使えるプランと規則の数は**要確認**（公式の文書とダッシュボード）。リポジトリの外の設定。
- **`CF-Connecting-IP`**: 本番では Cloudflare が利用者の IP を入れる見出し。`wrangler dev` と vitest で付くかは**要確認**（付かないときの扱いは §3）。
- D1 の書き込みの速さ・1 日の書き込みの上限は**要確認**（`operations-security.md` の方針どおり数字を固定しない）。

元の文書から引く決まり:

- `docs/guides/decisions/operations-security.md` の公開前の必須要件 3（ランキング値の自己申告は改ざんできる）・4（IP・アカウント・ゲーム・エンドポイント単位の制限）・6（個人情報を最小にする。IP をそのまま残さない理由）・8（容量の制限）。
- `failure-case-test-plan.md` のケース 5 と §5 の決めること 4（送信 ID は `Idempotency-Key` の見出し）。
- `account-design.md` §10 の条件 2（K3 の残りの 2 本とゲストの発行の IP ごとの制限）・3（スコアの自己申告をどこまで信じるか）。
- `config-design.md` §4: 設定は公開の情報で、ゲストの発行より前に読む。→ 読む API に回数の制限を掛けない理由と同じ（§3）。

## 2. 何をどこで数えるか（全体）

| 口 | 単位（鍵） | 上限（推し） | 数える場所 | 束 |
| --- | --- | --- | --- | --- |
| `POST /v1/accounts/guest` | IP（`CF-Connecting-IP` のハッシュ） | 60 秒に 10 回 | D1 | R1 |
| `POST /v1/accounts/guest` | ゲーム（`gameId`） | 60 秒に 300 回 | D1 | R1 |
| `POST /v1/rankings/{boardId}` | プレイヤー（トークンの `g`・`p`） | 60 秒に 30 回 | D1 | R1 |
| `/v1/saves` の 4 つの操作（`PUT`・`GET`・一覧・`DELETE`） | プレイヤー（トークンの `g`・`p`） | 60 秒に 60 回（4 つで合わせて） | D1 | R2 |
| `GET /v1/inventory`・`GET /v1/inventory/history`（E2 でイベントの一覧・受け取りも合わせる） | プレイヤー（トークンの `g`・`p`） | 60 秒に 60 回（報酬の操作で合わせて。`RATE_LIMITS.rewards`） | D1 | E1（`event-reward-design.md`） |
| 管理の API（`/v1/admin/...` の全部の口） | IP（`CF-Connecting-IP` のハッシュ。正しい管理の鍵でも数え、鍵を確かめる前に数える） | 60 秒に 60 回（管理の口で合わせて。`RATE_LIMITS.admin`・単位の名前 `admin-ip`） | D1 | O1（`admin-design.md`） |
| `GET`・`POST /v1/player-data` | プレイヤー（トークンの `g`・`p`） | 60 秒に 60 回（2 つの口で合わせて。`RATE_LIMITS.playerData`・単位の名前 `player-data`） | D1 | U1（`player-data-design.md`） |
| `GET /v1/quests`・`POST /v1/quests/{questId}/claim` | プレイヤー（トークンの `g`・`p`） | 60 秒に 60 回（2 つの口で合わせて。`RATE_LIMITS.quests`・単位の名前 `quests`） | D1 | Q1（`quest-design.md`） |
| `POST /v1/accounts/token`（トークンの更新） | プレイヤー（トークンの `g`・`p`） | 60 秒に 10 回（`RATE_LIMITS.tokenRefresh`・単位の名前 `token-refresh`。ほかの操作とは別に数える） | D1 | B3（`client-integration-design.md` §2.7） |
| 公開の読み取り（`/health`・お知らせ・ランキングの `GET`・設定・マスターデータ） | — | 掛けない（Worker の中では） | 公開するときに WAF の規則で（§10 の決めること 1 の D） | — |

- 数・窓・単位の名前は**定数のモジュール 1 か所**（`src/core/rate-limit-policy.ts`）に置く（design-cycle §2）。上の表の数はそこの初期値で、変えるときは定数とこの表を同じコミットで直す。
- 数の理由: ゲストの発行の IP ごと 10 回／分は、CLI モックの通し（1 回で 1 人）を続けて回しても掛からず、1 つの IP から 1 日に作れる行を 14,400 組に抑える。ゲームごと 300 回／分は IP を替えて作る攻撃の上限（1 日 432,000 組）で、ふつうの開始の山（**要確認**: 実際のゲームの数。Phase 3 で測る）より大きく取る。スコア 30 回／分は 1 回の遊びに 1 回送る使い方の 2 秒に 1 回で、`failure-case-test-plan.md` の `同じプレイヤーが並べて連投しても最高スコアだけが残る`（20 本）を通す。セーブ 60 回／分は書く・読む・一覧・消すを 1 つの流れで使う CLI モック（5 回）とオートセーブ（**要確認**: 間隔）を見込む。
- 上げるのは互換を壊さない（通っていた要求は通る）。下げると壊すので、小さすぎない値から始める。

## 3. 数え方（R1）

### 固定の窓（ふつうの関数。`src/core/rate-limit.ts`）

入出力の無い関数にして、L1 の試験で確かめる（CLAUDE.md の「ロジックは入出力から外へ出す」）。

| 関数 | 入力 | 出力 |
| --- | --- | --- |
| `windowStart(nowSeconds, period)` | いまの秒・窓の長さ | `nowSeconds - nowSeconds % period` |
| `retryAfterSeconds(nowSeconds, period)` | 同じ | 窓の終わりまでの秒（切り上げ・1 以上・`period` 以下） |
| `decide(count, limit)` | この要求を足した後の数・上限 | `count <= limit` なら通す、超えたら断る |

- 窓は固定（60 秒ごとに数を 0 から）。窓の境目で最大 2 倍まで通る弱みがあるが、表の 1 行で数えられて、試験で開始状態を入れやすい（§10 の決めること 3）。

### 表（`migrations/` の新しい番号 `0008_rate_limits.sql`）

```sql
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  scope TEXT NOT NULL,          -- 'guest-ip'・'guest-game'・'score'・'saves'・'rewards'・'admin-ip'・'player-data'・'quests'・'token-refresh'（定数のモジュールの名前。rewards は E1、admin-ip は O1、player-data は U1、quests は Q1、token-refresh は B3 で足した）
  subject TEXT NOT NULL,        -- IP のハッシュ・gameId・'<gameId>:<playerId>'
  window_start INTEGER NOT NULL, -- 窓の始まり（UNIX 秒）
  count INTEGER NOT NULL CHECK (count >= 1),
  PRIMARY KEY (scope, subject, window_start)
);
```

数える 1 回（`src/core/rate-limit.ts` の `consume(db, rule, subject, nowSeconds)`）は `batch` の 2 文:

```sql
INSERT INTO rate_limit_counters (scope, subject, window_start, count) VALUES (?, ?, ?, 1)
  ON CONFLICT (scope, subject, window_start) DO UPDATE SET count = count + 1
  RETURNING count;
DELETE FROM rate_limit_counters WHERE scope = ? AND subject = ? AND window_start < ?;  -- 同じ鍵の古い窓
```

- 1 つの文で足して数を返すので、並べた要求でも数え漏れが無い（D1 は 1 つの書き手で文を順に流す）。
- 古い窓は同じ鍵の次の要求で消える。来なくなった鍵の行は残る（1 鍵 1 行）。まとめて消すのは後から（§12）。
- 断った要求も数える（数えてから比べる）。攻撃を続けるほど窓の中で断られ続ける。
- DB の失敗は入口の `try/catch` で 500 `INTERNAL_ERROR`（制限を確かめられないときは通さない）。

### 鍵

- IP: `CF-Connecting-IP` の値の SHA-256（16 進）を `subject` にする。IP をそのまま残さない（`operations-security.md` の 6）。見出しが無いとき（vitest・`wrangler dev` で付かないとき。§1 の要確認）は `'no-ip'` の 1 つの鍵で数える（**見出しが無いことを理由に数えずに通さない**。本番で付かない事故があっても、通し放題にならず、全員が 1 つの鍵で止まる側に倒れる）。ローカルで見出しが付かないなら、`npm run cli:smoke` を 1 分に 10 回より多く回すと 429 になる（ふつうの使い方では掛からない。掛かったら `Retry-After` の秒だけ待つ）。
- プレイヤー: トークンの `g` と `p`（`requireAuth` の後）。本文の `playerId` は使わない。
- ゲーム: ゲストの発行の本文の `gameId`（形を確かめ、ゲームの登録を確かめた後）。

### 応答（§10 の決めること 4）

```text
HTTP/1.1 429
Retry-After: 37
content-type: application/json; charset=utf-8

{"error":{"code":"RATE_LIMITED","message":"Too many requests"}}
```

- 新しいエラーコード `RATE_LIMITED`（429）を 1 つ足す（12 個になる）。どの鍵で断ったか・上限の数は本文に入れない（攻撃の手がかりを減らす。クライアントは `Retry-After` だけ見ればよい）。
- `Retry-After` は秒の整数（`retryAfterSeconds`）。`src/core/http.ts` の `error` に見出しを足せる引数（`headers`）を足す。
- 断ったときは行を作らない・変えない（数の表だけ増える）。

### 検査の順（どこに挟むか）

| 口 | 順（太字が足す所） |
| --- | --- |
| ゲストの発行 | ルート → `requireLocalWrite`（403）→ **IP の制限（429）** → JSON（400）→ 本文の形（400）→ ゲームの登録（404）→ **ゲームの制限（429）** → 鍵 → 書き込み |
| スコアの投稿 | ルート → `requireLocalWrite`（403）→ `requireAuth`（401）→ JSON（400）→ 形（400）→ **プレイヤーの制限（429）** → なりすまし（403）→ ゲームの登録 → 書き込み（R1 の実装で、制限を JSON の前から形の後へ移した。既存の試験 `形の正しくないgameIdはゲームの登録を引く前にINVALID_ARGUMENTの400を返す` は壊れた DB を渡して 400 を待つので、形の外れた要求で DB を引けないため。鍵はトークンの `g`・`p` なので、本文を読んだ後でも偽れない） |
| セーブ（R2） | ルート → `requireLocalWrite`（403）→ `requireAuth`（401）→ **プレイヤーの制限（429）** → `gameId` → トークンのゲーム → …（`save-design.md` §3 の順のまま） |
| トークンの更新（B3） | ルート → `requireLocalWrite`（403）→ `requireAuth`（401）→ **プレイヤーの制限（429）** → 止めた印（403 `PLAYER_BANNED`）→ 新しいトークン（本文は読まない。`client-integration-design.md` §2.7） |

- `APP_ENV` の守りが一番先（本番の設定では数の表にも書かない）。トークンの無い・正しくない要求は数えない（401 が先。他人のプレイヤーの数を減らさせない）。
- IP の制限は本文を読む前（本文を読まずに断る）。ゲームの制限は `gameId` が要るので登録の後。

## 4. ゲストの発行（認証の無い書き込みの口）の守り方

ゲストの発行はトークン無しで `accounts`・`game_players` の行を作れる唯一の口で、制限が無いと表を際限なく大きくできる（`operations-security.md` の 8）。

1. **IP ごと**（60 秒に 10 回）で 1 つの機械からの乱造を止める。`account-design.md` §10 の条件 2 の「ゲストの発行そのものの利用制限（IP ごと）」がこれ。
2. **ゲームごと**（60 秒に 300 回）で IP を替える乱造の上限を決める。弱み: 攻撃者が上限を使い切ると、その窓の間は正しい利用者も発行できない（429 と `Retry-After` が返り、クライアントは待って発行し直す）。行が際限なく増えるより軽いので受け入れる。
3. 作った行を消す仕組み（遊ばれなかったゲストの掃除）は範囲の外（§12。Phase 2 の管理機能）。
4. 本人確認（CAPTCHA・端末の証明・プラットフォームの認証）は範囲の外。ゲストのアカウントが本人確認でないことは公開の説明に書く（`account-design.md` §10 の条件 3）。

## 5. 二重送信（`Idempotency-Key`）の扱い（§10 の決めること 5）

**いまの 3 つの書き込みには掛けない（見出しは受け取って無視する）。** 理由:

- スコアの投稿は `MAX` で最高スコアだけを残すので、同じ要求を何度送っても記録と応答が同じ（K2 の `同じスコアを二重送信しても行は1つで結果は同じ` が見張っている）。
- セーブは `baseRevision` で止まり、2 回目は 409 `SAVE_CONFLICT` になって 2 回書かれない。応答が 1 回目と違うのは、クライアントが `GET` でリビジョンを読み直して確かめる（`save-design.md` §5 の使い方）。
- ゲストの発行は 2 回送ると 2 人できるが、使われない 1 人が残るだけで、表の大きさは §4 の制限で抑える。

これにより K3 の `同じ送信IDの二重送信は1回分として扱う` は、`Idempotency-Key` を付けたスコアの投稿を 2 回送って「2 回とも同じ 200 の本文・行は 1 つ・スコアは 1 回分」を見る試験になる（R1。見出しを読まない実装で通ることを、この設計で決めた挙動として固定する）。利用制限の数は 2 回分数える（見出しを読まないため）。

送るクライアントの側: CLI モックと 3 つのクライアントは見出しを付けなくてよい。付けても害は無い。

**後から足す形**（結果が足し算になる書き込み。Phase 2 の報酬の受け取り・所持品の付与。`docs/guides/working/architecture.md` の「冪等性」の行）:

- 表 `idempotency_keys(game_id, player_id, idem_key, request_hash, status, response_body, created_at, PRIMARY KEY (game_id, player_id, idem_key))`。同じ鍵と同じ本文なら保存した応答を返し、同じ鍵で違う本文なら 422（新しいエラーコード）。期限は 24 時間（**要確認**: クライアントの再試行の長さ。Phase 3）。
- 書き込みと鍵の保存は同じ `batch` に入れる（片方だけ残らない）。

## 6. スコアの不正対策でサーバーがやること／やらないこと

サーバーはゲーム固有のルールを持たない（ADR 0002）。**ゲームを問わず効くものだけ**をやる。

| やる（ゲームを問わない） | どこで | いつ |
| --- | --- | --- |
| トークンのプレイヤーだけが自分のスコアを書ける | `requireAuth`・`requireSamePlayer` | 済み（A2） |
| 値の範囲の上限: 安全な整数・0〜1,000,000,000 | `parseScoreSubmission` と DB の `CHECK` | 済み（K1） |
| 時刻はサーバーが付ける（クライアントの時刻を受け取らない） | `updated_at = datetime('now')` | 済み（K2） |
| 最高スコアだけ残す（二重送信・低い値の再送で記録が崩れない） | `MAX` の書き込み | 済み（K2） |
| 回数の制限（プレイヤーごと 60 秒に 30 回）と、ゲストの乱造の制限（§4） | §3 | R1 |

| やらない（範囲の外） | 理由 | 後から足せる形 |
| --- | --- | --- |
| 「このスコアがゲームの中で取れるか」の確かめ（ステージごとの最高点・経過時間との比べ・リプレイの照合） | ゲーム固有のルール（ADR 0002）。`operations-security.md` の 3 の「サーバー側検証、リプレイ照合」はゲームの側の作者が持つもの | **ボードごとの上限の設定**: 表 `ranking_boards(game_id, board_id, max_score)` をマイグレーションで入れ、行があればその `max_score` を超える投稿を 400 `INVALID_ARGUMENT` にする（無ければいまの 10 億）。共通の仕組み（数の上限）だけで、意味はゲームの作者が決める |
| 改造したクライアントを見分ける | ゲストのトークンは誰でも取れ、クライアントの申告は偽れる | プラットフォームの認証（Steam 等。`account-design.md` §11 の `account_identities`）と、Phase 2 の管理機能での BAN・記録の取り消し |
| 不審な記録の自動の検出・取り消し | 基準がゲームごとに違う | Phase 2 の管理機能（ログ・BAN・データ修正） |

**限界（そのまま書く）**: 改造したクライアントは、範囲の内（10 億まで）のどんなスコアでも、制限の内の回数で送れる。ゲストは IP の制限の内で何人でも作れるので、プレイヤーごとの制限は人を替えればすり抜けられる（上限は §4 の IP ごと・ゲームごとの数）。競争の強いランキングを公開するゲームは、ボードごとの上限とゲーム側の検証を足すまで、記録を「申告」として扱う（公開の説明に書く）。

## 7. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は R1 が `test/rate-limits.test.ts`（L1 の 3 本も同じファイル）、R2 が `test/saves-rate-limits.test.ts`、スキーマの 2 本は `test/schema-conformance.test.ts`、CLI モックの 1 本は `test/failure-server.test.ts`。

試験の作り方:

- 制限を超える試験は、**数の表に開始状態を入れて**から 1 回送る（例: いまの窓と次の窓の両方に `count = 上限` の行を入れる）。上限の回数を送ると窓の境目をまたいで落ちたり通ったりするので、そうしない。
- IP ごとの試験は `CF-Connecting-IP` を試験ごとに違う値で付ける。
- ほかの試験が制限に掛からないように、書き込みをするファイルの `beforeEach` に `DELETE FROM rate_limit_counters` を足す（`test/support/` の手伝い `resetRateLimits(db)`。§8 の手続き。§10 の決めること 6）。

| 束 | テストの名前 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- |
| R1 | `利用制限の窓の始まりと残りの秒は時刻と長さから決まる` | L1 | `windowStart(125, 60)`・`retryAfterSeconds(125, 60)`・`retryAfterSeconds(120, 60)` | 120・55・60 |
| R1 | `足した後の数が上限までなら通し上限を超えたら断る` | L1 | `decide(30, 30)`・`decide(31, 30)` | 通す・断る |
| R1 | `利用制限の回数と窓は定数のモジュールにある` | L1 | `src/core/rate-limit-policy.ts` の書き出し | `guest-ip` 10／60・`guest-game` 300／60・`score` 30／60・`saves` 60／60・`rewards` 60／60・`admin-ip` 60／60・`player-data` 60／60・`quests` 60／60・`token-refresh` 10／60（§2 の表と同じ。`token-refresh` は B3 で足した） |
| R1 | `同じIPからゲストを上限より多く発行すると429とRetry-Afterを返し行を作らない` | L2 | `CF-Connecting-IP: 203.0.113.1` の鍵に `count = 10` を入れてゲストを発行 | 429・`RATE_LIMITED`・`Retry-After` が 1〜60 の整数。`accounts` と `game_players` の行は増えない |
| R1 | `ゲストの発行の利用制限はIPごとに別に数える` | L2 | `203.0.113.1` を上限まで埋め、`203.0.113.2` で発行 | 200 で発行できる |
| R1 | `ゲームごとのゲストの発行の上限を超えると429を返す` | L2 | `guest-game`・`demo-rpg` に `count = 300` を入れ、新しい IP で発行 | 429・`RATE_LIMITED`。行は増えない |
| R1 | `利用制限の表にIPをそのまま残さない` | L2 | `CF-Connecting-IP: 203.0.113.9` でゲストを 1 回発行 | `rate_limit_counters` のどの行の `subject` にも `203.0.113.9` が無い（64 文字の 16 進がある） |
| R1 | `スコアの投稿の利用制限はプレイヤーごとに別に数える` | L2 | `score`・`demo-rpg:p1` に `count = 30` を入れ、`p2` のトークンで投稿 | `p2` は 200。`p1` の投稿は 429 |
| R1 | `トークンの無い書き込みは利用制限を数えず401を返す` | L2 | `Authorization` 無しでスコアを 1 回投稿 | 401・`UNAUTHENTICATED`。`rate_limit_counters` に行が無い |
| R1 | `本番の設定では利用制限より先にNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV=disabled` でゲストの発行とスコアの投稿 | どちらも 403・`NOT_READY_FOR_PRODUCTION`。`rate_limit_counters` に行が無い |
| R1 | `前の窓の数は次の窓に持ち越さない` | L2 | 前の窓（`window_start` が 60 秒前より前）に `count = 30` を入れて投稿 | 200。その鍵の前の窓の行は消えている |
| R1 | `429の応答はスキーマに合う` | L2 | 制限を超えたスコアの投稿 | 本文が `openapi/rpg-online.v1.json` の 429 の応答と `Error` に合い、`Retry-After` の見出しがスキーマに書いてある |
| R1 | `スキーマのErrorCodeの列挙は12個のエラーコードと一致する` | L1 | スキーマの `ErrorCode` | `errorCodes`（いまの 11 個と `RATE_LIMITED`）と同じ |
| R1 | `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` | L2 | `scripts/cli-requests.mjs` の関数でゲストの発行・スコア・セーブの流れを 2 回（同じ `CF-Connecting-IP`） | 全部 200（429 が 1 つも無い） |
| R2 | `セーブの操作を上限より多く呼ぶと429とRetry-Afterを返す` | L2 | `saves`・`demo-rpg:p1` に `count = 60` を入れ、`p1` で `GET /v1/saves` | 429・`RATE_LIMITED`・`Retry-After` |
| R2 | `セーブの利用制限で断った書き込みはリビジョンを進めない` | L2 | リビジョン 1 のスロットがある状態で上限まで埋め、`baseRevision: 1` で `PUT` | 429。行のリビジョンは 1 のまま・`data` も同じ |
| R2 | `セーブの利用制限はスコアの投稿と別に数える` | L2 | `score`・`demo-rpg:p1` を上限まで埋め、`p1` でセーブを書く | 200（`saves` の数は別） |

数（行）: R1 が 14・R2 が 3。

### K3（失敗ケースの計画の残りの 2 本）の割り当て

名前と入力の正は `failure-case-test-plan.md` §3。ここでは束と、この設計で決めた中身だけを書く。

| テストの名前 | 束 | この設計で決めた中身 |
| --- | --- | --- |
| `決めた回数を超えて連投すると429を返す` | R1 | 同じプレイヤーのスコアの投稿で、`score` の鍵に `count = 30` を入れてから 1 回 POST → 429・`RATE_LIMITED`・`Retry-After`。ランキングの行は変わらない（§3）。**計画の入力（上限を超える回数を POST）からの違い**: 30 回分を表に入れて 31 回目だけ送る。数える所は同じで、窓の境目をまたいで結果が揺れないため（§7 の試験の作り方）。失敗ケースの計画の入力の書き方は、R1 の実装の Issue で計画の側をこの形に置き換える |
| `同じ送信IDの二重送信は1回分として扱う` | R1 | 同じ `Idempotency-Key` を付けたスコアの投稿を 2 回 → 2 回とも 200 で同じ本文。行は 1 つ・スコアは 1 回分（§5。見出しを読まない実装で通る） |

## 8. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `スキーマのErrorCodeの列挙は11個のエラーコードと一致する` | R1 | コードが 12 個になり、名前の「11個」が嘘になる（名前の中の数で挙動が変わる） | 消して、§7 の `スキーマのErrorCodeの列挙は12個のエラーコードと一致する` に置き換える。`errorCodes` に `RATE_LIMITED` を足す |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` | R1 | `errorCodes` と起こしたコードの集合を突き合わせるので、`RATE_LIMITED` を起こす行が要る | `submitScore` で 429 を起こす行を足す。いまの行と期待は変えない（見る範囲は増える） |
| `今のCLIモックと同じ形の要求を受け付ける` | R1 | 変わらない（CLI モックの要求の形は変えない）。制限の内の回数なので通る | 変えない。API を変えたら CLI モックも直す合図のまま |
| ゲストの発行・スコアの投稿・セーブを呼ぶ試験のファイル（`test/accounts.test.ts`・`test/auth.test.ts`・`test/failure-input.test.ts`・`test/failure-server.test.ts`・`test/games.test.ts`・`test/game-modules.test.ts`・`test/saves.test.ts`・`test/saves-manage.test.ts`・`test/schema-conformance.test.ts`） | R1（セーブは R2） | ファイルの中の試験が同じ鍵（`'no-ip'`・`p1`）を共有するので、続けると制限に掛かりうる | **開始状態だけ**を直す: `beforeEach` に `resetRateLimits(db)` を足す（無いファイルは `beforeEach` を足す）。要求・期待する結果は 1 文字も変えない |
| `スキーマのファイルはOpenAPI 3.1で11個の操作を持つ` | — | 変わらない（操作を足さない。429 は既存の操作の応答に足す） | 変えない |
| `マイグレーションを2回当ててもデータは壊れない` | R1 | 変わらない（`0008` は `IF NOT EXISTS` だけ） | 変えない |

## 9. `APP_ENV`・`CLAUDE.md`・文書のどこが変わるか

- **`APP_ENV === 'local'` の時だけ書き込みを通す守りは外さない**（`CLAUDE.md` の「守るもの」）。この設計は `account-design.md` §10 の条件 2・3 を満たすためのもので、R1・R2 が合格しても守りを外すかはユーザーが決める。§3 の順のとおり、守りは制限より先。
- R1 を実装した Issue で直す所（この Issue では変えない。CLAUDE.md 原則 5 で旧文を置き換える）:
  - `docs/api-contract.md`: 冒頭の「ログイン・レート制限・不正対策が未実装」を「ログインは未実装（ゲストのトークンだけ）。書き込みの口とセーブに回数の制限（429・`Retry-After`）。スコアは値の範囲と回数まで」に置き換え、エラーコードの表に `RATE_LIMITED` を足す。`openapi/rpg-online.v1.json` の `ErrorCode` と、ゲストの発行・スコアの投稿（R2 でセーブの 4 つ）に 429 の応答と `Retry-After` の見出し。
  - `docs/guides/working/architecture.md`: 利用制限の置き場（`src/core/rate-limit.ts`・`rate_limit_counters`）。
- 守りを外すとき（ユーザーが決めた後）に直す所:
  - `CLAUDE.md` のプロジェクトの行「認証・レート制限・不正対策は未実装」を「認証はゲストのトークン・利用制限は D1 の固定窓・スコアは値の範囲と回数まで（ゲーム固有の確かめは無い）」の形に置き換える。
  - `docs/guides/decisions/operations-security.md`: 冒頭の「現状」と、公開前の必須要件 3（§6 の範囲と限界）・4（§2 の表。読む API は WAF の規則で）を満たした形を書く。

## 10. 決めること

推しの案で §2〜§9 を書いた。違う案にするときは、該当する節と §7 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 数える場所 | A: **D1 の表（`rate_limit_counters`。§3）**。B: Durable Objects（鍵ごとに 1 つ。`wrangler.jsonc` に `durable_objects.bindings` と `migrations` の `new_sqlite_classes` を足す）。C: Workers の Rate Limiting のバインディング（`wrangler.jsonc` に `ratelimits: [{ name, namespace_id, simple: { limit, period } }]` を足す。`period` は 10 か 60）。D: WAF の利用制限の規則（ダッシュボード） | **A**。`wrangler.jsonc` もパッケージも変えずに済み、いまの D1 で厳密に数えられて、試験で開始状態を入れられる。弱みは書き込み 1 回につき D1 の書き込みが 1 回増えること（**要確認**: D1 の上限）。B は厳密で速いが、バインディングとクラスの書き出しと試験の作りが増える。D1 の書き込みが重くなったら B へ移す（`consume` の中だけ替える）。C は拠点ごとの近似で、公式の文書が厳密な上限に勧めていない・IP を鍵にするのを勧めていない・窓が 10 か 60 秒だけ。D は公開の読み取りの守りとして、公開するときに足す（Worker の手前で断れる。リポジトリの外） |
| 2 | 単位と回数 | A: **§2 の表（ゲストは IP とゲーム、書き込みはプレイヤー）**。B: どれも IP だけ。C: プレイヤーだけ（ゲストの発行は制限しない） | **A**。プレイヤーの鍵はトークンで偽れない。IP は多くの人が共有しうる（公式の文書の注意）ので、トークンの無いゲストの発行だけに使う。B は同じ IP の後ろの正しい利用者を巻き込む。C はゲストの乱造を止められない（`account-design.md` §10 の条件 2 を満たさない） |
| 3 | 窓の形 | A: **固定の窓**。B: 滑る窓（前の窓の数を重みで足す）。C: トークンのバケツ | **A**。表の 1 行と 1 つの文で数えられ、試験で開始状態を入れやすい。境目で最大 2 倍まで通るが、§2 の数は余裕を見てあり、守る目的（行の乱造と連投を止める）には足りる |
| 4 | 429 の応答 | A: **新しいコード `RATE_LIMITED` と `Retry-After`（秒）**。B: コードを足さず `INVALID_ARGUMENT` を 429 で返す。C: `Retry-After` を付けない | **A**。クライアント（CLI・UE・Unity・ブラウザ）がコードで分けて、待つ秒を見出しから読める（HTTP の決まりどおり）。B はコードの意味が混ざる。C はクライアントが待つ長さを決められない。エラーコードが 12 個になる（§8） |
| 5 | `Idempotency-Key` を掛ける口 | A: **いまの 3 つの書き込みには掛けない（受け取って無視）。Phase 2 の足し算の書き込みに掛ける**（§5）。B: スコアの投稿とセーブに掛ける（表を足す）。C: 全部の書き込みに掛ける | **A**。スコアは `MAX` で結果が同じ、セーブはリビジョンで止まる、ゲストは乱造の制限で抑える。B・C は表と期限と本文の比べを作るのに、守る結果がいまと変わらない。報酬・所持品（Phase 2）で 2 回付与が起きうる所に、§5 の後から足す形で掛ける |
| 6 | 試験とローカルで、ほかが制限に掛からないようにする | A: **書き込むファイルの `beforeEach` で数の表を消す（`resetRateLimits`）。制限の試験は表に開始状態を入れる**。B: `Env` に制限を切る値（例: `RATE_LIMITS=off`）を足し、試験の `env` だけで切る。C: `CF-Connecting-IP` が無いときは数えない | **A**。本物の数え方を全部の試験で通しつつ、ファイルの中の試験が前の数に頼らない（いまの `DELETE` の作りと同じ）。ローカル（`npm run dev`）は §2 の数が CLI モックの通しより十分大きいので掛からない（§7 の `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` が見張る）。B は本番で切られる道を作り、`wrangler.jsonc` の値を増やす。C は本番で見出しが無いと通し放題になる |
| 7 | パッケージ | A: **足さない（D1 と Web Crypto の SHA-256 だけ）**。B: 利用制限の部品（npm の rate limiter 等）を足す | **A**。§3 は表 1 つと関数 3 つで書け、`package.json` を変えずに済む。B は Workers のランタイムで動くかの確かめが増え、数える場所は結局 D1 か Durable Objects が要る |
| 8 | セーブの読み取りも数えるか | A: **4 つの操作を合わせて数える（R2）**。B: 書く・消すだけ数える。C: 数えない | **A**。読み取りも 64 KiB の本体を D1 から読むので、トークンを持つ人の連打の重さは書き込みと変わらない。1 つの鍵で数えれば表の行も増えない。公開の読み取り（設定・ランキング）と違い、プレイヤーの鍵で数えられる |

## 11. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| R1 | `migrations/` の新しい `0008_rate_limits.sql`・`src/core/rate-limit.ts`（§3 の関数と `consume`）・`src/core/rate-limit-policy.ts`（定数）・`src/core/http.ts` の見出しの引数・`src/core/accounts.ts` と `src/modules/rankings/index.ts` に §3 の順で挟む・`test/support/` の `resetRateLimits`・§9 の契約の変わる所（ゲストの発行とスコアの投稿）・CLI モックの 429 の表示（下）・§7 の R1 の試験と K3 の 2 本 | A2（`account-design.md`） | §8 の手続きで 1 本を置き換え・1 本に行を足し・`beforeEach` を足す | 足さない |
| R2 | `src/modules/saves/index.ts` の `checkAccess` に §3 の順で挟む・セーブの 4 つの操作の 429 の契約・§7 の R2 の試験 | R1 | セーブの試験のファイルに `beforeEach` を足す | 足さない |

CLI モック（`scripts/cli-mock.mjs`）の変え方（R1）: 要求の形は変えない（`Idempotency-Key` も付けない。§5）。1 回の通しはゲストの発行 1・スコア 1・セーブ 5 回で、§2 の数に掛からない。429 を受けたら `call()` の表示に `Retry-After` の秒を足して（例: `POST /v1/rankings/boss-score: 429 {...} retry-after=37`）、いまと同じく `HTTP 429` で止まる（再試行はしない。再試行の回数と時間は `failure-case-test-plan.md` の K4・Phase 3）。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。`gitClean` は `base` を渡さないと作業ツリーしか見ないので、先頭の `base` に**実装の Issue を作るときの main のコミットの SHA** を書き入れる（`docs/guides/procedures/issue-goal-setting.md`）。

R1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0008_rate_limits.sql', 'src/core/rate-limit.ts', 'src/core/rate-limit-policy.ts', 'test/rate-limits.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check((spec.components?.schemas?.ErrorCode?.enum ?? []).includes('RATE_LIMITED'), 'スキーマの ErrorCode に RATE_LIMITED がある');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(!all.includes('スキーマのErrorCodeの列挙は11個のエラーコードと一致する'), '置き換えた試験が残っていない（11個）');
runTests();
requireTests([
  '利用制限の窓の始まりと残りの秒は時刻と長さから決まる',
  '足した後の数が上限までなら通し上限を超えたら断る',
  '利用制限の回数と窓は定数のモジュールにある',
  '同じIPからゲストを上限より多く発行すると429とRetry-Afterを返し行を作らない',
  'ゲストの発行の利用制限はIPごとに別に数える',
  'ゲームごとのゲストの発行の上限を超えると429を返す',
  '利用制限の表にIPをそのまま残さない',
  'スコアの投稿の利用制限はプレイヤーごとに別に数える',
  'トークンの無い書き込みは利用制限を数えず401を返す',
  '本番の設定では利用制限より先にNOT_READY_FOR_PRODUCTIONの403を返す',
  '前の窓の数は次の窓に持ち越さない',
  '429の応答はスキーマに合う',
  'スキーマのErrorCodeの列挙は12個のエラーコードと一致する',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
  '決めた回数を超えて連投すると429を返す',
  '同じ送信IDの二重送信は1回分として扱う',
  '今のCLIモックと同じ形の要求を受け付ける',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// セーブ・設定・お知らせ・守り・既存のマイグレーションを変えない（R2 で触る）
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data']
  .map((m) => `migrations/${m}.sql`);
const keep = ['src/modules/saves/', 'src/modules/config/', 'src/modules/announcements/', 'src/core/guards.ts', ...migrations,
  'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

R2:

```js
import { runTests, requireTests, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
import { readFileSync } from 'node:fs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const pkg = ['package', 'json'].join('.');
check(/\bconsume\(/.test(readFileSync('src/modules/saves/index.ts', 'utf8')), 'セーブのモジュールが利用制限（consume）を呼ぶ');
runTests();
requireTests([
  'セーブの操作を上限より多く呼ぶと429とRetry-Afterを返す',
  'セーブの利用制限で断った書き込みはリビジョンを進めない',
  'セーブの利用制限はスコアの投稿と別に数える',
  '決めた回数を超えて連投すると429を返す',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
]);
const keep = ['src/core/guards.ts', 'src/core/rate-limit.ts', 'src/modules/rankings/', 'src/modules/config/', 'migrations/', 'wrangler.jsonc', pkg];
gitClean(keep, { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり）。

## 12. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 公開の読み取り（設定・お知らせ・ランキング）の回数の制限 | 公開するときに WAF の利用制限の規則（§10 の決めること 1 の D）。Worker の中で数えるなら、IP の鍵で §3 の `consume` を呼ぶだけ（表は同じ） |
| 来なくなった鍵の古い行の掃除 | `wrangler.jsonc` に Cron の `triggers` を足し、`DELETE FROM rate_limit_counters WHERE window_start < ?` を 1 日 1 回 |
| 使われないゲストの掃除 | Phase 2 の管理機能（最後に使った時刻の列を足し、期限を過ぎた `game_players` と `accounts` を消す） |
| `Idempotency-Key` の保存 | §5 の表（Phase 2 の報酬・所持品） |
| ゲームごとのスコアの確かめ | §6 の `ranking_boards` の上限と、ゲーム側の検証・リプレイの照合（ゲームの作者） |
| ゲームごとに上限の数を変える | 定数のモジュールの値を、ゲームの表の列か設定（`config-design.md`）から読む形に替える（機能の設定は認可の代わりにしないので、上限の値だけ） |
| D1 から Durable Objects へ移す | §10 の決めること 1 の B。`consume` の中だけ替え、§7 の L2 の試験はそのまま使う |

## 13. 指示の表

| Issue #26 の指示 | どこで答えるか |
| --- | --- |
| どの API に・何を単位に・何回まで（429 と `Retry-After`） | §2・§3・§10 の決めること 2・4 |
| 数える場所（D1・Durable Objects・Rate Limiting・WAF）と、`wrangler.jsonc` に足すもの。Cloudflare の数字は公式で確かめるか「要確認」 | §1・§10 の決めること 1 |
| 二重送信（`Idempotency-Key`）。最高スコアだけ残す・セーブのリビジョンを踏まえて推し | §5・§10 の決めること 5 |
| 認証の無い書き込みの口（ゲストの発行）の守り方 | §4 |
| スコアの不正対策でやること／やらないこと。ゲーム固有の確かめは範囲の外、後から足せる形、改造クライアントの限界 | §6 |
| `APP_ENV` の守りは外さない。`CLAUDE.md` と `operations-security.md` のどこを変えるか | §9 |
| 試験とローカルで、ほかの試験が制限に掛からないようにする | §7 の試験の作り方・§10 の決めること 6 |
| 新しいパッケージは案だけ・足さない案を 1 つ | §10 の決めること 7 |
| CLI モックが制限に掛からないか・429 の表示 | §11 の CLI モックの変え方・§7 |
| K3 の残りの 2 本・`スキーマのErrorCodeの列挙は11個のエラーコードと一致する`・`今のCLIモックと同じ形の要求を受け付ける` | §7 の K3 の割り当て・§8 |
| 束の印は `R1`・`R2`… | §7・§11 |
