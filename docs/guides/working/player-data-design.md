# プレイヤーデータ（実績・進行状態・統計値）の設計書

`docs/guides/decisions/roadmap.md` Phase 2 の「プレイヤーデータ（実績・進行状態・統計値）」の設計書。`docs/guides/working/event-reward-design.md` §13 が順 2 に置いた（順 1 の管理は `docs/guides/working/admin-design.md` で済んだ）。次の「クエスト」の前提になる。

何を持つか（実績・進行状態・統計値の分け方）とセーブとの境目・データの形（D1 の表・新しいマイグレーションの番号）とキーの決め方・書き方（増やす・最大値で置く・値で置く・真偽を立てる）とクライアントの自己申告をどこまで信じるか・二重の止め方と利用制限・実績の解除を誰が決めるか・API とその確かめの順・認証と `APP_ENV` と BAN・管理との関係・`scripts/cli-mock.mjs` の通しのシナリオ・試験の名前・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`。ゲーム固有のルールを共通のサーバーに入れない）と、これまでの設計書の決定: `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・機能の設定 `game_modules` は認可の代わりにしない）・`docs/guides/working/account-design.md`（プレイヤーはトークンの `p` だけで決まる・`requireAuth`）・`docs/guides/working/save-design.md`（セーブの本文をサーバーが解釈しない・リビジョン）・`docs/guides/working/config-design.md`（マスターデータはサーバーが解釈しない）・`docs/guides/working/abuse-protection-design.md`（D1 の固定窓の `consume`・スコアの自己申告の扱い・`Idempotency-Key` の後から足す形）・`docs/guides/working/event-reward-design.md`（サーバーが持つものの分け方・一意の鍵と 1 つの `batch`）・`docs/guides/working/admin-design.md`（管理の口・監査のログ `admin_audit_log`・BAN の `requireNotBanned`）。これらは「決めること」に戻さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（ゲームのクライアントの形）・`openapi/rpg-online-admin.v1.json`（管理の口の形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§10 の試験の名前を `requireTests` に渡して実装の Issue を U1〜U3 の順に回し、**CLI モック（`scripts/cli-mock.mjs`）がゲストのトークンで、ゲームが宣言したキーの統計値を増やし（同じ `Idempotency-Key` で送り直しても 1 回分にしかならない）、統計値が閾値を越えるとサーバーが実績を解いて応答に載せ、宣言していないキー・範囲の外の値・1 回の上限を超える増加が断られることを §10 の試験が確かめ、管理コマンド（`scripts/admin-cli.mjs`）がそのプレイヤーの値と実績を読み、直すと監査のログに前と後が残る**のを見て、サーバーがゲームの中の意味（実績の名前・説明・解除の意味）を持たずに数と真偽だけを持ち、クエストと分析がそれを数として読めると分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§13 に決めること（案と推し）、§14 に実装の束、§16 に範囲の外がある | 機械（Issue #38 の確認コマンド） |
| ADR 0002・元の文書（`roadmap.md`・`account-design.md`・`save-design.md`・`config-design.md`・`abuse-protection-design.md`・`event-reward-design.md`・`admin-design.md`）・`game_modules`・`APP_ENV`・`requireAuth`・`requireNotBanned`・`consume`・`RATE_LIMITED`・`Idempotency-Key`・D1・`scripts/cli-mock.mjs`・`scripts/admin-cli.mjs`・`CLAUDE.md` が出てくる。実績・進行状態・統計値・マスターデータ・セーブ・自己申告・二重・監査の扱いが出てくる | 機械（同上） |
| Phase 2 の残りの項目（クエスト・分析）に触れている（§15） | 機械（同上） |
| 名前の中の数や機能の一覧で挙動が変わる既存の試験と、互換を見張る `今のCLIモックと同じ形の要求を受け付ける` に名前で触れている（§11） | 機械（同上） |
| §10 の表の束は `U1`〜`U3`。名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§14） | 機械（同上） |
| 指している `docs/`・`scripts/`・`openapi/` のパスが実在する（これから作る `src/`・`test/`・`migrations/` の下はパスの形で書いてよい） | 機械（同上） |
| サーバーがゲーム固有のルール（実績の名前・説明・解除の意味・値の意味）を持たない（§2・ADR 0002）。宣言の無いキーを受け付けない（§3）。自己申告の限界を書いている（§5）。`add` の二重が `Idempotency-Key` と 1 つの `batch` で止まる（§6）。`APP_ENV` の守りを外さない（§9）。Cloudflare の数字・機能は確かめた所と「要確認」が分かれている（§1） | AI の判定（作っていない判定役が、§1〜§9 と `src/`・`migrations/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§14 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 挙動の変わる既存の試験は §11 の手続きだけで直す。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（§9）。
- U2 の後、会話の側で `npm run db:migrate:local && npm run dev` と `npm run cli:smoke` を回し、§12 のシナリオが `PASS` で通るのを見る。U3 の後、同じく人が `.dev.vars` に `ADMIN_API_KEY` を書いて `node scripts/admin-cli.mjs smoke` と §8 の管理の操作を回す（無人の回では開発サーバーを起動しない）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

2026-10-31 の main（`87fb9cf`）の `src/`・`migrations/`・`test/`・`scripts/`・`openapi/`・`wrangler.jsonc` を読んで確かめた。

| 所 | いま |
| --- | --- |
| 機能のモジュール | `src/modules/index.ts` の `[announcements, rankings, saves, config, inventory, events]`。名前は `game_modules` の `module` と同じ。モジュールどうしは互いを読み込まない |
| マイグレーション | `0001`〜`0012`（`0012_player_bans.sql` が最後）。次の番号は `0013` |
| プレイヤーデータ | 表も口も無い。実績・進行状態・統計値を置く所は、クライアントが中身を決めるセーブの本文（サーバーは解釈しない）しか無い |
| トークンの要る口の確かめの順 | saves・inventory・events: `requireLocalWrite` → `requireAuth` → `consume`（プレイヤーごと）→ `requireNotBanned`（`src/core/bans.ts`）→ `gameId` の形 → トークンのゲームとの突き合わせ → `requireGame`（`src/modules/events/index.ts` の `checkAccess`） |
| 利用制限 | `src/core/rate-limit.ts` の `consume`。回数は `src/core/rate-limit-policy.ts` の `RATE_LIMITS`（`guestIp`・`guestGame`・`score`・`saves`・`rewards`・`admin`）。試験 `利用制限の回数と窓は定数のモジュールにある` が中身を `toEqual` で見る |
| `Idempotency-Key` | 管理の増減（`POST /v1/admin/players/{playerId}/inventory`）だけが必須で読む。形は `src/core/admin/audit.ts` の `IDEMPOTENCY_KEY_PATTERN`（`^[a-zA-Z0-9_-]{8,64}$`）・`parseIdempotencyKey`、本文の比べは `requestHash`（決まった順の JSON の SHA-256）。鍵は `admin_audit_log` の列に保存し、同じ鍵で違う本文は 422 `IDEMPOTENCY_KEY_REUSED`（管理のスキーマだけにあるコード）。プレイヤーの口はどれも読まない（`abuse-protection-design.md` §5 の表 `idempotency_keys` はまだ無い） |
| エラーコード | ゲームのクライアントのスキーマに 15 個（`test/schema-conformance.test.ts` の `errorCodes`。最後が `PLAYER_BANNED`）。管理のスキーマに 10 個 |
| スキーマの操作 | ゲームのクライアントに 15 個（試験 `スキーマのファイルはOpenAPI 3.1で15個の操作を持つ`）。管理に 8 個（試験 `管理のスキーマの操作は管理のルートと1対1で対応する` は数を名前に持たない） |
| トークンの要る操作を全部送る試験 | `PLAYER_BANNEDの応答はスキーマに合う`（`test/bans.test.ts`）が、スキーマの 401 を持つ操作の一覧と、試験の中の要求の表を `toEqual` で比べる（新しい口を足すと表に行が要る。§11） |
| 管理のプレイヤーを読む口 | `GET /v1/admin/players/{playerId}`（`src/core/admin/routes.ts`）が `balances`・`history`・`saves`・`rankings`（と止めていれば `ban`）を返す。試験は欄ごとに見ていて、欄を足しても落ちない |
| 監査のログ | `admin_audit_log` の `action` は `player.ban`・`player.unban`・`inventory.adjust`・`ranking.delete`・`item.put`・`event.put`。前と後は D1 の `json_object` で同じ文の中で作る |
| CLI モック | `scripts/cli-mock.mjs` は健康 → 設定 → お知らせ → ゲスト → スコア → セーブ → イベントと所持品。要求の形の関数は `scripts/cli-requests.mjs`。管理の鍵を持たない |
| 管理コマンド | `scripts/admin-cli.mjs`（操作は `player`・`audit`・`grant`・`revoke`・`ban`・`unban`・`delete-score`・`put-item`・`put-event`・`smoke`）。要求の形の関数は `scripts/admin-requests.mjs` |

元の文書から引く決まり:

- `roadmap.md` Phase 2 の項目（上の段落）。残りはクエスト（達成条件・報酬・進捗）と分析（DAU・継続率）・バックアップ・費用アラート（§15）。
- `event-reward-design.md` §2（サーバーは仕組みだけを持ち、意味はマスターデータ）・§5（一意の鍵と 1 つの `batch`。続く文は「この要求の行が入ったとき」だけ書く）・§13 の順 2 の行（クエストの進捗の置き場の前提。サーバーは数と真偽を持ち、実績の意味はマスターデータ）・§14（条件つきの報酬はプレイヤーデータとクエストで。サーバーは数の閾値だけを見る）。
- `admin-design.md` §5（プレイヤーを読む口）・§6（データ修正は行を直に書き換えず履歴に残る形・監査に前と後）・§13 の行（プレイヤーを読む口にプレイヤーデータの欄を足す。直す口が要るなら監査に前と後）。
- `save-design.md` §2（サーバーはセーブの本文を解釈しない。JSON として読まない・欄を見ない）・§5（リビジョンで競合を止める）。
- `config-design.md` §2（マスターデータはクライアントだけが見る。サーバーは解釈しない。機能フラグでサーバーの挙動を変えない）。
- `abuse-protection-design.md` §5（自然な鍵の無い足し算の書き込みに `Idempotency-Key` を後から足す形。同じ鍵で違う本文は 422・書き込みと鍵の保存を同じ `batch`）・§6（スコアの自己申告でサーバーがやること／やらないこと・限界）。
- `account-design.md`（トークンの `p` だけでプレイヤーが決まる。本文の `playerId` を信じない）。
- `docs/guides/decisions/operations-security.md` の 3（自己申告の値は改ざんできる）・5（操作の原子性）・8（容量の制限）。

Cloudflare の機能（2026-10-31。確かめたものと、要確認のもの）:

- **D1 の `batch`**: 文を順に流し、どれかが落ちれば全部戻る。公式の文書では確かめておらず**要確認**（`src/core/env.ts` の決まりで、イベントの受け取り・管理の増減が頼っている前提。`event-reward-design.md` §1 と同じ）。並べて送った要求の `batch` が互いに混ざらず順に流れること（1 つの書き手）は、公式の文書では確かめておらず**要確認**（`abuse-protection-design.md` §3 と同じ前提。イベントの試験 `同じ期間の受け取りを並べて送っても付与は1回分` がローカルの D1 で通っていることだけを確かめた）。
- **D1 の JSON の関数（`json_object`・`json_group_array`）**: 公式の文書では確かめていない。リポジトリの管理の口（`src/core/admin/routes.ts`）が使っていて、`test/admin.test.ts` が Workers のランタイムと D1 の中で通っていることで動くのを確かめた。§6 の応答の写しを SQL の中で作るのに使う。
- **D1 の書き込みの速さ・行の数・データベースの大きさの上限**: **要確認**（`operations-security.md` の方針どおり数字を固定しない）。§6 の書き込みの記録（1 回の書き込みで 1 行）が増える量は、利用制限の数で抑える（§9）。
- Durable Objects・Queues・Cron Triggers: この設計では**使わない**（§13 の決めること 9）。

## 2. 何を持つか（分け方）とセーブとの境目

### サーバーが持つもの・持たないもの（ADR 0002）

| 持つ（ゲームを問わない仕組み） | 持たない（ゲームの中の意味。ゲームの側・マスターデータ） |
| --- | --- |
| キーの宣言（ゲームごと。キーの名前・書き方・値の上限・1 回の増加の上限） | キーの意味（「倒したスライムの数」という説明・表示の名前・絵） |
| プレイヤーごとの値（0 以上の整数）と最後に変わった時刻 | 値の意味（章の番号が何の章か・職の番号が何の職か） |
| 実績の宣言（ID・見るキー・閾値）と、解いたかと解いた時刻 | 実績の名前・説明・絵・隠し実績か・並び順（マスターデータ。`config-design.md` の C2 で配る） |
| 解くかの判定（キーの値が閾値以上か。数の比べだけ） | 値を増やす条件（何を倒したら 1 増えるか。ゲームの中のルール） |

サーバーはマスターデータを読まない（`config-design.md` の決定のまま）。実績の名前や説明は、ゲームの作者がマスターデータに実績の ID をキーにして置き、クライアントが ID で引いて出す。

### 3 つの分け方

| 種類 | 何か | 書き方（§5） | 例 |
| --- | --- | --- | --- |
| 統計値 | 数え上げる数・最高の記録 | `add`（増やす）・`max`（最大値で置く） | 倒したスライムの数（`add`）・着いた一番深い階（`max`） |
| 進行状態 | ゲームが決めるキーと値。いまの状態 | `set`（値で置く）・`flag`（真偽を立てる。0 → 1 だけ） | いまの章（`set`）・ボス 1 を倒した（`flag`） |
| 実績 | 解いたか・解いた時刻 | 書く口は無い。統計値か進行状態のキーが閾値以上になった書き込みの中でサーバーが解く（§7） | 「はじめてスライムを倒した」（`slimes-defeated` が 1 以上） |

統計値と進行状態は **1 つの表**（キーの宣言の `mode` で分ける）、実績は**別の表**にする（§13 の決めること 1）。統計値と進行状態はどちらも「キーごとの 1 つの整数」で、違うのは書き方だけ。実績は値でなく「解いた時刻」で、宣言も閾値を持つので形が違う。

### セーブとの境目

| | セーブ（`save-design.md`） | プレイヤーデータ（この設計） |
| --- | --- | --- |
| サーバーが中身を読むか | 読まない（本文はクライアントが決める文字列） | 読む（キーごとの整数。クエスト・分析・実績が数として使う） |
| 形 | スロットごとの本文・リビジョン | 宣言したキーごとの値 |
| 書き方 | 本文を丸ごと置き換える（リビジョンで競合を止める） | キーごとに書き方（`add`・`max`・`set`・`flag`）で足す・置く |
| 使う所 | ゲームの続きを開く | サーバーが判定・集計に使う（実績・クエストの条件・分析） |

**同じ値を両方に持つときは、プレイヤーデータを正にする**（§13 の決めること 2）。クライアントは起動の時に `GET /v1/player-data` で読み、セーブの中の同じ値と違えばプレイヤーデータの値で上書きする。サーバーはセーブの本文からプレイヤーデータを作らない（本文を解釈しないため）。理由: クエストの達成・実績・分析はサーバーの判定で、正が 2 つあると「セーブでは 10 体倒したのにクエストが進まない」が起き、どちらを直すかが決まらない。サーバーが読まない値（装備・所持の並び・地図の開いた所）はセーブだけに置く（プレイヤーデータは判定と集計に使う値だけ。キーの数は §3 の上限で抑える）。

## 3. データの形とキーの決め方

**キーは宣言したものだけを受け付ける**（§13 の決めること 3）。宣言はサーバーの表 `player_data_keys` に置き（品目の `inventory_items` と同じ考え）、宣言の無いキーへの書き込みは 404 `NOT_FOUND`（`Unknown key`）。意味（名前・説明）はマスターデータ。

### 表（U1: `migrations/` の新しい番号 `0013_player_data.sql`）

```sql
-- キーの宣言（ゲームごと。書き方と上限だけ。名前・説明はマスターデータ）
CREATE TABLE IF NOT EXISTS player_data_keys (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  key TEXT NOT NULL,                            -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  mode TEXT NOT NULL CHECK (mode IN ('add', 'max', 'set', 'flag')),
  max_value INTEGER NOT NULL CHECK (max_value BETWEEN 1 AND 1000000000),   -- MAX_PLAYER_DATA_VALUE（src/core/player-data.ts と 2 か所）
  max_delta INTEGER CHECK (max_delta BETWEEN 1 AND 1000000000),            -- add の 1 回の増加の上限。add のときだけ値がある
  CHECK ((mode = 'add') = (max_delta IS NOT NULL)),
  CHECK (mode <> 'flag' OR max_value = 1),
  PRIMARY KEY (game_id, key)
);
-- プレイヤーごとの値（キーごとに 1 行。書いたことの無いキーの行は作らない）
CREATE TABLE IF NOT EXISTS player_data (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（saves・inventory_balances と同じ理由）
  key TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 1000000000),
  updated_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  PRIMARY KEY (game_id, player_id, key),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 書き込みの記録（書き込み 1 回で 1 行。二重の止めの Idempotency-Key と、送り直しに返す応答の写し）
CREATE TABLE IF NOT EXISTS player_data_writes (
  write_id INTEGER PRIMARY KEY,                 -- 増える番号
  write_ref TEXT NOT NULL UNIQUE,               -- 要求ごとにサーバーが作る（crypto.randomUUID()）。応答の writeId
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  request_key TEXT NOT NULL,                    -- Idempotency-Key（必須）
  request_hash TEXT NOT NULL,                   -- 本文の SHA-256（16 進）。同じ鍵で違う本文を見分ける
  result_json TEXT,                             -- 応答の写し（同じ batch の最後の文で入れる。§6）
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, player_id, request_key)
);
-- それまでに登録したゲームは player-data を使う設定にする（0003・0009 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'player-data' FROM games;
-- demo-rpg の手本のキー（CLI モックの通しに使う）
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'slimes-defeated', 'add', 1000000000, 100);
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'highest-floor', 'max', 999, NULL);
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'chapter', 'set', 100, NULL);
INSERT OR IGNORE INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES ('demo-rpg', 'boss-1-defeated', 'flag', 1, NULL);
```

### 表（U2: `migrations/` の新しい番号 `0014_achievements.sql`）

```sql
-- 実績の宣言（ゲームごと。見るキーと閾値だけ。名前・説明・絵はマスターデータ）
CREATE TABLE IF NOT EXISTS achievements (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,                 -- ^[a-zA-Z0-9_-]{1,64}$
  key TEXT NOT NULL,
  threshold INTEGER NOT NULL CHECK (threshold BETWEEN 1 AND 1000000000),
  PRIMARY KEY (game_id, achievement_id),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 解いた実績（プレイヤー・実績ごとに 1 行。一意の鍵で二重に解かない）
CREATE TABLE IF NOT EXISTS player_achievements (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,                 -- サーバーの時刻（UNIX 秒）
  write_ref TEXT NOT NULL,                      -- 解いた書き込み（player_data_writes.write_ref）。応答の unlocked を引く鍵
  PRIMARY KEY (game_id, player_id, achievement_id),
  FOREIGN KEY (game_id, achievement_id) REFERENCES achievements(game_id, achievement_id)
);
-- §6 の文 4（この書き込みで解いた実績）が write_ref で引く
CREATE INDEX IF NOT EXISTS player_achievements_write ON player_achievements (write_ref);
-- demo-rpg の手本の実績
INSERT OR IGNORE INTO achievements (game_id, achievement_id, key, threshold) VALUES ('demo-rpg', 'first-slime', 'slimes-defeated', 1);
INSERT OR IGNORE INTO achievements (game_id, achievement_id, key, threshold) VALUES ('demo-rpg', 'boss-1', 'boss-1-defeated', 1);
```

- マイグレーションはどれも `IF NOT EXISTS`・`INSERT OR IGNORE` だけ（既存の試験 `マイグレーションを2回当ててもデータは壊れない` が通る）。`ALTER TABLE` を使わない。
- 機能の名前は `player-data`（URL の `/v1/player-data` と同じ。`src/core/ids.ts` の形に合う）。実績は同じ機能の中に置く（別の機能の名前にしない。§13 の決めること 10）。
- 宣言を消す口は作らない（値と実績の行が外部キーで指す）。使わなくなったキーはそのまま残し、クライアントが書かなくなるだけ。

### 定数（データ 1 か所。design-cycle §2）

| 定数 | 値 | 置き場 | 束 |
| --- | --- | --- | --- |
| `MAX_PLAYER_DATA_VALUE` | 1,000,000,000（スコア・所持品の上限と同じ） | `src/core/player-data.ts`（モジュールと管理の口〔`src/core/admin/`〕の両方が読む）。DB の `CHECK` と 2 か所 | U1 |
| `PLAYER_DATA_MODES` | `['add', 'max', 'set', 'flag']` | `src/core/player-data.ts` | U1 |
| `MAX_CHANGES_PER_WRITE` | 20（1 回の書き込みのキーの数。`batch` の文の数を抑える） | `src/modules/player-data/limits.ts` | U1 |
| `MAX_PLAYER_DATA_KEYS` | 200（1 ゲームの宣言の数。1 プレイヤーの行の数の上限にもなる。§13 の決めること 14） | `src/core/player-data.ts`（管理の宣言の口が確かめる） | U3 |
| `RATE_LIMITS.playerData` | `{ scope: 'player-data', limit: 60, period: 60 }` | `src/core/rate-limit-policy.ts`（`abuse-protection-design.md` §2 の表にも行を足す。§9） | U1 |

`IDEMPOTENCY_KEY_PATTERN`・`parseIdempotencyKey` は U1 で `src/core/admin/audit.ts` から `src/core/idempotency.ts` へ移す（管理の口とプレイヤーデータのモジュールの両方が読む。モジュールが `src/core/admin/` を読み込まないように。値と形は変えない）。

### モジュールのファイル

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/core/player-data.ts` | `MAX_PLAYER_DATA_VALUE`・`PLAYER_DATA_MODES`・`MAX_PLAYER_DATA_KEYS`・`checkChange(def, value)`（§5 の範囲の確かめ。入出力の無い関数） | U1（`MAX_PLAYER_DATA_KEYS` は U3） |
| `src/core/idempotency.ts` | `IDEMPOTENCY_KEY_PATTERN`・`parseIdempotencyKey`・`sha256Hex` | U1 |
| `src/modules/player-data/index.ts` | `playerData: GameModule`（`name: 'player-data'`）。§4 の `GET` と `POST` と §6 の SQL | U1（実績は U2） |
| `src/modules/player-data/parse.ts` | `parseChanges(body)`（§4 の本文の形）・`writeRequestHash(gameId, changes)`。入出力の無い関数 | U1 |
| `src/modules/player-data/limits.ts` | `MAX_CHANGES_PER_WRITE` | U1 |

## 4. API と確かめの順

2 つの口はどちらもトークンが要る。プレイヤーはトークンの `p` だけで決まる（本文・クエリの `playerId` を受け取らない）。読み取りも、セーブ・所持品の `GET` と同じく `APP_ENV` の守りを通す（§9）。

### 確かめの順（2 つの口で同じ。イベントの `checkAccess` と同じ形）

ルート → `requireLocalWrite`（403 `NOT_READY_FOR_PRODUCTION`）→ `requireAuth`（401）→ **プレイヤーの利用制限 `RATE_LIMITS.playerData`（429 `RATE_LIMITED`・`Retry-After`。2 つの口を合わせて、鍵は `<トークンの g>:<トークンの p>`）** → `requireNotBanned`（403 `PLAYER_BANNED`）→ `gameId` の形（400 `INVALID_ARGUMENT`）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定 `requireGame(env, gameId, 'player-data', known)`（404）→ 口ごとの確かめ。

### `GET /v1/player-data?gameId=demo-rpg`（U1。`achievements` は U2）

```json
{"gameId":"demo-rpg","values":[{"key":"chapter","mode":"set","value":2,"updatedAt":"2026-10-31T15:30:00Z"},{"key":"slimes-defeated","mode":"add","value":3,"updatedAt":"2026-10-31T15:30:00Z"}],"achievements":[{"achievementId":"first-slime","unlockedAt":"2026-10-31T15:30:00Z"}]}
```

- `values` はキーの昇順。書いたことの無いキーは載せない（何も書いていなければ空の配列）。`mode` は宣言の書き方（クライアントが統計値か進行状態かを出し分けるため）。
- `achievements` は解いた実績だけ（実績の ID の昇順）。U1 の間は欄を載せない（U2 で足す。U1 の試験は欄の無いことを見ない）。

### `POST /v1/player-data?gameId=demo-rpg`（U1。`unlocked` は U2）

見出し `Idempotency-Key`（必須・`^[a-zA-Z0-9_-]{8,64}$`）。本文:

```json
{"changes":[{"key":"slimes-defeated","value":3},{"key":"highest-floor","value":12},{"key":"boss-1-defeated","value":1}]}
```

共通の確かめの後:

1. `Idempotency-Key` の形（無い・形の誤りは 400 `INVALID_ARGUMENT`）。
2. 本文が JSON でなければ 400 `INVALID_JSON`。`parseChanges`: `changes` が 1〜`MAX_CHANGES_PER_WRITE` 行・キーが ID の形で重ならない・`value` が安全な整数（400 `INVALID_ARGUMENT`）。
3. 宣言を読む（`SELECT key, mode, max_value, max_delta FROM player_data_keys WHERE game_id = ? AND key IN (…)`）。無いキーがあれば 404 `NOT_FOUND`（`Unknown key`）。何も書かない。
4. キーごとに `checkChange`（§5 の表。外れは 400 `INVALID_ARGUMENT`）。何も書かない。
5. §6 の `batch` を流し、書き込みの記録を読み直して応答を作る。

```json
{"gameId":"demo-rpg","writeId":"<writeRef>","values":[{"key":"boss-1-defeated","value":1},{"key":"highest-floor","value":12},{"key":"slimes-defeated","value":3}],"unlocked":[{"achievementId":"boss-1","unlockedAt":"2026-10-31T15:30:00Z"},{"achievementId":"first-slime","unlockedAt":"2026-10-31T15:30:00Z"}]}
```

- `values` は送ったキーの、書いた後の値（キーの昇順）。`max` で前の値のほうが大きければ前の値のまま返る。
- `unlocked` はこの書き込みで解いた実績（U2。無ければ空の配列）。前に解いた実績は載せない（`GET` で読む）。
- 1 回の書き込みは全部通るか、どれも書かないか（1 つの `batch`）。

## 5. 書き方と、クライアントの自己申告をどこまで信じるか

### 書き方（キーの宣言の `mode`。クライアントは選べない）

| `mode` | 種類 | 送る `value` の意味 | 書いた後の値 | `checkChange` の確かめ（400） |
| --- | --- | --- | --- | --- |
| `add` | 統計値 | 増やす数 | 前の値 + `value` | 1 以上 `max_delta` 以下（減らせない・0 は送らない） |
| `max` | 統計値 | 新しい記録 | `MAX(前の値, value)` | 0 以上 `max_value` 以下 |
| `set` | 進行状態 | 新しい値 | `value` | 0 以上 `max_value` 以下 |
| `flag` | 進行状態 | 1（立てる） | 1（一度立てたら下げない） | 1 だけ |

- `add` の結果が `max_value` を超えるときは、その書き込みを全部断る: 409 **`PLAYER_DATA_LIMIT_EXCEEDED`**（新しいコード）。何も書かない。上限で止める（丸める）形にしないのは、作者の決めた上限に当たるのは改造か作りの誤りで、黙って丸めると気づけないため（`INVENTORY_LIMIT_EXCEEDED` と同じ考え。§13 の決めること 5）。
- 書き方をクライアントに選ばせない: `add` のキーに「値で置く」を送れると、数え上げの統計値を好きな数にできる。書き方は宣言の 1 か所で決まる。
- 減らす口は作らない（`add` は増やすだけ、`flag` は下げない）。下げるのは管理の直し（§8）だけ。`set` のキーは下げられる（進行状態は戻ることがある。例: 章を選び直す）。

### 自己申告の扱い（`abuse-protection-design.md` §6 のスコアと同じ考え）

サーバーは値がゲームの中で取れたかを確かめられない（ルールを持たない。ADR 0002）。**ゲームを問わず効くものだけ**をやり、値は**自己申告**として扱う（§13 の決めること 12・13）。

| やる（ゲームを問わない） | 何を止めるか |
| --- | --- |
| トークンのプレイヤーにしか書けない（`requireAuth`。本文の `playerId` を読まない） | 他人の値を書く |
| 宣言の無いキーを断る（§3） | 好きなキーを作って表を太らせる・クエストの条件のキーを作り出す |
| 値の範囲（0〜`max_value`）・1 回の増加の上限（`max_delta`）・`flag` は 1 だけ | 一度で巨大な数にする・桁あふれ |
| 書き方を宣言で固定（`add` は増やすだけ・`max` は下がらない・`flag` は戻らない） | 数え上げの統計値を置き換える |
| 利用制限（プレイヤーごと 60 秒に 60 回。§9） | `add` の連打で上限まで一気に増やす |
| 時刻はサーバーが付ける（`updated_at`・`unlocked_at`。クライアントの時刻を受け取らない） | 解いた時刻・最後に遊んだ時刻の偽り |

**限界（そのまま書く）**: 改造したクライアントは、範囲の内の値を、制限の内の回数で送れる。`add` のキーは 1 分に最大 `max_delta × 60` まで増やせ、`max`・`set` のキーは一度で `max_value` にでき、`flag` はいつでも立てられる。それで解ける実績も同じく申告で、ゲストは何人でも作れる（`abuse-protection-design.md` §4 の IP ごとの制限の内）。プレイヤーデータを読むもの（実績・クエストの条件・ランキングに使うゲーム・分析）は、値を「申告」として扱う。作者が強く守りたい値は、`max_delta`・`max_value` を小さく宣言する（例: 1 回の戦闘で倒せる数が 10 までなら `max_delta = 10`）。不正が分かった人は管理で値を直し・実績を取り消し（§8）・BAN する（`admin-design.md` §4）。

## 6. 二重の止め方（同じ増加を 2 回送る）

`add` は足し算なので、届かなかった応答の送り直しで二重になる。自然な鍵（イベントの受け取りのプレイヤー・イベント・区切り）が無いので、**`Idempotency-Key` を必須にし、書き込みの記録 `player_data_writes` の列に保存する**（§13 の決めること 4。管理の増減が `admin_audit_log` の列に保存するのと同じ形）。`max`・`set`・`flag` だけの書き込みも同じく必須にする（口を 1 つにし、書き方で見出しの要否を変えない）。

`batch` の文（`src/modules/player-data/index.ts`。引数は `?` を順に `bind` する。下は読みやすさのために名前で書く。`:ref` は要求ごとに作る `crypto.randomUUID()`）:

```sql
-- 1. 書き込みの記録。add の結果が上限の内のときだけ（add の変更ごとに条件を 1 つ AND でつなぐ）。同じプレイヤーの同じ鍵があれば何もしない
INSERT INTO player_data_writes (write_ref, game_id, player_id, request_key, request_hash, created_at)
  SELECT :ref, :g, :p, :key, :hash, :now
  WHERE COALESCE((SELECT value FROM player_data WHERE game_id = :g AND player_id = :p AND key = :k1), 0) + :v1 <= :max1
    -- AND …（add の変更の数だけ）
  ON CONFLICT (game_id, player_id, request_key) DO NOTHING;
-- 2. 値（変更ごとに 1 文。この要求の記録が入ったときだけ）。mode で ON CONFLICT の中身が変わる
INSERT INTO player_data (game_id, player_id, key, value, updated_at)
  SELECT :g, :p, :k, :v, :now WHERE EXISTS (SELECT 1 FROM player_data_writes WHERE write_ref = :ref)
  ON CONFLICT (game_id, player_id, key) DO UPDATE SET
    value = player_data.value + excluded.value, updated_at = excluded.updated_at;            -- add
    -- max・flag: value = excluded.value, updated_at = excluded.updated_at WHERE excluded.value > player_data.value
    -- set:       value = excluded.value, updated_at = excluded.updated_at
-- 3. 実績（U2。§7）
-- 4. 応答の写し（この要求の記録に、書いた後の値と、この書き込みで解いた実績を入れる）
UPDATE player_data_writes SET result_json = json_object(
    'values', (SELECT json_group_array(json_object('key', key, 'value', value)) FROM
                (SELECT key, value FROM player_data WHERE game_id = :g AND player_id = :p AND key IN (:k1, …) ORDER BY key)),
    'unlocked', (SELECT json_group_array(json_object('achievementId', achievement_id, 'unlockedAt', unlocked_at)) FROM
                (SELECT achievement_id, unlocked_at FROM player_achievements WHERE write_ref = :ref ORDER BY achievement_id)))  -- U2 で足す
  WHERE write_ref = :ref;
```

`batch` の後に `SELECT write_ref, request_hash, result_json FROM player_data_writes WHERE game_id = :g AND player_id = :p AND request_key = :key` を引く:

| 引いた結果 | 応答 |
| --- | --- |
| 行がある（この要求の `write_ref`） | 200（`result_json` と `write_ref` から作る） |
| 行がある（前の要求）・`request_hash` が同じ＝二重 | **200 で 1 回目と同じ本文**（同じ `writeId`・`values`・`unlocked`）。値は増えない |
| 行がある・`request_hash` が違う | 422 `IDEMPOTENCY_KEY_REUSED`（管理のスキーマにあるコードを、ゲームのクライアントのスキーマにも足す） |
| 行が無い | 409 `PLAYER_DATA_LIMIT_EXCEEDED`（文 1 の `add` の上限の条件で止まった） |

- 並べて送っても: D1 は `batch` を順に流すので（§1 の**要確認**の前提）、2 つ目の `batch` の文 1 は一意の鍵で何もせず、その `write_ref` の行が無いので文 2〜4 も何もしない（イベントの受け取り・管理の増減と同じ）。
- 違う鍵の `add` を並べて送ると、どちらも足される（別の書き込み）。上限の条件は文 1 が書く前の値で見るので、2 つ合わせて `max_value` を超えれば後の方が 409。
- `request_hash` は `{"gameId","changes"}`（`changes` はキーの昇順に並べ直す）を決まった順の JSON にして SHA-256（16 進）。並びだけ違う同じ本文は同じ書き込みとみなす。
- 鍵の範囲はプレイヤーごと（`UNIQUE (game_id, player_id, request_key)`）。別のプレイヤーが同じ鍵を使っても当たらない。
- 鍵の期限: **30 日**。書き込みの記録の行（`player_data_writes`）は 30 日を過ぎると 1 日 1 回の掃除で消え、その後に同じ鍵で送ると新しい書き込みになる（保持の日数と消し方の正は `docs/guides/working/analytics-design.md` §6）。クライアントは書き込みごとに新しい鍵（`crypto.randomUUID()` など）を作り、送り直しのときだけ同じ鍵を使う。
- `abuse-protection-design.md` §5 の表 `idempotency_keys`（応答の本文を丸ごと保存する汎用の表）は作らない。書き込みの記録の行が鍵と応答の写しを持つ（表が 1 つで済み、書き込みと鍵の保存が同じ `batch` に入る）。`idempotency_keys` は、プレイヤーの消費の口（`event-reward-design.md` §6）を足すときに改めて決める。
- DB の失敗は入口の `try/catch` で 500 `INTERNAL_ERROR`（中身を返さない。`CLAUDE.md` の守るもの）。

## 7. 実績の解除

**サーバーがキーの値と閾値で判定する。クライアントが「解いた」と申告する口は作らない**（§13 の決めること 6）。

- 実績はどれも「キー（統計値か進行状態）の値が閾値以上」で解ける。ゲームの中の出来事で解く実績（「ボスを倒した」）は、`flag` のキーを宣言して閾値 1 の実績にする。これでクライアントの申告で解く実績も、申告の確かめ（宣言・範囲・利用制限）を通る 1 つの道になる。
- 判定は書き込みの `batch` の中（§6 の文 3）で、その書き込みのプレイヤーについてだけ:

```sql
-- 3. 実績（この要求の記録が入ったときだけ。書いた後の値が閾値以上で、まだ解いていない実績）
INSERT INTO player_achievements (game_id, player_id, achievement_id, unlocked_at, write_ref)
  SELECT a.game_id, :p, a.achievement_id, :now, :ref FROM achievements a
  JOIN player_data v ON v.game_id = a.game_id AND v.player_id = :p AND v.key = a.key
  WHERE a.game_id = :g AND v.value >= a.threshold
    AND EXISTS (SELECT 1 FROM player_data_writes WHERE write_ref = :ref)
  ON CONFLICT (game_id, player_id, achievement_id) DO NOTHING;
```

- 一度解いた実績は、値が下がっても（`set` のキー・管理の直し）取り消さない。取り消すのは管理の口だけ（§8）。
- 実績の宣言を足す・閾値を下げると、次にそのプレイヤーが書き込んだときに判定される（宣言の時に全部のプレイヤーをさかのぼって解かない。全員の行を一度に書くのは D1 の 1 回の `batch` の大きさの上限〔**要確認**〕に当たりうるため）。さかのぼりが要るゲームは、クライアントがいまの値を `max`・`set` で送り直せば解ける。
- クエストの達成の判定（§15）も同じ形（キーの値と閾値）にする前提で、この判定を `src/modules/player-data/` に置く。

## 8. 管理との関係（U3）

`admin-design.md` §13 の行のとおり、プレイヤーを読む口に欄を足し、直す口は監査に前と後を残す。どれも管理の口の確かめの順（`checkAdmin`: `requireLocalWrite` → 管理の鍵 → 管理の利用制限 → `gameId` → ゲームの登録 → 書き込みは `X-Admin-Actor` と `reason`）を通る。管理の口は機能の設定（`game_modules` の `player-data`）を見ない（`admin-design.md` §2 の決まりのまま）。

| 口 | 本文 | 応答・決まり | 監査の `action`（前 → 後） |
| --- | --- | --- | --- |
| `GET /v1/admin/players/{playerId}` に欄を足す | — | `"playerData":{"values":[{"key","mode","value","updatedAt"}],"achievements":[{"achievementId","unlockedAt","writeId"}]}`（いつも載せる。無ければ空の配列） | 残さない（読み取り） |
| `PUT /v1/admin/player-data/keys/{key}?gameId=…` | `{"mode":"add","maxValue":1000000000,"maxDelta":100,"reason":"…"}` | 無ければ作る。値の行があるキーの `mode` は変えられない（400）。`maxValue`・`maxDelta` は変えられる（前に書いた値が新しい上限を超えても消さない。次の `add` から効く）。宣言が `MAX_PLAYER_DATA_KEYS` を超えるなら 400。本文の確かめ（`parsePlayerDataKey`。400）で表の `CHECK` と同じ決まり（`maxDelta` は `add` のときだけ必須で、ほかは送らない・`flag` の `maxValue` は 1・`maxValue` と `maxDelta` は 1〜`MAX_PLAYER_DATA_VALUE`）を先に見る（DB の `CHECK` で落ちて 500 にしない） | `player-data-key.put`（前の宣言 → 後の宣言） |
| `PUT /v1/admin/achievements/{achievementId}?gameId=…` | `{"key":"slimes-defeated","threshold":10,"reason":"…"}` | 宣言の無いキーは 404 `Unknown key`。解いた人がいる実績の `key` は変えられない（400）。`threshold` は変えられる（解いた人の行は消さない） | `achievement.put`（前 → 後） |
| `PUT /v1/admin/players/{playerId}/player-data/{key}?gameId=…` | `{"value":0,"reason":"不正な連打の分を戻す"}` | 値を置く（`mode` に関わらず 0〜`max_value`）。`game_players` に無いプレイヤーは 404 `Unknown player`、無いキーは 404 `Unknown key`。実績は判定しない（解かない・取り消さない） | `player-data.set`（`{"key","value"}` か `null` → `{"key","value"}`） |
| `DELETE /v1/admin/players/{playerId}/achievements/{achievementId}?gameId=…` | `{"reason":"…"}` | 解いた行を消す。無ければ 404 `Unknown achievement`（監査も残さない。`ranking.delete` と同じ） | `achievement.revoke`（`{"achievementId","unlockedAt"}` → `null`） |

- 直しは値の行を書き換えるが、前と後を `admin_audit_log` に残す（`admin-design.md` §6 の「履歴に残る形」。プレイヤーデータには所持品の受領の履歴のような台帳を持たないので、監査のログが直しの履歴になる）。書き込みと監査の行は 1 つの `batch`（監査の行を 1 文目にし、続く文は「この要求の `audit_ref` の行が入ったとき」だけ）。
- 4 つの口は何度送っても結果が同じ（置く・消す）なので `Idempotency-Key` は要らない（BAN・スコアを消すと同じ。`admin-design.md` §11 の決めること 12）。
- 新しいエラーコードは管理のスキーマに足さない（400・404 だけ）。
- 管理コマンド `scripts/admin-cli.mjs` に操作 `put-data-key`・`put-achievement`・`set-data`・`revoke-achievement` を足し、`player` の表示にプレイヤーデータを足す（要求の形の関数は `scripts/admin-requests.mjs`）。いまの `smoke` の流れと `SMOKE_AUDIT_ACTIONS` は変えない（既存の試験 `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` が見張る）。プレイヤーデータの管理の通しは §10 の U3 の `管理コマンドと同じ流れでプレイヤーデータの宣言と直しと実績の取り消しが監査に残る` で確かめる。

## 9. 認証・`APP_ENV`・利用制限・BAN・文書のどこが変わるか

- 2 つの口はどちらも `requireAuth` の後で、プレイヤーはトークンの `p` だけ（`account-design.md` の決定）。他人の値には触れられない。
- **`APP_ENV === 'local'` のときだけ通す守りを外さない**（`CLAUDE.md` の「守るもの」）。書き込みだけでなく `GET` も、セーブ・所持品の `GET` と同じく守りを通す（プレイヤーのデータで、公開の読み取りでないため）。`wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない。
- 利用制限: `RATE_LIMITS.playerData`（プレイヤーごと、2 つの口を合わせて 60 秒に 60 回）を `consume` で数える。トークンの無い・正しくない要求は数えない（401 が先）。CLI モックの通し（§12）は 1 回で 4 回なので掛からない。
- BAN: `requireNotBanned` を利用制限の直後に呼ぶ（`admin-design.md` §4 の順のまま）。止めた人は 403 `PLAYER_BANNED`。
- 新しいエラーコードは 2 つ（U1。ゲームのクライアントのスキーマ `openapi/rpg-online.v1.json` に入る）: `PLAYER_DATA_LIMIT_EXCEEDED`（409・新しい）と `IDEMPOTENCY_KEY_REUSED`（422・管理のスキーマ `openapi/rpg-online-admin.v1.json` に既にあるものを、ゲームのクライアントのスキーマにも足す）。ゲームのクライアントのエラーコードは 17 個になる（§11）。管理のスキーマのコードは変わらない。本文の形は `{ "error": { "code", "message" } }` のまま。

束の実装の Issue で直す所（この Issue では変えない。`CLAUDE.md` 原則 5 で旧文を置き換える。例外を追記しない）:

| 文書 | U1 | U2 | U3 |
| --- | --- | --- | --- |
| `docs/api-contract.md` | `GET /v1/player-data`・`POST /v1/player-data` の節。エラーコードの表に 2 つ。「利用制限」の表に `player-data` の行 | 2 つの口に実績の欄 | 「管理の API」に 4 つの口と、プレイヤーを読む口の `playerData` |
| `openapi/rpg-online.v1.json` | 2 つの操作（`getPlayerData`・`writePlayerData`）と 401・403・429・`Retry-After`・`ErrorCode` の 2 つ | `achievements`・`unlocked` の欄 | — |
| `openapi/rpg-online-admin.v1.json` | — | — | 4 つの操作と `adminGetPlayer` の `playerData` |
| `docs/guides/working/architecture.md` | 4 のデータ境界に `player_data_keys`・`player_data`・`player_data_writes`。「冪等性」の行に「プレイヤーデータの書き込みは `Idempotency-Key` が必須」を置き換えて入れる | 同 `achievements`・`player_achievements` | — |
| `docs/guides/working/abuse-protection-design.md` | §2 の表に `player-data` の行（定数と同じコミット） | — | — |
| `docs/guides/working/admin-design.md` | — | — | §13 のプレイヤーデータの行を、この設計書の §8 を指す形に置き換える |
| `docs/guides/working/event-reward-design.md` | — | §13 の順 2 の行を、この設計書を指す形に置き換える | — |
| `docs/guides/decisions/roadmap.md` | — | — | Phase 2 のプレイヤーデータの行に印と Issue の番号（U3 の後、会話の側の通しの確かめが済んでから） |

`CLAUDE.md` は変えない（プロジェクトの行の「認証・レート制限・不正対策は未実装」は、守りを外すとき＝ユーザーが決めるときに直す。`admin-design.md` §10 のとおり）。

## 10. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は新しい `test/player-data.test.ts`（U1・U2。L1 も同じファイル）と `test/admin.test.ts`（U3）。スキーマの置き換えは `test/schema-conformance.test.ts`、モジュールの一覧は `test/modules.test.ts`、demo-rpg の設定は `test/game-modules.test.ts`、CLI の流れは `test/failure-server.test.ts`。

試験の作り方:

- 試験のゲームは専用（`pd-game` など。`registerGame` とキー・実績の宣言の行を `beforeEach` で入れる）。demo-rpg の手本の行は CLI の流れの試験だけが使う。
- 書き込みをするファイルの `beforeEach` で `resetRateLimits(db)` と、`player_data`・`player_data_writes`・`player_achievements`・止めた印の表の `DELETE`（いまの試験の作りと同じ）。
- 値・実績の行を直に入れる試験は、先に宣言の行を入れる（外部キー。無いと見たいものでなく外部キーで落ちる）。
- 利用制限の試験は `rate_limit_counters` に `count = 60` を入れてから 1 回送る（`abuse-protection-design.md` §7 と同じ）。
- 新しい試験の名前には、機能が増えると変わる数（エラーコード・操作・ルートの個数）を入れない（`admin-design.md` §8 と同じ）。既存の試験の置き換え（§11）だけは入れる。

| 束 | テストの名前 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- |
| U1 | `プレイヤーデータの変更の本文はキーが重ならず行の数と整数を確かめる` | L1 | `parseChanges` に `changes` 無し・0 行・21 行・キーの重なり・形の誤ったキー・小数・文字列の値・正しい本文 | 正しい本文だけ通る |
| U1 | `プレイヤーデータの書き方ごとに受け付ける値の範囲が決まる` | L1 | `checkChange` に `add`（0・1・`max_delta`・`max_delta + 1`・負）・`max` と `set`（-1・0・`max_value`・`max_value + 1`）・`flag`（0・1・2） | §5 の表のとおり |
| U1 | `プレイヤーデータの書き込みの本文のハッシュは変更の並びに左右されない` | L1 | `writeRequestHash` に同じ変更を違う順で・値の違う変更 | 前の 2 つは同じ・値が違えば別 |
| U1 | `プレイヤーデータを増やすと書いた後の値が返り読み直しても同じ` | L2 | `add` のキーに 3 を書き、もう一度 2 を書いて `GET` | 2 回とも 200。`values` が 3・5。`GET` の値が 5 |
| U1 | `最大値で置くキーは小さい値を送っても下がらない` | L2 | `max` のキーに 12 → 5 | 2 回目の応答も 12。`GET` も 12 |
| U1 | `値で置くキーは送った値に置き換わり下げられる` | L2 | `set` のキーに 3 → 1 | 1 |
| U1 | `真偽のキーは1だけを受け付け一度立てたら下がらない` | L2 | `flag` のキーに 1 → 0 | 1 回目は 200 で 1。2 回目は 400 `INVALID_ARGUMENT`。値は 1 のまま |
| U1 | `宣言の無いキーへの書き込みはNOT_FOUNDの404を返し何も書かない` | L2 | 宣言したキーと宣言の無いキーを 1 回で送る | 404・`NOT_FOUND`。宣言したキーの行も書かれない |
| U1 | `1回の増加の上限を超える値は400を返し何も書かない` | L2 | `add` のキーに `max_delta + 1` | 400・`INVALID_ARGUMENT`。`player_data`・`player_data_writes` が増えない |
| U1 | `増やした結果が上限を超えるとPLAYER_DATA_LIMIT_EXCEEDEDの409を返し何も書かない` | L2 | 値を `max_value - 1` にしてから 2 を足し、同じ書き込みに別のキーの `set` も入れる | 409・`PLAYER_DATA_LIMIT_EXCEEDED`。どちらのキーも変わらない |
| U1 | `同じIdempotency-Keyの書き込みを2回送っても1回分で同じ本文を返す` | L2 | 同じ鍵と本文で `add` を 2 回 | 2 回とも 200 で本文が同じ（`writeId` も）。値は 1 回分・`player_data_writes` は 1 行 |
| U1 | `同じIdempotency-Keyの書き込みを並べて送っても1回分` | L2 | 同じ鍵と本文を `Promise.all` で 10 本 | 全部 200 で `writeId` が 1 つ。値は 1 回分 |
| U1 | `同じIdempotency-Keyで違う中身の書き込みはIDEMPOTENCY_KEY_REUSEDの422を返す` | L2 | 同じ鍵で値を変えて送る | 422・`IDEMPOTENCY_KEY_REUSED`。値は 1 回目のまま |
| U1 | `Idempotency-Keyの無いプレイヤーデータの書き込みはINVALID_ARGUMENTの400を返す` | L2 | 見出し無し・7 文字・使えない文字 | どれも 400・`INVALID_ARGUMENT`。何も書かない |
| U1 | `ほかのプレイヤーが同じIdempotency-Keyを使っても別の書き込みになる` | L2 | `p1` と `p2` が同じ鍵で同じ本文を送る | どちらも 200 で `writeId` が違う。それぞれの値が 1 回分 |
| U1 | `プレイヤーデータを読むとトークンのプレイヤーの値だけがキーの順に返る` | L2 | `p1` と `p2` の値の行を入れ、`p1` のトークンで `GET` | 200。`p1` の行だけ・キーの昇順・`mode` と `updatedAt` がある |
| U1 | `何も書いていないプレイヤーのプレイヤーデータは空の一覧で返る` | L2 | 行の無いプレイヤーで `GET` | 200・`values: []` |
| U1 | `クライアントが送った時刻はプレイヤーデータの時刻に使わない` | L2 | 本文に `"updatedAt":"2000-01-01T00:00:00Z"`・`Date` の見出しを付けて書く | `updatedAt` がサーバーのいまの時刻（前後 5 秒） |
| U1 | `プレイヤーデータはトークンの無い要求に401を返し利用制限を数えない` | L2 | `Authorization` 無しで `GET` と `POST` | 401・`UNAUTHENTICATED`。`rate_limit_counters` に行が無い |
| U1 | `トークンと違うゲームのプレイヤーデータはPERMISSION_DENIEDの403を返す` | L2 | `pd-game` のトークンで `gameId=demo-rpg` | 403・`PERMISSION_DENIED` |
| U1 | `player-dataを使わない設定のゲームのプレイヤーデータはNOT_FOUNDの404を返す` | L2 | `player-data` の無いゲームのトークンで `GET` と `POST` | 404・`NOT_FOUND` |
| U1 | `本番の設定ではプレイヤーデータの読み書きにNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV=disabled` で `GET` と `POST` | どちらも 403・`NOT_READY_FOR_PRODUCTION`。何も書かない |
| U1 | `プレイヤーデータの操作を上限より多く呼ぶと429とRetry-Afterを返す` | L2 | `player-data`・`pd-game:p1` に `count = 60` を入れて `POST` | 429・`RATE_LIMITED`・`Retry-After`。何も書かない |
| U1 | `BANしたプレイヤーのプレイヤーデータの読み書きはPLAYER_BANNEDの403を返し何も書かない` | L2 | `player_bans` に行を入れて `GET` と `POST` | どちらも 403・`PLAYER_BANNED`。値の行が増えない |
| U1 | `プレイヤーデータの値はマイナスにも上限より大きくもできない` | L2 | 宣言の行を入れてから、`player_data` に `value = -1` と `MAX_PLAYER_DATA_VALUE + 1` を直に入れる | どちらも D1 が断る（`CHECK`） |
| U1 | `プレイヤーデータの読み書きの応答はスキーマに合う` | L2 | `GET` の 200・`POST` の 200・400・404・409・422 | `openapi/rpg-online.v1.json` の応答の形に合う |
| U1 | `プレイヤーデータの利用制限の回数と窓は定数のモジュールにある` | L1 | `RATE_LIMITS.playerData` | `{ scope: 'player-data', limit: 60, period: 60 }` |
| U1 | `スキーマのErrorCodeの列挙は17個のエラーコードと一致する` | L1 | スキーマの `ErrorCode` | `errorCodes`（いまの 15 個と `PLAYER_DATA_LIMIT_EXCEEDED`・`IDEMPOTENCY_KEY_REUSED`）と同じ |
| U1 | `スキーマのファイルはOpenAPI 3.1で17個の操作を持つ` | L1 | スキーマの操作 | いまの 15 個と `getPlayerData`・`writePlayerData` |
| U1 | `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataでルートが重ならない` | L1 | `modules` | 7 つの名前・ルートが重ならない |
| U1 | `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataを使う設定で登録される` | L2 | demo-rpg の `game_modules` | 7 つ（名前の順） |
| U2 | `統計値が閾値に届いた書き込みで実績が解け応答に載る` | L2 | 閾値 10 の実績で、`add` を 9 → 1 | 1 回目の `unlocked` は空、2 回目に実績が 1 つ。`GET` の `achievements` に載る |
| U2 | `真偽のキーを立てると閾値1の実績が解ける` | L2 | `flag` のキーに 1 | `unlocked` に実績 |
| U2 | `解いた実績はもう一度届いても二重に解けず時刻が変わらない` | L2 | 解いた後に同じキーへもう一度 `add` | 2 回目の `unlocked` は空。`player_achievements` は 1 行・`unlocked_at` が変わらない |
| U2 | `値で置くキーを下げても解いた実績は消えない` | L2 | `set` のキーを閾値まで上げて解き、0 に下げる | `GET` の `achievements` に残る |
| U2 | `同じIdempotency-Keyの送り直しは解いた実績も1回目と同じ本文で返す` | L2 | 実績が解ける書き込みを同じ鍵で 2 回 | 2 回目も `unlocked` に同じ実績と時刻。行は 1 つ |
| U2 | `実績の解除を申告する欄は読まない` | L2 | 本文に `"achievements":["first-slime"]`・`"unlocked":[…]` を付けて、閾値に届かない書き込み | 200・`unlocked` は空。`player_achievements` に行が無い |
| U2 | `ほかのプレイヤーの値では自分の実績は解けない` | L2 | `p2` が閾値に届いた後、`p1` が届かない書き込み | `p1` の `unlocked` は空 |
| U2 | `実績の応答はスキーマに合う` | L2 | `GET` と `POST` の `achievements`・`unlocked` のある 200 | `openapi/rpg-online.v1.json` の応答の形に合う |
| U2 | `CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける` | L2 | `scripts/cli-requests.mjs` の関数で demo-rpg のゲスト → 読む → `slimes-defeated` に 1（新しい鍵）→ 同じ鍵でもう一度 → 読む | 書き込みは 2 回とも 200 で同じ `writeId`。値は 1・`first-slime` が 1 つ |
| U3 | `管理の読み取りはプレイヤーデータの値と解いた実績を返す` | L2 | 値と実績の行のあるプレイヤーを `GET /v1/admin/players/{playerId}` | `playerData.values`・`playerData.achievements` が行のとおり。行の無い人は空の配列 |
| U3 | `管理の口で宣言したキーにプレイヤーが書ける` | L2 | `PUT /v1/admin/player-data/keys/{key}` → ゲストのトークンで `POST /v1/player-data` | 200・値が書ける |
| U3 | `値のあるキーの書き方は変えられない` | L2 | 値の行があるキーの `mode` を変える | 400・`INVALID_ARGUMENT`。`maxValue` だけの変更は 200 |
| U3 | `宣言の無いキーを見る実績の宣言はNOT_FOUNDの404を返し何も書かない` | L2 | 無いキーの実績を `PUT` | 404。`achievements`・監査が変わらない |
| U3 | `管理でプレイヤーデータを直すと値が置き換わり監査に前と後が残る` | L2 | 値 50 の `add` のキーを 0 に直して監査を読む | 値が 0。監査に `player-data.set`・前 50・後 0・`actor`・`reason` |
| U3 | `管理で値を直しても実績は解けず取り消されない` | L2 | 閾値を超える値に直す・解いた人の値を 0 に直す | 前者の `player_achievements` は増えない。後者は残る |
| U3 | `管理で実績を取り消すと解いた行が消え監査に残る` | L2 | 解いた実績を `DELETE` → プレイヤーで `GET` → 同じ `DELETE` をもう一度 | `achievements` から消える。監査に `achievement.revoke`。2 回目は 404 で監査が増えない |
| U3 | `本番の設定ではプレイヤーデータの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV: 'disabled'` と正しい管理の鍵で 4 つの口 | どれも 403・何も書かない |
| U3 | `プレイヤーデータの管理の口の応答は管理のスキーマに合う` | L2 | 4 つの口の 200・400・404 と、プレイヤーを読む口の 200 | `openapi/rpg-online-admin.v1.json` に合う |
| U3 | `管理コマンドと同じ流れでプレイヤーデータの宣言と直しと実績の取り消しが監査に残る` | L2 | `scripts/admin-requests.mjs` の関数で、キーと実績の宣言 → ゲストが書いて実績を解く → 値を直す → 実績を取り消す → 監査を読む | 各手順の応答が §8 のとおり。監査に新しい順で `achievement.revoke`・`player-data.set`・`achievement.put`・`player-data-key.put` |

数（行）: U1 が 31・U2 が 9・U3 が 10。

## 11. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `スキーマのErrorCodeの列挙は15個のエラーコードと一致する` | U1 | コードが 17 個になり、名前の「15個」が嘘になる（名前の中の数で挙動が変わる） | 消して、§10 の `スキーマのErrorCodeの列挙は17個のエラーコードと一致する` に置き換える。`errorCodes` に 2 つ足す |
| `スキーマのファイルはOpenAPI 3.1で15個の操作を持つ` | U1 | 操作が 17 個になる | `…17個の操作を持つ` に置き換える（前の名前は残さない） |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない` | U1 | 名前の中の機能の一覧が変わる | `…とeventsとplayer-dataで…` に置き換える |
| `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsを使う設定で登録される` | U1 | マイグレーションで demo-rpg に機能が足される | `…とeventsとplayer-dataを使う…` に置き換える |
| `利用制限の回数と窓は定数のモジュールにある`（`test/rate-limits.test.ts`） | U1 | `RATE_LIMITS` を `toEqual` で比べているので、`playerData` を足すと落ちる | 名前は変えず、期待に `playerData` の行を足す（いまの 6 行は変えない）。§10 の `プレイヤーデータの利用制限の回数と窓は定数のモジュールにある` が足した行を別に見る |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る`（`test/schema-conformance.test.ts`） | U1 | 全部のコードを 1 回ずつ出す試験で、2 つの新しいコードが出ないと落ちる | 名前は変えず、`writePlayerData` で 409 と 422 を起こす行を足す。いまの行と期待は変えない |
| `PLAYER_BANNEDの応答はスキーマに合う`（`test/bans.test.ts`） | U1 | スキーマの 401 を持つ操作の一覧と試験の要求の表を `toEqual` で比べるので、2 つの操作を足すと落ちる | 名前は変えず、要求の表に `getPlayerData`・`writePlayerData` の 2 行を足す（確かめる中身を弱めない） |
| `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない`（`test/failure-server.test.ts`） | U2 | CLI モックの流れにプレイヤーデータの手順が足される | 流れにプレイヤーデータの 4 回を足し、期待の件数を 24 から 32 にする（「全部 200」は変えない。見る範囲が増える） |
| `今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`） | 全部 | **変わらない**（いまの要求の形を変えない。プレイヤーデータの手順は流れの後ろに足すだけ） | 変えない。API を変えたら CLI モックも直す合図のまま。U1〜U3 の `requireTests` に入れて見張る |
| `管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない`（`test/admin.test.ts`） | U3 | **変わらない**（欄ごとに見ていて、`playerData` の欄を足しても落ちない） | 直さない。U3 の `requireTests` に入れて見張る |
| `管理のスキーマの操作は管理のルートと1対1で対応する` | U3 | **変わらない**（名前に数が無い。ルートとスキーマに同じ 4 つを足す） | 直さない。U3 の `requireTests` に入れる |
| `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` | U3 | **変わらない**（`smoke` の流れを変えない。§8） | 直さない。U3 の `requireTests` に入れる |
| `マイグレーションを2回当ててもデータは壊れない` | U1・U2 | 変わらない（`0013`・`0014` は `IF NOT EXISTS`・`INSERT OR IGNORE` だけ） | 変えない |

置き換えは `docs/guides/decisions/test-plan.md` §11 の手続き（名前の嘘を直すだけで、確かめる中身を弱めない）。

## 12. `scripts/cli-mock.mjs` の通しのシナリオ（U2）

API を変えたら CLI モックも合わせる（`CLAUDE.md` のプロジェクトの決まり）。いまの流れ（健康 → 設定 → お知らせ → ゲスト → スコア → セーブ → イベントと所持品）は**変えず、最後に足す**ので、いまの `npm run cli:smoke` は壊れない（`player-data` を使わない設定・`0013` を当てていない DB で 404 になったときは飛ばさず `HTTP 404` で止まる。CLI モックは demo-rpg だけを使い、demo-rpg は `0013` で `player-data` を使う設定になるので、404 はマイグレーションの当て忘れを知らせる失敗として扱う。イベントと同じ扱い）。

足す手順（同じゲストのトークン。§13 の決めること 15）:

1. `GET /v1/player-data?gameId=demo-rpg` → 200・`values: []`・`achievements: []`。
2. `POST /v1/player-data?gameId=demo-rpg`、新しい `Idempotency-Key`、本文 `{"changes":[{"key":"slimes-defeated","value":1}]}` → 200・`values` に 1・`unlocked` に `first-slime`。
3. 同じ鍵と本文でもう一度 → 200 で 2 と同じ本文（`writeId` も）。
4. `GET /v1/player-data?gameId=demo-rpg` → `slimes-defeated` が 1 のまま（二重にならない）・`achievements` に `first-slime` が 1 つ。

- ゲストは回すたびに新しいので、1 回目の書き込みは毎回 1 になる。
- 要求の形の関数（`playerDataPath`・`playerDataWrite`・`newIdempotencyKey` に当たるもの）を `scripts/cli-requests.mjs` に足し、§10 の `CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける` が同じ関数を使う。
- 利用制限: 1 回の通しで `player-data` を 4 回（60 回／分の内）。
- U1 だけの間は CLI モックを変えない（U2 で実績まで入ってから足す。1 回の通しで見せたいのは「増える・二重にならない・実績が解ける」の 3 つ）。

## 13. 決めること

推しの案で §2〜§12 を書いた。違う案にするときは、該当する節と §10 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 持つものの分け方 | A: 1 つの表（実績もキーの値 0／1 と時刻で持つ）。B: **統計値と進行状態は 1 つの表（宣言の `mode` で書き方を分ける）、実績は別の表（宣言は閾値を持ち、解いた時刻を持つ）**。C: 3 つの表（統計値・進行状態・実績を全部分ける） | **B**。統計値と進行状態はどちらも「キーごとの 1 つの整数」で、違いは書き方だけ（宣言の 1 列で足りる）。実績は解いた時刻と閾値の宣言を持ち形が違う。A は実績をクライアントが `flag` で立てる形になり、サーバーの判定（決めること 6）が入らない。C は同じ形の表が 2 つになり、口と試験が倍になる |
| 2 | セーブと同じ値を持つときの正 | A: **プレイヤーデータを正にする（クライアントは起動の時に読んで、セーブの値を上書きする）**。B: セーブを正にし、プレイヤーデータは写し。C: 決めない（ゲームに任せる） | **A**。プレイヤーデータはサーバーが判定に使う（実績・クエスト・分析）。B はサーバーが読まない本文が正になり、判定の元が偽れる上に、判定と食い違っても直す手がかりが無い。C は作者ごとに食い違いの直し方が変わる |
| 3 | キーの決め方 | A: 自由なキー（形の決まりと 1 プレイヤーの数の上限だけ）。B: **サーバーの表 `player_data_keys` で宣言したキーだけ（書き方と上限も宣言に持つ）**。C: マスターデータの JSON をサーバーが読んでキーを知る | **B**。書き方（`add` か `set` か）と上限をキーごとに決めないと、自己申告の守り（§5）が作れない。クエストの条件のキーを作り出せない。A は書き方をクライアントが選ぶことになり、数え上げの値を置き換えられる。C はマスターデータを解釈しない決定（`config-design.md`）を崩す。宣言は管理の口で入れる（§8） |
| 4 | 二重の止め方 | A: **`Idempotency-Key` を必須にし、書き込みの記録 `player_data_writes` の列（`UNIQUE (game_id, player_id, request_key)`）に保存して、応答の写しを持つ**。B: `abuse-protection-design.md` §5 の汎用の表 `idempotency_keys` を作る。C: 送信 ID を本文に入れる。D: `add` を持たない（`max`・`set` だけにして、クライアントが合計を送る） | **A**。`add` は自然な鍵が無い足し算で、見出しが要る。記録の行が鍵と応答の写しを持てば、書き込み・鍵・写しが 1 つの `batch` に収まり表が 1 つで済む（管理の増減と同じ形）。B は応答の本文を丸ごと保存する汎用の仕組みで、使うのがこの口だけのうちは重い。C は見出しと同じことを本文で決め直すだけ。D は端末を替えると合計がずれ（2 台で遊ぶと片方の合計で上書きされる）、統計値の「数え上げ」にならない |
| 5 | `add` の結果が上限を超えるとき | A: **409 `PLAYER_DATA_LIMIT_EXCEEDED`（新しいコード）で全部断る**。B: 上限で止める（丸めて 200）。C: 400 `INVALID_ARGUMENT` | **A**。作者の決めた上限に当たるのは改造か作りの誤りで、黙って丸めると気づけない。値は送った本文でなく、いまの値で決まるので 409（`INVENTORY_LIMIT_EXCEEDED` と同じ考え）。C は本文だけで決まる誤りと区別できない |
| 6 | 実績の解除 | A: **サーバーがキーの値と閾値で判定する（書き込みの `batch` の中）。解いたと申告する口は作らない**。B: クライアントが解いたと申告する口（`POST /v1/player-data/achievements/{id}`）。C: 両方 | **A**。クエストの達成の判定（§15）が同じ形（キーの値と閾値）になり、条件をサーバーが持てる。出来事で解く実績は `flag` のキーと閾値 1 で同じ道に乗る。B は実績ごとの守りが無く、どんな実績でも解ける（申告の確かめが宣言・範囲・利用制限を通らない）。C は道が 2 つになり試験が倍になる |
| 7 | 1 回の書き込みのキーの数 | A: 1 回で 1 キー。B: **1 回で 1〜20 キー（全部通るか、どれも書かない）** | **B**。1 回の戦闘の後に「倒した数・最深の階・ボスの印」をまとめて送れ、利用制限の回数を抑えられる。20 は `batch` の文の数を抑える上限（`MAX_REWARD_LINES` と同じ考え）。A はクライアントが 3 回送り、途中で切れると一部だけ残る |
| 8 | 管理の口 | A: **読む口に欄を足し、キーと実績の宣言・値を置く・実績を取り消すの 4 つの口を足す（監査に前と後）**。B: 読むだけ（直すのは BAN と、行を消すマイグレーション）。C: 値を足し引きする口（`Idempotency-Key` 必須） | **A**。不正な値を戻す・誤って解けた実績を消すのは運用で要る。置く・消すは何度送っても同じで鍵が要らない。B は直すのに SQL を流すことになり監査に残らない（`admin-design.md` §11 の決めること 1 の A と同じ穴）。C は統計値の「戻す」に足し引きの意味は要らず、置くで足りる |
| 9 | Cron Triggers・Durable Objects を使うか | A: **使わない（D1 の `batch` と一意の鍵だけ）**。B: プレイヤーごとの Durable Object で書き込みを順に処理する。C: 実績の判定を Cron Triggers でまとめて流す | **A**。`wrangler.jsonc` もパッケージも変えずに済む。B は D1 の一意の鍵で足りる二重の止めに、クラスと設定を足す。C は解けるまでに間ができ、応答で「解けた」を返せない |
| 10 | 機能の名前（`game_modules`） | A: **`player-data` の 1 つ（実績も含む）**。B: `player-data` と `achievements` の 2 つ | **A**。実績は値の書き込みの中で判定するので、値を使わず実績だけ使うことはできない。B は分けても選べる組み合わせが増えない。機能の設定は認可の代わりにしない（決定のまま） |
| 11 | パッケージ | A: **足さない（D1・Web Crypto だけ）**。B: JSON の形の確かめのライブラリを足す | **A**。本文の形は小さく、`parseChanges` の手書きで足りる。`package.json` を変えない |
| 12 | クライアントの自己申告をどこまで信じるか | A: **スコアと同じ扱い（`abuse-protection-design.md` §6）。サーバーはゲームを問わない守り〔宣言・範囲・1 回の上限・書き方の固定・利用制限・サーバーの時刻〕だけをやり、値は申告として扱う（§5）**。B: ゲームごとに署名やリプレイの照合を足して確かめる。C: 信じない（プレイヤーデータを書く口を作らず、サーバーの出来事〔報酬の受け取りなど〕からだけ数える） | **A**。値がゲームの中で取れたかはゲーム固有のルールで、共通のサーバーは確かめられない（ADR 0002）。B は作者ごとのルールと鍵をサーバーに入れることになり、クライアントの長期の鍵は安全とみなさない（`architecture.md` の 5）。C はゲームの中の出来事（倒した数・進んだ章）をサーバーが知る道が無く、クエストと分析の元が無くなる。限界は §5 にそのまま書き、不正は管理（§8）と BAN で対処する |
| 13 | 1 回の増加の上限 | A: **キーごとの `max_delta`（宣言に持つ。`add` のキーだけ）**。B: 全部のキーで一律の定数。C: 上限を持たない（`max_value` と利用制限だけ） | **A**。1 回で増えうる数はキーの意味で違い（倒した数は 10、得た経験値は 10,000）、作者が意味を知っている。B は小さくすると正しい送信を断り、大きくすると守りにならない。C は 1 回で `max_value` まで増やせ、利用制限が効かない |
| 14 | 上限の数（キーの数・値の範囲・利用制限） | A: **1 ゲーム 200 キー（`MAX_PLAYER_DATA_KEYS`。1 プレイヤーの行の数の上限にもなる）・値は 0〜1,000,000,000（スコア・所持品と同じ）・1 回の書き込みは 20 キー・利用制限はプレイヤーごと 60 秒に 60 回（`rewards`・`saves` と同じ）**。B: キーの数を持たない（行の数を利用制限だけで抑える）。C: 値に負の数も許す | **A**。宣言だけを受け付けるので、1 プレイヤーの行の数は宣言の数で決まり、表が太らない。値の上限を既存と揃えると、クライアントの整数の型（32 ビットを越えない範囲の扱い）が口ごとに変わらない。B は管理の口の打ち間違いで宣言が増え続ける。C は「数え上げ」と「最大値」の意味に負が要らず、`CHECK` が 1 つ緩むだけ。上げるのは互換を壊さない（通っていた要求は通る） |
| 15 | CLI モックに足す手順 | A: **成功の道の 4 手順（読む → 増やす → 同じ鍵で送り直す → 読み直す）。断られる例は §10 の試験で見る**。B: A に断られる例（宣言の無いキー・1 回の上限を超える増加）を足す。C: 足さない（試験だけ） | **A**。CLI モックは 3 つのクライアントの代わりで、クライアントが実際に通る道（送り直しで二重にならない・実績が解ける）を見せる。B は断られる応答で止まらない作りを CLI モックに入れることになり、いまの「どれかが失敗したら止まる」作りと合わない（断られる例は §10 の L2 で見る）。C は `npm run cli:smoke` で人が通しを見られない |

## 14. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| U1 | 値と書き込み: `migrations/` の新しい `0013_player_data.sql`・`src/core/player-data.ts`・`src/core/idempotency.ts`（管理の口の読み込み先を移す）・`src/modules/player-data/`（`index.ts`・`parse.ts`・`limits.ts`）・`src/modules/index.ts` に足す・`RATE_LIMITS.playerData`・2 つのエラーコード・§9 の U1 の文書と契約・§10 の U1 の試験 | O4（`admin-design.md`） | §11 の手続きで 4 本を置き換え・3 本に行を足す | 足さない |
| U2 | 実績と CLI モック: `migrations/` の新しい `0014_achievements.sql`・§7 の判定の文・応答の `achievements`・`unlocked`・§12 の CLI モックと `scripts/cli-requests.mjs`・§9 の U2 の文書と契約・§10 の U2 の試験 | U1 | §11 の手続きで 1 本に行を足す | 足さない |
| U3 | 管理: `src/core/admin/` に §8 の 4 つの口とプレイヤーを読む口の欄・`MAX_PLAYER_DATA_KEYS`・`scripts/admin-cli.mjs` と `scripts/admin-requests.mjs` に操作・管理のスキーマ・§9 の U3 の文書・§10 の U3 の試験 | U2 | 変えない | 足さない |

範囲の外（後の設計書）: §16。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。`gitClean` は `base` を渡さないと作業ツリーしか見ないので、先頭の `base` に**実装の Issue を作るときの main のコミットの SHA** を書き入れる（`docs/guides/procedures/issue-goal-setting.md`）。

U1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0013_player_data.sql', 'src/core/player-data.ts', 'src/core/idempotency.ts', 'src/modules/player-data/index.ts',
  'src/modules/player-data/parse.ts', 'src/modules/player-data/limits.ts', 'test/player-data.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
const mod = read('src/modules/player-data/index.ts');
check(/\bconsume\(/.test(mod), 'プレイヤーデータのモジュールが利用制限（consume）を呼ぶ');
check(/requireNotBanned/.test(mod), 'プレイヤーデータのモジュールが止めた印を確かめる');
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
const codes = spec.components?.schemas?.ErrorCode?.enum ?? [];
check(codes.includes('PLAYER_DATA_LIMIT_EXCEEDED') && codes.includes('IDEMPOTENCY_KEY_REUSED'), 'スキーマの ErrorCode に 2 つのコードがある');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(!all.includes('スキーマのErrorCodeの列挙は15個のエラーコードと一致する'), '置き換えた試験が残っていない（15個のコード）');
check(!all.includes('スキーマのファイルはOpenAPI 3.1で15個の操作を持つ'), '置き換えた試験が残っていない（15個の操作）');
check(!all.includes("'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない'"), '置き換えた試験が残っていない（モジュールの一覧）');
check(!all.includes("'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsを使う設定で登録される'"), '置き換えた試験が残っていない（demo-rpg の設定）');
runTests();
requireTests([
  'プレイヤーデータの変更の本文はキーが重ならず行の数と整数を確かめる',
  'プレイヤーデータの書き方ごとに受け付ける値の範囲が決まる',
  'プレイヤーデータの書き込みの本文のハッシュは変更の並びに左右されない',
  'プレイヤーデータを増やすと書いた後の値が返り読み直しても同じ',
  '最大値で置くキーは小さい値を送っても下がらない',
  '値で置くキーは送った値に置き換わり下げられる',
  '真偽のキーは1だけを受け付け一度立てたら下がらない',
  '宣言の無いキーへの書き込みはNOT_FOUNDの404を返し何も書かない',
  '1回の増加の上限を超える値は400を返し何も書かない',
  '増やした結果が上限を超えるとPLAYER_DATA_LIMIT_EXCEEDEDの409を返し何も書かない',
  '同じIdempotency-Keyの書き込みを2回送っても1回分で同じ本文を返す',
  '同じIdempotency-Keyの書き込みを並べて送っても1回分',
  '同じIdempotency-Keyで違う中身の書き込みはIDEMPOTENCY_KEY_REUSEDの422を返す',
  'Idempotency-Keyの無いプレイヤーデータの書き込みはINVALID_ARGUMENTの400を返す',
  'ほかのプレイヤーが同じIdempotency-Keyを使っても別の書き込みになる',
  'プレイヤーデータを読むとトークンのプレイヤーの値だけがキーの順に返る',
  '何も書いていないプレイヤーのプレイヤーデータは空の一覧で返る',
  'クライアントが送った時刻はプレイヤーデータの時刻に使わない',
  'プレイヤーデータはトークンの無い要求に401を返し利用制限を数えない',
  'トークンと違うゲームのプレイヤーデータはPERMISSION_DENIEDの403を返す',
  'player-dataを使わない設定のゲームのプレイヤーデータはNOT_FOUNDの404を返す',
  '本番の設定ではプレイヤーデータの読み書きにNOT_READY_FOR_PRODUCTIONの403を返す',
  'プレイヤーデータの操作を上限より多く呼ぶと429とRetry-Afterを返す',
  'BANしたプレイヤーのプレイヤーデータの読み書きはPLAYER_BANNEDの403を返し何も書かない',
  'プレイヤーデータの値はマイナスにも上限より大きくもできない',
  'プレイヤーデータの読み書きの応答はスキーマに合う',
  'プレイヤーデータの利用制限の回数と窓は定数のモジュールにある',
  'スキーマのErrorCodeの列挙は17個のエラーコードと一致する',
  'スキーマのファイルはOpenAPI 3.1で17個の操作を持つ',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataでルートが重ならない',
  'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataを使う設定で登録される',
  // 中身に行を足した既存の試験と、変わらないことを見張る既存の試験（§11）
  '利用制限の回数と窓は定数のモジュールにある',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
  'PLAYER_BANNEDの応答はスキーマに合う',
  '同じIdempotency-Keyの付与を2回送っても1回分で同じ本文を返す',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション・守り・ほかのモジュール・CLI モック・管理コマンドを変えない（CLI モックは U2・管理コマンドは U3）
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory', '0010_events', '0011_admin', '0012_player_bans'].map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/rate-limit.ts', 'src/core/ledger.ts',
  'src/modules/saves/', 'src/modules/config/', 'src/modules/rankings/', 'src/modules/announcements/', 'src/modules/inventory/',
  'src/modules/events/', 'scripts/', 'openapi/rpg-online-admin.v1.json', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

U2:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0014_achievements.sql'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/\/v1\/player-data/.test(read('scripts/cli-requests.mjs')), 'CLI モックの要求の形がプレイヤーデータの口を持つ');
check(/player_achievements/.test(read('src/modules/player-data/index.ts')), 'プレイヤーデータのモジュールが実績を判定する');
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(!mock.includes('/v1/admin') && !mock.includes('ADMIN_API_KEY'), 'CLI モックに管理の口と鍵が無い');
runTests();
requireTests([
  '統計値が閾値に届いた書き込みで実績が解け応答に載る',
  '真偽のキーを立てると閾値1の実績が解ける',
  '解いた実績はもう一度届いても二重に解けず時刻が変わらない',
  '値で置くキーを下げても解いた実績は消えない',
  '同じIdempotency-Keyの送り直しは解いた実績も1回目と同じ本文で返す',
  '実績の解除を申告する欄は読まない',
  'ほかのプレイヤーの値では自分の実績は解けない',
  '実績の応答はスキーマに合う',
  'CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける',
  // U1 の挙動と CLI モックの互換を見張る（§11）
  '同じIdempotency-Keyの書き込みを2回送っても1回分で同じ本文を返す',
  '同じIdempotency-Keyの書き込みを並べて送っても1回分',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
  'CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション（0013 まで）・守り・ほかのモジュール・管理を変えない
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory', '0010_events', '0011_admin', '0012_player_bans', '0013_player_data'].map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/rate-limit.ts', 'src/core/rate-limit-policy.ts',
  'src/core/admin/', 'src/modules/saves/', 'src/modules/config/', 'src/modules/rankings/', 'src/modules/announcements/',
  'src/modules/inventory/', 'src/modules/events/', 'scripts/admin-cli.mjs', 'scripts/admin-requests.mjs', 'scripts/issue-run/',
  'openapi/rpg-online-admin.v1.json', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

U3:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/player-data\.set/.test(read('src/core/admin/routes.ts')), '管理の口が値の直しを監査に残す');
check(/achievement\.revoke/.test(read('src/core/admin/routes.ts')), '管理の口が実績の取り消しを監査に残す');
const requests = ['scripts', 'admin-requests.mjs'].join('/');
check(/\/v1\/admin\/player-data\/keys/.test(read(requests)), '管理コマンドがキーの宣言の口を呼ぶ');
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(!mock.includes('/v1/admin') && !mock.includes('ADMIN_API_KEY'), 'CLI モックに管理の口と鍵が無い');
runTests();
requireTests([
  '管理の読み取りはプレイヤーデータの値と解いた実績を返す',
  '管理の口で宣言したキーにプレイヤーが書ける',
  '値のあるキーの書き方は変えられない',
  '宣言の無いキーを見る実績の宣言はNOT_FOUNDの404を返し何も書かない',
  '管理でプレイヤーデータを直すと値が置き換わり監査に前と後が残る',
  '管理で値を直しても実績は解けず取り消されない',
  '管理で実績を取り消すと解いた行が消え監査に残る',
  '本番の設定ではプレイヤーデータの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す',
  'プレイヤーデータの管理の口の応答は管理のスキーマに合う',
  '管理コマンドと同じ流れでプレイヤーデータの宣言と直しと実績の取り消しが監査に残る',
  // 管理とゲームのクライアントが変わらないことを見張る（§11）
  '管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  '管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る',
  'CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// マイグレーション（全部）・ゲームのクライアントのスキーマ・CLI モック・守りを変えない（U3 は表を足さない）
const keep = ['migrations/', 'openapi/rpg-online.v1.json', 'scripts/cli-mock.mjs', 'scripts/cli-requests.mjs', 'scripts/cli-requests.d.mts',
  'scripts/issue-run/', 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/ledger.ts', 'src/modules/',
  'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（`CLAUDE.md` の進め方の決まり）。
- 通しの確かめ（`npm run cli:smoke` と管理コマンド）は確認コマンドに入れない（無人の回では開発サーバーを起動せず、`.dev.vars` も作らない）。U2・U3 の後に会話の側で回す（§0）。

## 15. Phase 2 の残りの項目（クエスト・分析）との関係

`event-reward-design.md` §13 の順（管理 → プレイヤーデータ → クエスト → 分析）のまま。この設計が残りの項目に渡すもの:

| 項目（`roadmap.md` Phase 2） | この設計との関係 |
| --- | --- |
| クエスト（達成条件・報酬・進捗） | `docs/guides/working/quest-design.md` が正（Q1 済み）。**達成条件はプレイヤーデータのキーと閾値**（実績と同じ形。§7）で、進捗はキーのいまの値を読むだけ（クエストの表に持たない）。達成は書き込みの `batch` でなく、受け取りの口の中で判定する（`quest-design.md` §5。この機能の書き込みにクエストの文を足さない）。報酬は受け取りと同じ形（`LEDGER_SOURCES.questClaim`。同 §6）。区切りごとの値は同 §6・§7（Q2） |
| 分析（DAU・継続率）・バックアップ・費用アラート | 書き込みの記録 `player_data_writes`（プレイヤーと時刻）は、遊んだ日の数え上げの元になりうる（DAU。ただし書き込まない日は数えられないので、ゲストの発行・トークンの要る要求の記録とどう合わせるかは分析の設計書で決める）。`player_data_writes` の古い行の掃除（鍵の期限）を Cron Triggers で作る（§6）。値の分布（どこまで進んだか）は `player_data` から集計できる。Analytics Engine を使うかは分析で決める |

## 16. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 減らす統計値・最小値で置く（最速のクリアの時間） | 宣言の `mode` に `min` を足す（`CHECK` の列挙を変えるので、新しい表に移すか、`mode` を別の表で持つ。`ALTER TABLE` を使わない） |
| 数でない値（文字列・JSON の進行状態） | セーブに置く（サーバーは解釈しない）。サーバーが読む要るものだけ、数に直してキーを宣言する |
| 実績の宣言の時にさかのぼって全員を判定する | 管理の口に「判定し直す」口を足し、プレイヤーを区切って流す（D1 の 1 回の `batch` の大きさは**要確認**） |
| 区切りごとの統計値（今日倒した数・今週の数） | `docs/guides/working/quest-design.md` §6・§7（区切りで数える宣言 `player_data_key_periods` と区切りごとの値 `player_data_period_values`。書き込みの `batch` が足す） |
| ほかのプレイヤーの値を読む（フレンドの進み・統計値のランキング） | ソーシャル（P2 以降）。統計値のランキングは、`ranking_entries` に統計値から写す形をランキングの決まりと一緒に |
| 書き込みの記録の掃除・鍵の期限 | 30 日で消す（§6 の鍵の期限。`docs/guides/working/analytics-design.md` §6・§7） |
| 値の改ざんの自動の検出 | ゲームごとに基準が違う（ADR 0002）。管理の読み取り（§8）で見て、直し・BAN で対処する |
| 管理画面（ブラウザ）でのプレイヤーデータの表示 | Phase 4（`admin-design.md` §14） |
| `APP_ENV` の守りを外すこと | ユーザーが決める（`admin-design.md` §10） |

## 17. 指示の表

| Issue #38 の指示 | どこで答えるか |
| --- | --- |
| 何を持つか（実績・進行状態・統計値の分け方）とセーブとの境目 | §2・§13 の決めること 1・2 |
| データの形（D1 の表・新しいマイグレーションの番号）とキーの決め方（1 プレイヤーのキーの数・値の範囲の上限） | §3・§13 の決めること 3・14 |
| 書き方（増やす・最大値で置く・値で置く・真偽を立てる）・クライアントの自己申告をどこまで信じるか・1 回の増加の上限 | §5・§13 の決めること 5・12・13 |
| 二重の止め方（`Idempotency-Key`・表・送信 ID）と利用制限 | §6・§9・§13 の決めること 4 |
| 実績の解除をサーバーが判定するか、クライアントが申告するか | §7・§13 の決めること 6 |
| API とその確かめの順・認証・`APP_ENV`・BAN | §4・§9 |
| 管理との関係（読む・直す・監査） | §8・§13 の決めること 8 |
| `scripts/cli-mock.mjs` の通しのシナリオ（`npm run cli:smoke` を壊さない） | §12・§13 の決めること 15 |
| 試験の名前（束は `U1`・`U2`…）・名前の中の数の試験・互換の試験 | §10・§11 |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §14 |
| Phase 2 の残りの項目（クエスト・分析） | §15 |
| Cloudflare の数字・機能は公式で確かめたか「要確認」 | §1 |
| 新しいエラーコードはどちらのスキーマに入るか | §9 |
| 新しいパッケージは足さない案を推し | §13 の決めること 11 |
