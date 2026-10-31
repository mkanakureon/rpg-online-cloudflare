# 分析（DAU・継続率）・バックアップ・費用アラートの設計書

`docs/guides/decisions/roadmap.md` Phase 2 の最後の項目「分析（DAU・継続率）・バックアップ・費用アラート」の設計書。`docs/guides/working/event-reward-design.md` §13 が順 4 に置いた（順 1 の管理は `docs/guides/working/admin-design.md`、順 2 のプレイヤーデータは `docs/guides/working/player-data-design.md`、順 3 のクエストは `docs/guides/working/quest-design.md` で済んだ）。これまでの設計書が分析へ渡したもの（`admin-design.md` §13 の監査のログの 365 日の保持と掃除・`player-data-design.md` §15 の書き込みの記録の掃除と DAU の元・`quest-design.md` §15 の受け取りの行と区切りの値の掃除と達成率の元）を前提にする。

「遊んだ」の定義と記録の置き場・日の区切り・継続率の定義と集計の形（要求の時か Cron Triggers か・D1 か Workers Analytics Engine か）・読む口（管理の口と `scripts/admin-cli.mjs`）と個人を出さない決まり・掃除する表ごとの保持の日数と消し方・`wrangler.jsonc` の `triggers` と `scheduled` の入口とローカルでの確かめ方・バックアップと復元・費用アラートのどこまでをコードにし、どこからを手順書にするか・試験の名前・実装の束を決める。**この設計書では実装しない**（`src/`・`test/`・`migrations/`・`openapi/`・`scripts/`・`wrangler.jsonc` は次の Issue）。

方針の前提は ADR 0002（`docs/adr/0002-engine-agnostic-game-backend.md`。ゲーム固有のルールを共通のサーバーに入れない）と、これまでの設計書の決定: `docs/guides/working/core-foundation-design.md`（`src/core/` と `src/modules/<機能>/`・core はモジュールを読み込まない・機能の設定 `game_modules` は認可の代わりにしない）・`docs/guides/working/account-design.md`（プレイヤーはトークンの `p` だけで決まる・`requireAuth`）・`docs/guides/working/abuse-protection-design.md`（D1 の固定窓の `consume`・`rate_limit_counters`）・`docs/guides/working/event-reward-design.md`（区切り・受領の履歴 `inventory_ledger`）・`docs/guides/working/admin-design.md`（管理の口・監査のログ `admin_audit_log`・`AUDIT_RETENTION_DAYS` の 365 日）・`docs/guides/working/player-data-design.md`（書き込みの記録 `player_data_writes`）・`docs/guides/working/quest-design.md`（受け取りの行 `quest_claims`・区切りの値 `player_data_period_values`）。これらは「決めること」に戻さない。運用の決まりは `docs/guides/decisions/operations-security.md`（6 のログの保持と削除の手順・8 のバックアップと復元演習・9 のコストアラート）。
用語・テストレベル（L1／L2／L3）・合格基準は `docs/guides/decisions/test-plan.md` が正で、ここには写さない。いまの契約の正は `docs/api-contract.md`（挙動の説明）と `openapi/rpg-online.v1.json`（ゲームのクライアントの形）・`openapi/rpg-online-admin.v1.json`（管理の口の形）、いまの挙動の正は `src/`。

## 0. ゴールと合格の条件

### ゴール

開発者（とその代わりに動く無人の Claude）が、§10 の試験の名前を `requireTests` に渡して実装の Issue を N1〜N3 の順に回し、**CLI モック（`scripts/cli-mock.mjs`）を変えずに通しを回すと、ゲストの発行とトークンの要る要求がその日（UTC）の「遊んだ」の行を 1 人 1 日 1 行だけ残し、管理コマンド（`scripts/admin-cli.mjs`）の `analytics` が日ごとの DAU・新しい人の数・D1／D7／D30 の継続の数を、プレイヤー ID を出さずに返し、毎日の Cron Triggers の `scheduled` が保持の日数を過ぎた行だけを表ごとに消し（二重の止めの鍵の行と受領の履歴は消さない）、`analytics-grants` が配った量とクエストの受け取りの数を日ごとに返す**のを §10 の試験で見て、サーバーがゲームの意味（離脱の理由など）を持たずに数だけを持ち、バックアップと復元・費用アラートが Cloudflare の機能と手順書の置き場で決まっていると分かる。

### 合格の条件（この設計書の）

| 合格の条件 | 誰が・どう確かめるか |
| --- | --- |
| §0 にゴールと合格の条件、§13 に決めること（案と推し）、§14 に実装の束、§16 に範囲の外がある | 機械（Issue #46 の確認コマンド） |
| ADR 0002・元の文書（`roadmap.md`・`operations-security.md`・`abuse-protection-design.md`・`event-reward-design.md`・`admin-design.md`・`player-data-design.md`・`quest-design.md`）・`game_modules`・`APP_ENV`・`requireAuth`・`consume`・D1・Cron Triggers・`scheduled`・`wrangler.jsonc`・`AUDIT_RETENTION_DAYS`・掃除の対象の 6 つの表・`scripts/cli-mock.mjs`・`scripts/admin-cli.mjs`・`CLAUDE.md` が出てくる。DAU・継続率・集計・保持・掃除・バックアップ・復元・費用・アラート・個人・要確認の扱いが出てくる | 機械（同上） |
| 後の Phase（Phase 3・Phase 4）に触れている（§15） | 機械（同上） |
| 名前の中の数や機能の一覧で挙動が変わりうる既存の試験と、互換・管理の通し・管理のエラーコードを見張る既存の試験に名前で触れている（§11） | 機械（同上） |
| §10 の表の束は `N1`〜`N3`。名前に重複が無く、いまの `test/` の名前と重ならない | 機械（同上） |
| 束ごとの確認コマンドの案が `requireTests` を使い、`gitClean` に `base` を渡す（§14） | 機械（同上） |
| 指している `docs/`・`scripts/`・`openapi/` のパスが実在する（これから作る `src/`・`test/`・`migrations/` の下と、これから書く手順書はパスの形で書かない） | 機械（同上） |
| 集計がゲームを問わない数だけで、応答にプレイヤー ID を出さない（§2・§5）。「遊んだ」の記録がいまの口の往復を増やさない（§4）。消してはいけない行（二重の止めの鍵・受領の履歴）を消さない（§6）。`APP_ENV` の守りを外さない（§9）。D1 の 1 つの文のバインドの上限と 1 回の起動の文の数を数えている（§6）。Cloudflare の数字・機能は確かめた所と「要確認」が分かれている（§1） | AI の判定（作っていない判定役が、§1〜§9 と `src/`・`migrations/` を並べて見る） |
| 読みやすさ | ユーザー（後で読んで決める） |

### 実装の Issue の合格の条件（この設計書から作る）

- 束ごとに、§14 の確認コマンドの案が exit 0 になる（`runTests()` が `Result: PASS`・`requireTests` の名前が全部ある・通る）。
- 挙動の変わる既存の試験は §11 の手続きだけで直す。テストを挙動に合わせて弱めない（`docs/guides/decisions/test-plan.md` §11）。
- `package.json` を変えない（全部の束）。`wrangler.jsonc` は N2 で `triggers.crons` の 1 行だけ足し、`vars` の `APP_ENV=disabled` と D1 のダミーの ID を変えない（N1・N3 は変えない）。`migrations/` の既存のファイルを書き換えない。`APP_ENV === 'local'` の守り（`src/core/guards.ts` の `requireLocalWrite`）を外さない（§9）。
- N1・N3 の後、会話の側で人が管理の鍵をファイルに書かずに `wrangler dev --local --var APP_ENV:local --var ADMIN_API_KEY:<鍵>` で起動し、`npm run cli:smoke` の後に同じ鍵を環境変数で渡して `node scripts/admin-cli.mjs analytics`（N3 は `analytics-grants`）を回す。N2 の後、同じ起動で §7 のローカルの確かめ（`/cdn-cgi/local/scheduled`）を回す（無人の回では開発サーバーを起動しない。`.dev.vars` に書く手順にしない）。

## 1. 元の文書と、いまの挙動（ソースで確かめた事実）

2026-10-31 の main（`bbbe253`）の `src/`・`migrations/`・`test/`・`scripts/`・`openapi/`・`wrangler.jsonc` を読んで確かめた。

| 所 | いま |
| --- | --- |
| Worker の入口 | `src/worker.ts` は `fetch` だけを書き出す。`scheduled` は無い |
| `wrangler.jsonc` | `vars.APP_ENV = "disabled"`・D1 の `DB`（ID はダミー）・`migrations_dir`。`triggers` は無い。入れた wrangler は 4.152.0（`node_modules/wrangler/package.json`） |
| マイグレーション | `0001`〜`0016`（`0016_player_data_periods.sql` が最後）。次の番号は `0017` |
| 「遊んだ」の記録 | 無い。トークンの要る口は全部 `requireLocalWrite` → `requireAuth` → `consume(env.DB, RATE_LIMITS.<種類>, '<gameId>:<playerId>')` の順（saves・rankings の投稿・inventory・events・player-data・quests の 6 か所）。ゲストの発行（`src/core/accounts.ts`）は `accounts` と `game_players` を 1 つの `batch` で入れる |
| `game_players.created_at` | `datetime('now')` の文字列（UTC の `YYYY-MM-DD HH:MM:SS`） |
| 利用制限 | `src/core/rate-limit.ts` の `consume` が、足す文と同じ鍵の古い窓を消す文を 1 つの `batch` で流す。来なくなった鍵の行は残る（`abuse-protection-design.md` §12 の範囲の外の行） |
| 日の区切り | `src/core/period.ts` の `periodKey(kind, now, offsetMinutes)`。`periodKey('daily', now, 0)` が UTC の `YYYY-MM-DD` |
| 監査のログ | `admin_audit_log`。保持は `src/core/admin/audit.ts` の `AUDIT_RETENTION_DAYS = 365`。消す仕組みは無い（`admin-design.md` §5） |
| 掃除の候補の表 | `admin_audit_log`（`created_at`）・`player_data_writes`（`created_at`。`Idempotency-Key` の保存）・`player_data_period_values`（`updated_at`）・`quest_claims`（`claimed_at`。主キーが二重の止めの鍵）・`event_claims`（同じ）・`inventory_ledger`（`created_at`。受け取りの `claim_id` を `source_id` に持つ）・`rate_limit_counters`（`window_start`）。どれも時刻の列に索引が無い |
| 管理の口 | `src/core/admin/routes.ts` の 13 の操作。管理のスキーマの ErrorCode は 10 個（`INVALID_ARGUMENT`・`NOT_FOUND`・`RATE_LIMITED` などを含む） |
| ゲームのクライアントのスキーマ | 操作 19 個・ErrorCode 19 個（試験 `スキーマのファイルはOpenAPI 3.1で19個の操作を持つ`・`スキーマのErrorCodeの列挙は19個のエラーコードと一致する`） |
| 管理コマンド | `scripts/admin-cli.mjs`（`player`・`audit`・`grant`・`revoke`・`ban`・`unban`・`delete-score`・`put-item`・`put-event`・`put-quest`・`put-data-key`・`put-achievement`・`set-data`・`revoke-achievement`・`smoke`）。要求の形の関数は `scripts/admin-requests.mjs` |

Cloudflare の機能（2026-10-31 に公式の文書で確かめたものと、要確認のもの）:

- **Cron Triggers**（`developers.cloudflare.com/workers/configuration/cron-triggers/` で確かめた）: Wrangler の設定ファイルの `triggers.crons` の配列に書く。入口は `scheduled(controller, env, ctx)`。**UTC の時刻で動く**。ローカルでは `wrangler dev` の起動中に `/cdn-cgi/local/scheduled` へ HTTP の要求を送ると動かせ、`?cron=...` で式を、`&time=...` で `scheduledTime` を渡せる（入れた wrangler 4.152.0 の本体にこの道の文字列があることも確かめた）。`--test-scheduled` の旗が要るかは**要確認**。アカウントあたりの Cron Triggers の数の上限は Workers の上限のページにあり、数は**要確認**（この設計は 1 つだけ使う）。
- **D1 の上限**（`developers.cloudflare.com/d1/platform/limits/` で確かめた）: 1 つの文のバインドは 100 まで・1 つの文は 100 KB まで・1 つの文（と 1 つの `batch` 全体）は 30 秒まで・Worker の 1 回の起動で送れる文の数は Workers Paid で 1000・Free で 50（`batch` は 1 つと数える）。この数が `scheduled` の起動にも同じく効くかは**要確認**（§6 は Free の 50 に収める）。1 回の `batch` の文の数の上限は**要確認**のまま（`quest-design.md` §1）。
- **D1 の料金の数え方**（`developers.cloudflare.com/workers/platform/pricing/` で確かめた）: 読んだ行（返した行でなく走査した行）・書いた行（`INSERT`・`UPDATE`・`DELETE`）・保存の量（表と索引）で数える。金額は書かない（`operations-security.md` の決まり）。衝突して何も入れなかった `INSERT OR IGNORE` を書いた行に数えるかは**要確認**。
- **D1 の Time Travel**（`developers.cloudflare.com/d1/reference/time-travel/` で確かめた）: いつも有効で設定は要らない・追加の費用は無い・Workers Paid は 30 日・Free は 7 日まで分単位で戻せる。`wrangler d1 time-travel info` で印（bookmark）を見て、`wrangler d1 time-travel restore <DB> --timestamp=<UNIX 秒>` で戻す。**戻すのはその場で上書きする壊す操作**で、戻した時に返る印で取り消せる。30 日より長い保持は R2 への書き出しを案内している。ローカルの D1 で使えるかは**要確認**。
- **D1 の書き出し**（`developers.cloudflare.com/d1/best-practices/import-export-data/` で確かめた）: `wrangler d1 export <DB> --remote --output=<ファイル>.sql`（`--table`・`--no-data`・`--no-schema`）。書き出しの間はほかの要求を止める。戻すのは `wrangler d1 execute <DB> --remote --file=<ファイル>.sql`。ローカルの D1 に `--local` で書き出せるかは**要確認**。
- **費用の通知**（`developers.cloudflare.com/billing/manage/budget-alerts/` で確かめた）: 予算のアラートはダッシュボードの Manage Account → Billing → Billable Usage で作り、使った額がしきい値を越えるとメールが届く。**知らせるだけで使うのを止めない**。従量の払いのアカウントだけ。使用量の通知は Notifications にあり、手順の細部は**要確認**。
- **Workers Analytics Engine**: 書き込みの口・読む口（SQL の API とその鍵）・ローカルの試験での動き・料金は確かめておらず**要確認**。この設計では使わない（§13 の決めること 5）。

## 2. サーバーが持つもの・持たないもの（ADR 0002）

| 持つ（ゲームを問わない数） | 持たない（ゲームの中の意味。ゲームの側・外の道具） |
| --- | --- |
| 1 人 1 日 1 行の「遊んだ」の印（ゲーム・UTC の日付・プレイヤー・その日が初めての日か） | 何をして遊んだか・遊んだ時間・画面の遷移・課金の額・端末の種類 |
| 日ごとの遊んだ人の数（DAU）・新しい人の数・D1／D7／D30 に戻った人の数 | 離脱の理由・ゲームの中の進み具合の段階（ファネル）・ゲームごとの「アクティブ」の定義 |
| 日ごとに配った量（受領の履歴の種類と品目ごとの増減の合計）・クエストごとの受け取りの数 | 品目やクエストの名前・値打ち（マスターデータ。サーバーは ID だけ） |
| 表ごとの保持の日数と、過ぎた行の掃除 | 個人を特定する情報（IP・端末の ID・名前）。「遊んだ」の印は IP もトークンも持たない |

集計の応答はどれも数だけで、プレイヤー ID を返さない（§5）。1 人のプレイヤーを見るのは、今ある管理のプレイヤーを読む口（`GET /v1/admin/players/{playerId}`）の仕事のまま。

## 3. データの形

### 表（N1: `migrations/` の新しい番号 `0017_player_activity.sql`）

```sql
CREATE TABLE IF NOT EXISTS player_activity_days (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  day TEXT NOT NULL,                            -- UTC の 'YYYY-MM-DD'（periodKey('daily', now, 0)）
  player_id TEXT NOT NULL,                      -- トークンの p。外部キーは付けない（player_data と同じ理由）
  is_new INTEGER NOT NULL DEFAULT 0 CHECK (is_new IN (0, 1)),  -- ゲストの発行の日の行だけ 1
  PRIMARY KEY (game_id, day, player_id)
);
CREATE INDEX IF NOT EXISTS player_activity_days_day ON player_activity_days (day);
```

- 1 人 1 日 1 行。主キーの衝突で 2 回目からは入らない（`INSERT OR IGNORE`）。
- `is_new = 1` の行は、ゲストの発行の `batch` が入れる 1 行だけ（新しいプレイヤーなので衝突しない）。同じ日のトークンの要る要求は `INSERT OR IGNORE` で `is_new = 0` を入れようとして衝突し、1 のまま残る。
- 継続率の「初めての日」は `is_new = 1` の行の日にする。`0017` より前に発行したプレイヤーは新しい人に数えない（記録はこの束から始まる。§16）。
- 索引 `(day)` は掃除の文（日付だけで探す）のため。主キーの並び `(game_id, day, player_id)` は、DAU の数え上げ（ゲームと日の範囲）と継続の確かめ（ゲーム・日・プレイヤーの一致）の両方に当たる。

### 表（N2: `migrations/` の新しい番号 `0018_cleanup_indexes.sql`）

表は足さない。掃除の文が時刻の列で探すための索引だけを足す（`IF NOT EXISTS` だけ。既存の表を作り直さない）。

```sql
CREATE INDEX IF NOT EXISTS admin_audit_log_created ON admin_audit_log (created_at);
CREATE INDEX IF NOT EXISTS player_data_writes_created ON player_data_writes (created_at);
CREATE INDEX IF NOT EXISTS player_data_period_values_updated ON player_data_period_values (updated_at);
CREATE INDEX IF NOT EXISTS rate_limit_counters_window ON rate_limit_counters (window_start);
```

### 表（N3: `migrations/` の新しい番号 `0019_analytics_grants_indexes.sql`）

```sql
CREATE INDEX IF NOT EXISTS inventory_ledger_game_created ON inventory_ledger (game_id, created_at);
CREATE INDEX IF NOT EXISTS quest_claims_game_claimed ON quest_claims (game_id, claimed_at);
```

### 定数（データ 1 か所。design-cycle §2）

| 定数 | 値 | 置き場 | 使う所 |
| --- | --- | --- | --- |
| `MAX_ANALYTICS_RANGE_DAYS` | 92 | `src/core/analytics.ts` | 読む口の `from`〜`to` の日数の上限（両端を含む） |
| `RETENTION_OFFSETS` | `[1, 7, 30]` | `src/core/analytics.ts` | 継続の数を出す何日目（D1・D7・D30） |
| `MAX_ANALYTICS_ROWS` | 5000 | `src/core/analytics.ts` | N3 の配った量の応答の行の上限（越えたら `truncated: true`） |
| `RETENTION_DAYS` | 表ごと（§6 の表） | `src/core/cleanup.ts` | 掃除の文の切り目。監査のログは `AUDIT_RETENTION_DAYS` を読んで写さない |
| `CLEANUP_ROWS_PER_STATEMENT` | 1000 | `src/core/cleanup.ts` | 1 つの `DELETE` が消す行の上限 |
| `CLEANUP_MAX_STATEMENTS` | 40 | `src/core/cleanup.ts` | 1 回の `scheduled` で送る文の数の上限（D1 の Free の 50 の内） |
| `CLEANUP_CRON` | `'30 18 * * *'` | `src/core/cleanup.ts` と `wrangler.jsonc`（2 か所。試験で一致を見る） | UTC の 18:30（日本の 3:30）に 1 日 1 回 |

### モジュールのファイル

| ファイル | 中身 |
| --- | --- |
| `src/core/activity.ts`（N1） | `activityDay(now)`（`periodKey('daily', now, 0)` を読む）・`recordActivitySql`・`consumeForPlayer(db, rule, claims, now)`（`consume` と同じ 2 文に「遊んだ」の 1 文を足した 1 つの `batch`。断る・通すの決め方は `consume` と同じ関数 `decide` を使う） |
| `src/core/analytics.ts`（N1・N3） | 入出力の無い関数: `parseAnalyticsRange(url, now)`（`from`・`to` の形と範囲）・`fillDays(from, to, rows)`（数の無い日を 0 で埋める）・`retentionCell(cohortDay, today, offset, count)`（まだ来ていない日は `null`）・SQL の文字列 |
| `src/core/cleanup.ts`（N2） | `RETENTION_DAYS` の表・`cutoffFor(table, now)`（入出力の無い関数）・`cleanupStatements`・`runCleanup(db, now)`（表ごとに消して、消した数を返す） |
| `src/core/admin/routes.ts`（N1・N3） | 読む口 2 つを足す（§5） |
| `src/worker.ts`（N2） | `scheduled` を書き出す（§7） |

`src/core/` に置く理由: 「遊んだ」の記録は全部の機能のトークンの要る口が使い、掃除は全部の機能の表に効く。core はモジュールを読み込まず（表を SQL で読み書きするだけ。管理の口と同じ）、機能のモジュールは `consume` の代わりに `consumeForPlayer` を呼ぶだけになる。

## 4. 「遊んだ」の記録（N1）

**定義: その日（UTC）に、トークンの確かめ（`requireAuth`）を通った要求を 1 回でも送ったか、ゲストを発行した人を、その日に遊んだとする。** トークンの無い読み取り（お知らせ・ランキングの読み取り・設定）は誰か分からないので数えない。

| 所 | 書き方 | いまの口への影響 |
| --- | --- | --- |
| トークンの要る 6 か所（saves・rankings の投稿・inventory・events・player-data・quests） | `consume(...)` を `consumeForPlayer(env.DB, RATE_LIMITS.<種類>, auth.claims)` に置き換える。今の 2 文（窓に足す・古い窓を消す）の `batch` の 3 文目に `INSERT OR IGNORE INTO player_activity_days (game_id, day, player_id) VALUES (?, ?, ?)` を足す（バインド 3） | **往復は増えない**（今の `batch` に 1 文足すだけ）。応答の形・状態・確かめの順は変えない。429 で断った要求も数える（数えてから断るのは `consume` と同じ） |
| ゲストの発行（`src/core/accounts.ts`） | 今の `batch`（`accounts` → `game_players`）の 3 文目に `INSERT INTO player_activity_days (game_id, day, player_id, is_new) VALUES (?, ?, ?, 1)` | 往復は増えない。応答は変えない |

- `consumeForPlayer` の鍵は今と同じ `'<gameId>:<playerId>'`（`rate_limit_counters` の行は変わらない）。
- 止めたプレイヤー（BAN）は、`consume` の後で `requireNotBanned` が断るので、断られた要求でも遊んだに数える（§13 の決めること 1）。
- 記録の文が落ちると `batch` 全体が戻り、今の DB の失敗と同じく 500 `INTERNAL_ERROR` になる（中身を返さない。`CLAUDE.md` の守るもの）。
- 管理の口（`/v1/admin/...`）は遊んだに数えない（プレイヤーのトークンを読まない）。

## 5. 読む口と集計（N1・N3）

集計は**要求の時に D1 の SQL で数える**（日ごとにまとめた表を持たない。§13 の決めること 4）。どちらの口も管理の読み取りで、確かめの順は今の管理の読み取りと同じ（`src/core/admin/routes.ts` の `checkAdmin`: `APP_ENV=local` の門 → 鍵の有無 → `RATE_LIMITS.admin` → 鍵 → `gameId` の形 → ゲームの登録）。読み取りなので監査に残さない。機能の設定（`game_modules`）は見ない（管理の口の決まり。`admin-design.md` §2）。

### `GET /v1/admin/analytics/players?gameId=demo-rpg&from=2026-10-01&to=2026-10-31`（N1）

- `from`・`to`: UTC の `YYYY-MM-DD`。両方要る。`from <= to`・日数（両端を含む）が `MAX_ANALYTICS_RANGE_DAYS` 以下・`to` がサーバーの今日（UTC）以下。外れは 400 `INVALID_ARGUMENT`。知らないゲームは 404 `NOT_FOUND`。
- 応答 200:

```json
{
  "gameId": "demo-rpg", "from": "2026-10-01", "to": "2026-10-31", "timezone": "UTC", "serverTime": "2026-10-31T12:00:00Z",
  "days": [{ "date": "2026-10-01", "activePlayers": 12, "newPlayers": 3 }],
  "cohorts": [{ "date": "2026-10-01", "newPlayers": 3, "retained": { "d1": 2, "d7": 1, "d30": 1 } }]
}
```

- `days` は `from`〜`to` の全部の日を昇順に並べ、数の無い日は 0（`fillDays`）。`activePlayers` がその日の DAU、`newPlayers` はその日に発行した人の数。
- `cohorts` は同じ日の範囲で、その日に発行した人（`is_new = 1`）のうち N 日目（`RETENTION_OFFSETS`）に遊んだ人の数。**継続率**は `retained.dN / newPlayers` で、割り算はクライアント（管理コマンド）がする（0 で割らないため・数のまま渡すと合計し直せるため）。N 日目がサーバーの今日より後なら `null`（まだ決まらない）。`newPlayers` が 0 の日は行を出さない。
- 文（バインドはどちらも 3 つ: `gameId`・`from`・`to`）:

```sql
SELECT day, COUNT(*) AS active_players, SUM(is_new) AS new_players
  FROM player_activity_days WHERE game_id = ? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day;

SELECT c.day, COUNT(*) AS new_players,
  SUM(EXISTS (SELECT 1 FROM player_activity_days a WHERE a.game_id = c.game_id AND a.day = date(c.day, '+1 day') AND a.player_id = c.player_id)) AS d1,
  SUM(EXISTS (SELECT 1 FROM player_activity_days a WHERE a.game_id = c.game_id AND a.day = date(c.day, '+7 day') AND a.player_id = c.player_id)) AS d7,
  SUM(EXISTS (SELECT 1 FROM player_activity_days a WHERE a.game_id = c.game_id AND a.day = date(c.day, '+30 day') AND a.player_id = c.player_id)) AS d30
  FROM player_activity_days c WHERE c.game_id = ? AND c.is_new = 1 AND c.day BETWEEN ? AND ? GROUP BY c.day ORDER BY c.day;
```

`'+1 day'` などの文字は `RETENTION_OFFSETS` から SQL の文字列を作る（値をバインドせずに数を文に入れるのは、定数のモジュールの整数だけ。要求の値は入れない）。

### `GET /v1/admin/analytics/grants?gameId=demo-rpg&from=2026-10-01&to=2026-10-31`（N3）

- 範囲の決まりと断り方は上と同じ（`parseAnalyticsRange` を共有）。
- 応答 200:

```json
{
  "gameId": "demo-rpg", "from": "2026-10-01", "to": "2026-10-31", "timezone": "UTC", "serverTime": "2026-10-31T12:00:00Z",
  "grants": [{ "date": "2026-10-01", "sourceType": "quest-claim", "itemId": "gold", "added": 500, "removed": 0, "entries": 10 }],
  "questClaims": [{ "date": "2026-10-01", "questId": "first-hunt", "claims": 10 }],
  "truncated": false
}
```

- `grants` は受領の履歴 `inventory_ledger` を `date(created_at, 'unixepoch')`・`source_type`・`item_id` でまとめる（`added` は正の `delta` の合計・`removed` は負の `delta` の絶対値の合計・`entries` は行の数）。管理の取り消し（`source_type = 'admin'` の負の数）も見える。
- `questClaims` は `quest_claims` を `date(claimed_at, 'unixepoch')`・`quest_id` でまとめる。クエストごとの**達成率**の分母（その日の DAU）は N1 の口から取り、割り算はクライアントがする。
- 行の数が `MAX_ANALYTICS_ROWS` を越えたら、日付の昇順で切って `truncated: true`。
- 日の範囲を UNIX 秒にして比べる（バインドは `gameId`・始まりの秒・終わりの秒の 3 つ）。N3 の索引で範囲を読む。

### 個人を出さない決まり

- 2 つの口の応答には `playerId` も、プレイヤーを区別できる値（行ごとの時刻など）も入れない。数と日付と ID の決まった品目・クエストだけ。
- 小さなゲームで「その日の新しい人が 1 人」から人が分かりうる点は、今の管理の口（プレイヤーを読む口）が既に 1 人ずつ読めるので、新しく漏れるものは無い。数を伏せる（小さい数を丸める）のは範囲の外（§16）。

### `scripts/admin-cli.mjs` に足すもの

| 操作 | 束 | 送る要求 | 出すもの |
| --- | --- | --- | --- |
| `analytics [--from YYYY-MM-DD] [--to YYYY-MM-DD]` | N1 | `GET /v1/admin/analytics/players`。旗が無ければ今日（UTC）までの 7 日 | 応答の JSON と、`cohorts` ごとの継続率（割り算の結果。0 の日は出さない） |
| `analytics-grants [--from …] [--to …]` | N3 | `GET /v1/admin/analytics/grants` | 応答の JSON |

要求の形の関数は `scripts/admin-requests.mjs` に足し、§10 の試験が同じ関数を使う。`smoke` は変えない（§13 の決めること 10）。`scripts/cli-mock.mjs` は変えない（ゲームのクライアントの口を足さないため。`CLAUDE.md` の「API を変えたらここも合わせる」に当たらない）。

## 6. 保持と掃除（N2）

### 表ごとの保持の日数

| 表 | 保持 | 切り目の列 | 消してよい理由・消さない理由 |
| --- | --- | --- | --- |
| `admin_audit_log` | 365 日（`AUDIT_RETENTION_DAYS` を読む） | `created_at` | `admin-design.md` §5 の決まりのまま。管理の増減の `Idempotency-Key` も同じ 365 日で効かなくなる（`admin-design.md` §5 に書いたとおり） |
| `player_data_writes` | 30 日 | `created_at` | 中身は `Idempotency-Key` と応答の写しだけで、値の正は `player_data`。30 日を過ぎた鍵で送り直すと新しい書き込みになる（クライアントの送り直しは数秒〜数分の内。`docs/api-contract.md` に鍵の期限として書く） |
| `player_data_period_values` | 35 日 | `updated_at` | クエストが読むのは今の区切りの行だけ（`quest-design.md` §7）。今の区切り（週間で最長 7 日と時差 14 時間）の行は 35 日より新しいので消えない |
| `rate_limit_counters` | 1 日 | `window_start` | 窓は最長 60 秒（`src/core/rate-limit-policy.ts`）。来なくなった鍵の行だけが残っている（`abuse-protection-design.md` §12 の後から足す形のまま） |
| `player_activity_days` | 400 日 | `day` | 読む口の範囲（92 日）と D30 の先を足しても足り、1 年前との比べができる |
| `quest_claims` | **消さない** | — | 一度きりのクエストの行は二重の止めの鍵（主キー）で、消すともう一度受け取れる。デイリー・週間の過去の区切りの行は消しても二重にならないが、`inventory_ledger` の `source_id` が `claim_id` を指し、管理のプレイヤーを読む口の `questClaims` が見る。量は受け取りの数だけ |
| `event_claims` | **消さない** | — | `quest_claims` と同じ理由（`event-reward-design.md` §5 の一意の鍵） |
| `inventory_ledger` | **消さない** | — | 残高の増減の証拠（問い合わせ・管理の取り消しの元）で、プレイヤーが読む受領の履歴そのもの。量は受け取りと管理の増減の数だけ |

消さない 3 つの表の量が問題になったら、Phase 4 の利用上限・コストモデルの説明（§15）で見積もり、「区切りの過去の受け取りの行と履歴を同じ日数で一緒に消す」形を足す（§16）。

### 消し方

1 つの表に 1 つの文の形（バインドは 2 つ: 切り目・行の数の上限）:

```sql
DELETE FROM <表> WHERE rowid IN (SELECT rowid FROM <表> WHERE <切り目の列> < ? LIMIT ?);
```

- 表の名前と列の名前は `RETENTION_DAYS` の表（定数）から作る。要求の値は入れない。
- `DELETE ... LIMIT` の書き方は SQLite の作りの旗に頼るので使わず、`rowid` の副問い合わせにする（どの表も `WITHOUT ROWID` でない）。
- 1 つの文で `CLEANUP_ROWS_PER_STATEMENT`（1000）行まで。消した数が 1000 なら同じ表をもう一度、それより少なければ次の表へ。全部で `CLEANUP_MAX_STATEMENTS`（40）文で止め、残りは次の日に消す（D1 の Free の 1 回の起動の 50 文の内・1 文 30 秒の内に収める）。
- 表ごとに別の文で送る（1 つの `batch` にまとめない）。1 つの表で落ちても、ほかの表は消す。落ちた表は `console.error` に表の名前だけを出す（DB のエラーの中身を外へ返す口は無いが、ログにも行の中身を出さない）。
- 切り目: `created_at`・`updated_at`・`window_start` は `now - 日数 × 86400`（UNIX 秒）。`player_activity_days.day` は `activityDay(now - 日数 × 86400)` の文字列で比べる。
- 掃除の結果は表ごとの消した行の数だけを `console.log` に出す（プレイヤー ID を出さない）。

## 7. Cron Triggers と `scheduled` の入口（N2）

- `wrangler.jsonc` に `"triggers": { "crons": ["30 18 * * *"] }` を足す（UTC で動く。公式で確かめた）。`vars.APP_ENV` と D1 の ID は変えない。足したら `npm run cf-typegen` で `worker-configuration.d.ts` を作り直す（`CLAUDE.md` のコマンド）。
- `src/worker.ts` の書き出しに `scheduled(controller, env, ctx)` を足す。中身は `ctx.waitUntil(runScheduled(env, Math.floor(controller.scheduledTime / 1000)))` だけで、`runScheduled` は:
  1. `env.APP_ENV !== 'local'` なら何も消さず、`console.log` に止めたことだけを出して終わる（§9）。
  2. `runCleanup(env.DB, now)` を呼ぶ。
  3. 集計はしない（§5 は要求の時に数える）。後で日ごとにまとめた表を足すときは、この同じ入口に足す（§13 の決めること 6）。
- `controller.cron` の値は見ない（Cron は 1 つだけ。足すときに分ける）。

ローカルでの確かめ:

- 無人の回（試験）: `runCleanup(env.DB, now)` を `now` を渡して直に呼ぶ L2 と、`worker.scheduled(偽の controller, env, 偽の ctx)` を呼んで `ctx.waitUntil` に渡された約束を待つ L2 で確かめる（時計を動かさない。開発サーバーを起動しない）。
- 会話の側（N2 の後）: `wrangler dev --local --var APP_ENV:local --var ADMIN_API_KEY:<鍵>` の起動中に `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=30+18+*+*+*"` を送り、ログに表ごとの消した数が出るのを見る（道は公式の文書で確かめた。`--test-scheduled` の旗が要るかは**要確認**で、要れば起動の旗に足す）。

## 8. バックアップと復元・費用アラート（コードにしない。手順書の置き場だけ）

| 項目 | このリポジトリのコード | 手順書（この Issue では書かない） |
| --- | --- | --- |
| バックアップ | 作らない。D1 の Time Travel がいつも有効で、30 日（Paid）／7 日（Free）の内は分単位で戻せる（§1 で確かめた） | Phase 4 の配布の手順（使う人に渡す説明書。置き場は `docs/guides/manuals/`、名前の案は `backup-restore.md`）に、`wrangler d1 time-travel info` で印を控える・`wrangler d1 export --remote` で 30 日より長く残す写しを取る（R2 への書き出しの自動化は §16）手順を書く |
| 復元 | 作らない | 同じ説明書に、`wrangler d1 time-travel restore` が上書きする壊す操作であること・戻した時の印で取り消せること・復元演習（`operations-security.md` の 8）のやり方を書く。ローカルの D1 での演習のやり方は**要確認** |
| 費用アラート | サーバーで額を数えない。今ある数の口（§5 の DAU）と D1 の料金の数え方（読んだ行・書いた行・保存の量）を見積もりの手がかりにする | Phase 4 の配布の手順（同じ置き場、名前の案は `cost-alerts.md`）に、予算のアラート（Billing → Billable Usage。知らせるだけで止めない・従量のアカウントだけ）と使用量の通知（Notifications。細部は**要確認**）の作り方と、通知の宛先をファイルに書かないことを書く |

本番の Cloudflare の操作（`wrangler d1 time-travel restore`・`--remote`・ダッシュボードの設定）は、このリポジトリのコードとスクリプトに入れない（`CLAUDE.md` の守るもの: デプロイしない・本番の設定の値をファイルに書かない）。手順書は Phase 4 の「利用者が自分の Cloudflare にデプロイできる手順を確立」「利用上限・コストモデル・バージョン移行を説明」（`roadmap.md`）と同じ Issue で書く。

## 9. 認証・`APP_ENV`・利用制限・`game_modules`・文書のどこが変わるか

| 所 | 決まり |
| --- | --- |
| 認証 | 「遊んだ」の記録は `requireAuth` を通った後だけ書く。読む口は管理の鍵（今の管理の口と同じ）。プレイヤーのトークンでは読めない |
| `APP_ENV` | `requireLocalWrite` の守りと `wrangler.jsonc` の既定 `APP_ENV=disabled` を外さない（`CLAUDE.md`）。記録はトークンの要る口（既に `local` のときだけ通る）の中なので、`local` 以外では書かれない。読む口は今の管理の口と同じく `local` 以外で 403 `NOT_READY_FOR_PRODUCTION`。`scheduled` の掃除も `local` 以外では消さない（守りを外す時にユーザーが一緒に決める。`admin-design.md` §10） |
| 利用制限 | 新しい `RATE_LIMITS` の行を足さない。読む口は今の `RATE_LIMITS.admin`（IP ごと）を数える。記録はトークンの要る口の今の決まりの中（`consume` の数え方を変えない） |
| `game_modules` | 機能の名前を足さない（「遊んだ」の記録と掃除は全部のゲームに効く仕組みで、利用制限と同じく core）。demo-rpg の設定とモジュールの一覧は変わらない |
| エラーコード | 足さない。読む口は今の管理のコード（400 `INVALID_ARGUMENT`・404 `NOT_FOUND`・401・403・429・500）だけ。ゲームのクライアントのスキーマ `openapi/rpg-online.v1.json` は変えない。管理のスキーマ `openapi/rpg-online-admin.v1.json` には操作を足すが ErrorCode の列挙は変えない |
| 文書（実装の束で直す） | `docs/api-contract.md` の「管理の API」に 2 つの読む口（N1・N3）と、プレイヤーデータの `Idempotency-Key` の期限 30 日（N2）。`docs/guides/working/architecture.md` に `scheduled` の入口（N2）。`admin-design.md` §5 の「消す仕組みは分析の束で」の文を、この設計書の §6 を指す文に置き換える（N2）。`roadmap.md` の Phase 2 の行は N3 の後に印を付ける（統合のセッション） |

## 10. 試験の名前の表

名前は `it('…')` の文そのまま（`docs/guides/procedures/node-test-procedure.md`）。置き場は新しい `test/analytics.test.ts`（N1・N3。L1 も同じファイル）と `test/cleanup.test.ts`（N2）。

試験の作り方:

- 試験のゲームは専用（`analytics-game` など。`registerGame` を `beforeEach` で）。`beforeEach` で `resetRateLimits(db)` と `player_activity_days` の `DELETE`。
- 日をまたぐ試験は、`now` を渡す L1 と、過去の日の行を直に入れる L2 で確かめる（時計を動かさない。`event-reward-design.md` §8 と同じ）。
- 掃除の試験は、切り目の前後 1 秒の行を直に入れてから `runCleanup(db, now)` を呼ぶ。
- 新しい試験の名前には、機能が増えると変わる数（エラーコード・操作・ルートの個数）を入れない。

| 束 | テストの名前 | 層 | 入力（要求） | 期待する結果 |
| --- | --- | --- | --- | --- |
| N1 | `遊んだ日の鍵はサーバーの時刻のUTCの日付` | L1 | `activityDay` に UTC の 23:59:59 と翌 0:00:00 | 日付が 1 日ずれる。時差を入れない |
| N1 | `集計の日の範囲は形と順と上限日数と今日までを確かめる` | L1 | `parseAnalyticsRange` に形の誤り・`from > to`・93 日・明日まで・92 日 | 92 日までは通り、ほかは外れと理由 |
| N1 | `集計の日の並びは数の無い日を0で埋める` | L1 | `fillDays` に飛び飛びの行 | 全部の日が昇順で、無い日は 0 |
| N1 | `継続の数はまだ来ていない日をnullにする` | L1 | `retentionCell` に今日より前・今日・後の N 日目 | 後だけ `null` |
| N1 | `ゲストを発行するとその日の遊んだ行が新しい人として1行入る` | L2 | ゲストを発行 | `player_activity_days` に `is_new = 1` の 1 行。応答は今と同じ形 |
| N1 | `トークンの要る要求を同じ日に何回送っても遊んだ行は1人1行` | L2 | 同じトークンで所持品・プレイヤーデータ・クエストの口を合わせて 5 回 | 1 行のまま。発行の日なら `is_new = 1` のまま |
| N1 | `トークンの要る6つの機能の口はどれも遊んだ行を残す` | L2 | saves・rankings の投稿・inventory・events・player-data・quests の口を別々の新しいプレイヤーで 1 回ずつ | 6 人とも行がある |
| N1 | `トークンの無い要求と外れたトークンは遊んだ行を残さない` | L2 | トークン無し・署名の誤り・期限切れの要求と、お知らせの読み取り | 行が増えない |
| N1 | `利用制限で断られた要求も遊んだ行を残し制限の数え方は変わらない` | L2 | 窓の数を上限にしてから 1 回 | 429 と `Retry-After`。行が 1 つ増え、`rate_limit_counters` の数は今と同じく 1 増える |
| N1 | `管理の集計はその日の遊んだ人と新しい人の数を返しプレイヤーIDを返さない` | L2 | 3 日分の行を直に入れて `GET /v1/admin/analytics/players` | 200。`days` が §5 のとおり。本文の文字列に入れたプレイヤー ID がどれも出てこない |
| N1 | `管理の集計は発行の日ごとにD1とD7とD30に戻った人の数を返す` | L2 | 発行の日の行と、1・7・30 日後の行を一部のプレイヤーだけ入れる | `cohorts` の `retained` が入れた数。31 日目の行は数えない |
| N1 | `管理の集計は日の範囲の誤りにINVALID_ARGUMENTの400を返し知らないゲームにNOT_FOUNDの404を返す` | L2 | 範囲の誤り・知らない `gameId` | 400・404。DB に何も書かない |
| N1 | `管理の集計は管理の鍵が無いと401で本番の設定ではNOT_READY_FOR_PRODUCTIONの403を返す` | L2 | 鍵無し・`APP_ENV=disabled` | 401・403 |
| N1 | `管理の集計の応答は管理のスキーマに合う` | L2 | 200・400・404 | `openapi/rpg-online-admin.v1.json` に合う |
| N1 | `管理コマンドと同じ要求の形で集計を読める` | L2 | `scripts/admin-requests.mjs` の関数で、ゲスト → 要求 → 集計 | 今日の `activePlayers` と `newPlayers` が 1 以上 |
| N2 | `掃除の切り目は表ごとの保持の日数から決まり監査のログは保持の定数を読む` | L1 | `cutoffFor` に各表と `now` | `now - 日数 × 86400`。監査のログの日数が `AUDIT_RETENTION_DAYS` と同じ |
| N2 | `掃除は保持の日数を過ぎた行だけを消し切り目の行は残す` | L2 | 各表に切り目の 1 秒前・切り目ちょうどの行 | 前だけ消える |
| N2 | `掃除は受け取りの行と受領の履歴を消さない` | L2 | 400 日前の `quest_claims`（一度きりとデイリー）・`event_claims`・`inventory_ledger` の行 | 全部残る。一度きりのクエストをもう一度受け取ると今までどおり同じ本文 |
| N2 | `掃除はいまの区切りの値を消さずクエストの進捗が変わらない` | L2 | 今日のデイリーの値と 36 日前の値 | 今日の行だけ残り、クエストの一覧の `progress` が同じ |
| N2 | `掃除は1つの文で消す行の数と1回に送る文の数に上限がある` | L2 | 古い行を `CLEANUP_ROWS_PER_STATEMENT × 3` 行入れ、文を数える偽の DB と実の DB で | 1 文の消す数が上限まで。文の数が `CLEANUP_MAX_STATEMENTS` 以下。残りは 2 回目で消える |
| N2 | `掃除は1つの表で落ちてもほかの表を消しDBのエラーの中身をログに出さない` | L2 | 1 つの表の文だけ投げる偽の DB | ほかの表の文は送られる。ログに表の名前だけ |
| N2 | `scheduledは本番の設定では何も消さない` | L2 | `APP_ENV=disabled` の env で `worker.scheduled` | 古い行が残る |
| N2 | `scheduledはローカルの設定で掃除を待ち合わせて流す` | L2 | `APP_ENV=local` の env と偽の `ctx` で `worker.scheduled` | `waitUntil` に渡した約束を待つと古い行が消えている |
| N2 | `wranglerの設定のcronは掃除の定数と同じでAPP_ENVの既定は変わらない` | L1 | `wrangler.jsonc` を文字列で読み込む（Vite の `?raw`。Workers のランタイムの中で読めるかは**要確認**で、読めなければこの行を確認コマンドの `check` に移すよう設計を直す）・コメントを外して JSON にする | `triggers.crons` が `[CLEANUP_CRON]`。`vars.APP_ENV` が `disabled` |
| N3 | `管理の配った量の集計は日と種類と品目ごとに増やした量と減らした量を返す` | L2 | 受け取り・管理の付与と取り消しの履歴の行を直に入れる | `grants` が §5 のとおり。プレイヤー ID が出てこない |
| N3 | `管理の配った量の集計はクエストごとの受け取りの数を日ごとに返す` | L2 | 2 つのクエストの受け取りの行を 2 日に分けて入れる | `questClaims` が入れた数 |
| N3 | `管理の配った量の集計は行の上限を越えると切ってtruncatedを返す` | L2 | 上限を小さくした関数の呼び方（L1 の形でもよい）か、上限を越える行 | 日付の昇順で切れ、`truncated: true` |
| N3 | `管理の配った量の集計はほかのゲームの履歴を数えない` | L2 | 2 つのゲームに行を入れる | 頼んだゲームの行だけ |
| N3 | `管理の配った量の集計の応答は管理のスキーマに合う` | L2 | 200・400・404 | 管理のスキーマに合う |
| N3 | `管理コマンドと同じ要求の形で配った量を読める` | L2 | `scripts/admin-requests.mjs` の関数で、イベントの受け取り → 集計 | 今日の `event-claim` の行がある |

数（行）: N1 が 15・N2 が 9・N3 が 6。

## 11. 挙動が変わる既存の試験と、直す手続き

ゲームのクライアントの口・エラーコード・機能のモジュールを足さないので、名前の中の数で挙動が変わる試験は無い。見張る試験として `requireTests` に入れる。

| 既存の試験（`test/`） | 束 | 何が変わるか | 直し方 |
| --- | --- | --- | --- |
| `スキーマのファイルはOpenAPI 3.1で19個の操作を持つ` | N1〜N3 | **変わらない**（ゲームのクライアントの操作を足さない） | 直さない。全部の束の `requireTests` に入れて見張る |
| `スキーマのErrorCodeの列挙は19個のエラーコードと一致する` | N1〜N3 | **変わらない**（コードを足さない） | 直さない。同上 |
| `demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsを使う設定で登録される` | N1 | **変わらない**（`game_modules` に機能を足さない） | 直さない。N1 の `requireTests` に入れる |
| `モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない` | N1 | **変わらない**（モジュールを足さない。読む口は管理のルート） | 直さない。N1 の `requireTests` に入れる |
| `今のCLIモックと同じ形の要求を受け付ける` | N1 | **変わらない**（記録は今の `batch` に 1 文足すだけで、要求と応答の形を変えない） | 直さない。N1 の `requireTests` に入れる |
| `CLIモックの通しの流れを続けて2回回しても利用制限に掛からない` | N1 | **変わらない**（`consume` の数え方を変えない） | 直さない。N1 の `requireTests` に入れる |
| `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` | N1・N3 | **変わらない**（`smoke` の流れを変えない） | 直さない。N1・N3 の `requireTests` に入れる |
| `管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する` | N1・N3 | **変わらない**（読む口は今のコードだけを返す） | 直さない。N1・N3 の `requireTests` に入れる |
| `管理のスキーマの操作は管理のルートと1対1で対応する` | N1・N3 | 名前に数が無い。ルートとスキーマに同じ 1 つずつを足す | 直さない。N1・N3 の `requireTests` に入れる |
| `利用制限の回数と窓は定数のモジュールにある` | N1 | **変わらない**（`RATE_LIMITS` に行を足さない） | 直さない。N1 の `requireTests` に入れる |
| `マイグレーションを2回当ててもデータは壊れない` | N1〜N3 | 変わらない（`0017`〜`0019` は `IF NOT EXISTS` だけ） | 変えない。全部の束の `requireTests` に入れる |
| `DBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない`・`書き込みでDBが失敗してもINTERNAL_ERRORの500を返す` | N1 | 変わらない（記録の文も同じ `batch` で落ち、同じ 500 になる） | 変えない。N1 の `requireTests` に入れる |

置き換えが要る試験が出たら、`docs/guides/decisions/test-plan.md` §11 の手続き（名前の嘘を直すだけで、確かめる中身を弱めない）で直し、この表に行を足す。

## 12. 通しのシナリオ

- `scripts/cli-mock.mjs`: **変えない**。通しを回すと、ゲストの発行とトークンの要る要求で今日の遊んだ行が 1 行入る（CLI モックは見ない）。
- `scripts/admin-cli.mjs`（会話の側。N1 の後）: `npm run cli:smoke` → `node scripts/admin-cli.mjs analytics` で、今日の `activePlayers` と `newPlayers` が通しの回数だけ増えているのを見る（ゲストは回すたびに新しい）。N3 の後は `analytics-grants` で、今日の `event-claim` と `quest-claim` の行を見る。
- N2 の後: §7 の `/cdn-cgi/local/scheduled` を送ってログを見る。

## 13. 決めること

推しの案で §2〜§12 を書いた。違う案にするときは、該当する節と §10 の表を同じコミットで直す。

| # | 決めること | 案 | 推し |
| --- | --- | --- | --- |
| 1 | 「遊んだ」の定義 | A: **トークンの確かめを通った要求（429・BAN で断られたものも含む）とゲストの発行**。B: 書き込み（プレイヤーデータ・セーブ・スコア・受け取り）だけ。C: ゲームが「遊んだ」を送る口を足す | **A**。読むだけの日（所持品やクエストの一覧を開いただけ）も遊んだ日で、`player-data-design.md` §15 が書いた「書き込まない日は数えられない」の穴を埋める。断られた要求も本人が起動している。B は読むだけの日が抜ける。C はクライアントの作りが要り、申告の値になる |
| 2 | 記録の置き場 | A: **新しい表 `player_activity_days`（1 人 1 日 1 行・初めての日の印）**。B: いまある表（`player_data_writes`・`quest_claims`・`game_players` など）から数える。C: 構造化ログ（`console.log`）だけに出し、外の道具で数える | **A**。DAU と継続率が 1 つの表の数え上げで済み、行の数は DAU × 日数で抑えられる。B は表ごとに意味と保持の日数が違い（30 日で消える書き込みの記録など）、読むだけの日が抜ける。C はローカルの試験で確かめられず、本番のログの道具が要る |
| 3 | 記録を書く所と速さへの影響 | A: **`consume` と同じ `batch` に 1 文足す新しい関数 `consumeForPlayer`（6 か所の呼び出しを置き換え）と、ゲストの発行の `batch`**。B: 応答の後に `ctx.waitUntil` で書く。C: ルーターが全部の要求の後に書く | **A**。往復が増えず、トークンの確かめの後なので誰かが決まっている。B は `Route.handle` に `ctx` が渡っておらず、型と全部のルートを変える。C はルーターがトークンを読むことになり、確かめの順（`account-design.md` §5）が二重になる |
| 4 | 集計の形 | A: **要求の時に D1 の SQL で数える（まとめた表を持たない）**。B: Cron Triggers で毎日まとめた表（`daily_stats`）に書き、読む口はそれを読む。C: 両方（今日は数え、過去はまとめた表） | **A**。正が 1 つで、記録を直せば集計も直る。行の数は DAU × 92 日で、索引の範囲で読める。B はまとめが遅れた・落ちた日の扱いと作り直しの手順が要る。遅くなったら B を後から足せる形にしておく（§16） |
| 5 | D1 だけか、Workers Analytics Engine などを使うか | A: **D1 だけ**。B: Analytics Engine に書き、読むのは SQL の API。C: 外の分析の道具（ログの転送） | **A**。ローカルの試験で確かめられ、パッケージも設定も足さない。B は書き込み・読む口・ローカルでの動きが**要確認**で、読むのにアカウントの鍵が要り、`wrangler.jsonc` に結び付けを足す。C は Phase 4 の配布で使う人ごとに道具が違う |
| 6 | Cron Triggers を入れるか・掃除と集計を同じ入口でやるか | A: **入れる（1 日 1 回・UTC の 18:30）。入口は 1 つの `scheduled` で、今は掃除だけ。まとめの表を足すときも同じ入口に足す**。B: 入れず、管理の口に「掃除する」書き込みの口を足して人が呼ぶ。C: 要求の時に少しずつ消す（`consume` の古い窓の消し方と同じ） | **A**。`admin-design.md`・`player-data-design.md`・`quest-design.md` がここへ送った掃除を 1 か所でできる。B は人が忘れると消えず、監査に残る書き込みの口が増える。C は全部の要求に文が増え、表ごとの切り目がばらける |
| 7 | 日の区切り | A: **UTC の 0 時（全部のゲームで同じ）。応答に `timezone: "UTC"` を書く**。B: ゲームごとの時差（`games` に列を足す・イベントの `reset_offset_minutes` と同じ範囲）。C: 記録に時刻を持ち、読む時に時差を指定する | **A**。Cron Triggers も UTC で動き、記録の日付が書いた時に決まる。B は時差を変えると過去の記録と境目がずれ、`games` に `ALTER TABLE` か新しい表が要る。C は 1 人 1 日 1 行の印にできず、行が要求の数だけ増える。日本の作者には「0 時が日本の 9 時」と管理コマンドの出力に書く。要るゲームが出たら B を新しい表で足す（§16） |
| 8 | 継続率の定義 | A: **発行の日を 0 日目とし、ちょうど 1・7・30 日目に遊んだ人の数（D1・D7・D30）。割り算はクライアント**。B: N 日目「以降」に 1 回でも戻った人（rolling）。C: 週ごとのまとまり（週の継続） | **A**。よく使われる形で、1 つの文で数えられる。数のまま返すと日をまたいで足し直せる。B・C は同じ表から後で足せる |
| 9 | 保持の日数と、消さない表 | A: **§6 の表（監査 365・書き込みの記録 30・区切りの値 35・利用制限 1・遊んだ印 400。受け取りの行と受領の履歴は消さない）**。B: 全部の表を同じ日数（365）で消す。C: 受け取りの行のうちデイリー・週間の過去の区切りと、その履歴を 400 日で消す | **A**。消すと二重になる行・残高の証拠を残し、意味の無くなった行だけ消す。B は一度きりのクエストの鍵を消してもう一度受け取れる道を作る。C は履歴の `source_id` と受け取りの行を一緒に消す手続きが要り、量が問題になってから足す（§16） |
| 10 | 読む口と管理コマンド | A: **管理の口に読む口を 2 つ（`/v1/admin/analytics/players`・`/v1/admin/analytics/grants`）。`scripts/admin-cli.mjs` に `analytics`・`analytics-grants`。`smoke` は変えない**。B: 管理の口を足さず、`wrangler d1 execute` の SQL を手順書に書く。C: 1 つの口にまとめる | **A**。管理の鍵・利用制限・確かめの順をそのまま使え、試験で形を見張れる。`smoke` の流れは既存の試験 `管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る` が見張っていて、変えると期待を書き換えることになる。B は本番の DB に直に SQL を流す手順になり、個人を出さない決まりを守れない。C は束を分けられず、応答が大きくなる |
| 11 | 集計に個人を出すか | A: **出さない（数と日付と品目・クエストの ID だけ）**。B: 遊んだ人の ID の一覧を返す（管理の読み取りに渡す）。C: 小さい数を丸めて伏せる | **A**。1 人を見るのは今のプレイヤーを読む口で足りる。B は集計の口が個人の一覧の口になる（`operations-security.md` の 6 の最小化に合わない）。C は管理の鍵を持つ人に伏せても今の口で読め、意味が薄い（§16） |
| 12 | バックアップと復元 | A: **コードにしない。D1 の Time Travel と `wrangler d1 export` を使う手順を Phase 4 の配布の説明書に書く（置き場だけ決める）**。B: Cron Triggers で R2 へ書き出す（Workflows を使う）。C: 管理の口に書き出しの口を足す | **A**。Time Travel はいつも有効で費用が無く（公式で確かめた）、本番の操作はリポジトリに入れない（`CLAUDE.md`）。B は R2 の結び付け・Workflows を `wrangler.jsonc` に足し、30 日より長い保持が要るときに足す（§16）。C は大きな本文を返す口と、書き出しの間の止まり（公式の注意）を抱える |
| 13 | 費用アラート | A: **サーバーで額を数えない。予算のアラートと使用量の通知の作り方を Phase 4 の配布の説明書に書く**。B: サーバーで要求の数・書いた行を数えて、しきい値で管理に知らせる。C: 利用制限を額に合わせて自動で下げる | **A**。額は Cloudflare だけが正しく知り、予算のアラートは止めずに知らせる（公式で確かめた）。B は数えるたびに D1 に書き、それ自体が費用になる。C はゲームを止める判断をサーバーが勝手にする |
| 14 | 新しいエラーコード | A: **足さない（読む口は 400・404 と管理の共通のコード）**。B: 日の範囲の誤りに `ANALYTICS_RANGE_INVALID` を足す（管理のスキーマ） | **A**。範囲の誤りは入力の誤りで `INVALID_ARGUMENT` に当たる。どちらのスキーマの ErrorCode も変えない |
| 15 | `game_modules` に機能の名前を足すか | A: **足さない（記録・掃除は core。全部のゲームに効く）**。B: `analytics` を足し、使うゲームだけ記録する | **A**。利用制限と同じく運用の仕組みで、記録はプレイヤー ID と日付だけ。機能の設定は認可の代わりにしない（`core-foundation-design.md`）。B は 6 か所の口が機能の設定を引き、モジュールの一覧と demo-rpg の設定の試験の名前が変わる |
| 16 | `scheduled` を `APP_ENV` で止めるか | A: **`local` 以外では消さない（ログに止めたことだけ）**。B: いつでも消す（要求でないので門は要らない） | **A**。`APP_ENV` の守りを外す判断はユーザーがまとめて決める（`admin-design.md` §10）。今はデプロイしないので、B との違いはデプロイの時にだけ出る。外すときは §9 の表と一緒に直す |
| 17 | パッケージ | A: **足さない（D1・Web Crypto・wrangler の今の版だけ）**。B: 日付や集計のライブラリを足す | **A**。日付は `src/core/period.ts` の関数と SQLite の `date()` で足りる。`package.json` を変えない |

## 14. 実装の束

束は 1 つの実装の Issue に当たる。上から順に作る。

| 束 | 中身 | 前の束 | 既存の試験 | パッケージ |
| --- | --- | --- | --- | --- |
| N1 | 遊んだ記録と DAU・継続率: `migrations/` の新しい `0017_player_activity.sql`・`src/core/activity.ts`・`src/core/analytics.ts`・6 か所の `consume` を `consumeForPlayer` に・ゲストの発行の `batch`・管理の読む口 `GET /v1/admin/analytics/players`・管理のスキーマ・`scripts/admin-cli.mjs` と `scripts/admin-requests.mjs` に `analytics`・§9 の N1 の文書と契約・§10 の N1 の試験 | Q3（`quest-design.md`） | 変えない（§11 を見張る） | 足さない |
| N2 | 掃除: `migrations/` の新しい `0018_cleanup_indexes.sql`・`src/core/cleanup.ts`・`src/worker.ts` の `scheduled`・`wrangler.jsonc` の `triggers.crons`・`npm run cf-typegen`・§9 の N2 の文書・§10 の N2 の試験 | N1 | 変えない | 足さない |
| N3 | 配った量とクエストの受け取りの数: `migrations/` の新しい `0019_analytics_grants_indexes.sql`・管理の読む口 `GET /v1/admin/analytics/grants`・管理のスキーマ・`analytics-grants`・§9 の N3 の文書・§10 の N3 の試験 | N2 | 変えない | 足さない |

範囲の外（後の設計書）: §16。

### 束ごとの確認コマンドの案

実装の Issue の本文の ```js に入れる。`runTests()` で全部回したあとの結果（JUnit の XML）を `requireTests` が読む（`scripts/issue-run/check-lib.mjs`）。守るファイルの名前は、書かせる側のファイルと重ならないように組み立てる。`gitClean` は `base` を渡さないと作業ツリーしか見ないので、先頭の `base` に**実装の Issue を作るときの main のコミットの SHA** を書き入れる（`docs/guides/procedures/issue-goal-setting.md`）。

N1:

```js
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0017_player_activity.sql', 'src/core/activity.ts', 'src/core/analytics.ts', 'test/analytics.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
for (const m of ['saves', 'rankings', 'inventory', 'events', 'player-data', 'quests']) {
  const src = read(`src/modules/${m}/index.ts`);
  check(/consumeForPlayer\(/.test(src) && !/\bconsume\(/.test(src), `${m} が consumeForPlayer で数えて記録する`);
}
check(/player_activity_days/.test(read('src/core/accounts.ts') + read('src/core/activity.ts')), 'ゲストの発行が遊んだ行を書く');
const admin = JSON.parse(read('openapi/rpg-online-admin.v1.json') || '{}');
check(Boolean(admin.paths?.['/v1/admin/analytics/players']?.get), '管理のスキーマに集計の口がある');
const spec = JSON.parse(read('openapi/rpg-online.v1.json') || '{}');
check((spec.components?.schemas?.ErrorCode?.enum ?? []).length === 19, 'ゲームのクライアントの ErrorCode を足していない');
check(/analytics/.test(read('scripts/admin-cli.mjs')), '管理コマンドに analytics がある');
const all = readdirSync('test').filter((f) => f.endsWith('.ts')).map((f) => read('test/' + f)).join('\n');
check(all.includes('今のCLIモックと同じ形の要求を受け付ける'), '互換の試験が残っている');
runTests();
requireTests([
  '遊んだ日の鍵はサーバーの時刻のUTCの日付',
  '集計の日の範囲は形と順と上限日数と今日までを確かめる',
  '集計の日の並びは数の無い日を0で埋める',
  '継続の数はまだ来ていない日をnullにする',
  'ゲストを発行するとその日の遊んだ行が新しい人として1行入る',
  'トークンの要る要求を同じ日に何回送っても遊んだ行は1人1行',
  'トークンの要る6つの機能の口はどれも遊んだ行を残す',
  'トークンの無い要求と外れたトークンは遊んだ行を残さない',
  '利用制限で断られた要求も遊んだ行を残し制限の数え方は変わらない',
  '管理の集計はその日の遊んだ人と新しい人の数を返しプレイヤーIDを返さない',
  '管理の集計は発行の日ごとにD1とD7とD30に戻った人の数を返す',
  '管理の集計は日の範囲の誤りにINVALID_ARGUMENTの400を返し知らないゲームにNOT_FOUNDの404を返す',
  '管理の集計は管理の鍵が無いと401で本番の設定ではNOT_READY_FOR_PRODUCTIONの403を返す',
  '管理の集計の応答は管理のスキーマに合う',
  '管理コマンドと同じ要求の形で集計を読める',
  'スキーマのファイルはOpenAPI 3.1で19個の操作を持つ',
  'スキーマのErrorCodeの列挙は19個のエラーコードと一致する',
  'demo-rpgはannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsを使う設定で登録される',
  'モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsとplayer-dataとquestsでルートが重ならない',
  '今のCLIモックと同じ形の要求を受け付ける',
  'CLIモックの通しの流れを続けて2回回しても利用制限に掛からない',
  '管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  '利用制限の回数と窓は定数のモジュールにある',
  'マイグレーションを2回当ててもデータは壊れない',
  'DBが失敗するとINTERNAL_ERRORの500を返し中身を漏らさない',
  '書き込みでDBが失敗してもINTERNAL_ERRORの500を返す',
]);
// 既存のマイグレーション・ゲームのクライアントのスキーマ・CLI モック・守り・設定を変えない
const keep = ['migrations/0001_initial.sql', 'migrations/0016_player_data_periods.sql', 'openapi/rpg-online.v1.json', 'scripts/cli-mock.mjs',
  'scripts/cli-requests.mjs', 'scripts/issue-run/', 'src/core/guards.ts', 'src/core/auth.ts', 'src/core/rate-limit-policy.ts', 'src/worker.ts',
  'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

N2:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0018_cleanup_indexes.sql', 'src/core/cleanup.ts', 'test/cleanup.test.ts'];
mustExist(files);
gitTracked(files);
check(/APP_ENV\s*!==\s*'local'/.test(read('src/core/guards.ts')), 'APP_ENV=local の守りが残っている');
const wr = read('wrangler.jsonc');
check(/"APP_ENV"\s*:\s*"disabled"/.test(wr), 'wrangler.jsonc の既定 APP_ENV=disabled が残っている');
check(/"crons"\s*:\s*\[\s*"30 18 \* \* \*"\s*\]/.test(wr), 'wrangler.jsonc に掃除の cron が 1 つある');
check(/scheduled/.test(read('src/worker.ts')), 'Worker の入口が scheduled を書き出す');
const cleanup = read('src/core/cleanup.ts');
check(/AUDIT_RETENTION_DAYS/.test(cleanup), '掃除が監査のログの保持の定数を読む');
check(!/quest_claims|event_claims|inventory_ledger/.test(cleanup), '掃除の文が受け取りの行と受領の履歴を指さない');
runTests();
requireTests([
  '掃除の切り目は表ごとの保持の日数から決まり監査のログは保持の定数を読む',
  '掃除は保持の日数を過ぎた行だけを消し切り目の行は残す',
  '掃除は受け取りの行と受領の履歴を消さない',
  '掃除はいまの区切りの値を消さずクエストの進捗が変わらない',
  '掃除は1つの文で消す行の数と1回に送る文の数に上限がある',
  '掃除は1つの表で落ちてもほかの表を消しDBのエラーの中身をログに出さない',
  'scheduledは本番の設定では何も消さない',
  'scheduledはローカルの設定で掃除を待ち合わせて流す',
  'wranglerの設定のcronは掃除の定数と同じでAPP_ENVの既定は変わらない',
  '管理の集計はその日の遊んだ人と新しい人の数を返しプレイヤーIDを返さない',
  'スキーマのファイルはOpenAPI 3.1で19個の操作を持つ',
  'スキーマのErrorCodeの列挙は19個のエラーコードと一致する',
  '今のCLIモックと同じ形の要求を受け付ける',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// wrangler.jsonc は triggers を足すので守らない（中身は上の check で見る）
const keep = ['migrations/0017_player_activity.sql', 'openapi/', 'scripts/', 'src/core/guards.ts', 'src/core/auth.ts', 'src/modules/',
  'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

N3:

```js
import { readFileSync, existsSync } from 'node:fs';
import { runTests, requireTests, mustExist, gitTracked, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
const base = 'MAIN_SHA'; // 実装の Issue を作るときの main の SHA に書き換える
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const pkg = ['package', 'json'].join('.');
const files = ['migrations/0019_analytics_grants_indexes.sql'];
mustExist(files);
gitTracked(files);
const admin = JSON.parse(read('openapi/rpg-online-admin.v1.json') || '{}');
check(Boolean(admin.paths?.['/v1/admin/analytics/grants']?.get), '管理のスキーマに配った量の口がある');
check(/analytics-grants/.test(read('scripts/admin-cli.mjs')), '管理コマンドに analytics-grants がある');
runTests();
requireTests([
  '管理の配った量の集計は日と種類と品目ごとに増やした量と減らした量を返す',
  '管理の配った量の集計はクエストごとの受け取りの数を日ごとに返す',
  '管理の配った量の集計は行の上限を越えると切ってtruncatedを返す',
  '管理の配った量の集計はほかのゲームの履歴を数えない',
  '管理の配った量の集計の応答は管理のスキーマに合う',
  '管理コマンドと同じ要求の形で配った量を読める',
  '管理の集計の応答は管理のスキーマに合う',
  '掃除は受け取りの行と受領の履歴を消さない',
  '管理コマンドと同じ流れで付与と取り消しとBANとイベントの定義が監査のログに残る',
  '管理のスキーマのErrorCodeの列挙は管理の口が返すコードと一致する',
  '管理のスキーマの操作は管理のルートと1対1で対応する',
  'スキーマのファイルはOpenAPI 3.1で19個の操作を持つ',
  'スキーマのErrorCodeの列挙は19個のエラーコードと一致する',
  'マイグレーションを2回当ててもデータは壊れない',
]);
// 既存のマイグレーション・ゲームのクライアントのスキーマ・CLI モック・掃除・モジュール・設定を変えない
const keep = ['migrations/0017_player_activity.sql', 'migrations/0018_cleanup_indexes.sql', 'openapi/rpg-online.v1.json', 'scripts/cli-mock.mjs',
  'scripts/cli-requests.mjs', 'scripts/issue-run/', 'src/core/guards.ts', 'src/core/cleanup.ts', 'src/modules/', 'src/worker.ts',
  'wrangler.jsonc', 'vitest.config.ts', pkg];
gitClean(keep, { base });
done();
```

- 確認コマンドの案は、実装の Issue を作る前に 1 回回し、「まだ作っていないから」落ちることを確かめる（`CLAUDE.md` の進め方の決まり）。
- 通しの確かめ（`npm run cli:smoke`・管理コマンド・`/cdn-cgi/local/scheduled`）は確認コマンドに入れない（無人の回では開発サーバーを起動せず、管理の鍵をファイルに書かない）。N1〜N3 の後に会話の側で回す（§0）。
- N2 の `wrangler.jsonc` の変更は、実装の Issue の「守るファイル」から外し、上の `check` で中身（`APP_ENV=disabled` が残る・cron が 1 つ）を見る。

## 15. 後の Phase との関係

この設計書で Phase 2 の項目は全部、設計が済む（`event-reward-design.md` §13 の順 4）。

| Phase（`roadmap.md`） | この設計が渡すもの |
| --- | --- |
| Phase 3（クライアント統合） | クライアントは何も足さない（「遊んだ」の記録はサーバーがトークンの要る要求から取る）。Unreal・Unity・ブラウザの SDK が起動の時に 1 回トークンの要る口（プレイヤーデータの読み取りなど）を呼べば、その日に遊んだに数えられる。SDK の手引きにその 1 行を書く |
| Phase 4（配布／OSS 公開） | §8 のバックアップと復元・費用アラートの説明書（`docs/guides/manuals/` の下）。「利用上限・コストモデル」の説明に、§6 の保持の日数・消さない 3 つの表の量の見積もり・`player_activity_days` の行の数（DAU × 400 日）を使う。管理画面（ブラウザ）で §5 の 2 つの口を表やグラフにする。`APP_ENV` の守りを外すとき、`scheduled` の門（§13 の決めること 16）も一緒に決める |

## 16. 範囲の外と、後から足せる形

| 範囲の外 | 後から足す形 |
| --- | --- |
| ゲームごとの時差での日の区切り | 新しい表 `game_analytics_settings(game_id, day_offset_minutes)` を足し、記録の日付をその時差で決める。過去の行は UTC のまま（境目がずれることを応答に書く） |
| 日ごとにまとめた表（集計が遅くなったとき） | `daily_stats(game_id, day, active_players, new_players, d1, d7, d30)` を足し、§7 の `scheduled` で前の日の分を書く。読む口はまとめた表と今日の数え上げを合わせる |
| WAU・MAU・rolling の継続 | 同じ `player_activity_days` から数える文を足す（表を変えない） |
| `0017` より前に発行したプレイヤーの初めての日 | さかのぼらない（`game_players.created_at` から作れるが、遊んだ日は残っていない）。記録は N1 から |
| 小さい数を伏せる（k 匿名） | 公開の画面に出すとき（Phase 4 の管理画面）に、閾値より小さい数を丸める関数を `src/core/analytics.ts` に足す |
| 受け取りの行・受領の履歴の掃除 | 量が問題になったら、デイリー・週間の過去の区切りの受け取りの行と、それを `source_id` で指す履歴の行を同じ日数で、1 つの `batch` で消す形を足す（一度きりの行は消さない） |
| 使われないゲストの掃除（`accounts`・`game_players`） | `player_activity_days` の最後の日を「最後に遊んだ日」として使い、期限を過ぎた人を消す。セーブ・所持品・履歴を一緒に消すかを決めてから（`abuse-protection-design.md` §12） |
| R2 への長期のバックアップの自動化 | 30 日より長い保持が要るときに、`wrangler.jsonc` に R2 の結び付けと Workflows を足す（公式の文書が案内する形。細部は**要確認**） |
| サーバーで費用を数える・利用制限を自動で下げる | しない（§13 の決めること 13） |
| Workers Analytics Engine への書き込み | D1 の数え上げで足りなくなったら、`consumeForPlayer` の隣に書き込みを足す（書き込み・読む口・料金は**要確認**） |
| 管理画面（ブラウザ）での集計の表示 | Phase 4（`admin-design.md` §14） |
| `APP_ENV` の守りを外すこと | ユーザーが決める（`admin-design.md` §10） |

## 17. 指示の表

| Issue #46 の指示 | どこで答えるか |
| --- | --- |
| DAU・継続率の元: 何をもって「遊んだ」とするか・1 人 1 日 1 行の表を足すか・日の区切り | §3・§4・§13 の決めること 1・2・7 |
| 記録を書く所が、いまの口の応答と速さに与える影響 | §4・§13 の決めること 3 |
| 継続率の定義（D1・D7 など） | §5・§13 の決めること 8 |
| 集計の形: 要求の時か Cron Triggers か・D1 だけか Analytics Engine か | §5・§13 の決めること 4・5 |
| 読み方: 管理の口か・管理コマンド・CLI モックに何を足すか・個人を出さないか | §5・§12・§13 の決めること 10・11 |
| 保持と掃除: 表ごとの保持の日数・消し方（上限・`batch`）・消してはいけない表 | §6・§13 の決めること 9 |
| Cron Triggers の `triggers.crons` と `scheduled` の入口・`npm run dev` での確かめ方・掃除と集計を同じ入口か | §7・§13 の決めること 6・16 |
| バックアップと復元（Time Travel・export）と、Phase 4 の配布の手順との境目 | §1・§8・§13 の決めること 12・§15 |
| 費用アラート（通知・使用量の見方を手順にするか、サーバーで数えるか） | §1・§8・§13 の決めること 13 |
| API とその確かめの順・認証・`APP_ENV`・利用制限・`game_modules` | §5・§9・§13 の決めること 15・16 |
| 新しいエラーコードはどちらのスキーマに入るか | §9・§13 の決めること 14 |
| 試験の名前（束は `N1`・`N2`…）・名前の中の数の試験・互換と管理の通しと管理のエラーコードの試験 | §10・§11 |
| 実装の束と、束ごとの確認コマンドの案（`requireTests`・`gitClean` に `base`） | §14 |
| Cloudflare の数字・機能は公式で確かめたか「要確認」・D1 のバインドの上限 | §1・§5・§6 |
| 新しいパッケージは足さない案を推し | §13 の決めること 17 |
| 管理の通しは管理の鍵を `--var` で渡す前提・開発サーバーを起動しない | §0・§7・§12・§14 |
| 本番の Cloudflare の操作・手順書の本文は書かず、置き場だけ決める | §8・§15 |
