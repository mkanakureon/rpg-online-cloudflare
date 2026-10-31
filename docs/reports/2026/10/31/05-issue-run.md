# Issue の無人実行のまとめ（20261031-132756）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261031-132756/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #37 Phase 2 の実装 O4: イベントの定義の管理の口と管理コマンド（品目とイベントの PUT・admin-cli の smoke） | PASS | 12 | 2026-10-31 13:28〜13:40 | 1 | 3 |  |

## #37 Phase 2 の実装 O4: イベントの定義の管理の口と管理コマンド（品目とイベントの PUT・admin-cli の smoke） — PASS

- `de2bc83 fix: 管理コマンドの put-event は理由が無ければ送る前に止める（Issue #37）`
- `452ae74 feat: 管理 O4 のイベントの定義と管理コマンドを足す（品目とイベントの PUT・parseEventDefinition・受け取りのあるイベントの守り・MAX_REWARD_LINES を src/core/inventory.ts へ・scripts/admin-cli.mjs と admin-requests.mjs と型・O4 の試験 8 本）（Issue #37）`
- `854bfd1 docs: O4 の契約を先に書く（品目とイベントの PUT・管理コマンド・event-reward-design.md §11 の決めること 7 と §14 を admin-design.md §7 に置き換え）（Issue #37）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 新しいファイル（`scripts/admin-cli.mjs`・`admin-requests.mjs`・`admin-requests.d.mts`）があり git に入っている | OK | `git ls-files` で 3 つとも出る |
| 管理コマンド: 要求の形の関数が品目とイベントの口を呼ぶ・`smoke` が `guestRequest` を使う・10 個の操作・鍵は `ADMIN_API_KEY`／ローカルの行き先だけ `.dev.vars` を読む・ファイルを書かない・既定の名前は `local-admin` | OK | 確認コマンドの文字列の部分だけを Node で回して全部 ok。`node scripts/admin-cli.mjs`（引数なし）→ 使い方を出して exit 2、鍵なし（`RPG_API_BASE=http://example.invalid`）→ `FAIL: ADMIN_API_KEY is not set` で exit 1 |
| `MAX_REWARD_LINES`（10）が `src/core/inventory.ts` にあり、events に定義が残っていない | OK | 同じ部分の確かめで ok（`src/modules/events/limits.ts` は `git rm`） |
| `APP_ENV=local` の守りが残っている | OK | `src/core/guards.ts` は base から差が無い |
| 管理のスキーマに品目とイベントの `PUT` がある | OK | `openapi/rpg-online-admin.v1.json` に 2 つの操作。試験「管理のスキーマの操作は管理のルートと1対1で対応する」が通る |
| `docs/api-contract.md` に品目とイベントの口がある | OK | 2 つの節を足し、旧文（「イベントを書き換える API は無い」「イベントの定義の口は後で足す」）を置き換えた |
| `event-reward-design.md` の §11 の決めること 7 と §14 の行が `admin-design.md` §7 を指す | OK | 部分の確かめで row7・row14 が ok |
| CLI モックと `wrangler.jsonc` に管理の鍵と管理の口が無く、`.dev.vars` は git に入っていない | OK | 部分の確かめで ok |
| 型: `npm run typecheck` が通る | OK | exit 0 |
| テストの入口が `Result: PASS` | OK | `node scripts/test.mjs` → `Result: PASS 248/248` |
| §8 の O4 の 8 本がある | OK | JUnit と突き合わせて、足りない・落ちたものが 0 |
| base（`92e20d9`）の試験は全部残って通る | OK | base の 240 本を JUnit と突き合わせて、足りない・落ちたものが 0 |
| 守るものを変えていない | OK | `git diff 92e20d9 HEAD -- <守るものの一覧>` が空 |

判定は、作った本人でない別のエージェントがログと差分を読んで行った。全部の条件が OK。

### やったこと
- 契約を先に書いた（最初のコミット）:
  - `docs/api-contract.md` に `PUT /v1/admin/items/{itemId}` と `PUT /v1/admin/events/{eventId}` の節と、管理コマンドの説明を足した。
  - 管理のスキーマに、2 つの操作と `AdminItem*`・`AdminEvent*` の型を足した。
  - `event-reward-design.md` の定数の表・§11 の決めること 7・§14 の 2 行を `admin-design.md` §7 を指す形に置き換えた。
- 実装:
  - `src/core/admin/parse.ts` に `parseItemKind` と `parseEventDefinition` を足した。ISO の時刻を読む所は `isoToSeconds` にまとめ、`parseExpiresAt` もこれを使う。
  - `src/core/admin/routes.ts` に品目とイベントの `PUT` を足した。
    - 先に読んで断る（違う種類は 400・知らない品目は 404・受け取りのあるイベントの区切りの変更は 400）。
    - 同じ条件を監査の行の文の `WHERE` にも入れた。
    - 監査の行 → `events` の upsert → 報酬の DELETE → 報酬の INSERT を 1 つの `batch` で書き、どの文も「この要求の `audit_ref` の行が入ったとき」だけ書く。
  - `MAX_REWARD_LINES` を `src/core/inventory.ts` へ移した。
- 管理コマンド: `scripts/admin-requests.mjs`（操作ごとの要求の形・`adminRequest`・送る関数を受け取る通しの `runSmoke`）・`admin-requests.d.mts`・`admin-cli.mjs`（10 個の操作）を作った。
- 試験: §8 の O4 の 8 本を `test/admin.test.ts` に足した。管理コマンドの試験は `runSmoke` に worker の `fetch` を渡す。

### コミット
- `854bfd1` docs: O4 の契約を先に書く
- `452ae74` feat: 管理 O4 のイベントの定義と管理コマンドを足す
- `de2bc83` fix: 管理コマンドの put-event は理由が無ければ送る前に止める（判定役の指摘）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- イベントの `PUT` の応答は `{gameId, eventId, kind, startsAt, endsAt, resetOffsetMinutes, rewards}` にした。`rewards` は品目の ID の昇順。`listEvents` と同じ欄の名前に、定義の `resetOffsetMinutes` を足した形。違っていたら `shownDefinition` とスキーマの `AdminEventResult` を直す。
- 通しの流れ `runSmoke` は `admin-requests.mjs` に置いた（送る関数を引数で受け取る）。これで CLI と試験が同じ流れを回す。違っていたら CLI 側へ移す。
- `local-admin` は CLI にも定数で書いた（確認コマンドが CLI の中の文字列を見るため）。`admin-requests.mjs` の `DEFAULT_ACTOR` と値が 2 か所にある。
- `test/admin.test.ts` の `beforeEach` に、受け取り・イベント・止めた印を消す行を足した（demo-rpg の手本の `daily-login` は残す）。品目を消す行は、demo-rpg の手本の `gold`・`potion` 以外も消すように広げた（smoke が demo-rpg に入れる品目を片付けるため）。既存の期待は変えていない。戻すときはその行を元に戻す。
- `src/modules/events/limits.ts` は中身がこの定数だけだったので `git rm` した。

### やらなかったこと・断られた操作
- 開発サーバーの起動と、実際の HTTP での `node scripts/admin-cli.mjs smoke`・`npm run cli:smoke` は回していない（Issue の決めごとどおり、会話の側でやる）。
- ロードマップの印は付けていない（会話の側でやる）。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `migrations/0010_events.sql` の説明に、もう無い `src/modules/events/limits.ts` の名前が残っている。既存のマイグレーションは書き換えない決まり。
- `admin-design.md` §7 に「`MAX_REWARD_LINES` は `src/modules/events/limits.ts` にある」と書いてある。いまは `src/core/inventory.ts`。設計書は守るファイルなので、この回では直していない。
- `audit --limit abc` は送る前に止めず、サーバーの 400 で止まる（害は無い）。

