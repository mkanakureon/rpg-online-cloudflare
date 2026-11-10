# イベントと報酬（所持品・通貨・受領の履歴）の設計書

`docs/guides/decisions/roadmap.md` Phase 2 の最初の設計書。Phase 2 の完了条件「MacとCLIだけで、イベントの開始から報酬の受け取りまでのシナリオを通せる」に要る 2 項目、**期間限定イベント・デイリー／週間の報酬**と**所持品・通貨・配布と受領の履歴**を扱う。

データの形（D1 の表・新しいマイグレーションの番号）・API とその確かめの順・期間の判定にサーバーの時刻を使うこと・受け取りの二重を止める方法・所持品と通貨の増減をどこまでサーバーが持つか・認証と `APP_ENV` と利用制限・`scripts/cli-mock.mjs` の通しのシナリオ・試験の名前・実装の束を決める。Phase 2 の残りの 4 項目（プレイヤーデータ・クエスト・管理・分析）は、やる順と置き場だけを §13 に書く。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`。ゲーム固有のルールを共通のサーバーに入れない）と、これまでの設計書の決定: `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・`tenant_id` を持たない・機能の設定 `game_modules` は認可の代わりにしない）・`docs/guides/working/account-design.md`（トークン `v1.<本文>.<HMAC>`・プレイヤーはトークンの `p` だけで決まる・`requireAuth`）・`docs/guides/working/save-design.md`（リビジョンで競合を止める・1 文の SQL で比べて書く・墓石）・`docs/guides/working/config-design.md`（マスターデータはサーバーが解釈しない・設定は新しい番号のマイグレーションで入れる）・`docs/guides/working/abuse-protection-design.md`（D1 の固定窓の `consume`・`RATE_LIMITS`・`Idempotency-Key` の扱い）。これらは「決めること」に戻さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。失敗ケースの試験の名前の正は `docs/guides/working/failure-case-test-plan.md`。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§8 の試験の名前を `requireTests` に渡して実装の Issue を E1・E2 の順に回し、**CLI モック（`scripts/cli-mock.mjs`）がゲストのトークンで開いているイベントの一覧を読み、デイリーの報酬を受け取ると所持品の通貨が増えて受領の履歴に 1 行残り、もう一度受け取っても 200 で同じ本文が返って残高も履歴も増えない（二重にならない）、期間の判定はクライアントの時刻でなくサーバーの時刻で決まる**のを見て、Phase 2 の完了条件「イベントの開始から報酬の受け取りまでのシナリオ」が Mac と CLI だけで通り、サーバーがゲームの中の意味（品目の効果・値段）を持たずに仕組み（期間・回数・付与・残高・履歴）だけを持つと分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§11 に決めること（案と推し）、§12 に実装の束、§14 に範囲の外がある | 機械（Issue #30 の確認コマンド） |
| ADR 0002・元の文書（`roadmap.md`・`account-design.md`・`save-design.md`・`config-design.md`・`abuse-protection-design.md`・`failure-case-test-plan.md`・`operations-security.md`）・`game_modules`・`APP_ENV`・`RATE_LIMITED`・D1・Cron Triggers・`scripts/cli-mock.mjs`・`CLAUDE.md` が出てくる。イベント・所持品・通貨・受領・二重・サーバーの時刻の扱いが出てくる | 機械（同上） |
| Phase 2 の残りの項目（プレイヤーデータ・クエスト・管理・分析）に触れている（§13） | 機械（同上） |
| 失敗ケースの計画の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う` に名前で触れ、§8 の表に写していない。`スキーマのErrorCodeの列挙は12個のエラーコードと一致する`・`今のCLIモックと同じ形の要求を受け付ける` に名前で触れている（§9） | 機械（同上） |
| §8 の表の束は `E1`・`E2`。名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§12） | 機械（同上） |
| 指しているパスが実在する（これから作る `src/`・`test/`・`migrations/` の下と、§13 の次の設計書の名前を除く） | 機械（同上） |
| サーバーがゲーム固有のルール（品目の効果・値段・ドロップ率・達成の判定）を持たない（§2・ADR 0002）。期間の判定にクライアントの時刻を使わない（§4）。受け取りの二重が 1 つの `batch` と一意の鍵で止まる（§5）。`APP_ENV` の守りを外さない（§7）。Cloudflare の数字・機能は確かめた所と「要確認」が分かれている（§1） | AI の判定（作っていない判定役が、§1〜§7 と `src/`・`migrations/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§12 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 挙動の変わる既存の試験は §9 の手続きだけで直す。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束。§11 の決めること 6・8）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（§7）。
- E2 の後、会話の側で `npm run db:migrate:local && npm run dev` と `npm run cli:smoke` を回し、§10 のシナリオが `PASS` で通るのを見る（無人の回では開発サーバーを起動しない）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

2026-10-30 の main（`61baf7b`）の `src/`・`migrations/`・`test/`・`scripts/`・`wrangler.jsonc` を読んで確かめた。

| 所 | いま |
| --- | --- |
| 機能のモジュール | `src/modules/index.ts` の `[announcements, rankings, saves, config]`。名前は `game_modules` の `module` と同じ。モジュールどうしは互いを読み込まない |
| マイグレーション | `0001`〜`0008`（`0008_rate_limits.sql` が最後）。次の番号は `0009` |
| トークンの要る読み取り | セーブの `GET`（`requireLocalWrite` → `requireAuth` → `consume(RATE_LIMITS.saves)` → `gameId` の形 → トークンのゲームとの突き合わせ。`src/modules/saves/index.ts` の `checkAccess`） |
| 利用制限 | `src/core/rate-limit.ts` の `consume(db, rule, subject, nowSeconds)`。回数は `src/core/rate-limit-policy.ts` の `RATE_LIMITS`（`guestIp`・`guestGame`・`score`・`saves`）。429 `RATE_LIMITED` と `Retry-After` |
| エラーコード | 12 個（`test/schema-conformance.test.ts` の `errorCodes`。最後が `RATE_LIMITED`） |
| スキーマの操作 | 11 個（試験 `スキーマのファイルはOpenAPI 3.1で11個の操作を持つ`） |
| 時刻 | クライアントの時刻はどの口でも受け取らない。記録の時刻は D1 の `datetime('now')`・`strftime(...)`（`failure-case-test-plan.md` のケース 6） |
| `batch` | `src/core/env.ts` の `Database.batch`（全部が通るか、どれも入らない）。ゲストの発行が使っている |
| 所持品・通貨・イベント | 表も口も無い |
| 品目の定義の置き場 | 無い。マスターデータ（`config_master_data`）はサーバーが解釈しない文字列（`config-design.md` §2） |
| `Idempotency-Key` | どこも読まない。`abuse-protection-design.md` §5 は「Phase 2 の報酬の受け取り・所持品の付与」に後から足す形（表 `idempotency_keys`）を書いている |
| CLI モック | `scripts/cli-mock.mjs` は健康 → 設定 → お知らせ → ゲスト → スコア → セーブ（書く・読む・一覧・消す）。要求の形の関数は `scripts/cli-requests.mjs` |

元の文書から引く決まり:

- `roadmap.md` Phase 2 の項目と完了条件（上の段落）。
- 構想の文書（`docs/inspecs/2026/10/` の「共通ゲームバックエンド構想」。人が書いた入力で、読むだけ）: §2 で「イベント（デイリー、週間、期間限定）」「アイテム（所持品、通貨、配布、受領履歴）」は P1。「共通バックエンドに入れないもの」: 錬金のレシピや戦闘の計算のようなゲーム固有のルールは入れず、**所持品の管理・報酬の付与などの仕組み**を共通にする。§6: Queues と Cron Triggers は「P1 以降」。
- `docs/guides/decisions/operations-security.md` の公開前の必須要件 5（操作の原子性: 報酬の二重取り・在庫の競合・アイテムの重複を防ぐ。KV は整合性の厳しい更新に向かない）・2（認可。ID の申告で他人のデータを読み書きさせない）・4（利用制限）。
- `failure-case-test-plan.md` のケース 5（同じイベントを二重送信する）・ケース 6（サーバーとローカルの時刻が違う）。ケース 6 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う` は L3・UE 統合後（Phase 3）の試験で、正は失敗ケースの計画。この設計ではイベントの API を作り、その試験が見るもの（期間の内か外かがサーバーの時刻で決まる）を §4 と §8 の L2 の試験で先に固める。§8 の表には写さない。
- `docs/guides/working/architecture.md` の「冪等性: 報酬受取や購入など状態更新には `Idempotency-Key` を導入する」・Cron Triggers の行（日次切替・集計・清掃。冪等性・タイムゾーンの明示）。→ 報酬の受け取りは一意の鍵で冪等にし、見出しは要らない形にした（§5・§11 の決めること 2）。architecture.md の行の直し方は §7。

Cloudflare の機能（2026-10-30。リポジトリに入っている wrangler 4.152.0 の `node_modules/wrangler/config-schema.json` で確かめたものと、要確認のもの）:

- **Cron Triggers**: `wrangler.jsonc` の `triggers: { crons: ["<cron の式>"] }` で Worker の `scheduled` の入口を呼ぶ（`config-schema.json` の `triggers.crons` が文字列の配列）。この設計では**使わない**（§4・§11 の決めること 6）。cron の式の時刻が UTC であることと、実行の遅れ・重なりの扱いは**要確認**（公式の文書）。
- **Queues**: 使わない。バインディングの形と料金は**要確認**。
- **D1 の `batch`**: 文を順に流し、どれかが落ちれば全部戻る（`src/core/env.ts` の決まりで、ゲストの発行が頼っている）。並べた要求の `batch` が互いに混ざらず順に流れる（1 つの書き手）ことは `abuse-protection-design.md` §3 と同じ前提。D1 の書き込みの速さ・上限の数は**要確認**（`operations-security.md` の方針どおり数字を固定しない）。
- **D1 の `?NNN`（番号つきの引数）**: §5 の SQL は読みやすさのために `?1` の形で書いた。D1 で使えるかは**要確認**。使えなければ実装で `?` を順に `bind` する（中身は同じ）。

## 2. サーバーが持つもの・持たないもの（ADR 0002）

| 持つ（ゲームを問わない仕組み） | 持たない（ゲームの中の意味。ゲームの側・マスターデータ） |
| --- | --- |
| 品目の ID と種類（通貨か所持品か） | 品目の名前・絵・説明・効果・値段（マスターデータ。`config-design.md` の C2 で配る。サーバーは解釈しない） |
| イベントの期間（始まり・終わり）・区切り（一度きり・デイリー・週間）・時差 | イベントの見せ方・物語・バナー |
| 報酬の中身（どの品目を何個） | ドロップ率・抽選・条件つきの報酬（ゲーム固有のルール） |
| 受け取れる回数（区切りごとに 1 回） | 受け取る条件（ログインした・クエストを終えた等の判定。クエストは §13） |
| 付与・残高・受領の履歴（足し算と記録） | 消費（使う・買う・合成）の意味と値段。Phase 2 に入れない（§6） |
| 残高の上限（10 億。桁あふれの止め） | 品目ごとの所持の上限（ゲームの決まり） |

品目の定義は表 `inventory_items`（ID と種類だけ）に置き、意味はマスターデータに置く（§11 の決めること 4）。サーバーはマスターデータを読まない（`config-design.md` の決定のまま）。

## 3. データの形

### 表（E1: `migrations/` の新しい番号 `0009_inventory.sql`）

```sql
-- 品目（ゲームごと。ID と種類だけ。名前・効果はマスターデータ）
CREATE TABLE IF NOT EXISTS inventory_items (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,                        -- ^[a-zA-Z0-9_-]{1,64}$（src/core/ids.ts と同じ形）
  kind TEXT NOT NULL CHECK (kind IN ('currency', 'item')),
  PRIMARY KEY (game_id, item_id)
);
-- 残高（プレイヤー・品目ごとに 1 行。0 の行は作らない）
CREATE TABLE IF NOT EXISTS inventory_balances (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（saves と同じ理由）
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0 AND amount <= 1000000000),  -- MAX_ITEM_AMOUNT（src/core/inventory.ts と同じ。2 か所）
  updated_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  PRIMARY KEY (game_id, player_id, item_id),
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
-- 受領の履歴（増減 1 回で 1 行。API からは書き換えない・消さない。ゲームの行を消したときだけ CASCADE で消える）
CREATE TABLE IF NOT EXISTS inventory_ledger (
  entry_id INTEGER PRIMARY KEY,                 -- 増える番号（履歴の順と続きの鍵）
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),    -- Phase 2 は付与だけ（正の数）。消費を足すときに負の数を使う（§6）
  source_type TEXT NOT NULL,                    -- 'event-claim'（E2）。後から 'quest'・'admin'（§13）
  source_id TEXT NOT NULL,                      -- 受け取りの claim_id など
  created_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
CREATE INDEX IF NOT EXISTS inventory_ledger_player ON inventory_ledger (game_id, player_id, entry_id);
-- それまでに登録したゲームは inventory を使う設定にする（0003・0005 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'inventory' FROM games;
-- demo-rpg の手本の品目（CLI モックの通しに使う）
INSERT OR IGNORE INTO inventory_items (game_id, item_id, kind) VALUES ('demo-rpg', 'gold', 'currency');
INSERT OR IGNORE INTO inventory_items (game_id, item_id, kind) VALUES ('demo-rpg', 'potion', 'item');
```

### 表（E2: `migrations/` の新しい番号 `0010_events.sql`）

```sql
-- イベント（ゲームごと）。時刻はどれも UNIX 秒（UTC）
CREATE TABLE IF NOT EXISTS events (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,                       -- ^[a-zA-Z0-9_-]{1,64}$
  kind TEXT NOT NULL CHECK (kind IN ('once', 'daily', 'weekly')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  reset_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (reset_offset_minutes BETWEEN -720 AND 840),  -- 区切りの時差（0 は UTC）
  CHECK (ends_at > starts_at),
  PRIMARY KEY (game_id, event_id)
);
-- 報酬の中身（イベントごとに品目と数。1 イベント最大 MAX_REWARD_LINES 行）
CREATE TABLE IF NOT EXISTS event_rewards (
  game_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1 AND amount <= 1000000000),
  PRIMARY KEY (game_id, event_id, item_id),
  FOREIGN KEY (game_id, event_id) REFERENCES events(game_id, event_id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
-- 受け取り（プレイヤー・イベント・区切りごとに 1 行。二重を止める一意の鍵）
CREATE TABLE IF NOT EXISTS event_claims (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  period_key TEXT NOT NULL,                     -- 'once'・'2026-10-30'（デイリー）・'2026-10-26'（週間。月曜の日付）
  claim_id TEXT NOT NULL UNIQUE,                -- サーバーが作る（crypto.randomUUID()。ゲストの発行の src/core/accounts.ts と同じ作り方）
  claimed_at INTEGER NOT NULL,                  -- サーバーの時刻（UNIX 秒）
  PRIMARY KEY (game_id, player_id, event_id, period_key)
);
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'events' FROM games;
-- demo-rpg の手本のイベント（CLI モックの通しに使う）。デイリーのログインの報酬・金貨 100
INSERT OR IGNORE INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes)
  VALUES ('demo-rpg', 'daily-login', 'daily', CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER),
          CAST(strftime('%s', '2100-01-01 00:00:00') AS INTEGER), 0);
INSERT OR IGNORE INTO event_rewards (game_id, event_id, item_id, amount) VALUES ('demo-rpg', 'daily-login', 'gold', 100);
```

- `inventory_balances` は `inventory_ledger` の合計の写し（読むのを速くするため）。両方は §5 の 1 つの `batch` で書くので、ずれない。ずれを見つける試験は §8 の `報酬を受け取ると所持品が増え受領の履歴に残る`（残高と履歴の合計を比べる）。
- マイグレーションはどれも `IF NOT EXISTS`・`INSERT OR IGNORE` だけ（既存の試験 `マイグレーションを2回当ててもデータは壊れない` が通る）。`ALTER TABLE` を使わない（2 回目に落ちる）。
- 時刻は UNIX 秒の整数にする（期間の比べと区切りの計算を整数でする）。API の応答では ISO 8601 の UTC（`2026-10-30T15:30:00Z`）に直す。

### 定数（データ 1 か所。design-cycle §2）

| 定数 | 値 | 置き場 | 束 |
| --- | --- | --- | --- |
| `MAX_ITEM_AMOUNT` | 1,000,000,000（スコアの上限と同じ） | `src/core/inventory.ts`（events と inventory の両方のモジュールが読む。モジュールどうしは読み込まないので core に置く）。DB の `CHECK` と 2 か所 | E1 |
| `HISTORY_LIMIT_DEFAULT`・`HISTORY_LIMIT_MAX` | 20・100 | `src/modules/inventory/limits.ts` | E1 |
| `MAX_REWARD_LINES` | 10（1 イベントの報酬の行の数。`batch` の文の数を抑える） | `src/core/inventory.ts`（events のモジュールと、管理のイベントの定義の口〔`src/core/admin/`〕の両方が読む。`admin-design.md` §7） | E2・O4 |
| `MAX_EVENTS` | 200（1 ゲームのイベントの宣言の数。`MAX_QUESTS` と揃える。管理のイベントの定義の口が、新しいイベントで超えるなら 400 `INVALID_ARGUMENT`。あるイベントの置き換えは通す） | `src/core/inventory.ts`（`MAX_REWARD_LINES` の隣。管理の口〔`src/core/admin/routes.ts`〕が読む） | F1（Issue #55） |
| `RATE_LIMITS.rewards` | `{ scope: 'rewards', limit: 60, period: 60 }` | `src/core/rate-limit-policy.ts`（`abuse-protection-design.md` §2 の表にも行を足す。§7） | E1 |

### モジュールのファイル

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/core/inventory.ts` | `MAX_ITEM_AMOUNT`・品目の種類の名前 | E1 |
| `src/modules/inventory/index.ts` | `inventory: GameModule`（`name: 'inventory'`）。§4 の所持品と受領の履歴の 2 つの `GET` | E1 |
| `src/modules/inventory/shape.ts` | `shapeInventory(rows)`（通貨と所持品に分け、品目の ID の昇順）・`parseHistoryQuery(url)`（`limit`・`before`）。入出力の無い関数 | E1 |
| `src/modules/events/index.ts` | `events: GameModule`（`name: 'events'`）。一覧の `GET` と受け取りの `POST` と §5 の SQL | E2 |
| `src/core/period.ts` | `isOpen`・`periodKey`・`nextResetAt`・`isoSeconds`（§4。入出力の無い関数。クエスト・プレイヤーデータのモジュールと管理の口も読むので core に置く。置き場の正は `docs/guides/working/quest-design.md` §3） | E2 |

受け取りの SQL は所持品の表にも書くが、events のモジュールの中に置く（inventory のモジュールを読み込まない）。付与の口が 2 つ目（管理の増減）になったときの置き場は `admin-design.md` §6 の決定のとおり: 受領の履歴の種類の名前 `LEDGER_SOURCES` と 1 品目の増減の文を `src/core/ledger.ts` に置き、受け取りの 3 文は events のモジュールに残す（種類の名前だけ `LEDGER_SOURCES.eventClaim` を読む）。

## 4. API と確かめの順・サーバーの時刻

4 つの口はどれもトークンが要る。プレイヤーはトークンの `p` だけで決まる（本文・クエリの `playerId` を受け取らない）。読み取りも、セーブの `GET` と同じく `APP_ENV` の守りを通す（§7）。

### 確かめの順（4 つの口で同じ。セーブの `checkAccess` と同じ形）

ルート → `requireLocalWrite`（403 `NOT_READY_FOR_PRODUCTION`）→ `requireAuth`（401）→ **プレイヤーの利用制限 `RATE_LIMITS.rewards`（429 `RATE_LIMITED`・`Retry-After`。4 つの口を合わせて、鍵は `<トークンの g>:<トークンの p>`）** → `gameId` の形（400 `INVALID_ARGUMENT`）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定 `requireGame(env, gameId, 'inventory' | 'events', known)`（404）→ 口ごとの確かめ。

### `GET /v1/inventory?gameId=demo-rpg`（E1）

```json
{"gameId":"demo-rpg","currencies":[{"itemId":"gold","amount":100}],"items":[{"itemId":"potion","amount":3}]}
```

- `currencies`・`items` は品目の ID の昇順。残高の行が無い品目は載せない（何も受け取っていなければ両方空の配列）。

### `GET /v1/inventory/history?gameId=demo-rpg&limit=20&before=42`（E1）

```json
{"gameId":"demo-rpg","items":[{"entryId":41,"itemId":"gold","delta":100,"sourceType":"event-claim","sourceId":"<claimId>","createdAt":"2026-10-30T15:30:00Z"}],"nextBefore":41}
```

- 新しい順（`entry_id DESC`）。`limit` は 1〜100（既定 20。外れは 400 `INVALID_ARGUMENT`）。`before` を付けると、その番号より古いものだけ。続きがあれば `nextBefore`（最後の行の `entryId`）、無ければ欄ごと載せない。

### `GET /v1/events?gameId=demo-rpg`（E2）

```json
{"gameId":"demo-rpg","serverTime":"2026-10-30T15:30:00Z","items":[{"eventId":"daily-login","kind":"daily","startsAt":"2026-01-01T00:00:00Z","endsAt":"2100-01-01T00:00:00Z","periodKey":"2026-10-30","nextResetAt":"2026-10-31T00:00:00Z","rewards":[{"itemId":"gold","amount":100}],"claimed":false}]}
```

- **いま開いているイベントだけ**（`isOpen`）。並びは `eventId` の昇順。`claimed` はトークンのプレイヤーがいまの区切りで受け取ったか。受け取り済みかは、重ならない区切りの鍵だけを `period_key IN (…)` で引き、イベントとの突き合わせは JS の側でする（引数はどの時差でも数個。開いているイベントの数だけ条件を並べると D1 の 1 文の引数の上限 100 を超える。クエストの一覧と同じ形）。
- `serverTime` はサーバーの時刻。クライアントは残り時間の表示にこれと `nextResetAt`・`endsAt` を使い、端末の時刻で期間を決めない（`failure-case-test-plan.md` のケース 6）。`nextResetAt` は一度きりのイベントでは載せない。

### `POST /v1/events/{eventId}/claim?gameId=demo-rpg`（E2）

本文は要らない（送っても読まない。`Idempotency-Key` も読まない。§5）。共通の確かめの後:

1. `eventId` の形（ルートの `^[a-zA-Z0-9_-]{1,64}$`。外れは既存のルートに当たらない 404）。
2. イベントを読む。無ければ 404 `NOT_FOUND`（`Unknown event`）。
3. サーバーの時刻 `now` で `isOpen`。外なら 409 `EVENT_NOT_ACTIVE`（新しいコード）。何も書かない。
4. `periodKey(kind, now, reset_offset_minutes)` を決め、§5 の `batch` を流す。
5. 受け取りの行を読み直して応答を作る（§5）。

```json
{"gameId":"demo-rpg","eventId":"daily-login","periodKey":"2026-10-30","claimId":"<claimId>","claimedAt":"2026-10-30T15:30:00Z","grants":[{"itemId":"gold","amount":100}]}
```

- 応答に残高は入れない（2 回目も同じ本文にするため。残高は `GET /v1/inventory` で読む）。

### 期間と区切り（`src/core/period.ts`。サーバーの時刻だけを入力にする）

`now` は Worker の `Math.floor(Date.now() / 1000)`。**クライアントの時刻（本文・クエリ・`Date` の見出し）を受け取らない**。試験は関数に `now` を渡して確かめ、L2 はイベントの期間をいまの時刻の前後に置いて確かめる（§8）。

| 関数 | 入力 | 出力 |
| --- | --- | --- |
| `isOpen(startsAt, endsAt, now)` | UNIX 秒 | `startsAt <= now && now < endsAt`（始まりを含み、終わりを含まない） |
| `periodKey(kind, now, offsetMinutes)` | 区切り・いま・時差（分） | `once` → `'once'`。`daily` → `now + offset` の UTC の日付 `YYYY-MM-DD`。`weekly` → その日を含む週の月曜の日付 |
| `nextResetAt(kind, now, offsetMinutes, endsAt)` | 同じ・終わり | `daily` → 次の時差の 0 時、`weekly` → 次の時差の月曜 0 時（UNIX 秒）。`endsAt` を越えるなら `endsAt`。`once` → `null` |

例（`now` = 2026-10-30T15:30:00Z。金曜）:

| 区切り・時差 | `periodKey` | `nextResetAt` |
| --- | --- | --- |
| `daily`・0（UTC） | `2026-10-30` | 2026-10-31T00:00:00Z |
| `daily`・540（UTC+9） | `2026-10-31` | 2026-10-31T15:00:00Z |
| `weekly`・0 | `2026-10-26` | 2026-11-02T00:00:00Z |
| `weekly`・0・`now` = 2026-11-01T23:59:59Z（日曜） | `2026-10-26` | 2026-11-02T00:00:00Z |
| `weekly`・540・`now` = 2026-11-01T15:00:00Z（UTC+9 で月曜 0 時） | `2026-11-02` | 2026-11-08T15:00:00Z |
| `once` | `once` | `null` |

- 時差は固定の分（夏時間を持たない）。区切りの時差はイベントごとの列（§11 の決めること 5）。
- Cron Triggers で日替わりの処理を流さない。区切りは要求の時に計算するので、時刻の決まった処理が遅れても止まっても、受け取りの判定は変わらない（§11 の決めること 6）。

## 5. 受け取りの二重を止める方法

**一意の鍵（プレイヤー・イベント・区切り）と、受け取り・履歴・残高を 1 つの `batch` で書くこと**で止める（§11 の決めること 1）。`claim_id` は要求ごとにサーバーが作る新しい乱数の ID で、2 つ目・3 つ目の文は「この要求の `claim_id` の行が入ったとき」だけ書く。

`batch` の 3 文（引数: `?1` gameId・`?2` playerId・`?3` eventId・`?4` periodKey・`?5` claimId・`?6` now・`?7` `MAX_ITEM_AMOUNT`）:

```sql
-- 1. 受け取りの行。期間の内で、付与しても上限を超えないときだけ。同じ区切りの行があれば何もしない
INSERT INTO event_claims (game_id, player_id, event_id, period_key, claim_id, claimed_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6 FROM events e
  WHERE e.game_id = ?1 AND e.event_id = ?3 AND e.starts_at <= ?6 AND ?6 < e.ends_at
    AND NOT EXISTS (
      SELECT 1 FROM event_rewards r
      LEFT JOIN inventory_balances b ON b.game_id = r.game_id AND b.player_id = ?2 AND b.item_id = r.item_id
      WHERE r.game_id = ?1 AND r.event_id = ?3 AND COALESCE(b.amount, 0) + r.amount > ?7)
  ON CONFLICT (game_id, player_id, event_id, period_key) DO NOTHING;
-- 2. 受領の履歴（この要求の claim_id が入ったときだけ）
INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
  SELECT r.game_id, ?2, r.item_id, r.amount, 'event-claim', ?5, ?6 FROM event_rewards r
  WHERE r.game_id = ?1 AND r.event_id = ?3 AND EXISTS (SELECT 1 FROM event_claims c WHERE c.claim_id = ?5);
-- 3. 残高（同じ条件）
INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at)
  SELECT r.game_id, ?2, r.item_id, r.amount, ?6 FROM event_rewards r
  WHERE r.game_id = ?1 AND r.event_id = ?3 AND EXISTS (SELECT 1 FROM event_claims c WHERE c.claim_id = ?5)
  ON CONFLICT (game_id, player_id, item_id) DO UPDATE SET
    amount = inventory_balances.amount + excluded.amount, updated_at = excluded.updated_at;
```

`batch` の後に `SELECT claim_id, claimed_at FROM event_claims WHERE game_id = ?1 AND player_id = ?2 AND event_id = ?3 AND period_key = ?4` を引く:

| 引いた結果 | 応答 |
| --- | --- |
| 行がある（この要求の `claim_id`） | 200。`grants` は `inventory_ledger` の `source_id = claim_id` の行（品目の ID の昇順） |
| 行がある（前の要求の `claim_id`）＝二重 | **200 で 1 回目と同じ本文**（同じ `claimId`・`claimedAt`・`grants`）。残高も履歴も増えない |
| 行が無く、`now` で期間の外（3 の確かめの後に終わった） | 409 `EVENT_NOT_ACTIVE` |
| 行が無く、期間の内 | 409 `INVENTORY_LIMIT_EXCEEDED`（新しいコード。付与すると残高が `MAX_ITEM_AMOUNT` を超える）。何も書かない |

- 並べて送っても: D1 は `batch` を順に流すので、2 つ目の `batch` の文 1 は一意の鍵で何もせず、その `claim_id` の行が無いので文 2・3 も何もしない（§8 の `同じ期間の受け取りを並べて送っても付与は1回分`）。
- 2 回目を 200 にする理由: クライアント（CLI・UE・Unity・ブラウザ）は応答が届かなかったとき、同じ要求を送り直すだけでよい（結果を確かめ直す手間が要らない）。2 回目かどうかを知りたいクライアントは `claimId` を比べる（§11 の決めること 2）。
- イベントが終わった後の送り直し（終わる直前に送り、届かず終わった後に送り直す）は、手順 3 の `isOpen` で 409 `EVENT_NOT_ACTIVE` になる（同じ本文の 200 にはならない）。クライアントは 409 を受けたら `GET /v1/inventory/history` で `sourceType: "event-claim"` の行を見て、受け取れていたかを確かめる。終わった後の受け取りを通さないことを、送り直しの楽さより先にする（期間の判定をサーバーの時刻だけで決めるため）。
- 区切りをまたいだ送り直し（デイリーの 0 時の前に送り、届かず 0 時の後に送り直す）は、新しい区切りの受け取りになる（その区切りの報酬は正しく受け取れるものなので、二重取りではない）。
- `Idempotency-Key` は読まない（送られても無視）。受け取りは一意の鍵で冪等になり、`abuse-protection-design.md` §5 の後から足す形（表 `idempotency_keys`）は、自然な鍵の無い書き込み（§6 の消費）を足すときに使う。
- DB の失敗は入口の `try/catch` で 500 `INTERNAL_ERROR`（中身を返さない。CLAUDE.md の守るもの）。

## 6. 所持品・通貨の増減を、どこまでサーバーが持つか

| 増減 | Phase 2（この設計） | 理由 |
| --- | --- | --- |
| 増やす（付与） | **サーバーだけが増やす**: イベントの報酬の受け取り（E2）。クライアントが「何個増やして」と申告する口は作らない | 付与の中身（品目・数）はサーバーの表 `event_rewards` が決める。申告で増やせると、改造したクライアントが何でも増やせる（`operations-security.md` の 3・5） |
| 減らす（消費） | **入れない**（範囲の外） | 下の限界 |
| 読む | 残高と受領の履歴（E1） | — |

**消費をクライアントの申告で減らすことの限界**（そのまま書く）: 「ポーションを 1 個使った」「金貨 50 で剣を買った」の申告は、サーバーが値段も効果も知らない（ADR 0002）ので、正しいかを確かめられない。減らす向きの申告は自分の損にしかならないが、**買い物（通貨を減らして品目を増やす）**は値段を知らないサーバーには確かめられず、増やす向きの申告と同じ穴になる。改造したクライアントは残高を減らさずに使うこともできる（減らす申告を送らない）。ゲームの中で使う分はクライアントの側の状態（セーブ）に持つのが今の形。

**後から足す形**（Phase 2 の管理・クエスト、または P2 の課金連携で要るときに）:

- `POST /v1/inventory/consume?gameId=…` 本文 `{"itemId":"potion","amount":1}`。**`Idempotency-Key` を必須**にする（自然な鍵が無い書き込みのため。表は `abuse-protection-design.md` §5 の `idempotency_keys`）。
- 1 つの `batch` で `UPDATE inventory_balances SET amount = amount - ? WHERE … AND amount >= ?` と履歴の行（`delta` が負）。足りなければ 409 `INSUFFICIENT_BALANCE`（新しいコード）。
- 交換・購入（通貨 → 品目）は、値段の表をサーバーに置く仕組み（`exchange_offers(game_id, offer_id, cost_item_id, cost_amount, item_id, amount)`）として足す。値段を決めるのはゲームの作者で、サーバーは表どおりに引いて足すだけ（ADR 0002 の「仕組みだけ」）。
- 表は E1 の形のまま使える（`delta` が負になれるのはそのため。`CHECK (delta <> 0)`）。

## 7. 認証・`APP_ENV`・利用制限・文書のどこが変わるか

- 4 つの口はどれも `requireAuth` の後で、プレイヤーはトークンの `p` だけ（`account-design.md` の決定）。他人の所持品・受け取りには触れられない（`operations-security.md` の 2）。
- **`APP_ENV === 'local'` のときだけ通す守りを外さない**（`CLAUDE.md` の「守るもの」）。受け取り（書き込み）だけでなく、一覧・所持品・履歴の読み取りも、セーブの `GET` と同じく守りを通す（プレイヤーのデータで、公開の読み取りでないため）。`wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない。
- 利用制限: `RATE_LIMITS.rewards`（プレイヤーごと、4 つの口を合わせて 60 秒に 60 回）を `consume` で数える。トークンの無い・正しくない要求は数えない（401 が先）。CLI モックの通し（§10）は 1 回で 6 回なので掛からない。
- 新しいエラーコードは 2 つ（E2）: `EVENT_NOT_ACTIVE`（409）・`INVENTORY_LIMIT_EXCEEDED`（409）。エラーコードは 14 個になる（§9）。本文の形は `{ "error": { "code", "message" } }` のまま。

束の実装の Issue で直す所（この Issue では変えない。CLAUDE.md 原則 5 で旧文を置き換える。例外を追記しない）:

| 文書 | E1 | E2 |
| --- | --- | --- |
| `docs/api-contract.md` | `GET /v1/inventory`・`GET /v1/inventory/history` の節。「利用制限」の表に `rewards` の行 | `GET /v1/events`・`POST /v1/events/{eventId}/claim` の節。エラーコードの表に 2 つ |
| `openapi/rpg-online.v1.json` | 2 つの操作（`getInventory`・`listInventoryHistory`）と 429・`Retry-After` | 2 つの操作（`listEvents`・`claimEventReward`）と 429・`Retry-After`・`ErrorCode` の 2 つ |
| `docs/guides/working/architecture.md` | 所持品の表と `src/modules/inventory/` の置き場 | イベントの置き場。「冪等性」の行を「報酬の受け取りは一意の鍵（プレイヤー・イベント・区切り）で冪等にする。自然な鍵の無い状態の更新（消費・購入）に `Idempotency-Key` を使う」に置き換える |
| `docs/guides/working/abuse-protection-design.md` | §2 の表に `rewards` の行（定数と同じコミット） | — |
| `docs/guides/working/failure-case-test-plan.md` | — | ケース 6 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う` の「イベントの API は Phase 2」を、この設計の口（`GET /v1/events` の `serverTime`・受け取りの 409）を指す形に置き換える |
| `docs/guides/decisions/roadmap.md` | — | Phase 2 の 2 項目に印（`npm run cli:smoke` が通った後。会話の側） |

`CLAUDE.md` は変えない（守るものの 2 行は、守りを外すとき＝ユーザーが決めるときに直す。`abuse-protection-design.md` §9 のとおり）。

## 8. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は E1 が `test/inventory.test.ts`、E2 が `test/events.test.ts`（L1 も同じファイル）。スキーマの置き換えは `test/schema-conformance.test.ts`、モジュールの一覧は `test/modules.test.ts`、demo-rpg の設定は `test/game-modules.test.ts`。

試験の作り方:

- 試験のゲームは専用（`inv-game`・`evt-game` など。`registerGame` と品目・イベントの行を `beforeEach` で入れる）。demo-rpg の手本の行は CLI の流れの試験だけが使う。
- 期間はいまの時刻の前後に置く（開いている: `starts_at = now - 3600`・`ends_at = now + 86400`。終わった: `ends_at = now - 1`）。区切りの境目の挙動は L1 の関数で、固定の `now` を渡して確かめる。
- 書き込みをするファイルの `beforeEach` で `resetRateLimits(db)` と、所持品・受け取りの表の `DELETE`（いまの試験の作りと同じ）。
- 残高・履歴・報酬の行を直に入れる試験は、先に `inventory_items` に品目の行を入れる（外部キー。無いと `CHECK` でなく外部キーで落ちて、見たいものを見ていない試験になる）。
- 上限の試験は残高の行に `MAX_ITEM_AMOUNT` に近い値を入れてから受け取る。利用制限の試験は `rate_limit_counters` に `count = 60` を入れてから 1 回送る（`abuse-protection-design.md` §7 と同じ）。

| 束 | テストの名前 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- |
| E1 | `所持品の応答は通貨と所持品に分けて品目のIDの順に並べる` | L1 | `shapeInventory` に `potion`(item)・`gold`(currency)・`elixir`(item) の行 | `currencies: [gold]`・`items: [elixir, potion]` |
| E1 | `受領の履歴のlimitは1から100で既定は20` | L1 | `parseHistoryQuery` に `limit` 無し・`1`・`100`・`0`・`101`・`abc` | 20・1・100・外れ・外れ・外れ |
| E1 | `受領の履歴のbeforeは1以上の整数だけ受け付ける` | L1 | `parseHistoryQuery` に `before` 無し・`42`・`0`・`-1`・`1.5`・`abc` | 無し・42・外れ・外れ・外れ・外れ（外れは 400 `INVALID_ARGUMENT`） |
| E1 | `所持品を読むとトークンのプレイヤーの通貨と所持品だけが返る` | L2 | `p1` と `p2` の残高の行を入れ、`p1` のトークンで `GET /v1/inventory` | 200。`p1` の行だけ |
| E1 | `何も受け取っていないプレイヤーの所持品は空の一覧で返る` | L2 | 行の無いプレイヤーで `GET` | 200・`currencies: []`・`items: []` |
| E1 | `受領の履歴は新しい順に返りlimitで区切って続きを読める` | L2 | 履歴を 3 行入れ、`limit=2` → `before=<nextBefore>` | 1 回目は新しい 2 行と `nextBefore`、2 回目は残りの 1 行で `nextBefore` が無い |
| E1 | `所持品はトークンの無い要求に401を返す` | L2 | `Authorization` 無しで `GET /v1/inventory` | 401・`UNAUTHENTICATED`。`rate_limit_counters` に行が無い |
| E1 | `トークンと違うゲームの所持品はPERMISSION_DENIEDの403を返す` | L2 | `inv-game` のトークンで `gameId=demo-rpg` | 403・`PERMISSION_DENIED` |
| E1 | `inventoryを使わない設定のゲームの所持品はNOT_FOUNDの404を返す` | L2 | `inventory` の無いゲームのトークンで `GET` | 404・`NOT_FOUND` |
| E1 | `本番の設定では所持品の読み取りにNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV=disabled` で 2 つの `GET` | どちらも 403・`NOT_READY_FOR_PRODUCTION` |
| E1 | `報酬の操作を上限より多く呼ぶと429とRetry-Afterを返す` | L2 | `rewards`・`inv-game:p1` に `count = 60` を入れて `GET /v1/inventory` | 429・`RATE_LIMITED`・`Retry-After` |
| E1 | `所持品の残高はマイナスにも上限より大きくもできない` | L2 | 品目の行を入れてから、`inventory_balances` に `amount = -1` と `MAX_ITEM_AMOUNT + 1` を直に入れる | どちらも D1 が断る（`CHECK`） |
| E1 | `所持品と受領の履歴の応答はスキーマに合う` | L2 | 2 つの `GET` の 200 と 401 | `openapi/rpg-online.v1.json` の応答の形に合う |
| E1 | `報酬の利用制限の回数と窓は定数のモジュールにある` | L1 | `RATE_LIMITS.rewards` | `{ scope: 'rewards', limit: 60, period: 60 }` |
| E1 | `スキーマのファイルはOpenAPI 3.1で13個の操作を持つ` | L1 | スキーマの操作 | いまの 11 個と `getInventory`・`listInventoryHistory` |
| E1 | `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryでルートが重ならない` | L1 | `modules` | 5 つの名前・ルートが重ならない |
| E1 | `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryを使う設定で登録される` | L2 | demo-rpg の `game_modules` | 5 つ（名前の順） |
| E2 | `イベントの期間は始まりを含み終わりを含まない` | L1 | `isOpen(100, 200, 99/100/199/200)` | 外・内・内・外 |
| E2 | `デイリーの区切りはイベントの時差の0時で変わる` | L1 | §4 の例の `daily` の 2 行 | `2026-10-30`・`2026-10-31` |
| E2 | `週間の区切りは月曜の0時で変わる` | L1 | §4 の例の `weekly` の 3 行 | `2026-10-26`・`2026-10-26`・`2026-11-02` |
| E2 | `一度きりのイベントの区切りはイベントの期間の全体` | L1 | `periodKey('once', …)` を違う `now` で 2 回 | どちらも `'once'` |
| E2 | `次の区切りの時刻はイベントの終わりを越えない` | L1 | §4 の例の `nextResetAt` と、終わりが次の 0 時より前のイベント | 例の値・終わりの時刻・`once` は `null` |
| E2 | `開いているイベントの一覧はサーバーの時刻とそのプレイヤーの受け取り済みかを返す` | L2 | 開いているイベント 2 つ（1 つは `p1` が受け取り済み）を `p1` で `GET /v1/events` | 200・`serverTime` がサーバーのいまの時刻（前後 5 秒）・`claimed` が `true` と `false` |
| E2 | `期間の外のイベントは一覧に出ない` | L2 | 終わったイベントとまだ始まらないイベントを入れて `GET` | 2 つとも `items` に無い |
| E2 | `報酬を受け取ると所持品が増え受領の履歴に残る` | L2 | `POST /v1/events/{eventId}/claim` → `GET /v1/inventory` → `GET /v1/inventory/history` | 200・`grants`。残高が報酬の数だけ増え、履歴の `sourceId` が `claimId`。残高と履歴の合計が同じ |
| E2 | `同じ期間の報酬を二重に受け取っても所持品は1回分で同じ本文を返す` | L2 | 同じ受け取りを 2 回続けて | 2 回とも 200 で本文が同じ（`claimId` も）。残高は 1 回分・履歴は報酬の行の数だけ |
| E2 | `同じ期間の受け取りを並べて送っても付与は1回分` | L2 | 同じ受け取りを `Promise.all` で 10 本 | 全部 200 で `claimId` が 1 つ。`event_claims` は 1 行・残高は 1 回分 |
| E2 | `デイリーの報酬は次の区切りの後にもう一度受け取れる` | L2 | 前の日の `period_key` の受け取りの行を入れてから受け取る | 200・新しい `claimId`。`event_claims` は 2 行 |
| E2 | `期間の外のイベントの報酬はEVENT_NOT_ACTIVEの409を返し付与しない` | L2 | 終わったイベントとまだ始まらないイベントを受け取る | どちらも 409・`EVENT_NOT_ACTIVE`。表の行は増えない |
| E2 | `クライアントが送った時刻は期間の判定に使わない` | L2 | 終わったイベントに本文 `{"now":"2000-01-01T00:00:00Z"}`・クエリ `&now=946684800`・見出し `Date: Sat, 01 Jan 2000 00:00:00 GMT` を付けて受け取る。開いているイベントに `2099` 年の時刻を付けて受け取る | 前者は 409・`EVENT_NOT_ACTIVE`、後者は 200 で `periodKey` がサーバーのいまの日付 |
| E2 | `所持品の上限を超える報酬はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない` | L2 | 残高を `MAX_ITEM_AMOUNT - 50` にし、100 の報酬を受け取る | 409・`INVENTORY_LIMIT_EXCEEDED`。受け取り・履歴・残高の行は変わらない |
| E2 | `知らないイベントの報酬はNOT_FOUNDの404を返す` | L2 | 無い `eventId` を受け取る | 404・`NOT_FOUND` |
| E2 | `ほかのプレイヤーの受け取りは自分の受け取り済みに数えない` | L2 | `p2` が受け取った後に `p1` が受け取る | `p1` も 200 で新しい `claimId`。それぞれの残高は 1 回分 |
| E2 | `トークンの無い受け取りは401を返し利用制限を数えない` | L2 | `Authorization` 無しで受け取る | 401・`UNAUTHENTICATED`。`rate_limit_counters` に行が無い |
| E2 | `本番の設定ではイベントの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV=disabled` で一覧と受け取り | どちらも 403・`NOT_READY_FOR_PRODUCTION`。表の行は増えない |
| E2 | `eventsを使わない設定のゲームのイベントはNOT_FOUNDの404を返す` | L2 | `events` の無いゲームのトークンで一覧と受け取り | どちらも 404・`NOT_FOUND` |
| E2 | `イベントの一覧と受け取りの応答はスキーマに合う` | L2 | 一覧の 200・受け取りの 200 と 409 | `openapi/rpg-online.v1.json` の応答の形に合う |
| E2 | `CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない` | L2 | `scripts/cli-requests.mjs` の関数で demo-rpg のゲスト → 一覧 → `daily-login` の受け取り → 所持品 → もう一度受け取り → 所持品 → 履歴 | 受け取りは 2 回とも 200 で同じ `claimId`。金貨は 2 回とも 100・履歴は 1 行 |
| E2 | `スキーマのErrorCodeの列挙は14個のエラーコードと一致する` | L1 | スキーマの `ErrorCode` | `errorCodes`（いまの 12 個と `EVENT_NOT_ACTIVE`・`INVENTORY_LIMIT_EXCEEDED`）と同じ |
| E2 | `スキーマのファイルはOpenAPI 3.1で15個の操作を持つ` | L1 | スキーマの操作 | E1 の 13 個と `listEvents`・`claimEventReward` |
| E2 | `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない` | L1 | `modules` | 6 つの名前・ルートが重ならない |
| E2 | `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsを使う設定で登録される` | L2 | demo-rpg の `game_modules` | 6 つ（名前の順） |

数（行）: E1 が 17・E2 が 25。

### 失敗ケースの計画の試験との関係

- ケース 6 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う`（L3・UE 統合後・正は `failure-case-test-plan.md`）: この設計の口を UE のクライアントが使う形の試験で、Phase 3 の K4 でユーザーが見る。E2 の `クライアントが送った時刻は期間の判定に使わない` と `開いているイベントの一覧はサーバーの時刻とそのプレイヤーの受け取り済みかを返す` が、サーバーの側の同じ決まりを先に固める。上の表には写さない。
- ケース 5（同じイベントを二重送信する）: E2 の `同じ期間の報酬を二重に受け取っても所持品は1回分で同じ本文を返す`・`同じ期間の受け取りを並べて送っても付与は1回分` がイベントの報酬の側で受ける。失敗ケースの計画の既存の名前は変えない。

## 9. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `スキーマのErrorCodeの列挙は12個のエラーコードと一致する` | E2 | コードが 14 個になり、名前の「12個」が嘘になる（名前の中の数で挙動が変わる） | 消して、§8 の `スキーマのErrorCodeの列挙は14個のエラーコードと一致する` に置き換える。`errorCodes` に 2 つ足す |
| `スキーマのファイルはOpenAPI 3.1で11個の操作を持つ` | E1（E2 でもう一度） | 操作が 13 個（E2 で 15 個）になる | E1 で `…13個の操作を持つ` に、E2 で `…15個の操作を持つ` に置き換える（前の名前は残さない） |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigでルートが重ならない` | E1（E2 でもう一度） | 名前の中の機能の一覧が変わる | E1 で `…とinventoryで…`、E2 で `…とinventoryとeventsで…` に置き換える |
| `demo-rpgはannouncementsとrankingsとsavesとconfigを使う設定で登録される` | E1（E2 でもう一度） | マイグレーションで demo-rpg に機能が足される | 同じく置き換える |
| `利用制限の回数と窓は定数のモジュールにある` | E1 | `RATE_LIMITS` を `toEqual` で比べているので、`rewards` を足すと落ちる | 期待に `rewards` の行を足す（いまの 4 行は変えない）。§8 の `報酬の利用制限の回数と窓は定数のモジュールにある` が足した行を別に見る |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る` | E2 | `errorCodes` と起こしたコードの集合を突き合わせるので、2 つのコードを起こす行が要る | `claimEventReward` で 409 を 2 つ起こす行を足す。いまの行と期待は変えない |
| `今のCLIモックと同じ形の要求を受け付ける` | E1・E2 | 変わらない（いまの要求の形を変えない。イベントの手順は流れの後ろに足すだけ） | 変えない。API を変えたら CLI モックも直す合図のまま |
| `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` | E2 | CLI モックの流れにイベントの手順が足される | 流れにイベントの 6 回を足す（期待「429 が 1 つも無い」は変えない。見る範囲が増える） |
| `マイグレーションを2回当ててもデータは壊れない` | E1・E2 | 変わらない（`0009`・`0010` は `IF NOT EXISTS`・`INSERT OR IGNORE` だけ） | 変えない |

置き換えは `docs/guides/decisions/test-plan.md` §11 の手続き（名前の嘘を直すだけで、確かめる中身を弱めない）。

## 10. `scripts/cli-mock.mjs` の通しのシナリオ（E2）

API を変えたら CLI モックも合わせる（`CLAUDE.md` のプロジェクトの決まり）。いまの流れ（健康 → 設定 → お知らせ → ゲスト → スコア → セーブ）は**変えず、セーブを消した後に足す**ので、いまの `npm run cli:smoke` は壊れない（一覧が空なら `events: none (skipped)` と出して後ろの手順を飛ばす。マスターデータの飛ばし方と同じ。`events` を使わない設定のゲーム・`0010` を当てていない DB で一覧が 404 になったときは飛ばさず `HTTP 404` で止まる。CLI モックは demo-rpg だけを使い、demo-rpg は `0010` で `events` を使う設定になるので、404 はマイグレーションの当て忘れを知らせる失敗として扱う）。

足す手順（同じゲストのトークン）:

1. `GET /v1/events?gameId=demo-rpg` → `daily-login` が `claimed: false` で載っている。`serverTime` を表示する。
2. `POST /v1/events/daily-login/claim?gameId=demo-rpg` → 200・`grants` に金貨 100。
3. `GET /v1/inventory?gameId=demo-rpg` → 金貨 100。
4. `POST /v1/events/daily-login/claim?gameId=demo-rpg` をもう一度 → 200 で `claimId` が 2 の応答と同じ。
5. `GET /v1/inventory?gameId=demo-rpg` → 金貨は 100 のまま（二重にならない）。
6. `GET /v1/inventory/history?gameId=demo-rpg` → 1 行（`sourceId` が `claimId`）。

- ゲストは回すたびに新しいので、1 回目の受け取りは毎回通る（セーブの `baseRevision: 0` と同じ）。
- 要求の形の関数（`eventsPath`・`claimPath`・`inventoryPath`・`historyPath`）を `scripts/cli-requests.mjs` に足し、§8 の `CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない` が同じ関数を使う。
- 利用制限: 1 回の通しで `rewards` を 6 回（60 回／分の内）。
- 2 と 4 の応答は、トークンを出さないいまの決まりのまま全部表示してよい（秘密を含まない）。

## 11. 決めること

推しの案で §2〜§10 を書いた。違う案にするときは、該当する節と §8 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 受け取りの二重を止める方法 | A: **D1 の一意の鍵（プレイヤー・イベント・区切り）と、受け取り・履歴・残高を 1 つの `batch`（文 2・3 は要求ごとの `claim_id` の行があるときだけ書く）**。B: 先に `SELECT` で受け取り済みかを見てから書く。C: Durable Objects でプレイヤーごとに順に処理する | **A**。並べた要求でも D1 の一意の鍵が 1 つだけ通し、`batch` で片方だけ残らない（`operations-security.md` の 5）。B は読んでから書くまでの間に 2 つ目が入る。C は `wrangler.jsonc` とクラスが増え、D1 の鍵で足りる |
| 2 | 2 回目の応答 | A: **200 で 1 回目と同じ本文（同じ `claimId`）**。B: 409 `ALREADY_CLAIMED`。C: 200 に `alreadyClaimed: true` を足す | **A**。届かなかった要求を送り直すだけで済み、クライアントの再試行（Phase 3 の K4）が簡単になる。2 回目かは `claimId` で分かる。B はクライアントが「受け取れた」かを読み直す手間が要り、エラーコードが増える。C は 1 回目と本文が変わり、送り直しの結果を比べにくい |
| 3 | `Idempotency-Key` を使うか | A: **受け取りには使わない（読まない）。自然な鍵の無い消費（§6）を足すときに使う**。B: 受け取りに必須にする。C: 任意で受け取り、あれば `idempotency_keys` に残す | **A**。受け取りは（プレイヤー・イベント・区切り）が自然な鍵で、見出しが無くても冪等。B・C は表と期限と本文の比べを作るのに、守る結果が A と同じ。`abuse-protection-design.md` §5 の「後から足す形」は消費のために残す |
| 4 | 品目の定義をどこに置くか | A: **サーバーの表 `inventory_items` に ID と種類（通貨か所持品か）だけ。名前・効果・値段はマスターデータ**。B: サーバーは ID と数だけ（表を作らず、どんな ID でも残高にできる）。C: マスターデータの JSON をサーバーが読んで品目を知る | **A**。報酬の表と残高が知らない ID を指せない（外部キー）、応答を通貨と所持品に分けられる。意味はゲームが持つ（ADR 0002）。B は書き間違いの ID が黙って残高になる。C はマスターデータを解釈しない決定（`config-design.md`）を崩す |
| 5 | デイリー・週間の区切りの時刻 | A: **イベントごとの時差（分。既定 0 = UTC）**。B: いつも UTC。C: ゲームごとの時差（`game_configs` に列を足す） | **A**。日本向けのゲームは 540（日本の 0 時）にでき、ゲームの中でイベントごとに変えられる。B は日本の 9 時に日が変わる。C は `ALTER TABLE` が要り、マイグレーションを 2 回当てる試験で落ちる（表を作り直すことになる）。夏時間は持たない（固定の分） |
| 6 | Cron Triggers・Queues を使うか | A: **使わない。区切りと期間は要求の時にサーバーの時刻で計算する**。B: Cron Triggers で毎日 0 時に「受け取れる」行を作る（`wrangler.jsonc` に `triggers: { crons: ["0 0 * * *"] }` と `scheduled` の入口）。C: Queues で付与を後から流す（`wrangler.jsonc` に `queues.producers`・`queues.consumers`） | **A**。`wrangler.jsonc` もパッケージも変えずに済み、試験で `now` を渡して確かめられる。処理が遅れても止まっても判定が変わらない。B はプレイヤーの数だけ行を作り、時差ごとの cron が要る。C は付与が後になり「受け取ったのに増えていない」間ができる。Cron Triggers は古い行の掃除・集計（§13 の分析）で使う |
| 7 | イベントの定義を誰がどう入れるか | A: 新しい番号のマイグレーションに `INSERT OR IGNORE`・`ON CONFLICT DO UPDATE` を書く（設定配信と同じ）。B: ローカルの管理コマンド。C: 管理の API（管理の鍵が要る） | **`admin-design.md` §7 で決めた: 管理の HTTP の口（品目とイベントの `PUT /v1/admin/items/{itemId}`・`PUT /v1/admin/events/{eventId}`）と、それを呼ぶ管理コマンド（`scripts/admin-cli.mjs` の `put-item`・`put-event`）**。本文の確かめ・受け取りのあるイベントの区切りを変えさせない守り・監査を Worker で持つ。A の形は demo-rpg の手本（`migrations/0010_events.sql`）と試験の行のために残す |
| 8 | パッケージ | A: **足さない（D1 と `Date` だけ）**。B: 日付のライブラリ（時差の計算）を足す | **A**。時差は固定の分なので、`now + offset * 60` の UTC の日付で計算できる。B は Workers のランタイムでの確かめが増える |
| 9 | 消費（減らす口）を Phase 2 に入れるか | A: **入れない。§6 の後から足す形を書く**。B: `POST /v1/inventory/consume` を入れる | **A**。Phase 2 の完了条件（イベントの開始から報酬の受け取りまで）に要らず、§6 の限界のとおりサーバーが値段を知らない消費は確かめられない。表は負の `delta` を入れられる形にしておく |
| 10 | 機能の名前（`game_modules`） | A: **`inventory` と `events` の 2 つ**。B: `rewards` の 1 つ | **A**。所持品は Phase 2 のクエスト・管理でも使い、イベントを使わないゲームも所持品だけ使える。機能の設定は認可の代わりにしない（決定のまま。受け取りは `events` だけを見て、所持品の表に書く） |

## 12. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| E1 | `migrations/` の新しい `0009_inventory.sql`・`src/core/inventory.ts`・`src/modules/inventory/`（`index.ts`・`shape.ts`・`limits.ts`）・`src/modules/index.ts` に足す・`RATE_LIMITS.rewards`・§7 の E1 の文書と契約・§8 の E1 の試験 | R2（`abuse-protection-design.md`） | §9 の手続きで 3 本を置き換え・1 本の期待に行を足す | 足さない |
| E2 | `migrations/` の新しい `0010_events.sql`・`src/modules/events/`（`index.ts`・`period.ts`・`limits.ts`）・2 つのエラーコード・§7 の E2 の文書と契約・§10 の CLI モックと `scripts/cli-requests.mjs`・§8 の E2 の試験 | E1 | §9 の手続きで 4 本を置き換え・2 本に行を足す | 足さない |

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。`gitClean` は `base` を渡さないと作業ツリーしか見ないので、先頭の `base` に**実装の Issue を作るときの main のコミットの SHA** を書き入れる（`docs/guides/procedures/issue-goal-setting.md`）。

E1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0009_inventory.sql', 'src/core/inventory.ts', 'src/modules/inventory/index.ts', 'src/modules/inventory/shape.ts',
  'test/inventory.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/\bconsume\(/.test(read('src/modules/inventory/index.ts')), '所持品のモジュールが利用制限（consume）を呼ぶ');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(!all.includes('スキーマのファイルはOpenAPI 3.1で11個の操作を持つ'), '置き換えた試験が残っていない（11個の操作）');
check(!all.includes("'モジュールの一覧はannouncementsとrankingsとsavesとconfigでルートが重ならない'"), '置き換えた試験が残っていない（モジュールの一覧）');
runTests();
requireTests([
  '所持品の応答は通貨と所持品に分けて品目のIDの順に並べる',
  '受領の履歴のlimitは1から100で既定は20',
  '受領の履歴のbeforeは1以上の整数だけ受け付ける',
  '所持品を読むとトークンのプレイヤーの通貨と所持品だけが返る',
  '何も受け取っていないプレイヤーの所持品は空の一覧で返る',
  '受領の履歴は新しい順に返りlimitで区切って続きを読める',
  '所持品はトークンの無い要求に401を返す',
  'トークンと違うゲームの所持品はPERMISSION_DENIEDの403を返す',
  'inventoryを使わない設定のゲームの所持品はNOT_FOUNDの404を返す',
  '本番の設定では所持品の読み取りにNOT_READY_FOR_PRODUCTIONの403を返す',
  '報酬の操作を上限より多く呼ぶと429とRetry-Afterを返す',
  '所持品の残高はマイナスにも上限より大きくもできない',
  '所持品と受領の履歴の応答はスキーマに合う',
  '報酬の利用制限の回数と窓は定数のモジュールにある',
  'スキーマのファイルはOpenAPI 3.1で13個の操作を持つ',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryでルートが重ならない',
  'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryを使う設定で登録される',
  '利用制限の回数と窓は定数のモジュールにある',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション・守り・ほかのモジュール・CLI モックを変えない（CLI モックは E2）
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits'].map((m) => `migrations/${m}.sql`);
const keep = ['src/modules/saves/', 'src/modules/config/', 'src/modules/rankings/', 'src/modules/announcements/', 'src/core/guards.ts',
  'src/core/rate-limit.ts', 'scripts/', ...migrations, 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

E2:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0010_events.sql', 'src/modules/events/index.ts', 'src/modules/events/period.ts', 'test/events.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/\/v1\/events/.test(read('scripts/cli-mock.mjs')), 'CLI モックがイベントの口を呼ぶ');
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
const codes = spec.components?.schemas?.ErrorCode?.enum ?? [];
check(codes.includes('EVENT_NOT_ACTIVE') && codes.includes('INVENTORY_LIMIT_EXCEEDED'), 'スキーマの ErrorCode に 2 つのコードがある');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(!all.includes('スキーマのErrorCodeの列挙は12個のエラーコードと一致する'), '置き換えた試験が残っていない（12個）');
check(!all.includes('スキーマのファイルはOpenAPI 3.1で13個の操作を持つ'), '置き換えた試験が残っていない（13個の操作）');
runTests();
requireTests([
  'イベントの期間は始まりを含み終わりを含まない',
  'デイリーの区切りはイベントの時差の0時で変わる',
  '週間の区切りは月曜の0時で変わる',
  '一度きりのイベントの区切りはイベントの期間の全体',
  '次の区切りの時刻はイベントの終わりを越えない',
  '開いているイベントの一覧はサーバーの時刻とそのプレイヤーの受け取り済みかを返す',
  '期間の外のイベントは一覧に出ない',
  '報酬を受け取ると所持品が増え受領の履歴に残る',
  '同じ期間の報酬を二重に受け取っても所持品は1回分で同じ本文を返す',
  '同じ期間の受け取りを並べて送っても付与は1回分',
  'デイリーの報酬は次の区切りの後にもう一度受け取れる',
  '期間の外のイベントの報酬はEVENT_NOT_ACTIVEの409を返し付与しない',
  'クライアントが送った時刻は期間の判定に使わない',
  '所持品の上限を超える報酬はINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない',
  '知らないイベントの報酬はNOT_FOUNDの404を返す',
  'ほかのプレイヤーの受け取りは自分の受け取り済みに数えない',
  'トークンの無い受け取りは401を返し利用制限を数えない',
  '本番の設定ではイベントの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す',
  'eventsを使わない設定のゲームのイベントはNOT_FOUNDの404を返す',
  'イベントの一覧と受け取りの応答はスキーマに合う',
  'CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない',
  'スキーマのErrorCodeの列挙は14個のエラーコードと一致する',
  'スキーマのファイルはOpenAPI 3.1で15個の操作を持つ',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない',
  'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsを使う設定で登録される',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション（0009 まで）・守り・利用制限の数え方・ほかのモジュールを変えない
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory'].map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/core/guards.ts', 'src/core/rate-limit.ts', 'src/core/rate-limit-policy.ts',
  'src/modules/saves/', 'src/modules/config/', 'src/modules/rankings/', 'src/modules/announcements/', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（CLAUDE.md の進め方の決まり）。
- 通しの確かめ（`npm run cli:smoke`）は確認コマンドに入れない（無人の回では開発サーバーを起動しない）。E2 の後に会話の側で回す（§0）。

## 13. Phase 2 の残りの項目（やる順と置き場）

この設計書の後に、次の順で設計書を書く（名前は案。`docs/guides/working/` に置く）。

| 順 | 項目（`roadmap.md` Phase 2） | 次の設計書の名前（案） | この設計との関係 |
| --- | --- | --- | --- |
| 1 | 管理コマンド／管理画面の最小機能（ログ・BAN・データ修正） | `admin-design.md` | イベントの定義の入れ方を A（マイグレーション）から管理コマンドへ広げる（§11 の決めること 7 の B）。データ修正は §6 の消費と同じ形の履歴（`source_type = 'admin'`）で付与・取り消しをする。管理の認証（管理の鍵）と `APP_ENV` の守りを外す条件をここで決める。付与の文を `src/core/ledger.ts` へ移す |
| 2 | プレイヤーデータ（実績・進行状態・統計値） | `docs/guides/working/player-data-design.md` §2・§7（済み） | 何を持つかとセーブとの境目は `player-data-design.md` §2、実績の解除（サーバーがキーの値と閾値で判定）は同 §7、クエストへ渡すものは同 §15 が正 |
| 3 | クエスト（達成条件・報酬・進捗） | `docs/guides/working/quest-design.md`（Q1 済み） | 報酬は §5 の受け取りと同じ形（一意の鍵・1 つの `batch`。種類の名前は `LEDGER_SOURCES.questClaim` の `quest-claim`。受け取りの 3 文はクエストのモジュールに置き、ここの 3 文は変えない）で、`quest-design.md` §6 が正。達成はサーバーがプレイヤーデータのキーの値と閾値で受け取りの時に判定する（同 §5） |
| 4 | 分析（DAU・継続率）・バックアップ・費用アラート | `analytics-design.md` | Cron Triggers（集計・古い行の掃除）と Analytics Engine はここで決める。受領の履歴（`inventory_ledger`）はイベントの効果の集計の元になる |

順の理由: Phase 2 の完了条件のシナリオ（イベントの開始から受け取りまで）はこの設計の E2 で通る。その次に、運用で要る「イベントを入れる・間違った付与を直す」（管理）を先にし、クエストの前提のプレイヤーデータ、クエスト、最後に集計（分析）の順にする。

## 14. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 消費・購入・交換 | §6（`POST /v1/inventory/consume` と `Idempotency-Key`・`exchange_offers`） |
| イベントを入れる・変える管理画面 | 管理の API と管理コマンドは `admin-design.md` §7 で入った。管理画面（ブラウザ）は Phase 4（`admin-design.md` §11 の決めること 1） |
| 条件つきの報酬（ログインの連続日数・クエストの達成） | §13 のプレイヤーデータとクエスト。サーバーは数の閾値だけを見る |
| 抽選・ドロップ率 | ゲーム固有のルール（ADR 0002）。入れない |
| 品目ごとの所持の上限・期限つきの品目 | `inventory_items` に列を持つ新しい表（`ALTER TABLE` でなく別の表）を足す |
| プレイヤーごと・段階的なイベントの配信（一部の人だけに開く） | `event_targets(game_id, event_id, player_id)` を足し、一覧と受け取りの文に条件を足す |
| 夏時間のある時差 | 区切りの時刻の表を持つ形（いまは固定の分） |
| 古い受け取りの行・履歴のまとめ | 受け取りの行と履歴は消さない（`analytics-design.md` §6 の決定。消すと二重に受け取れる・増減の証拠が無くなる）。量が問題になったら `analytics-design.md` §16 の形で足す |
| 付与の文の共通化 | `admin-design.md` §6 の決定（種類の名前と 1 品目の増減の文は `src/core/ledger.ts`、受け取りの 3 文は events に残す）。受け取りの 3 文を `src/core/ledger.ts` へ移すかは、クエスト（§13）を足すときに決める（§3） |
| UE・Unity・ブラウザでの表示と時刻の扱い | Phase 3。`failure-case-test-plan.md` のケース 6 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う`（K4） |

## 15. 指示の表

| Issue #30 の指示 | どこで答えるか |
| --- | --- |
| データの形（D1 の表・新しいマイグレーションの番号） | §3（`0009_inventory.sql`・`0010_events.sql`） |
| API（どの口で何を読む・受け取る）と確かめの順 | §4 |
| 期間の判定にサーバーの時刻を使う。デイリー・週間の区切り（UTC か時差か） | §4 の期間と区切り・§11 の決めること 5 |
| 受け取りの二重を止める方法（一意の制約と `batch`・`Idempotency-Key`・2 回目の応答） | §5・§11 の決めること 1〜3 |
| 所持品・通貨の増減をどこまでサーバーが持つか。消費を入れるか・申告で減らす限界・後から足せる形 | §6・§11 の決めること 9 |
| 品目の定義の置き場 | §2・§11 の決めること 4 |
| イベントの定義を誰がどう入れるか | §11 の決めること 7（`admin-design.md` §7 の管理の口と管理コマンド） |
| Cron Triggers・Queues を使うか。`wrangler.jsonc` に足すもの | §4・§11 の決めること 6 |
| Cloudflare の数字・機能は公式で確かめたか「要確認」 | §1 |
| 認証・`APP_ENV`・利用制限 | §4・§7 |
| `scripts/cli-mock.mjs` の通しのシナリオ・`npm run cli:smoke` を壊さない | §10 |
| 試験の名前（束は `E1`・`E2`）・失敗ケースの計画の時刻の試験・名前の中の数の試験・互換の試験 | §8・§9 |
| 実装の束 | §12 |
| Phase 2 の残りの 4 項目のやる順と置き場 | §13 |
| 新しいパッケージは足さない案を推しにする | §11 の決めること 8 |
