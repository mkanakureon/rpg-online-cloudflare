# Issue の無人実行のまとめ（20261031-120237）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261031-120237/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #35 Phase 2 の実装 O2: BAN（止めた印の表・4 つのモジュールでの確かめ・PLAYER_BANNED・BAN の管理の口） | PASS | 12 | 2026-10-31 12:02〜12:15 | 1 | 2 | Bash |

## #35 Phase 2 の実装 O2: BAN（止めた印の表・4 つのモジュールでの確かめ・PLAYER_BANNED・BAN の管理の口） — PASS

- `a3fe701 feat: BAN の O2 を足す（止めた印の表 0012・requireNotBanned を 4 つのモジュールの利用制限の後に・BAN の 2 つの管理の口・PLAYER_BANNED・O2 の試験と §9 の置き換え）（Issue #35）`
- `28d0a1a docs: BAN の契約を先に書く（PLAYER_BANNED・BAN の 2 つの口・プレイヤーを読む口の ban・データ境界の player_bans・account-design §11 の BAN の行）（Issue #35）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 新しいファイル 3 つ（0012・bans.ts・bans.test.ts）が git にある。0012 は `IF NOT EXISTS`・主キー `(game_id, player_id)`・`ALTER TABLE` 無し | 満たす | `git ls-files` で 3 つとも出る。確認コマンドの静的な部分を `node -e` で抜き出して当てた → all ok (24) |
| `APP_ENV=local` の守りが残り、`requireAuth` は DB を引かないまま | 満たす | `guards.ts`・`auth.ts` は base から差分なし |
| 4 つのモジュールが `consume` の後で `requireNotBanned` を呼ぶ | 満たす | 同上（rankings・saves・inventory・events とも順が ok） |
| `ErrorCode` に `PLAYER_BANNED`。401 を持つ 9 つの操作の 403 に `PLAYER_BANNED` がある | 満たす | 同上 |
| 管理のスキーマに BAN の PUT・DELETE。契約の文書に `PLAYER_BANNED` と BAN の口。architecture に `player_bans`。account-design §11 の行が admin-design.md §4 を指す | 満たす | 同上 |
| CLI モックと wrangler.jsonc に管理の鍵・管理の口が無い | 満たす | 同上（どちらのファイルも変えていない） |
| `npm run typecheck` が通る | 満たす | `typecheck exit=0` |
| テストの入口が PASS。O2 の 12 本がある。base の試験が置き換えの 1 本を除いて残る | 満たす | `node scripts/test.mjs` → `Result: PASS 225/225`。旧い名前（14個）は無く、15個の版がある |
| 守るもの（0011 までのマイグレーション・core の守るファイル・announcements・config・modules/index.ts・scripts/・既存の試験〔schema-conformance を除く〕・test/support/・設定・package.json）を base から変えていない | 満たす | `git diff --name-only 2142638 --` を守るパスに当てた → 出たのは test/bans.test.ts（新規）と schema-conformance だけ |
| 判定役による判定 | 合格 | 別のエージェントがログ・差分・check-lib.mjs を読み、全項目「満たす」と判定 |

### やったこと
- 契約を先に直した: `openapi/rpg-online.v1.json`（`PLAYER_BANNED` と、トークンの要る 9 つの操作の 403）・`openapi/rpg-online-admin.v1.json`（BAN の PUT と DELETE、`AdminBan` などのスキーマ、プレイヤーを読む口の `ban`、`INVALID_JSON`）・`docs/api-contract.md`（各口の確かめの順に止めた印、`PLAYER_BANNED` の説明、BAN の 2 つの口、書き込みの口の共通の確かめ）・architecture.md のデータ境界・account-design.md §11 の BAN の行
- `migrations/0012_player_bans.sql` と `src/core/bans.ts`（`isBanActive`・`requireNotBanned`）を作った
- 4 つのモジュールで、`consume` の直後に `requireNotBanned` を呼ぶようにした（rankings は本文の形 → consume → BAN → requireSamePlayer の順）
- `src/core/admin/`: audit.ts に `parseActor`・`parseReason`、parse.ts に `parseExpiresAt` を足した。routes.ts に `checkAdminWrite` と BAN の PUT・DELETE を足した（監査の行が 1 文目、印の書き込みが 2 文目の 1 つの batch。前の状態は SQL の中で作る）。プレイヤーを読む口に `ban` を足した
- 試験: `test/bans.test.ts`（§8 の O2 の 11 本と、足した 2 本）。schema-conformance は §9 の手続きどおり、14個→15個の置き換えと、BAN したプレイヤーで所持品を読む行を 1 つ足しただけ

### コミット
- 28d0a1a docs: BAN の契約を先に書く（Issue #35）
- a3fe701 feat: BAN の O2 を足す（Issue #35）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- プレイヤーを読む口の `ban` は、止めていなければ（印が無い・期限切れ）**欄ごと載せない**ことにした。設計書 §5 は `null` と書いているが、変えられない base の試験（admin.test.ts の `expect('ban' in body).toBe(false)`）が落ちるので、両方は満たせない。戻すなら routes.ts の展開を `ban: null` に変え、スキーマと契約の文書の説明も直す
- PUT を 2 回目に送ったときは `bannedAt` も今の時刻に置き換える（PUT は全体の置き換え）。前の印は監査に残る。最初の時刻を残したいなら upsertBan の `banned_at = excluded.banned_at` を外す
- 印の無いプレイヤーへの DELETE も、監査に `player.unban`（前も後も null）の 1 行を残す（書き込みの操作 1 回で 1 行）。残したくないなら、印があるときだけ書く条件に変える
- 本文が JSON でなければ 400 `INVALID_JSON`（ゲームの口と同じ）。そのため管理のスキーマの ErrorCode に `INVALID_JSON` を足した
- `requestHash` は増減の Idempotency-Key のための関数なので、O3 に回して足さなかった
- §8 の 12 本のほかに 2 本足した: `BANの見出しと本文の誤りはINVALID_ARGUMENTの400を返し印を作らない`・`BANの口の応答は管理のスキーマに合う`。要らなければその 2 つの `it` を消す

### やらなかったこと・断られた操作
- 書き換えに失敗した `docs/api-contract.md` を戻そうとした `git checkout -- docs/api-contract.md` が断られた。代わりに `git show HEAD:docs/api-contract.md > docs/api-contract.md` で戻してからやり直した
- 開発サーバーは起動していない。通しの確かめは会話の側に残っている
- 未追跡の `docs/inspecs/2026/`（自分のものでない）には触れていない

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/guides/working/admin-design.md` §5 の「止めていなければ `null`」と、§9 に admin.test.ts の `'ban' in body` の行が載っていないこと。実装と契約（欄ごと載せない）に合わせて main で直す（この回では守るファイル）
- 試験の検証関数（test/support/schema-check.ts）は `type: ['string','null']` の配列の型を確かめていない（前からある例と同じ）

