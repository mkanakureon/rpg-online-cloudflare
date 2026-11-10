# クエスト（達成条件・報酬・進捗）の設計書

`docs/guides/decisions/roadmap.md` Phase 2 の「クエスト（達成条件・報酬・進捗）」の設計書。`docs/guides/working/event-reward-design.md` §13 が順 3 に置いた（順 1 の管理は `docs/guides/working/admin-design.md`、順 2 のプレイヤーデータは `docs/guides/working/player-data-design.md` で済んだ）。`player-data-design.md` §15 がクエストに渡すもの（達成条件はプレイヤーデータのキーと閾値・報酬は受け取りと同じ形・定義は管理の口）を前提にする。

クエストの定義の置き場と達成条件の形・進捗の持ち方とデイリー・週間・期間つきのクエストの区切りごとの値・達成の判定の時と報酬の受け取り方・報酬の付与と二重の止め方（`LEDGER_SOURCES` に足す名前と、受け取りの文を `src/core/ledger.ts` へ移すか）・API とその確かめの順・認証と `APP_ENV` と BAN と利用制限・機能の名前（`game_modules`）とほかの機能への依存・管理との関係・`scripts/cli-mock.mjs` と `scripts/admin-cli.mjs` の通しのシナリオ・試験の名前・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`。ゲーム固有のルールを共通のサーバーに入れない）と、これまでの設計書の決定: `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・core はモジュールを読み込まない・機能の設定 `game_modules` は認可の代わりにしない）・`docs/guides/working/account-design.md`（プレイヤーはトークンの `p` だけで決まる・`requireAuth`）・`docs/guides/working/config-design.md`（マスターデータはサーバーが解釈しない）・`docs/guides/working/abuse-protection-design.md`（D1 の固定窓の `consume`・自己申告の扱い）・`docs/guides/working/event-reward-design.md`（区切り・一意の鍵と 1 つの `batch`・受領の履歴 `inventory_ledger`）・`docs/guides/working/admin-design.md`（管理の口・監査のログ `admin_audit_log`・BAN の `requireNotBanned`・`LEDGER_SOURCES`）・`docs/guides/working/player-data-design.md`（プレイヤーデータを正にする・キーの宣言 `player_data_keys`・自己申告の守りと限界・実績の判定）。これらは「決めること」に戻さない。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（ゲームのクライアントの形）・`openapi/rpg-online-admin.v1.json`（管理の口の形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§10 の試験の名前を `requireTests` に渡して実装の Issue を Q1〜Q3 の順に回し、**CLI モック（`scripts/cli-mock.mjs`）がゲストのトークンで、プレイヤーデータの統計値を増やすとクエストの一覧の進捗が上がって達成になり、報酬を受け取ると所持品が増えて受領の履歴に残り、同じクエストをもう一度受け取っても二重にならないことを見て、達成していないクエスト・期間の外のクエストの受け取りが断られること・デイリーのクエストが区切りごとに 0 から数え直されることを §10 の試験が確かめ、管理コマンド（`scripts/admin-cli.mjs`）がクエストを定義すると監査のログに前と後が残る**のを見て、サーバーがクエストの意味（名前・説明・物語）を持たずにキーと閾値と報酬だけを持ち、クエストの報酬が自己申告の値から出ることの限界が書かれていると分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§13 に決めること（案と推し）、§14 に実装の束、§16 に範囲の外がある | 機械（Issue #42 の確認コマンド） |
| ADR 0002・元の文書（`roadmap.md`・`account-design.md`・`config-design.md`・`abuse-protection-design.md`・`event-reward-design.md`・`admin-design.md`・`player-data-design.md`）・`game_modules`・`APP_ENV`・`requireAuth`・`requireNotBanned`・`consume`・`RATE_LIMITED`・`Idempotency-Key`・`LEDGER_SOURCES`・`player_data_keys`・`period_key`・D1・`scripts/cli-mock.mjs`・`scripts/admin-cli.mjs`・`CLAUDE.md` が出てくる。達成条件・報酬・進捗・閾値・区切り・デイリー・受け取り・マスターデータ・自己申告・二重・監査の扱いが出てくる | 機械（同上） |
| Phase 2 の残りの項目（分析）に触れている（§15） | 機械（同上） |
| 名前の中の数や機能の一覧で挙動が変わる既存の試験と、互換・管理の通し・管理のエラーコードを見張る既存の試験に名前で触れている（§11） | 機械（同上） |
| §10 の表の束は `Q1`〜`Q3`。名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§14） | 機械（同上） |
| 指している `docs/`・`scripts/`・`openapi/` のパスが実在する（これから作る `src/`・`test/`・`migrations/` の下はパスの形で書いてよい） | 機械（同上） |
| サーバーがクエストの意味（名前・説明・物語）を持たない（§2・ADR 0002）。進捗の元はプレイヤーデータの値で、自己申告の限界を書いている（§5）。受け取りの二重が一意の鍵と 1 つの `batch` で止まる（§6）。`APP_ENV` の守りを外さない（§9）。D1 の 1 つの文のバインドを数えている（§6）。Cloudflare の数字・機能は確かめた所と「要確認」が分かれている（§1） | AI の判定（作っていない判定役が、§1〜§9 と `src/`・`migrations/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§14 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 挙動の変わる既存の試験は §11 の手続きだけで直す。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。
- `package.json`・`wrangler.jsonc` を変えない（全部の束）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）と `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（§9）。
- Q1 の後、会話の側で `npm run db:migrate:local && npm run dev` と `npm run cli:smoke` を回し、§12 のシナリオが `PASS` で通るのを見る。Q3 の後、会話の側で人が管理の鍵をファイルに書かずに `wrangler dev --local --var APP_ENV:local --var ADMIN_API_KEY:<鍵>` で起動し（`--var` を 2 つ並べて渡せることは、2026-10-31 の Issue #34〜#41 の会話の側の通しで確かめた）、同じ鍵を環境変数で渡して `node scripts/admin-cli.mjs smoke` と §8 の `put-quest` を回す（無人の回では開発サーバーを起動しない。`.dev.vars` に書く手順にしない）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

2026-10-31 の main（`1d460bd`）の `src/`・`migrations/`・`test/`・`scripts/`・`openapi/` を読んで確かめた。

| 所 | いま |
| --- | --- |
| 機能のモジュール | `src/modules/index.ts` の `[announcements, rankings, saves, config, inventory, events, playerData]`。名前は `game_modules` の `module` と同じ。モジュールどうしは互いを読み込まない |
| マイグレーション | `0001`〜`0014`（`0014_achievements.sql` が最後）。次の番号は `0015` |
| クエスト | 表も口も無い |
| プレイヤーデータ | `player_data_keys`（宣言・`mode` は `add`・`max`・`set`・`flag`）・`player_data`（プレイヤーごとの値）・`player_data_writes`（書き込みの記録と `Idempotency-Key`）・`achievements`・`player_achievements`。書き込みは `src/modules/player-data/index.ts` の 1 つの `batch`（記録 → 値 → 実績 → 応答の写し）。区切りごとの値は無い（`player-data-design.md` §16 が「区切りごとの統計値」をこの設計書へ送った） |
| 区切りの計算 | `src/modules/events/period.ts` の `isOpen`・`periodKey`・`nextResetAt`（サーバーの時刻と時差の分だけを入力にする。`period_key` は `once`・`YYYY-MM-DD`・週の月曜の日付） |
| 受け取りの文 | `src/modules/events/index.ts` の 3 文（受け取りの行 → 受領の履歴 → 残高）。報酬の中身を `event_rewards` から SQL の中で読む。種類の名前は `src/core/ledger.ts` の `LEDGER_SOURCES`（`eventClaim: 'event-claim'`・`admin: 'admin'`） |
| トークンの要る口の確かめの順 | events・player-data: `requireLocalWrite` → `requireAuth` → `consume`（プレイヤーごと）→ `requireNotBanned` → `gameId` の形 → トークンのゲームとの突き合わせ → `requireGame` |
| 利用制限 | `src/core/rate-limit-policy.ts` の `RATE_LIMITS`（`guestIp`・`guestGame`・`score`・`saves`・`rewards`・`admin`・`playerData`）。試験 `利用制限の回数と窓は定数のモジュールにある` が中身を `toEqual` で見る |
| エラーコード | ゲームのクライアントのスキーマに 17 個（試験 `スキーマのErrorCodeの列挙は17個のエラーコードと一致する`。最後が `IDEMPOTENCY_KEY_REUSED`）。管理のスキーマに 10 個（試験 `管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する`） |
| スキーマの操作 | ゲームのクライアントに 17 個（試験 `スキーマのファイルはOpenAPI 3.1で17個の操作を持つ`）。管理に 12 個（試験 `管理のスキーマの操作は管理のルートと1対1で対応する` は数を名前に持たない） |
| トークンの要る操作を全部送る試験 | `PLAYER_BANNEDの応答はスキーマに合う`（`test/bans.test.ts`）が、スキーマの 401 を持つ操作の一覧と試験の要求の表を `toEqual` で比べる |
| 管理のプレイヤーを読む口 | `GET /v1/admin/players/{playerId}`（`src/core/admin/routes.ts`）が `balances`・`history`・`saves`・`rankings`・`playerData`（と止めていれば `ban`）を返す。試験は欄ごとに見る |
| 監査のログ | `admin_audit_log` の `action` は `player.ban`・`player.unban`・`inventory.adjust`・`ranking.delete`・`item.put`・`event.put`・`player-data-key.put`・`achievement.put`・`player-data.set`・`achievement.revoke` |
| CLI モック | `scripts/cli-mock.mjs` は健康 → 設定 → お知らせ → ゲスト → スコア → セーブ → イベントと所持品 → プレイヤーデータと実績。要求の形の関数は `scripts/cli-requests.mjs`。試験 `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` が通しの要求を 32 本と数える |
| 管理コマンド | `scripts/admin-cli.mjs`（操作は `player`・`audit`・`grant`・`revoke`・`ban`・`unban`・`delete-score`・`put-item`・`put-event`・`put-data-key`・`put-achievement`・`set-data`・`revoke-achievement`・`smoke`）。要求の形の関数は `scripts/admin-requests.mjs` |

元の文書から引く決まり:

- `roadmap.md` Phase 2: 残りはクエスト（この設計書）と分析（DAU・継続率）・バックアップ・費用アラート（§15）。
- `player-data-design.md` §2（同じ値を持つときはプレイヤーデータを正にする）・§3（宣言したキーだけ）・§5（値は自己申告。守りはゲームを問わないものだけ・限界）・§7（実績はサーバーがキーの値と閾値で判定）・§8（管理の宣言と直し）・§15（クエストへ渡すもの）・§16（区切りごとの統計値はクエストの設計書）。
- `event-reward-design.md` §4（区切りはサーバーの時刻と時差の 0 時。Cron Triggers を使わず要求の時に計算する）・§5（一意の鍵と 1 つの `batch`。続く文は「この要求の行が入ったとき」だけ書く・2 回目は 200 で同じ本文）・§13 の順 3 の行・§14（条件つきの報酬はプレイヤーデータとクエスト。サーバーは数の閾値だけを見る）。
- `admin-design.md` §6（台帳と `LEDGER_SOURCES`・受け取りの 3 文を `src/core/ledger.ts` へ移すかはクエストのときに決める）・§7（イベントの定義の口の形・受け取りのある定義の区切りを変えさせない守り）・§11 の決めること 7・§13 のクエストの行。
- `config-design.md`（マスターデータはクライアントだけが見る。サーバーは解釈しない）。
- `abuse-protection-design.md` §5（自然な鍵の無い足し算にだけ `Idempotency-Key`）・§6（自己申告でサーバーがやること／やらないこと）。
- `account-design.md`（トークンの `p` だけでプレイヤーが決まる）・`core-foundation-design.md`（core はモジュールを読み込まない・`game_modules` は認可の代わりにしない）。

Cloudflare の機能（2026-10-31。確かめたものと、要確認のもの）:

- **D1 の `batch`**: 文を順に流し、どれかが落ちれば全部戻ること、並べて送った `batch` が互いに混ざらず順に流れることは、公式の文書では確かめておらず**要確認**（`event-reward-design.md` §1・`player-data-design.md` §1 と同じ前提。試験 `同じ期間の受け取りを並べて送っても付与は1回分` がローカルの D1 で通っていることだけを確かめた）。
- **D1 の 1 つの文のバインドの上限（100）**: Issue #42 の前提の数で、公式の文書では確かめておらず**要確認**。プレイヤーデータの書き込みはこの数を越えないように共通の値を派生表で 1 回だけバインドしている（`src/modules/player-data/index.ts` の `insertWriteSql`）。この設計の文は §6 でバインドの数を数える。
- **D1 の 1 回の `batch` の文の数の上限**: **要確認**。§6 の区切りの値の文でプレイヤーデータの書き込みの文が増える数を数え、上限で抑える。
- Durable Objects・Queues・Cron Triggers: この設計では**使わない**（§13 の決めること 13）。区切りは要求の時に計算する。

## 2. サーバーが持つもの・持たないもの（ADR 0002）

| 持つ（ゲームを問わない仕組み） | 持たない（ゲームの中の意味。ゲームの側・マスターデータ） |
| --- | --- |
| クエストの宣言（ID・区切り・期間・見るキー・閾値・報酬の品目と数） | クエストの名前・説明・物語・絵・並び順・隠しクエストか（マスターデータ。`config-design.md` の C2 で配る） |
| 進捗の数（キーのいまの値か、区切りの中で増えた分） | 何をしたら進むか（何を倒したら 1 増えるか。ゲームの中のルール。プレイヤーデータの書き込みの前にクライアントが決める） |
| 達成の判定（進捗が閾値以上か。数の比べだけ） | 前のクエストを終えたら開く・選んだ道で変わる（物語の分岐。クライアントが一覧を出し分ける。§16） |
| 受け取りの行（プレイヤー・クエスト・区切りごとに 1 つ）と、受領の履歴・残高 | 報酬の演出 |

サーバーはマスターデータを読まない（`config-design.md` の決定のまま）。クエストの名前や説明は、ゲームの作者がマスターデータにクエストの ID をキーにして置き、クライアントが ID で引いて出す。**閾値と報酬はサーバーの表に置く**（サーバーが判定と付与に使うので、マスターデータに置くとサーバーがマスターデータを解釈することになる。§13 の決めること 1）。

## 3. データの形

### 表（Q1: `migrations/` の新しい番号 `0015_quests.sql`）

```sql
-- クエストの宣言（ゲームごと。区切り・期間・見るキーと閾値だけ。名前・説明はマスターデータ）。時刻はどれも UNIX 秒（UTC）
CREATE TABLE IF NOT EXISTS quests (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL,                       -- ^[a-zA-Z0-9_-]{1,64}$
  kind TEXT NOT NULL CHECK (kind IN ('once', 'daily', 'weekly')),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  reset_offset_minutes INTEGER NOT NULL DEFAULT 0 CHECK (reset_offset_minutes BETWEEN -720 AND 840),  -- 区切りの時差（events と同じ範囲）
  key TEXT NOT NULL,                            -- 見るキー（player_data_keys）
  threshold INTEGER NOT NULL CHECK (threshold BETWEEN 1 AND 1000000000),   -- MAX_PLAYER_DATA_VALUE と同じ上限
  CHECK (ends_at > starts_at),
  PRIMARY KEY (game_id, quest_id),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 報酬の中身（クエストごとに品目と数。1 クエスト最大 MAX_REWARD_LINES 行。event_rewards と同じ形）
CREATE TABLE IF NOT EXISTS quest_rewards (
  game_id TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 1 AND amount <= 1000000000),
  PRIMARY KEY (game_id, quest_id, item_id),
  FOREIGN KEY (game_id, quest_id) REFERENCES quests(game_id, quest_id) ON DELETE CASCADE,
  FOREIGN KEY (game_id, item_id) REFERENCES inventory_items(game_id, item_id)
);
-- 受け取り（プレイヤー・クエスト・区切りごとに 1 行。二重を止める一意の鍵。event_claims と同じ形）
CREATE TABLE IF NOT EXISTS quest_claims (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（event_claims と同じ）
  quest_id TEXT NOT NULL,
  period_key TEXT NOT NULL,                     -- 'once'・'2026-10-30'（デイリー）・'2026-10-26'（週間。月曜の日付）
  claim_id TEXT NOT NULL UNIQUE,                -- サーバーが作る（crypto.randomUUID()）
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, quest_id, period_key),
  FOREIGN KEY (game_id, quest_id) REFERENCES quests(game_id, quest_id)
);
-- 管理の読み取り（§8）が新しい順に引く
CREATE INDEX IF NOT EXISTS quest_claims_player ON quest_claims (game_id, player_id, claimed_at);
-- それまでに登録したゲームは quests を使う設定にする（0003・0005・0006・0009・0010・0013 と同じ形。demo-rpg を含む）
INSERT OR IGNORE INTO game_modules (game_id, module) SELECT game_id, 'quests' FROM games;
-- demo-rpg の手本のクエスト（CLI モックの通しに使う）。スライムを 1 体倒す・金貨 50
INSERT OR IGNORE INTO quests (game_id, quest_id, kind, starts_at, ends_at, reset_offset_minutes, key, threshold)
  VALUES ('demo-rpg', 'first-hunt', 'once', CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER),
          CAST(strftime('%s', '2100-01-01 00:00:00') AS INTEGER), 0, 'slimes-defeated', 1);
INSERT OR IGNORE INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES ('demo-rpg', 'first-hunt', 'gold', 50);
```

### 表（Q2: `migrations/` の新しい番号 `0016_player_data_periods.sql`）

区切りごとの値はプレイヤーデータの機能の表に置く（書くのはプレイヤーデータの書き込みで、クエストのモジュールは読むだけ。§4 の決まり）。

```sql
-- 区切りごとに数えるキーの宣言（増やすキーだけ。クエストの定義の口〔§8〕が、デイリー・週間のクエストを入れるときに同じ batch で入れる）
CREATE TABLE IF NOT EXISTS player_data_key_periods (
  game_id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  reset_offset_minutes INTEGER NOT NULL CHECK (reset_offset_minutes BETWEEN -720 AND 840),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, key, kind),
  FOREIGN KEY (game_id, key) REFERENCES player_data_keys(game_id, key)
);
-- 区切りごとの値（プレイヤー・キー・区切りの種類・区切りごとに 1 行。その区切りの中で add した合計）
CREATE TABLE IF NOT EXISTS player_data_period_values (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  period_key TEXT NOT NULL,                     -- periodKey(kind, now, reset_offset_minutes)
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 1000000000),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, player_id, key, kind, period_key),
  FOREIGN KEY (game_id, key, kind) REFERENCES player_data_key_periods(game_id, key, kind)
);
-- demo-rpg の手本: slimes-defeated をデイリーで数え、その日に 3 体倒すクエスト（薬 1）
INSERT OR IGNORE INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at)
  VALUES ('demo-rpg', 'slimes-defeated', 'daily', 0, CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER));
INSERT OR IGNORE INTO quests (game_id, quest_id, kind, starts_at, ends_at, reset_offset_minutes, key, threshold)
  VALUES ('demo-rpg', 'daily-slimes', 'daily', CAST(strftime('%s', '2026-01-01 00:00:00') AS INTEGER),
          CAST(strftime('%s', '2100-01-01 00:00:00') AS INTEGER), 0, 'slimes-defeated', 3);
INSERT OR IGNORE INTO quest_rewards (game_id, quest_id, item_id, amount) VALUES ('demo-rpg', 'daily-slimes', 'potion', 1);
```

- マイグレーションはどれも `IF NOT EXISTS`・`INSERT OR IGNORE` だけ（既存の試験 `マイグレーションを2回当ててもデータは壊れない` が通る）。`ALTER TABLE` を使わない。区切りを `player_data_keys` の列にしないのは、`ALTER TABLE` が使えず、表を作り直すとプレイヤーデータの外部キーが全部動くため（§13 の決めること 4）。
- 区切りごとの値の行は、宣言の後の書き込みから数える（宣言の前の書き込みはさかのぼらない。`player-data-design.md` §7 の実績と同じ考え）。古い区切りの行は、35 日を過ぎると 1 日 1 回の掃除で消える（いまの区切りの行は消えない。保持の日数と消し方の正は `docs/guides/working/analytics-design.md` §6）。
- 機能の名前は `quests`（URL の `/v1/quests` と同じ。`src/core/ids.ts` の形に合う）。
- クエストを消す口は作らない（受け取りの行が外部キーで指す。終えるときは `endsAt` をいまにする。イベントと同じ）。

### 定数（データ 1 か所。design-cycle §2）

| 定数 | 値 | 置き場 | 束 |
| --- | --- | --- | --- |
| `MAX_REWARD_LINES` | 10（いまの値のまま。クエストの報酬の行の数にも使う） | `src/core/inventory.ts`（いまの置き場。クエストのモジュールと管理の口が読む） | Q1 |
| `MAX_QUESTS` | 200（1 ゲームのクエストの宣言の数。一覧の応答の行の数の上限にもなる） | `src/core/quests.ts`（管理のクエストの定義の口が確かめる） | Q3 |
| `QUEST_KINDS` | `['once', 'daily', 'weekly']`（イベントの区切りと同じ名前） | `src/core/period.ts`（イベントの `EventKind` と同じ型にする） | Q2 |
| `RATE_LIMITS.quests` | `{ scope: 'quests', limit: 60, period: 60 }` | `src/core/rate-limit-policy.ts`（`abuse-protection-design.md` §2 の表にも行を足す。§9） | Q1 |
| `LEDGER_SOURCES.questClaim` | `'quest-claim'` | `src/core/ledger.ts`（種類の名前の 1 か所。§6） | Q1 |

### モジュールのファイル

| ファイル | 中身 | 束 |
| --- | --- | --- |
| `src/modules/quests/index.ts` | `quests: GameModule`（`name: 'quests'`）。§4 の一覧の `GET` と受け取りの `POST` と §6 の SQL | Q1（区切りは Q2） |
| `src/modules/quests/shape.ts` | `questStatus(def, progress, claimed)`（達成・受け取り済みを決める。入出力の無い関数）・一覧の行の形 | Q1 |
| `src/core/period.ts` | `isOpen`・`periodKey`・`nextResetAt`・`isoSeconds`・`QUEST_KINDS`。`src/modules/events/period.ts` から移す（events・quests・player-data のモジュールと管理の口が読む。中身と値は変えない。モジュールどうしを読み込まないため core に置く）。管理の口の写し `EVENT_DEFINITION_KINDS`（`src/core/admin/parse.ts`。core が modules を読めないための写し）は、ここを読む形に置き換えて消す | Q2 |
| `src/core/quests.ts` | `MAX_QUESTS` | Q3 |
| `src/modules/player-data/index.ts` | 書き込みの `batch` に区切りの値の文を足す（§6） | Q2 |

## 4. API と確かめの順

2 つの口はどちらもトークンが要る。プレイヤーはトークンの `p` だけで決まる（本文・クエリの `playerId` を受け取らない）。読み取りも、イベントの一覧と同じく `APP_ENV` の守りを通す（§9）。

### 確かめの順（2 つの口で同じ。イベントの `checkAccess` と同じ形）

ルート → `requireLocalWrite`（403 `NOT_READY_FOR_PRODUCTION`）→ `requireAuth`（401）→ **プレイヤーの利用制限 `RATE_LIMITS.quests`（429 `RATE_LIMITED`・`Retry-After`。2 つの口を合わせて、鍵は `<トークンの g>:<トークンの p>`）** → `requireNotBanned`（403 `PLAYER_BANNED`）→ `gameId` の形（400 `INVALID_ARGUMENT`）→ トークンのゲームとの突き合わせ（403 `PERMISSION_DENIED`）→ ゲームの登録と機能の設定 `requireGame(env, gameId, 'quests', known)`（404）→ 口ごとの確かめ。

- 機能の設定は `quests` だけを見る。`player-data`・`inventory` を使わない設定のゲームでも、クエストの口は通る（表はどのゲームにもあり、機能の設定は認可の代わりにしない。§13 の決めること 10）。そのゲームでは進捗が書かれないので達成しない・受け取った品目が `GET /v1/inventory` で読めない、というだけで、壊れはしない。
- クエストのモジュールはプレイヤーデータの表（`player_data`・`player_data_period_values`）を読み、所持品の表（`inventory_ledger`・`inventory_balances`）に書くが、player-data・inventory のモジュールは読み込まない（イベントの受け取りが所持品の表に書くのと同じ。モジュールどうしは読み込まない）。

### `GET /v1/quests?gameId=demo-rpg`（Q1。区切りの欄は Q2）

```json
{"gameId":"demo-rpg","serverTime":"2026-10-31T15:30:00Z","items":[
  {"questId":"daily-slimes","kind":"daily","startsAt":"2026-01-01T00:00:00Z","endsAt":"2100-01-01T00:00:00Z","periodKey":"2026-10-31","nextResetAt":"2026-11-01T00:00:00Z","key":"slimes-defeated","threshold":3,"progress":1,"completed":false,"claimed":false,"rewards":[{"itemId":"potion","amount":1}]},
  {"questId":"first-hunt","kind":"once","startsAt":"2026-01-01T00:00:00Z","endsAt":"2100-01-01T00:00:00Z","periodKey":"once","key":"slimes-defeated","threshold":1,"progress":1,"completed":true,"claimed":false,"rewards":[{"itemId":"gold","amount":50}]}]}
```

- **いま開いているクエストだけ**（`starts_at <= now < ends_at`）。並びは `questId` の昇順。受け取った後も期間の内なら載る（`claimed: true`）。
- `progress` は進捗の数: `once` はキーのいまの値（`player_data`。行が無ければ 0）、`daily`・`weekly` はいまの区切りの値（`player_data_period_values`。行が無ければ 0）。閾値で丸めない（クライアントが「3 / 3」に丸めて出す）。
- `completed` は `progress >= threshold`、`claimed` はいまの区切りの受け取りの行があるか（`questStatus`）。
- `serverTime`・`nextResetAt` はイベントの一覧と同じ（クライアントは端末の時刻で区切りを決めない）。`nextResetAt` は `once` では載せない。
- Q1 の間は `kind = 'once'` のクエストだけを載せる（区切りの値が Q2 で入るまで、デイリー・週間の進捗を数えられないため。Q1 の試験は区切りのあるクエストを入れない）。

### `POST /v1/quests/{questId}/claim?gameId=demo-rpg`（Q1）

本文は要らない（送っても読まない。「達成した」の申告も、時刻も読まない）。`Idempotency-Key` も読まない（§6）。共通の確かめの後:

1. `questId` の形（ルートの `^[a-zA-Z0-9_-]{1,64}$`。外れは既存のルートに当たらない 404）。
2. クエストを読む。無ければ 404 `NOT_FOUND`（`Unknown quest`）。Q1 の間は `kind` が `once` でなければ同じく 404。
3. `periodKey(kind, now, reset_offset_minutes)` を決め、§6 の `batch` を流す（期間・進捗・上限の判定は文 1 の条件の中。読んでから書くまでの間に値や定義が動いてもずれない）。
4. 受け取りの行を読み直して応答を作る（§6）。

```json
{"gameId":"demo-rpg","questId":"first-hunt","periodKey":"once","claimId":"<claimId>","claimedAt":"2026-10-31T15:30:00Z","grants":[{"itemId":"gold","amount":50}]}
```

- 応答の形はイベントの受け取りと同じ（`eventId` が `questId` になる）。残高は入れない（2 回目も同じ本文にするため）。

## 5. 達成の判定と、自己申告をどこまで信じるか

### 達成の判定（受け取りの時）

**達成は受け取りの口の中で判定する。プレイヤーデータの書き込みの `batch` には、クエストの文を足さない**（§13 の決めること 5）。

- 進捗の元はプレイヤーデータの値（`player-data-design.md` §2 でプレイヤーデータを正にした決定のまま）。クエストのモジュールは値を読むだけで、書かない。
- 一覧（`GET`）の `completed` と、受け取り（`POST`）の判定は、同じ数の比べ（`progress >= threshold`）。一覧はその時の値で計算するだけで、達成の行を持たない。
- **値が閾値を割ったら、受け取る前のクエストは達成でなくなる**（`set` のキー・管理の直しで下がったとき）。受け取った後に下がっても、受け取りは取り消さない。クエストに使うキーは `add`・`max`・`flag` を推す（下がらない）。`set` も使えるが、下がると達成でなくなることを作者が知って使う（§8 の定義の口は止めない）。
- `player-data-design.md` §15 は「書き込みの `batch` の中で、実績の文の隣に達成したクエストの行の文を足す形を検討する」と書いた。検討の結果は受け取りの時の判定で、理由は §13 の決めること 5（プレイヤーデータの機能がクエストの表に書くと、クエストを使わないゲームの書き込みにも文が足され、機能の境目が崩れる）。

### 自己申告の扱い（`player-data-design.md` §5・`abuse-protection-design.md` §6 と同じ考え）

サーバーは値がゲームの中で取れたかを確かめられない（ルールを持たない。ADR 0002）。クエストは**自己申告の値を品目に換える口**になるので、守りと限界を書く（§13 の決めること 12）。

| やる（ゲームを問わない） | 何を止めるか |
| --- | --- |
| 「達成した」と申告する口・欄を作らない。判定はサーバーがプレイヤーデータの値と閾値で行う | どのクエストでも申告だけで受け取る |
| 値の守りはプレイヤーデータのまま（宣言したキーだけ・範囲・1 回の増加の上限 `max_delta`・書き方の固定・利用制限） | 一度で巨大な数にして全部のクエストを一度に達成する |
| 受け取りは一意の鍵（プレイヤー・クエスト・区切り）で 1 回だけ（§6） | 同じ報酬を何度も受け取る |
| 区切りはサーバーの時刻だけで決める（本文・クエリ・`Date` の見出しの時刻を読まない） | 端末の時刻を動かしてデイリーを何度も受け取る |
| 利用制限（プレイヤーごと、クエストの口を合わせて 60 秒に 60 回。§9） | 受け取りの連打で D1 を叩く |

**限界（そのまま書く）**: 改造したクライアントは、プレイヤーデータの範囲の内の値を、制限の内の回数で送れる（`player-data-design.md` §5 の限界）。それで達成するクエストの報酬も受け取れる。`add` のキーを見るクエストは、閾値 ÷ (`max_delta` × 60) 分で達成でき、`max`・`set`・`flag` のキーを見るクエストは 1 回の書き込みで達成できる。デイリー・週間のクエストは区切りごとに 1 回なので、1 人が 1 日に受け取れる報酬の上限は「開いているデイリーのクエストの報酬の合計」で決まる（作者が見積もれる）。ゲストは何人でも作れる（`abuse-protection-design.md` §4 の IP ごとの制限の内）。作者が強く守りたい報酬は、見るキーの `max_delta`・`max_value` を小さく宣言し、報酬の数を抑える。不正が分かった人は管理で値を直し、受け取った品目を取り消し（`admin-design.md` §6 の増減）、BAN する。

## 6. 受け取りの二重の止め方と、報酬の付与

**一意の鍵（プレイヤー・クエスト・区切り）と、受け取り・履歴・残高を 1 つの `batch` で書くこと**で止める（`event-reward-design.md` §5 と同じ。§13 の決めること 6）。受け取りには自然な鍵があるので **`Idempotency-Key` は読まない**（送られても無視。プレイヤーデータの書き込みのような足し算でない）。

`batch` の 3 文（`src/modules/quests/index.ts`。引数は `?` を順に `bind` する。下は読みやすさのために名前で書く。`:ref` は要求ごとに作る `crypto.randomUUID()`）:

```sql
-- 1. 受け取りの行。期間の内で、進捗が閾値以上で、付与しても上限を超えないときだけ。同じ区切りの行があれば何もしない
INSERT INTO quest_claims (game_id, player_id, quest_id, period_key, claim_id, claimed_at)
  SELECT :g, :p, :q, :pk, :ref, :now FROM quests x
  WHERE x.game_id = :g AND x.quest_id = :q AND x.starts_at <= :now AND :now < x.ends_at
    AND COALESCE(CASE x.kind
          WHEN 'once' THEN (SELECT value FROM player_data WHERE game_id = :g AND player_id = :p AND key = x.key)
          ELSE (SELECT value FROM player_data_period_values                                   -- Q2 で足す（Q1 の文には ELSE の枝ごと書かない。無い表は通らない枝でも SQLite が断る）
                WHERE game_id = :g AND player_id = :p AND key = x.key AND kind = x.kind AND period_key = :pk)
        END, 0) >= x.threshold
    AND NOT EXISTS (
      SELECT 1 FROM quest_rewards r
      LEFT JOIN inventory_balances b ON b.game_id = r.game_id AND b.player_id = :p AND b.item_id = r.item_id
      WHERE r.game_id = :g AND r.quest_id = :q AND COALESCE(b.amount, 0) + r.amount > :max)
  ON CONFLICT (game_id, player_id, quest_id, period_key) DO NOTHING;
-- 2. 受領の履歴（この要求の claim_id が入ったときだけ）。種類の名前は LEDGER_SOURCES.questClaim を文に埋める
INSERT INTO inventory_ledger (game_id, player_id, item_id, delta, source_type, source_id, created_at)
  SELECT r.game_id, :p, r.item_id, r.amount, 'quest-claim', :ref, :now FROM quest_rewards r
  WHERE r.game_id = :g AND r.quest_id = :q AND EXISTS (SELECT 1 FROM quest_claims c WHERE c.claim_id = :ref);
-- 3. 残高（同じ条件）
INSERT INTO inventory_balances (game_id, player_id, item_id, amount, updated_at)
  SELECT r.game_id, :p, r.item_id, r.amount, :now FROM quest_rewards r
  WHERE r.game_id = :g AND r.quest_id = :q AND EXISTS (SELECT 1 FROM quest_claims c WHERE c.claim_id = :ref)
  ON CONFLICT (game_id, player_id, item_id) DO UPDATE SET
    amount = inventory_balances.amount + excluded.amount, updated_at = excluded.updated_at;
```

バインドの数（D1 の 1 つの文の上限 100 の内。§1 の**要確認**の前提）: 文 1 は名前つきで書いた値を `?` に直して 16（`:g` が 5 回・`:p` が 4 回など。#43 で数えた）、文 2 は 6・文 3 は 5。報酬の行の数はバインドに関わらない（`quest_rewards` から SQL で読む）。共通の値を派生表で 1 回だけバインドする形（プレイヤーデータの U1 の形）に直さなくても上限から遠いので、イベントの文と同じ素直な形にする。

`batch` の後に `SELECT claim_id, claimed_at FROM quest_claims WHERE game_id = :g AND player_id = :p AND quest_id = :q AND period_key = :pk` を引く:

| 引いた結果 | 応答 |
| --- | --- |
| 行がある（この要求の `claim_id`） | 200。`grants` は `inventory_ledger` の `source_type = 'quest-claim' AND source_id = claim_id` の行（品目の ID の昇順） |
| 行がある（前の要求の `claim_id`）＝二重 | **200 で 1 回目と同じ本文**（同じ `claimId`・`claimedAt`・`grants`）。残高も履歴も増えない |
| 行が無く、`now` で期間の外 | 409 **`QUEST_NOT_ACTIVE`**（新しいコード） |
| 行が無く、進捗が閾値に届かない | 409 **`QUEST_NOT_COMPLETED`**（新しいコード） |
| 行が無く、どちらでもない | 409 `INVENTORY_LIMIT_EXCEEDED`（いまのコード。付与すると残高が `MAX_ITEM_AMOUNT` を超える） |

- 行が無いときの見分けは、クエストの行と進捗を 1 文で読み直して TypeScript で比べる（`batch` と読み直しの間に値が動いたときは、読み直しの結果で返す。何も書いていないので、クライアントはもう一度送れる）。
- 並べて送っても: D1 は `batch` を順に流すので（§1 の**要確認**の前提）、2 つ目の `batch` の文 1 は一意の鍵で何もせず、その `claim_id` の行が無いので文 2・3 も何もしない（イベントの受け取りと同じ）。
- 区切りをまたいだ送り直しは新しい区切りの受け取りになり、そこで進捗が閾値に届いていなければ 409 `QUEST_NOT_COMPLETED`（区切りが変わると進捗は 0 から数え直すため）。クライアントは 409 を受けたら `GET /v1/inventory/history` で `sourceType: "quest-claim"` の行を見て、前の区切りで受け取れていたかを確かめる（イベントの §5 と同じ扱い）。
- DB の失敗は入口の `try/catch` で 500 `INTERNAL_ERROR`（中身を返さない。`CLAUDE.md` の守るもの）。

### 種類の名前と、受け取りの文の置き場（`admin-design.md` §6・§11 の決めること 7）

- `LEDGER_SOURCES` に `questClaim: 'quest-claim'` を足す（値はイベントの `event-claim` と同じ形。`admin-design.md` §13・`event-reward-design.md` §13 が名前の案として書いた `quest` は、決める前の案。Q1 でその 2 つの行をこの設計書を指す形に置き換える。§9）。
- **受け取りの 3 文はクエストのモジュールに置き、`src/core/ledger.ts` へ移さない**（§13 の決めること 7）。イベントの 3 文は変えない。受領の履歴に書く所は 3 つ（イベントの受け取り・クエストの受け取り・管理の増減）になるが、種類の名前は `LEDGER_SOURCES` の 1 か所のまま。

### 区切りごとの値の書き込み（Q2。`src/modules/player-data/index.ts`）

プレイヤーデータの書き込みの `batch` の文 2（値）の後ろに、**区切りを宣言した `add` のキーの変更ごと・区切りの種類ごとに 1 文**を足す。宣言は文 3 の宣言の読み込み（`loadKeys`）と一緒に `player_data_key_periods` から読み、`periodKey(kind, now, reset_offset_minutes)` を TypeScript で決めて渡す。

```sql
-- 2b. 区切りごとの値（この要求の記録が入ったときだけ）
INSERT INTO player_data_period_values (game_id, player_id, key, kind, period_key, value, updated_at)
  SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM player_data_writes WHERE write_ref = ?)
  ON CONFLICT (game_id, player_id, key, kind, period_key) DO UPDATE SET
    value = player_data_period_values.value + excluded.value, updated_at = excluded.updated_at;
```

- バインドは 1 文で 8。文の数は 1 回の書き込みで最大 `MAX_CHANGES_PER_WRITE` × 2（デイリーと週間）= 40 増える（いまの最大 23 文 → 63 文。D1 の 1 回の `batch` の文の数の上限は**要確認**。上限が足りないと分かったら `MAX_CHANGES_PER_WRITE` を下げる前に、区切りの値の文を 1 文の `INSERT … SELECT … FROM (VALUES …)` にまとめる）。
- 文 1 の上限の条件（`player_data` の書いた後の値が `max_value` 以下）を通った書き込みだけが書き、管理の値の直しは区切りの値を新しい値で頭打ちにする（§8。Q3 で入る）ので、区切りの値は合計の値を超えず、`CHECK` の上限に当たらない。Q2 から Q3 までの間は、管理で合計を下げると区切りの値が合計を超えうる（ローカル専用の間の一時の穴。Q3 で閉じる）。
- 同じ `Idempotency-Key` の送り直しは文 1 で止まり、区切りの値も増えない（二重に数えない）。409 `PLAYER_DATA_LIMIT_EXCEEDED` の書き込みも区切りの値を書かない。
- 書き込みの応答（`result_json`）と `GET /v1/player-data` の形は変えない（区切りの値はクエストの一覧の `progress` で見せる）。
- `max`・`set`・`flag` のキーは区切りで数えない（区切りの中の「増えた分」の意味が無い。§16）。

## 7. デイリー・週間・期間つきのクエスト（Q2）

- **区切りの決め方はイベントと同じ**（`event-reward-design.md` §4。サーバーの時刻と、クエストごとの時差の 0 時。週間は時差の月曜 0 時）。関数は Q2 で `src/modules/events/period.ts` から `src/core/period.ts` へ移し、イベント・クエスト・プレイヤーデータで同じものを使う（中身を変えないので、イベントの区切りの試験はそのまま通る）。
- **期間つき**は `starts_at`・`ends_at`（どの区切りのクエストにもある。一度きりのクエストも期間の外では一覧に出ず、受け取れない）。
- **区切りごとの値は、キーの側（`player_data_key_periods`）に区切りの種類と時差を持つ**（§13 の決めること 4）。同じキーを見るデイリーのクエストが 2 つあっても値は 1 つで、時差はキーごとに 1 つ（違う時差のデイリーを同じキーに入れる定義は 400。§8）。
- 区切りが変わると、新しい区切りの行はまだ無いので進捗は 0 から数え直す。前の区切りの行は残る（受け取っていなくても、前の区切りの分は受け取れない。区切りの鍵が今の区切りで決まるため）。
- クエストの「受ける」操作は作らない（§13 の決めること 3）。デイリーの進捗は、区切りの宣言があればプレイヤーが受けたかに関わらず数える。
- Cron Triggers で日替わりの処理を流さない（区切りは要求の時に計算する）。

## 8. 管理との関係（Q3）

`admin-design.md` §13 の行のとおり、クエストの定義は §7 のイベントの定義と同じく管理の口で入れる。どれも管理の口の確かめの順（`checkAdmin`: `requireLocalWrite` → 管理の利用制限 → 管理の鍵 → `gameId` → ゲームの登録 → 書き込みは `X-Admin-Actor` と `reason`）を通る。管理の口は機能の設定（`game_modules` の `quests`）を見ない（`admin-design.md` §2 の決まりのまま）。

| 口 | 本文 | 応答・決まり | 監査の `action`（前 → 後） |
| --- | --- | --- | --- |
| `PUT /v1/admin/quests/{questId}?gameId=…` | `{"kind":"daily","startsAt":"…","endsAt":"…","resetOffsetMinutes":0,"key":"slimes-defeated","threshold":3,"rewards":[{"itemId":"potion","amount":1}],"reason":"…"}` | 無ければ作る。本文の確かめ（`parseQuestDefinition`。400）はイベントの `parseEventDefinition` と同じ決まりに、`key` の形・`threshold` が 1〜`MAX_PLAYER_DATA_VALUE` の整数を足す。宣言の無いキーは 404 `Unknown key`、無い品目は 404 `Unknown item`。`daily`・`weekly` は `add` のキーだけ（ほかは 400）で、キーに同じ区切りの宣言が無ければ `player_data_key_periods` に同じ `batch` で入れ、あって時差が違えば 400。**受け取りの行があるクエストは `kind`・`startsAt`・`resetOffsetMinutes`・`key` を変えられない**（400。区切りの鍵と進捗の意味が変わるため）。`endsAt`・`threshold`・`rewards` は変えられる（変えた後の受け取りから）。新しいクエストで宣言が `MAX_QUESTS` を超えるなら 400 | `quest.put`（前の定義 → 後の定義） |
| `GET /v1/admin/players/{playerId}` に欄を足す | — | `"questClaims":[{"questId","periodKey","claimId","claimedAt"}]`（新しい順に 20 件。いつも載せる。無ければ空の配列） | 残さない（読み取り） |

- `batch`: 監査の行（前の定義と後の定義）→ 区切りの宣言（要るときだけ）→ `quests` を `INSERT … ON CONFLICT (game_id, quest_id) DO UPDATE` → `DELETE FROM quest_rewards WHERE game_id = ? AND quest_id = ?` → 報酬の行を `INSERT`（行の数だけ）。どの文も「この要求の `audit_ref` の行が入ったとき」だけ（イベントの定義と同じ）。
- 受け取りを直す口は作らない（§13 の決めること 9）。間違って受け取られた報酬は管理の増減（`revoke`）で戻し、進捗は値の直し（`set-data`）で戻す。どちらも今ある口で、監査に前と後が残る。
- **値の直し（`PUT /v1/admin/players/{playerId}/player-data/{key}`）は、Q3 で区切りの値も同じ `batch` で頭打ちにする**: 監査の行の後に `UPDATE player_data_period_values SET value = MIN(value, :new), updated_at = :now WHERE game_id = :g AND player_id = :p AND key = :k AND EXISTS (この要求の audit_ref)` を足す（バインドは 6）。これがないと、合計を下げても区切りの値が前のまま残り、デイリー・週間のクエストの進捗が直らず、その後の `add` で区切りの値が合計を超えうる。監査の前と後は合計の値のまま（区切りの値は合計から決まる写しとして扱う）。直しで区切りの値を上げることはしない（上げた分がどの区切りの分か決まらない）。
- 何度送っても結果が同じ（置く）なので `Idempotency-Key` は要らない（イベントの定義と同じ）。
- 新しいエラーコードは管理のスキーマに足さない（400・404 だけ。既存の試験 `管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する` は変わらない）。
- 管理コマンド `scripts/admin-cli.mjs` に操作 `put-quest`（定義は JSON のファイルを引数で渡す。`put-event` と同じ）を足し、`player` の表示にクエストの受け取りを足す（要求の形の関数は `scripts/admin-requests.mjs`）。いまの `smoke` の流れと `SMOKE_AUDIT_ACTIONS` は変えない（既存の試験 `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` が見張る）。クエストの管理の通しは §10 の Q3 の `管理コマンドと同じ流れでクエストの定義と受け取りが監査と受領の履歴に残る` で確かめる。
- 通しの確かめは、Q3 の後に会話の側で人が管理の鍵を `--var` で渡して開発サーバーを起動し、管理コマンドに同じ鍵を環境変数で渡して回す（§0。鍵をファイルに書かない）。

## 9. 認証・`APP_ENV`・利用制限・BAN・文書のどこが変わるか

- 2 つの口はどちらも `requireAuth` の後で、プレイヤーはトークンの `p` だけ（`account-design.md` の決定）。他人の進捗・受け取りには触れられない。
- **`APP_ENV === 'local'` のときだけ通す守りを外さない**（`CLAUDE.md` の「守るもの」）。受け取りだけでなく一覧の `GET` も、イベントの一覧と同じく守りを通す。`wrangler.jsonc` の既定 `APP_ENV=disabled` を変えない。
- 利用制限: `RATE_LIMITS.quests`（プレイヤーごと、2 つの口を合わせて 60 秒に 60 回）を `consume` で数える。トークンの無い・正しくない要求は数えない（401 が先）。報酬の `rewards` と分けるのは、クエストの一覧を開くたびに所持品の口の回数を減らさないため（§13 の決めること 11）。CLI モックの通し（§12）は 1 回で 4 回なので掛からない。
- BAN: `requireNotBanned` を利用制限の直後に呼ぶ（`admin-design.md` §4 の順のまま）。止めた人は 403 `PLAYER_BANNED`。
- 新しいエラーコードは 2 つ（Q1。ゲームのクライアントのスキーマ `openapi/rpg-online.v1.json` に入る）: `QUEST_NOT_COMPLETED`（409）・`QUEST_NOT_ACTIVE`（409）。ゲームのクライアントのエラーコードは 19 個になる（§11）。管理のスキーマ `openapi/rpg-online-admin.v1.json` のコードは変わらない。本文の形は `{ "error": { "code", "message" } }` のまま。
- 期間の外に `EVENT_NOT_ACTIVE` を使い回さないのは、クライアントがコードだけで「イベント」と「クエスト」の画面を出し分けるため（§13 の決めること 8）。

束の実装の Issue で直す所（この Issue では変えない。`CLAUDE.md` 原則 5 で旧文を置き換える。例外を追記しない）:

| 文書 | Q1 | Q2 | Q3 |
| --- | --- | --- | --- |
| `docs/api-contract.md` | `GET /v1/quests`・`POST /v1/quests/{questId}/claim` の節。エラーコードの表に 2 つ。「利用制限」の表に `quests` の行。受領の履歴の `sourceType` に `quest-claim` | 一覧の `periodKey`・`nextResetAt` と区切りの進捗の説明 | 「管理の API」にクエストの定義の口と、プレイヤーを読む口の `questClaims` |
| `openapi/rpg-online.v1.json` | 2 つの操作（`listQuests`・`claimQuest`）と 401・403・429・`Retry-After`・`ErrorCode` の 2 つ・履歴の `sourceType` の説明に `quest-claim`（列挙でなく説明の文字列） | 一覧の行の `nextResetAt` | — |
| `openapi/rpg-online-admin.v1.json` | — | — | 1 つの操作（`adminPutQuest`）と `adminGetPlayer` の `questClaims` |
| `docs/guides/working/architecture.md` | 4 のデータ境界に `quests`・`quest_rewards`・`quest_claims` | 同 `player_data_key_periods`・`player_data_period_values` | — |
| `docs/guides/working/abuse-protection-design.md` | §2 の表に `quests` の行（定数と同じコミット） | — | — |
| `docs/guides/working/event-reward-design.md` | §13 の順 3 の行を、この設計書を指す形に置き換える | §3 のモジュールのファイルの `period.ts` の置き場を `src/core/period.ts` に置き換える | — |
| `docs/guides/working/admin-design.md` | §6 の付与の文の置き場の段落と §13 のクエストの行を、この設計書の §6 を指す形に置き換える | — | §13 のクエストの行に定義の口（§8）を指す形を足して置き換える |
| `docs/guides/working/player-data-design.md` | §15 のクエストの行を、この設計書を指す形に置き換える | §16 の「区切りごとの統計値」の行を、この設計書の §6・§7 を指す形に置き換える | — |
| `docs/guides/decisions/roadmap.md` | — | — | Phase 2 のクエストの行に印と Issue の番号（Q3 の後、会話の側の通しの確かめが済んでから） |

`CLAUDE.md` は変えない（守るものの 2 行は、守りを外すとき＝ユーザーが決めるときに直す。`admin-design.md` §10 のとおり）。

## 10. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は新しい `test/quests.test.ts`（Q1・Q2。L1 も同じファイル）と `test/admin.test.ts`（Q3）。スキーマの置き換えは `test/schema-conformance.test.ts`、モジュールの一覧は `test/modules.test.ts`、demo-rpg の設定は `test/game-modules.test.ts`、CLI の流れは `test/failure-server.test.ts`。

試験の作り方:

- 試験のゲームは専用（`quest-game` など。`registerGame` と品目・キー・クエストの宣言の行を `beforeEach` で入れる）。demo-rpg の手本の行は CLI の流れの試験だけが使う。
- 書き込みをするファイルの `beforeEach` で `resetRateLimits(db)` と、`quest_claims`・`inventory_ledger`・`inventory_balances`・`player_data`・`player_data_writes`・`player_data_period_values`・止めた印の表の `DELETE`（いまの試験の作りと同じ）。
- 進捗はプレイヤーデータの口（`POST /v1/player-data`）で書くか、`player_data` に行を直に入れる（直に入れるときは先に宣言の行を入れる。外部キー）。
- 区切りの試験は、関数に `now` を渡す L1 と、区切りの鍵を前の日にした行を直に入れる L2 で確かめる（時計を動かさない。`event-reward-design.md` §8 と同じ）。
- 利用制限の試験は `rate_limit_counters` に `count = 60` を入れてから 1 回送る（`abuse-protection-design.md` §7 と同じ）。
- 新しい試験の名前には、機能が増えると変わる数（エラーコード・操作・ルートの個数）を入れない。既存の試験の置き換え（§11）だけは入れる。

| 束 | テストの名前 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- |
| Q1 | `クエストの一覧の行は進捗と閾値から達成と受け取り済みを決める` | L1 | `questStatus` に進捗 0・閾値 − 1・閾値・閾値 + 1 と受け取りの有無 | `completed` は閾値以上のときだけ。`claimed` は受け取りの有無のまま |
| Q1 | `クエストの一覧はトークンのプレイヤーの値で進捗と受け取り済みを返す` | L2 | `p1` と `p2` の値の行を入れ、`p1` のトークンで `GET` | 200。`p1` の値が `progress`。`questId` の昇順・`serverTime` がある |
| Q1 | `期間の外のクエストは一覧に出ず受け取りはQUEST_NOT_ACTIVEの409を返す` | L2 | 終わったクエストと始まる前のクエスト（どちらも進捗は閾値以上） | 一覧に無い。受け取りは 409・`QUEST_NOT_ACTIVE`。何も書かない |
| Q1 | `達成したクエストの報酬を受け取ると所持品が増え受領の履歴にクエストの受け取りとして残る` | L2 | 進捗を閾値にしてから受け取る | 200・`grants` が報酬のとおり。残高が増え、履歴に `sourceType: "quest-claim"`・`sourceId` が `claimId`。一覧の `claimed` が `true` |
| Q1 | `達成していないクエストの受け取りはQUEST_NOT_COMPLETEDの409を返し何も書かない` | L2 | 進捗が閾値 − 1 で受け取る | 409・`QUEST_NOT_COMPLETED`。`quest_claims`・履歴・残高が増えない |
| Q1 | `一度きりのクエストを2回受け取っても付与は1回分で同じ本文を返す` | L2 | 達成したクエストを 2 回受け取る | 2 回とも 200 で本文が同じ（`claimId` も）。残高は 1 回分・履歴は報酬の行の数だけ |
| Q1 | `同じクエストの受け取りを並べて送っても付与は1回分` | L2 | 同じ受け取りを `Promise.all` で 10 本 | 全部 200 で `claimId` が 1 つ。残高は 1 回分 |
| Q1 | `報酬を足すと所持の上限を超えるクエストの受け取りはINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない` | L2 | 残高を `MAX_ITEM_AMOUNT` − 1 にしてから達成したクエストを受け取る | 409・`INVENTORY_LIMIT_EXCEEDED`。受け取りの行が無い |
| Q1 | `知らないクエストの受け取りはNOT_FOUNDの404を返す` | L2 | 宣言の無い `questId` | 404・`NOT_FOUND` |
| Q1 | `ほかのプレイヤーの値ではクエストは達成にならない` | L2 | `p2` の値が閾値以上・`p1` は 0 で、`p1` が受け取る | 409・`QUEST_NOT_COMPLETED` |
| Q1 | `値で置くキーを閾値より下げると受け取る前のクエストは達成でなくなる` | L2 | `set` のキーを閾値まで上げて一覧 → 0 に下げて一覧と受け取り | 1 回目は `completed: true`、2 回目は `false`。受け取りは 409・`QUEST_NOT_COMPLETED` |
| Q1 | `クエストの受け取りは達成の申告と送られた時刻を読まない` | L2 | 進捗 0 で、本文に `"completed":true`・`"progress":999`・`Date` の見出しを付けて受け取る → 進捗を閾値にして同じく受け取る | 1 回目は 409・`QUEST_NOT_COMPLETED`。2 回目は 200 で `claimedAt` がサーバーのいまの時刻（前後 5 秒） |
| Q1 | `クエストはトークンの無い要求に401を返し利用制限を数えない` | L2 | `Authorization` 無しで `GET` と `POST` | 401・`UNAUTHENTICATED`。`rate_limit_counters` に行が無い |
| Q1 | `トークンと違うゲームのクエストはPERMISSION_DENIEDの403を返す` | L2 | `quest-game` のトークンで `gameId=demo-rpg` | 403・`PERMISSION_DENIED` |
| Q1 | `questsを使わない設定のゲームのクエストはNOT_FOUNDの404を返す` | L2 | `quests` の無いゲームのトークンで `GET` と `POST` | 404・`NOT_FOUND` |
| Q1 | `本番の設定ではクエストの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV=disabled` で `GET` と `POST` | どちらも 403・`NOT_READY_FOR_PRODUCTION`。何も書かない |
| Q1 | `クエストの操作を上限より多く呼ぶと429とRetry-Afterを返す` | L2 | `quests`・`quest-game:p1` に `count = 60` を入れて `POST` | 429・`RATE_LIMITED`・`Retry-After`。何も書かない |
| Q1 | `BANしたプレイヤーのクエストの一覧と受け取りはPLAYER_BANNEDの403を返し何も書かない` | L2 | `player_bans` に行を入れて `GET` と `POST` | どちらも 403・`PLAYER_BANNED`。受け取りの行が増えない |
| Q1 | `クエストの閾値は1より小さくも上限より大きくもできない` | L2 | 宣言の行を入れてから、`quests` に `threshold = 0` と `MAX_PLAYER_DATA_VALUE + 1` を直に入れる | どちらも D1 が断る（`CHECK`） |
| Q1 | `クエストの一覧と受け取りの応答はスキーマに合う` | L2 | `GET` の 200・`POST` の 200・404・409（3 つのコード） | `openapi/rpg-online.v1.json` の応答の形に合う |
| Q1 | `クエストの利用制限の回数と窓は定数のモジュールにある` | L1 | `RATE_LIMITS.quests` | `{ scope: 'quests', limit: 60, period: 60 }` |
| Q1 | `CLIモックと同じ流れでクエストを達成して報酬を受け取り二回目は二重にならない` | L2 | `scripts/cli-requests.mjs` の関数で demo-rpg のゲスト → `slimes-defeated` に 1 → 一覧 → `first-hunt` を受け取る → もう一度 → 一覧 | 一覧の `first-hunt` が `completed: true`。受け取りは 2 回とも 200 で同じ `claimId`。`gold` は 50 増えたまま・最後の一覧で `claimed: true` |
| Q1 | `スキーマのErrorCodeの列挙は19個のエラーコードと一致する` | L1 | スキーマの `ErrorCode` | `errorCodes`（いまの 17 個と `QUEST_NOT_COMPLETED`・`QUEST_NOT_ACTIVE`）と同じ |
| Q1 | `スキーマのファイルはOpenAPI 3.1で19個の操作を持つ` | L1 | スキーマの操作 | いまの 17 個と `listQuests`・`claimQuest` |
| Q1 | `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない` | L1 | `modules` | 8 つの名前・ルートが重ならない |
| Q1 | `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsを使う設定で登録される` | L2 | demo-rpg の `game_modules` | 8 つ（名前の順） |
| Q2 | `デイリーのクエストの進捗はその日の区切りに増やした分だけを数える` | L2 | 区切りを宣言した `add` のキーの合計を 10 にしてから（前の日の区切りの行を直に入れる）、今日 2 を足して一覧 | `progress` が 2（合計の 12 でない）。`periodKey`・`nextResetAt` がある |
| Q2 | `区切りが変わるとデイリーのクエストの進捗は0から数え直し前の区切りの値は残る` | L2 | 前の日の区切りの値を閾値以上で入れ、今日は書かずに一覧 | `progress` が 0・`completed: false`。前の日の行は残る |
| Q2 | `デイリーのクエストは区切りごとに1回受け取れ同じ区切りでは二重にならない` | L2 | 前の日の受け取りの行を入れ、今日の進捗を閾値にして 2 回受け取る | 2 回とも 200 で同じ `claimId`（前の日の行と違う）。今日の分の付与は 1 回 |
| Q2 | `週間のクエストの進捗は時差の月曜0時からの増加を数える` | L1 | `periodKey('weekly', now, offset)` を区切りの値の鍵に使う関数に、時差の日曜 23:59 と月曜 0:00 の `now` | 2 つの鍵が別の週になる（`event-reward-design.md` §4 の例と同じ値） |
| Q2 | `区切りを宣言したキーの書き込みは区切りの値も同じbatchで増え送り直しで二重に数えない` | L2 | 同じ `Idempotency-Key` で `add` を 2 回 | 合計も区切りの値も 1 回分。`player_data_period_values` は 1 行 |
| Q2 | `上限を超える書き込みは区切りの値も書かない` | L2 | 合計を `max_value` − 1 にしてから 2 を足す | 409・`PLAYER_DATA_LIMIT_EXCEEDED`。区切りの値の行が増えない |
| Q2 | `区切りを宣言していないキーの書き込みは区切りの値を作らない` | L2 | 区切りの宣言の無い `add` のキーに書く | 200。`player_data_period_values` に行が無い |
| Q2 | `一度きりのクエストの進捗は区切りの値でなくいまの値を見る` | L2 | 区切りを宣言したキーを見る `once` のクエストで、前の日の書き込みと今日の書き込み | `progress` が合計 |
| Q2 | `区切りのあるクエストの応答はスキーマに合う` | L2 | `daily`・`weekly` のクエストの一覧と受け取りの 200 | `openapi/rpg-online.v1.json` の応答の形に合う |
| Q3 | `管理の口でクエストを定義するとプレイヤーの一覧に出て監査に前と後が残る` | L2 | `PUT /v1/admin/quests/{questId}` → 定義を変えてもう一度 → ゲストのトークンで一覧と監査を読む | 一覧に後の定義で出る。監査に `quest.put`・1 回目は前が `null`・2 回目は前と後の定義 |
| Q3 | `宣言の無いキーか品目を使うクエストの定義はNOT_FOUNDの404を返し何も書かない` | L2 | 無いキー・無い品目で `PUT` | どちらも 404。`quests`・監査が変わらない |
| Q3 | `受け取りのあるクエストの区切りと見るキーは変えられない` | L2 | 受け取りの行のあるクエストの `kind`・`startsAt`・`resetOffsetMinutes`・`key` を変える → `endsAt`・`threshold`・`rewards` だけを変える | 前の 4 つは 400・`INVALID_ARGUMENT`。後は 200 |
| Q3 | `デイリーのクエストの定義は増やすキーだけを受け付け区切りの数え方を宣言する` | L2 | `set` のキーで `daily` → `add` のキーで `daily` | 前は 400。後は 200 で `player_data_key_periods` に行が入る |
| Q3 | `時差の違う区切りを同じキーに宣言するクエストの定義は400を返す` | L2 | 時差 0 のデイリーのあるキーに、時差 540 のデイリーのクエストを `PUT` | 400・`INVALID_ARGUMENT`。何も書かない |
| Q3 | `管理で値を下げるとデイリーのクエストの区切りの値も新しい値で頭打ちになる` | L2 | 区切りの値が 5 のプレイヤーの合計を管理で 2 に直し、一覧を読む → 合計を 10 に直す | 1 回目の後は区切りの値が 2・`progress` が 2。2 回目の後も区切りの値は 2（上げない）。監査に `player-data.set` |
| Q3 | `クエストの定義が上限の数を超えると400を返す` | L2 | `MAX_QUESTS` 個を入れてから新しいクエストを `PUT`・既存のクエストを `PUT` | 新しいのは 400。既存の置き換えは 200 |
| Q3 | `管理の読み取りはプレイヤーのクエストの受け取りを新しい順に返す` | L2 | 受け取りの行のあるプレイヤーと無いプレイヤーを `GET /v1/admin/players/{playerId}` | `questClaims` が新しい順。無い人は空の配列 |
| Q3 | `本番の設定ではクエストの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | `APP_ENV: 'disabled'` と正しい管理の鍵で `PUT` | 403・何も書かない |
| Q3 | `クエストの管理の口の応答は管理のスキーマに合う` | L2 | `PUT` の 200・400・404 と、プレイヤーを読む口の 200 | `openapi/rpg-online-admin.v1.json` に合う |
| Q3 | `管理コマンドと同じ流れでクエストの定義と受け取りが監査と受領の履歴に残る` | L2 | `scripts/admin-requests.mjs` の関数で、クエストの定義 → ゲストが値を書いて受け取る → プレイヤーを読む → 監査を読む | 各手順の応答が §8 のとおり。`questClaims` に受け取り・`history` に `quest-claim`・監査に `quest.put` |

数（行）: Q1 が 26・Q2 が 9・Q3 が 11。

## 11. 挙動が変わる既存の試験と、直す手続き

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `スキーマのErrorCodeの列挙は17個のエラーコードと一致する` | Q1 | コードが 19 個になり、名前の「17個」が嘘になる（名前の中の数で挙動が変わる） | 消して、§10 の `スキーマのErrorCodeの列挙は19個のエラーコードと一致する` に置き換える。`errorCodes` に 2 つ足す |
| `スキーマのファイルはOpenAPI 3.1で17個の操作を持つ` | Q1 | 操作が 19 個になる | `…19個の操作を持つ` に置き換える（前の名前は残さない） |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataでルートが重ならない` | Q1 | 名前の中の機能の一覧が変わる | `…とplayer-dataとquestsで…` に置き換える |
| `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataを使う設定で登録される` | Q1 | マイグレーションで demo-rpg に機能が足される | `…とplayer-dataとquestsを使う…` に置き換える |
| `利用制限の回数と窓は定数のモジュールにある`（`test/rate-limits.test.ts`） | Q1 | `RATE_LIMITS` を `toEqual` で比べているので、`quests` を足すと落ちる | 名前は変えず、期待に `quests` の行を足す（いまの 7 行は変えない）。§10 の `クエストの利用制限の回数と窓は定数のモジュールにある` が足した行を別に見る |
| `受領の履歴の種類の名前は台帳のモジュールの1か所にある`（`test/admin.test.ts`） | Q1 | `LEDGER_SOURCES` を `toEqual` で比べているので、`questClaim` を足すと落ちる | 名前は変えず、期待に `questClaim` の行を足す（いまの 2 行は変えない） |
| `エラーの応答はスキーマに書いた状態とエラーコードの組で返る`（`test/schema-conformance.test.ts`） | Q1 | 全部のコードを 1 回ずつ出す試験で、2 つの新しいコードが出ないと落ちる | 名前は変えず、`claimQuest` で 2 つの 409 を起こす行を足す。いまの行と期待は変えない |
| `PLAYER_BANNEDの応答はスキーマに合う`（`test/bans.test.ts`） | Q1 | スキーマの 401 を持つ操作の一覧と試験の要求の表を `toEqual` で比べるので、2 つの操作を足すと落ちる | 名前は変えず、要求の表に `listQuests`・`claimQuest` の 2 行を足す（確かめる中身を弱めない） |
| `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない`（`test/failure-server.test.ts`） | Q1 | CLI モックの流れにクエストの手順が足される | 流れにクエストの 4 回を足し、期待の件数を 32 から 40 にする（「全部 200」は変えない。見る範囲が増える） |
| `今のCLIモックと同じ形の要求を受け付ける`（`test/failure-server.test.ts`） | 全部 | **変わらない**（いまの要求の形を変えない。クエストの手順は流れの後ろに足すだけ） | 変えない。API を変えたら CLI モックも直す合図のまま。Q1〜Q3 の `requireTests` に入れて見張る |
| `CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける` | Q2 | **変わらない**（区切りの値の文を足しても、書き込みの応答と `GET /v1/player-data` の形は変えない） | 変えない。Q2 の `requireTests` に入れて見張る |
| イベントの区切りの試験（`test/events.test.ts` の `periodKey`・`nextResetAt` を見る試験） | Q2 | **変わらない**（関数を `src/core/period.ts` へ移すだけで中身を変えない。試験の読み込み先だけ直す） | 期待を変えない。Q2 の `requireTests` に `同じ期間の受け取りを並べて送っても付与は1回分` と `CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない` を入れて見張る |
| `管理のスキーマの操作は管理のルートと1対1で対応する` | Q3 | **変わらない**（名前に数が無い。ルートとスキーマに同じ 1 つを足す） | 直さない。Q3 の `requireTests` に入れる |
| `管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する` | Q3 | **変わらない**（管理の口に新しいコードを足さない。§8） | 直さない。Q3 の `requireTests` に入れる |
| `管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない` | Q3 | **変わらない**（欄ごとに見ていて、`questClaims` の欄を足しても落ちない） | 直さない。Q3 の `requireTests` に入れて見張る |
| `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` | Q3 | **変わらない**（`smoke` の流れを変えない。§8） | 直さない。Q3 の `requireTests` に入れる |
| `マイグレーションを2回当ててもデータは壊れない` | Q1・Q2 | 変わらない（`0015`・`0016` は `IF NOT EXISTS`・`INSERT OR IGNORE` だけ） | 変えない |

置き換えは `docs/guides/decisions/test-plan.md` §11 の手続き（名前の嘘を直すだけで、確かめる中身を弱めない）。

## 12. `scripts/cli-mock.mjs` の通しのシナリオ（Q1）

API を変えたら CLI モックも合わせる（`CLAUDE.md` のプロジェクトの決まり）。いまの流れ（健康 → 設定 → お知らせ → ゲスト → スコア → セーブ → イベントと所持品 → プレイヤーデータと実績）は**変えず、最後に足す**ので、いまの `npm run cli:smoke` は壊れない（`0015` を当てていない DB で 404 になったときは飛ばさず `HTTP 404` で止まる。demo-rpg は `0015` で `quests` を使う設定になるので、404 はマイグレーションの当て忘れを知らせる失敗として扱う。イベント・プレイヤーデータと同じ扱い）。

足す手順（同じゲストのトークン。プレイヤーデータの手順で `slimes-defeated` が 1 になった後。§13 の決めること 14）:

1. `GET /v1/quests?gameId=demo-rpg` → 200・`first-hunt` が `progress: 1`・`completed: true`・`claimed: false`。
2. `POST /v1/quests/first-hunt/claim?gameId=demo-rpg` → 200・`grants` に `gold` 50。
3. 同じ要求をもう一度 → 200 で 2 と同じ本文（`claimId` も）。
4. `GET /v1/quests?gameId=demo-rpg` → `first-hunt` が `claimed: true`。

- ゲストは回すたびに新しいので、毎回受け取れる。
- 要求の形の関数（`questsPath`・`questClaimPath` と手本の ID `SMOKE_QUEST_ID` に当たるもの）を `scripts/cli-requests.mjs` に足し、§10 の `CLIモックと同じ流れでクエストを達成して報酬を受け取り二回目は二重にならない` が同じ関数を使う。
- 利用制限: 1 回の通しで `quests` を 4 回（60 回／分の内）。
- Q2 の手本のデイリーのクエスト `daily-slimes`（閾値 3）は、通しの書き込みが 1 なので一覧に `completed: false` で載るだけ（CLI モックは見ない。手順を足さない）。
- `scripts/admin-cli.mjs` の `smoke` は変えない（§8）。

## 13. 決めること

推しの案で §2〜§12 を書いた。違う案にするときは、該当する節と §10 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | クエストの定義の置き場 | A: **サーバーの表 `quests`・`quest_rewards`（管理の口で入れる。実績の `achievements`・イベントの `events` と同じ形）。名前・説明はマスターデータ**。B: マスターデータの JSON にキー・閾値・報酬も置き、サーバーが読む。C: 定義を持たない（クライアントが「達成した」と報酬を申告する） | **A**。サーバーが判定（閾値）と付与（報酬）に使う数は、サーバーの表に置く。B はマスターデータを解釈しない決定（`config-design.md`）を崩し、配ったマスターデータの版と判定がずれうる。C は報酬を申告で受け取れ、守りが無い |
| 2 | 達成条件の形と数の上限 | A: **キー 1 つと閾値（実績と同じ形）。前のクエストの条件は持たない。1 ゲーム 200 個（`MAX_QUESTS`）**。B: 複数の条件（`quest_conditions` の行。全部満たす）。C: A に前のクエストを終えていることの条件を足す | **A**。`player-data-design.md` §15 の前提のままで、判定の文が 1 つの比べで済む。「スライム 3 体と章 2」のような条件は、作者が 1 つのキー（`flag`）にまとめて書ける。B は条件の行の数だけ文が増え、条件の行を足す表で後から足せる（§16）。C は物語の分岐で、クライアントが一覧を出し分ければ足り、サーバーで止めると受け取りの順の守りが要る（§16）。200 は `MAX_PLAYER_DATA_KEYS` と揃え、一覧の応答の大きさを抑える |
| 3 | 進捗の持ち方 | A: **キーのいまの値を読むだけ（一度きり）・区切りの値を読むだけ（デイリー・週間）。クエストを「受ける」操作は作らない**。B: クエストを受ける口を作り、受けた時の値を覚えて差を進捗にする（`player_quests` の表）。C: クエストごとに進捗の表を持ち、プレイヤーデータの書き込みのたびに足す | **A**。プレイヤーデータを正にする決定（`player-data-design.md` §2）のままで、正が 1 つ。B は受ける口・表・試験が増え、「受ける前に倒した分を数えない」が要るゲームは、クエストの期間（`startsAt`）か区切りで表せる。C はクエストの数だけ書き込みの文が増え、プレイヤーデータの機能がクエストの表に書く |
| 4 | デイリー・週間の区切りの値 | A: **区切りの値の表 `player_data_period_values` を足し、区切りの宣言はキーの側の新しい表 `player_data_key_periods`（クエストの定義の口が入れる）。区切りの決め方はイベントと同じ（サーバーの時刻・時差の 0 時）。今回の範囲に入れ、束を分ける（Q2）**。B: 区切りの宣言をクエストの側に持ち、書き込みの時にクエストの表を引いて区切りの値を書く。C: 今回は一度きりのクエストだけにして、区切りを後に回す | **A**。デイリーの進捗は「その区切りに増えた分」で、合計の値からは作れない（区切りの始まりの値を覚えていない）。値はプレイヤーデータの機能の表に置き、クエストのモジュールは読むだけにすると、書くモジュールが 1 つのまま。宣言をキーの側に持つと、同じキーを見るクエストが何個あっても値は 1 つ。`player_data_keys` に列を足すと `ALTER TABLE` か表の作り直しになるので別の表。B はプレイヤーデータの書き込みがクエストの表を引き、機能の境目が崩れる。C はロードマップの「デイリー／週間」と Issue の範囲（デイリー・週間・期間つき）に届かない。Q1 を一度きりで先に通し、区切りを Q2 に分けて束を小さくする |
| 5 | 達成の判定の時 | A: **受け取りの口の中（`batch` の文 1 の条件。一覧はその時の値で計算するだけ）**。B: プレイヤーデータの書き込みの `batch` の中で、実績の文の隣に達成の行を書く（`player-data-design.md` §15 の検討の形）。C: Cron Triggers でまとめて判定する | **A**。プレイヤーデータの機能がクエストの表に書かず、クエストを使わないゲームの書き込みに文が足されない。判定と付与が同じ文の中なので、読んでから書くまでに値が動いてもずれない。B は「達成したが受け取っていない」の行が増え、値が下がったときの扱い（行を消すか）が要る。C は応答で達成を返せず、`wrangler.jsonc` を変える |
| 6 | 報酬の受け取り方と二重の止め | A: **受け取りの口（`POST /v1/quests/{questId}/claim`）。一意の鍵（プレイヤー・クエスト・区切り）と 1 つの `batch`。2 回目は 200 で同じ本文。`Idempotency-Key` は読まない**。B: 達成と同時に付与する（プレイヤーデータの書き込みの中で）。C: 受け取りの口で、`Idempotency-Key` を必須にする | **A**。イベントの受け取り（`event-reward-design.md` §5）と同じ形で、クライアントの作り（応答が届かなければ送り直すだけ）が揃う。受け取りには自然な鍵があり、見出しは要らない（`abuse-protection-design.md` §5 の決まり）。B はプレイヤーデータの書き込みが所持品の表に書き、受け取りの演出をクライアントが出す時を選べない。C は自然な鍵で足りる所に、鍵の保存の表と 422 が増える |
| 7 | 受け取りの 3 文を `src/core/ledger.ts` へ移すか（`admin-design.md` §11 の決めること 7 の続き） | A: **移さない。クエストの受け取りの 3 文はクエストのモジュールに置き、種類の名前だけ `LEDGER_SOURCES.questClaim` を読む。イベントの 3 文は変えない**。B: 受け取りの 3 文を、報酬の表・受け取りの表の名前を引数にした 1 つの関数にして ledger.ts へ移し、イベントもそれを使う。C: 受け取りの表を 1 つ（`reward_claims` に `source_type` の列）にまとめる | **A**。イベントの受け取りの文とその試験に手を入れずに済み、束が小さい。文 1 の条件（期間・進捗）が受け取りの種類で違い、1 つの関数にすると条件の分岐が引数に入るだけ。書く所は 3 つになるが、種類の名前は 1 か所のまま。B は 4 つ目の受け取り（消費の口など）を足すときに、3 つの形を見比べてから決める（§16）。C は既存の `event_claims` を移すマイグレーションが要る |
| 8 | 新しいエラーコード | A: **`QUEST_NOT_COMPLETED`（409）と `QUEST_NOT_ACTIVE`（409）の 2 つを、ゲームのクライアントのスキーマ `openapi/rpg-online.v1.json` に足す。管理のスキーマには足さない**。B: 期間の外は `EVENT_NOT_ACTIVE` を使い回し、`QUEST_NOT_COMPLETED` だけ足す。C: どちらも 409 `PERMISSION_DENIED` などの既存のコード | **A**。クライアントはコードだけで画面の文を出し分ける（「まだ達成していません」と「期間が終わりました」）。B は「イベント」と書いたコードがクエストで返り、名前が嘘になる。C は状態の 409 を権限の誤りと区別できない。管理の口は 400・404 だけで足りる |
| 9 | 管理の口 | A: **クエストの定義の口（`PUT /v1/admin/quests/{questId}`。イベントの定義と同じ形・監査に前と後）と、プレイヤーを読む口に `questClaims` の欄。受け取りを直す口は作らない。値の直しは区切りの値を頭打ちにする（§8）**。B: A に受け取りの行を消す口（もう一度受け取れるようにする）を足す。C: マイグレーションで定義を入れ、管理の口を足さない | **A**。運営で要るのは「クエストを入れる・期間を変える・報酬を変える」と「受け取ったかを見る」。間違った付与は今ある増減の口（`revoke`）で戻せ、進捗は値の直し（`set-data`）で戻せる。B は受け取りの行を消すと履歴の `source_id` が指す先が消え、同じ区切りで二重に受け取れる道を作る。要るときは監査に前と後を残す形で後から足す（§16）。C は運営のたびにマイグレーションを書く（`admin-design.md` §11 の決めること 8 の A と同じ穴） |
| 10 | 機能の名前と、ほかの機能への依存 | A: **`quests` の 1 つ。`requireGame` は `quests` だけを見る（`player-data`・`inventory` を使わない設定でも口は通る）**。B: `quests` に加えて `player-data` と `inventory` も使う設定のときだけ通す（どれかが無ければ 404）。C: 管理の定義の口が、`player-data`・`inventory` を使わないゲームのクエストを断る | **A**。表はどのゲームにもあり、機能の設定は認可の代わりにしない（`core-foundation-design.md` の決定のまま）。使わない組み合わせは「進まない・読めない」だけで壊れない。B は `requireGame` に機能の組み合わせの決まりが入り、ほかの機能も同じことを言い出す。C は管理の口が機能の設定を見ない決まり（`admin-design.md` §2）を崩す |
| 11 | 利用制限 | A: **新しい `RATE_LIMITS.quests`（プレイヤーごと、2 つの口を合わせて 60 秒に 60 回）**。B: `rewards`（所持品・イベント）と同じ回数を分け合う | **A**。クエストの一覧を開くたびに所持品・イベントの口の回数が減らない。数は `rewards`・`playerData` と同じ。B は口を足すたびに既存の口の回数の意味が変わる |
| 12 | 自己申告をどこまで信じるか | A: **プレイヤーデータの守り（宣言・範囲・`max_delta`・書き方の固定・利用制限）に任せ、クエストは「達成した」の申告を読まない。限界は §5 にそのまま書く**。B: 受け取りの時に、書き込みの記録から「区切りの中で何回に分けて書いたか」などを見て怪しい受け取りを断る。C: クエストの報酬を持たない（達成の印だけ） | **A**。値がゲームの中で取れたかはゲーム固有のルールで、共通のサーバーは確かめられない（ADR 0002）。B は「怪しい」の基準がゲームごとに違い、正しい遊び方を断る。C はロードマップの「報酬」に届かない。不正は管理（値の直し・品目の取り消し・BAN）で対処する |
| 13 | Cron Triggers・Durable Objects を使うか | A: **使わない（区切りは要求の時に計算・D1 の `batch` と一意の鍵だけ）**。B: 日替わりに Cron Triggers で区切りの値を 0 にする。C: プレイヤーごとの Durable Object で受け取りを順に処理する | **A**。`wrangler.jsonc` もパッケージも変えずに済み、時刻の決まった処理が遅れても判定が変わらない（イベントと同じ）。B は全員の行を書き、遅れると前の日の値が残る。C は一意の鍵で足りる二重の止めにクラスと設定を足す |
| 14 | CLI モックに足す手順 | A: **一度きりのクエストの成功の道の 4 手順（一覧 → 受け取る → 同じ要求をもう一度 → 一覧）。断られる例とデイリーは §10 の試験で見る**。B: A にデイリーのクエストの受け取りを足す。C: 足さない（試験だけ） | **A**。プレイヤーデータの手順で増やした値でそのまま達成でき、「進む・受け取る・二重にならない」を 1 回の通しで見せられる。B は通しの書き込みを 3 回に増やすことになり、プレイヤーデータの手順（値が 1 になる）の確かめを変える。C は `npm run cli:smoke` で人が通しを見られない |
| 15 | `scripts/admin-cli.mjs` の `smoke` を変えるか | A: **変えない（`put-quest` の操作だけ足し、クエストの管理の通しは §10 の Q3 の試験と、会話の側で人が回す `put-quest` で見る）**。B: `smoke` の最後にクエストの定義とゲストの受け取りを足す | **A**。`smoke` の流れと `SMOKE_AUDIT_ACTIONS` は既存の試験 `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` が見張っていて、変えるとその試験の期待を書き換えることになる。B は管理の通しに値の書き込みと受け取り（ゲームのクライアントの道）が入り、`smoke` が何を確かめるかがぼやける |
| 16 | `LEDGER_SOURCES` に足す名前 | A: **`questClaim: 'quest-claim'`（イベントの `eventClaim: 'event-claim'` と同じ形）**。B: `quest: 'quest'`（`admin-design.md` §13・`event-reward-design.md` §13 が案として書いた名前）。C: イベントと同じ `event-claim` を使い、`source_id` で見分ける | **A**。受領の履歴を読むクライアントと集計（§15 の分析）が、`*-claim` で「受け取り」の種類を揃って見分けられる。B は前の文書の案のままだが、受け取りと管理の増減のどちらの形かが名前から読めない。前の 2 つの行は Q1 でこの設計書を指す形に置き換える（§9）。C は `source_id` から受け取りの表を引き直さないと種類が分からない |
| 17 | パッケージ | A: **足さない（D1・Web Crypto だけ）**。B: 日付の計算のライブラリを足す | **A**。区切りの計算はイベントの関数をそのまま使う。`package.json` を変えない |

## 14. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| Q1 | 一度きりのクエストと受け取り: `migrations/` の新しい `0015_quests.sql`・`src/modules/quests/`（`index.ts`・`shape.ts`）・`src/modules/index.ts` に足す・`RATE_LIMITS.quests`・`LEDGER_SOURCES.questClaim`・2 つのエラーコード・§12 の CLI モックと `scripts/cli-requests.mjs`・§9 の Q1 の文書と契約・§10 の Q1 の試験 | U3（`player-data-design.md`） | §11 の手続きで 4 本を置き換え・4 本に行を足す | 足さない |
| Q2 | デイリー・週間: `migrations/` の新しい `0016_player_data_periods.sql`・`src/core/period.ts`（events から移す。管理の口の写し `EVENT_DEFINITION_KINDS` を core を読む形に置き換える）・プレイヤーデータの書き込みの区切りの値の文・クエストの一覧と受け取りの区切り・§9 の Q2 の文書と契約・§10 の Q2 の試験 | Q1 | 変えない（イベントの区切りの試験は読み込み先だけ） | 足さない |
| Q3 | 管理: `src/core/admin/` にクエストの定義の口とプレイヤーを読む口の欄・値の直しの区切りの値の頭打ち（§8）・`src/core/quests.ts` の `MAX_QUESTS`・`scripts/admin-cli.mjs` と `scripts/admin-requests.mjs` に `put-quest`・管理のスキーマ・§9 の Q3 の文書・§10 の Q3 の試験 | Q2 | 変えない | 足さない |

範囲の外（後の設計書）: §16。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。`gitClean` は `base` を渡さないと作業ツリーしか見ないので、先頭の `base` に**実装の Issue を作るときの main のコミットの SHA** を書き入れる（`docs/guides/procedures/issue-goal-setting.md`）。

Q1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0015_quests.sql', 'src/modules/quests/index.ts', 'src/modules/quests/shape.ts', 'test/quests.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
const mod = read('src/modules/quests/index.ts');
check(/\bconsume\(/.test(mod), 'クエストのモジュールが利用制限（consume）を呼ぶ');
check(/requireNotBanned/.test(mod), 'クエストのモジュールが止めた印を確かめる');
check(/LEDGER_SOURCES\.questClaim/.test(mod), 'クエストの受け取りが種類の名前を LEDGER_SOURCES から読む');
check(/questClaim:\s*'quest-claim'/.test(read('src/core/ledger.ts')), 'LEDGER_SOURCES に questClaim がある');
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
const codes = spec.components?.schemas?.ErrorCode?.enum ?? [];
check(codes.includes('QUEST_NOT_COMPLETED') && codes.includes('QUEST_NOT_ACTIVE'), 'スキーマの ErrorCode に 2 つのコードがある');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(!all.includes('スキーマのErrorCodeの列挙は17個のエラーコードと一致する'), '置き換えた試験が残っていない（17個のコード）');
check(!all.includes('スキーマのファイルはOpenAPI 3.1で17個の操作を持つ'), '置き換えた試験が残っていない（17個の操作）');
check(!all.includes("'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataでルートが重ならない'"), '置き換えた試験が残っていない（モジュールの一覧）');
check(!all.includes("'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataを使う設定で登録される'"), '置き換えた試験が残っていない（demo-rpg の設定）');
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(/\/v1\/quests/.test(mock), 'CLI モックの要求の形がクエストの口を持つ');
check(!mock.includes('/v1/admin') && !mock.includes('ADMIN_API_KEY'), 'CLI モックに管理の口と鍵が無い');
runTests();
requireTests([
  'クエストの一覧の行は進捗と閾値から達成と受け取り済みを決める',
  'クエストの一覧はトークンのプレイヤーの値で進捗と受け取り済みを返す',
  '期間の外のクエストは一覧に出ず受け取りはQUEST_NOT_ACTIVEの409を返す',
  '達成したクエストの報酬を受け取ると所持品が増え受領の履歴にクエストの受け取りとして残る',
  '達成していないクエストの受け取りはQUEST_NOT_COMPLETEDの409を返し何も書かない',
  '一度きりのクエストを2回受け取っても付与は1回分で同じ本文を返す',
  '同じクエストの受け取りを並べて送っても付与は1回分',
  '報酬を足すと所持の上限を超えるクエストの受け取りはINVENTORY_LIMIT_EXCEEDEDの409を返し何も書かない',
  '知らないクエストの受け取りはNOT_FOUNDの404を返す',
  'ほかのプレイヤーの値ではクエストは達成にならない',
  '値で置くキーを閾値より下げると受け取る前のクエストは達成でなくなる',
  'クエストの受け取りは達成の申告と送られた時刻を読まない',
  'クエストはトークンの無い要求に401を返し利用制限を数えない',
  'トークンと違うゲームのクエストはPERMISSION_DENIEDの403を返す',
  'questsを使わない設定のゲームのクエストはNOT_FOUNDの404を返す',
  '本番の設定ではクエストの一覧と受け取りにNOT_READY_FOR_PRODUCTIONの403を返す',
  'クエストの操作を上限より多く呼ぶと429とRetry-Afterを返す',
  'BANしたプレイヤーのクエストの一覧と受け取りはPLAYER_BANNEDの403を返し何も書かない',
  'クエストの閾値は1より小さくも上限より大きくもできない',
  'クエストの一覧と受け取りの応答はスキーマに合う',
  'クエストの利用制限の回数と窓は定数のモジュールにある',
  'CLIモックと同じ流れでクエストを達成して報酬を受け取り二回目は二重にならない',
  'スキーマのErrorCodeの列挙は19個のエラーコードと一致する',
  'スキーマのファイルはOpenAPI 3.1で19個の操作を持つ',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない',
  'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsを使う設定で登録される',
  // 中身に行を足した既存の試験と、変わらないことを見張る既存の試験（§11）
  '利用制限の回数と窓は定数のモジュールにある',
  'エラーの応答はスキーマに書いた状態とエラーコードの組で返る',
  'PLAYER_BANNEDの応答はスキーマに合う',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
  '同じ期間の受け取りを並べて送っても付与は1回分',
  'CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない',
  'CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション・守り・ほかのモジュール・管理を変えない（区切りは Q2・管理は Q3）
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory', '0010_events', '0011_admin', '0012_player_bans', '0013_player_data', '0014_achievements']
  .map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/rate-limit.ts', 'src/core/admin/',
  'src/modules/saves/', 'src/modules/config/', 'src/modules/rankings/', 'src/modules/announcements/', 'src/modules/inventory/',
  'src/modules/events/', 'src/modules/player-data/', 'scripts/admin-cli.mjs', 'scripts/admin-requests.mjs', 'scripts/issue-run/',
  'openapi/rpg-online-admin.v1.json', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

Q2:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0016_player_data_periods.sql', 'src/core/period.ts'];
mustExist(files);
gitTracked(files);
check(!existsSync('src/modules/events/period.ts'), '区切りの関数は core の 1 か所にある（events の写しが残っていない）');
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/player_data_period_values/.test(read('src/modules/player-data/index.ts')), 'プレイヤーデータの書き込みが区切りの値を書く');
check(/player_data_period_values/.test(read('src/modules/quests/index.ts')), 'クエストのモジュールが区切りの値を読む');
check(!/from '\.\.\/player-data|from '\.\.\/events|from '\.\.\/inventory/.test(read('src/modules/quests/index.ts')), 'クエストのモジュールがほかのモジュールを読み込まない');
runTests();
requireTests([
  'デイリーのクエストの進捗はその日の区切りに増やした分だけを数える',
  '区切りが変わるとデイリーのクエストの進捗は0から数え直し前の区切りの値は残る',
  'デイリーのクエストは区切りごとに1回受け取れ同じ区切りでは二重にならない',
  '週間のクエストの進捗は時差の月曜0時からの増加を数える',
  '区切りを宣言したキーの書き込みは区切りの値も同じbatchで増え送り直しで二重に数えない',
  '上限を超える書き込みは区切りの値も書かない',
  '区切りを宣言していないキーの書き込みは区切りの値を作らない',
  '一度きりのクエストの進捗は区切りの値でなくいまの値を見る',
  '区切りのあるクエストの応答はスキーマに合う',
  // Q1・プレイヤーデータ・イベントの挙動と CLI モックの互換を見張る（§11）
  '一度きりのクエストを2回受け取っても付与は1回分で同じ本文を返す',
  '同じクエストの受け取りを並べて送っても付与は1回分',
  '同じIdempotency-Keyの書き込みを2回送っても1回分で同じ本文を返す',
  '同じ期間の受け取りを並べて送っても付与は1回分',
  'CLIモックと同じ流れでイベントの報酬を受け取り二回目は二重にならない',
  'CLIモックと同じ流れで統計値を増やし送り直しても二重にならず実績が解ける',
  'CLIモックと同じ流れでクエストを達成して報酬を受け取り二回目は二重にならない',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション（0015 まで）・守り・ほかのモジュール・管理・CLI モックを変えない
const migrations = ['0001_initial', '0002_games', '0003_game_modules', '0004_accounts', '0005_saves', '0006_config', '0007_config_master_data',
  '0008_rate_limits', '0009_inventory', '0010_events', '0011_admin', '0012_player_bans', '0013_player_data', '0014_achievements',
  '0015_quests'].map((m) => `migrations/${m}.sql`);
const keep = [...migrations, 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/rate-limit.ts', 'src/core/rate-limit-policy.ts',
  'src/core/ledger.ts', 'src/modules/saves/', 'src/modules/config/', 'src/modules/rankings/', 'src/modules/announcements/',
  'src/modules/inventory/', 'scripts/', 'openapi/rpg-online-admin.v1.json', 'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

Q3:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['src/core/quests.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
check(/quest\.put/.test(read('src/core/admin/routes.ts')), '管理の口がクエストの定義を監査に残す');
check(/MAX_QUESTS/.test(read('src/core/quests.ts')), 'クエストの数の上限が core の 1 か所にある');
const requests = ['scripts', 'admin-requests.mjs'].join('/');
check(/\/v1\/admin\/quests/.test(read(requests)), '管理コマンドがクエストの定義の口を呼ぶ');
const mock = read('scripts/cli-mock.mjs') + read('scripts/cli-requests.mjs');
check(!mock.includes('/v1/admin') && !mock.includes('ADMIN_API_KEY'), 'CLI モックに管理の口と鍵が無い');
runTests();
requireTests([
  '管理の口でクエストを定義するとプレイヤーの一覧に出て監査に前と後が残る',
  '宣言の無いキーか品目を使うクエストの定義はNOT_FOUNDの404を返し何も書かない',
  '受け取りのあるクエストの区切りと見るキーは変えられない',
  'デイリーのクエストの定義は増やすキーだけを受け付け区切りの数え方を宣言する',
  '時差の違う区切りを同じキーに宣言するクエストの定義は400を返す',
  '管理で値を下げるとデイリーのクエストの区切りの値も新しい値で頭打ちになる',
  'クエストの定義が上限の数を超えると400を返す',
  '管理の読み取りはプレイヤーのクエストの受け取りを新しい順に返す',
  '本番の設定ではクエストの管理の口にNOT_READY_FOR_PRODUCTIONの403を返す',
  'クエストの管理の口の応答は管理のスキーマに合う',
  '管理コマンドと同じ流れでクエストの定義と受け取りが監査と受領の履歴に残る',
  // 管理とゲームのクライアントが変わらないことを見張る（§11）
  '管理の読み取りはプレイヤーの所持品と履歴とセーブの一覧とスコアを返しセーブの中身は返さない',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  '管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る',
  '管理コマンドと同じ流れでプレイヤーデータの宣言と直しと実績の取り消しが監査に残る',
  'CLIモックと同じ流れでクエストを達成して報酬を受け取り二回目は二重にならない',
  '今のCLIモックと同じ形の要求を受け付ける',
]);
// マイグレーション（全部）・ゲームのクライアントのスキーマ・CLI モック・守り・モジュールを変えない（Q3 は表を足さない）
const keep = ['migrations/', 'openapi/rpg-online.v1.json', 'scripts/cli-mock.mjs', 'scripts/cli-requests.mjs', 'scripts/cli-requests.d.mts',
  'scripts/issue-run/', 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/bans.ts', 'src/core/ledger.ts', 'src/core/period.ts', 'src/modules/',
  'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（`CLAUDE.md` の進め方の決まり）。
- 通しの確かめ（`npm run cli:smoke` と管理コマンド）は確認コマンドに入れない（無人の回では開発サーバーを起動せず、管理の鍵をファイルに書かない）。Q1・Q3 の後に会話の側で回す（§0）。

## 15. Phase 2 の残りの項目（分析）との関係

`event-reward-design.md` §13 の順（管理 → プレイヤーデータ → クエスト → 分析）のまま。この設計書で、Phase 2 の残りは分析（DAU・継続率）・バックアップ・費用アラートだけになる。分析の設計は分析の設計書（`event-reward-design.md` §13 の名前の案は `analytics-design.md`）でやり、ここには渡すものだけを書く。

| 項目（`roadmap.md` Phase 2） | この設計が渡すもの |
| --- | --- |
| 分析（DAU・継続率）・バックアップ・費用アラート | 受け取りの行 `quest_claims`（プレイヤー・クエスト・区切り・時刻）は、クエストごとの達成率・デイリーのクエストを毎日受け取る人の数（継続の目安）の集計の元になる。受領の履歴の `source_type = 'quest-claim'` の行は、クエストで配った品目の量の集計の元になる。区切りごとの値 `player_data_period_values` と受け取りの行は区切りごとに増えるので、区切りの値は 35 日で掃除が消し、受け取りの行は消さない（`docs/guides/working/analytics-design.md` §6）。バックアップ（D1 の復元）と費用アラートはこの設計と関係しない |

## 16. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| 複数の条件（全部満たす・どれか満たす） | `quest_conditions(game_id, quest_id, key, threshold)` を足し、受け取りの文 1 の条件を「満たさない条件の行が無い」にする。いまの `quests.key`・`threshold` は 1 つ目の条件として残す |
| 前のクエストを終えていることの条件（連なるクエスト） | `quest_requirements(game_id, quest_id, required_quest_id)` を足し、文 1 に受け取りの行の `EXISTS` を足す。それまではクライアントが一覧を出し分ける |
| 区切りの中の最大値・最小値（今日の一番深い階・最速の時間） | `player_data_key_periods` に書き方の列を持つ新しい表を足す（`ALTER TABLE` を使わない）。いまは `add` だけ |
| 受け取りを消す・やり直させる管理の口 | 監査に前と後を残し、受領の履歴は消さずに管理の増減で戻す形で（§13 の決めること 9） |
| 受け取りの 3 文の共通化 | 4 つ目の受け取り（消費・交換の口など）を足すときに、イベント・クエストの形を見比べて `src/core/ledger.ts` へ移すかを決める（§13 の決めること 7） |
| 宣言の前の書き込みを区切りの値にさかのぼって数える | しない（宣言の後から数える）。要るゲームはクエストの期間を宣言の後から始める |
| 区切りの値をプレイヤーに見せる口（`GET /v1/player-data` の欄） | クエストの一覧の `progress` で足りる間は足さない。要るなら欄を足す（形を壊さない） |
| 自動の受け取り（達成と同時に付与・メールボックス） | 受け取りの口を残したまま、プレゼントボックスの設計（Phase 2 の外）で |
| 不正な達成の自動の検出 | ゲームごとに基準が違う（ADR 0002）。管理の読み取りで見て、値の直し・品目の取り消し・BAN で対処する |
| 管理画面（ブラウザ）でのクエストの編集 | Phase 4（`admin-design.md` §14） |
| 古い受け取りの行・区切りの値の掃除 | 区切りの値は 35 日で消す。受け取りの行は消さない（二重の止めの鍵。`docs/guides/working/analytics-design.md` §6・§7） |
| `APP_ENV` の守りを外すこと | ユーザーが決める（`admin-design.md` §10） |

## 17. 指示の表

| Issue #42 の指示 | どこで答えるか |
| --- | --- |
| クエストの定義の置き場（管理の口で入れる表か、マスターデータか）と達成条件の形（キー 1 つと閾値か、複数か）・前のクエストの条件・数の上限 | §2・§3・§13 の決めること 1・2 |
| 進捗の持ち方（キーのいまの値を読むだけか、クエストごとの表か）・受ける操作 | §4・§5・§13 の決めること 3 |
| デイリー・週間・期間つきのクエストの区切りごとの値（`period_key` を持つ値・宣言をどちらに持つか・今回の範囲か） | §3・§6・§7・§13 の決めること 4 |
| 達成の判定の時と、報酬の受け取り方 | §5・§13 の決めること 5・6 |
| 報酬の付与と二重の止め方・`LEDGER_SOURCES` に足す名前・受け取りの文を `src/core/ledger.ts` へ移すか | §6・§13 の決めること 6・7・16 |
| API とその確かめの順・認証・`APP_ENV`・BAN・利用制限・`game_modules` の機能の名前とほかの機能への依存 | §4・§9・§13 の決めること 10・11 |
| 管理との関係（定義の口・プレイヤーを読む・直す・監査） | §8・§13 の決めること 9 |
| `scripts/cli-mock.mjs` と `scripts/admin-cli.mjs` の通しのシナリオ | §8・§12・§13 の決めること 14・15 |
| 試験の名前（束は `Q1`・`Q2`…）・名前の中の数の試験・互換と管理の通しと管理のエラーコードの試験 | §10・§11 |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §14 |
| 新しいエラーコードはどちらのスキーマに入るか | §9・§13 の決めること 8 |
| Cloudflare の数字・機能は公式で確かめたか「要確認」・D1 のバインドの上限 | §1・§6 |
| Phase 2 の残りの項目（分析） | §15 |
| 新しいパッケージは足さない案を推し | §13 の決めること 17 |
| 管理の通しは管理の鍵を `--var` で渡す前提・開発サーバーを起動しない | §0・§8・§14 |
