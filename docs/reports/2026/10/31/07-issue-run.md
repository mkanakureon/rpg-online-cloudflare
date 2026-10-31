# Issue の無人実行のまとめ（20261031-143625）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261031-143625/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #39 Phase 2 の実装 U1: プレイヤーデータの値と書き込み（キーの宣言・add/max/set/flag・Idempotency-Key・2 つのエラーコード） | PASS | 13 | 2026-10-31 14:36〜14:49 | 1 | 3 | Write |

## #39 Phase 2 の実装 U1: プレイヤーデータの値と書き込み（キーの宣言・add/max/set/flag・Idempotency-Key・2 つのエラーコード） — PASS

- `41d5014 fix: プレイヤーデータのモジュールの頭書きに管理の口のパスを書かない（確認コマンドの読み込みの確かめに当たらないように）（Issue #39)`
- `5f02f33 feat: プレイヤーデータの値と書き込み（U1）を実装する（0013 の 3 つの表・GET と POST /v1/player-data・add/max/set/flag・Idempotency-Key で二重を止める 1 つの batch・RATE_LIMITS.playerData・Idempotency-Key の形を src/core/idempotency.ts へ移す・§10 の U1 の試験と §11 の置き換え 4 本と行の追加 3 本）（Issue #39）`
- `fd81952 docs: プレイヤーデータの 2 つの口の契約を書く（GET・POST /v1/player-data・Idempotency-Key 必須・PLAYER_DATA_LIMIT_EXCEEDED と IDEMPOTENCY_KEY_REUSED をゲームのクライアントのスキーマに・利用制限 player-data・データ境界の 3 つの表）（Issue #39）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 新しいファイル 7 つが git に入っている・0013 の形（3 表 IF NOT EXISTS・UNIQUE (game_id, player_id, request_key)・INSERT OR IGNORE で player-data・ALTER TABLE 無し） | 満たす | 確認コマンドから `runTests()` だけ抜いたもの（`/tmp/pdwork/partial-check.mjs`）が `OK（全部満たす）` |
| 実装: consume → requireNotBanned の順・1 つの batch・`src/core/admin/` を読まない・IDEMPOTENCY_KEY_PATTERN を移した・RATE_LIMITS.playerData・APP_ENV の守り | 満たす | 同上の該当行がすべて OK |
| 契約と文書: スキーマの 2 操作（429 RATE_LIMITED・403 PLAYER_BANNED）・ErrorCode の 2 つ・api-contract の 2 節と PLAYER_DATA_LIMIT_EXCEEDED と利用制限の行・architecture のデータ境界と冪等性の行・abuse-protection §2 の行 | 満たす | 同上の該当行がすべて OK |
| 型: `npm run typecheck` | 満たす | 終了コード 0 |
| 試験: `Result: PASS`・U1 の 31 本・base の試験が置き換えの 4 本を除いて残って通る・旧い名前が無い | 満たす | `node scripts/test.mjs` → `Result: PASS 275/275`。そのときの junit で requireTests がすべて OK |
| 守るもの（既存のマイグレーション・core の 8 ファイル・ほかのモジュール・scripts/・管理のスキーマ・直さない試験・test/support/・設定・package.json） | 満たす | gitClean（base 99d30f8）の行がすべて OK |
| 別のエージェントの判定 | 合格 | 判定役がログと差分を読んで、全部の条件を満たすと判定。欠陥は無し |

### やったこと
- 契約を最初に直した: `docs/api-contract.md` に `GET`・`POST /v1/player-data` の節を足し、エラーコードと利用制限の表、`Idempotency-Key` の旧い文を置き換えた。`openapi/rpg-online.v1.json` に `getPlayerData`・`writePlayerData`、スキーマ 5 つ、ErrorCode の 2 つを足した。`architecture.md` と `abuse-protection-design.md` も直した。
- `migrations/0013_player_data.sql`（設計書 §3 と同じ SQL）を足した。
- 新しく作ったコード:
  - `src/core/player-data.ts`（MAX_PLAYER_DATA_VALUE・PLAYER_DATA_MODES・checkChange）
  - `src/core/idempotency.ts`（IDEMPOTENCY_KEY_PATTERN・parseIdempotencyKey・sha256Hex）
  - `src/modules/player-data/`（index.ts・parse.ts・limits.ts）
- 既存のコードの直し:
  - 管理の `audit.ts`・`routes.ts` は `src/core/idempotency.ts` を読む形に直した（値と形は変えていない）。
  - `RATE_LIMITS.playerData` を足し、`src/modules/index.ts` にモジュールを登録した。
- 試験:
  - `test/player-data.test.ts` に U1 の 27 本を書いた。
  - §11 のとおり、4 本の名前と期待を置き換え、3 本に行を足した（rate-limits・schema-conformance の 409 と 422・bans の 2 つの操作）。

### コミット
- fd81952 docs: プレイヤーデータの 2 つの口の契約を書く
- 5f02f33 feat: プレイヤーデータの値と書き込み（U1）を実装する
- 41d5014 fix: プレイヤーデータのモジュールの頭書きに管理の口のパスを書かない

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- batch の文 1 は、共通の値を `FROM (SELECT ? AS ref, ? AS g, …) w` で 1 回だけ bind する形にした。設計書の SQL は `:g`・`:p` を `add` の条件ごとに bind するので、20 行のときに D1 の 1 文の引数の上限（100）を超える。いまの形の bind は最大 66。中身は設計書と同じ。戻すときは `insertWriteSql` を設計書の形に書き換える。
- 応答の写しの `json_group_array` を `json(...)` で包んだ。サブクエリを通ると JSON の印が落ち、`values` が文字列になるのを防ぐため。応答の `values` はコードの側でもキーの昇順に並べ直している。
- `sha256Hex` は元の `audit.ts` には関数として無く、`requestHash` の中に処理が直に書かれていた。`src/core/idempotency.ts` に関数として切り出し、`requestHash` から呼ぶ形にした（出力は同じ）。セーブの `src/modules/saves/checksum.ts` の同じ名前の関数は守るファイルなので、そのまま残した。
- `test/bans.test.ts` の writePlayerData の行は `Idempotency-Key` を付けずに送る。止めた印の確かめは見出しの確かめより先なので、それでも 403 PLAYER_BANNED になる。行を足すだけにして、手伝いの関数を変えないため。

### やらなかったこと・断られた操作
- CLI モック（U2）・実績（U2）・管理の口と管理コマンド（U3）は、範囲の外なので手を入れていない。開発サーバーは起動していない。
- 断られた操作は無い。ただ、試験のファイルを書く Write が 1 回、承認の判定から答えが返らず失敗した。そのまま送り直して通った。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- スキーマの `PlayerDataWrite.changes` に `minItems: 1` が無い（説明文と実装は 1 行以上）。`test/support/schema-check.ts` が `minItems` を知らない語として例外にするので、足すにはその守るファイルを直す必要がある。
- `PlayerData.values` の `maxItems: 200` は、U3 の `MAX_PLAYER_DATA_KEYS` を先に書いた形になっている。U3 で定数と突き合わせる。
- `player_data_writes` の古い行を掃除する仕組みは、設計書 §15 の分析の束で作る。

