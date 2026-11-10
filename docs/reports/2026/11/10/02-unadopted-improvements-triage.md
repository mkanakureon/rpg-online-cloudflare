---
date: 2026-11-10
type: report
project: rpg-online-cloudflare
---

# 未採用の改善の仕分けと対応（2026-11-10。main `e3a109e` に対して仕分けた）

元: `.issue-run/logs/*/issue-<N>-report.md` の `## 未採用の改善`（Issue ごとに最後の報告。58 件）。箇条は 119 行（#55 の「なし」と #36 の見出しの 1 行を含む）。`docs/reports/2026/*/*/*-issue-run.md` の `### 未採用の改善` と突き合わせ、文は全部同じだった（差 0 行）。同じ中身の行はまとめた（#8/#9、#18/#19、#23/#34、#32/#47、#35/#41、#42/#44、#45/#47）。

**件数: 済み 41・残る 46・不要 21**（まとめた後の 108 件）

重なりの列: 「§3.2-N」「§4.3-N」は `docs/reports/2026/11/10/01-repo-and-issue-driven-review-report.md` の番号。「と同じ」は同じ所見、「に近い」は一部が重なる。

| Issue | 内容（短く） | 判定 | 種類 | 根拠（file:line） | 重なり |
|---|---|---|---|---|---|
| #5 | working/ に文書を足したら CLAUDE.md の入口の表へ 1 行足す決まり | 残る | 文書 | `docs/guides/README.md:25` が決まり。CLAUDE.md の入口の表に設計書（abuse-protection・account・admin など 13 個）が無い | — |
| #5 | 登録の無いゲームの扱いが api-contract に無い | 済み | — | `docs/api-contract.md:33,77`（404 `Unknown game`） | — |
| #6 | 2^53+1 は JSON の読みで丸まり、安全な整数の外だけを見る試験が作れない | 不要 | — | 10 億の上限が先に効く。契約どおり（`docs/api-contract.md:77` 付近の範囲） | — |
| #6 | `tsconfig.json` が `test/` を型の確かめに入れていない | 済み | — | `tsconfig.json` の `include` に `test/**/*.ts` | — |
| #7 | CLI モックの本文を試験が写していて、CLI モックだけ変えても落ちない | 済み | — | CLI モックは SDK の `runScenario` を `runCli` で呼ぶ（`scripts/cli-mock.mjs:10-19`）。試験が同じ `runCli` を回す（`test/browser-sdk.test.ts:22,394-401`） | — |
| #7 | 「行は増えない」が前後の比較でなく 0 との比較 | 不要 | — | `beforeEach` で空にするので同じ意味（報告者の判断）。`test/failure-server.test.ts:88` | — |
| #8 | 作った型で `APP_ENV` が `"disabled"` 固定になる | 済み | — | `worker-configuration.d.ts:6`（`APP_ENV: string`） | — |
| #8 | `cf-typegen` の作り直しが手順に無い | 済み | — | `CLAUDE.md:22` | — |
| #8・#9 | `wrangler types` が `@types/node` を入れてと出す | 不要 | — | 依存を足さない作り。`tsconfig.json` の `"types": []` | — |
| #10 | CLI モックに `gameId=demo-rpg` を直書き | 不要 | — | SDK のクライアントの設定値として渡す形になった（`scripts/cli-mock.mjs:16`） | — |
| #11 | `RankingEntry` の応答のスキーマが DB の CHECK より厳しい（DB は score だけ） | 残る | コード（低） | `migrations/0001_initial.sql:14`（CHECK は score だけ）・`openapi/rpg-online.v1.json:3867`（`maxLength: 40` ほか） | — |
| #12 | api-schema-design §2「JSON の import は `resolveJsonModule` で通る」が事実と違う | 残る | 文書（低） | `docs/guides/working/api-schema-design.md:57`。`tsconfig.json` にその設定は無い | — |
| #12 | `getHealth` の 500 と `Object required` の 400 を HTTP で起こす試験が無い | 残る | 試験（低） | `test/health.test.ts:5`（成功だけ）。`Object required` は関数の単体だけ（`test/modules.test.ts:45`） | — |
| #13 | 確認コマンドの `gitClean` に `base` が無いとコミット後に素通り | 済み | — | `scripts/issue-run/check-lib.mjs:70-76`・`docs/guides/procedures/issue-goal-setting.md:84` に `base` の案内 | — |
| #14 | ルートの重なりの試験が pattern の文字列の一致しか見ない | 残る | 試験（低） | `test/modules.test.ts:16` | — |
| #15 | api-schema-design の表に「データが無くても 200 と空の items」が残り 404 が無い | 残る | 文書（低） | `docs/guides/working/api-schema-design.md:39`（同じ表の 41 行に `Authentication not implemented`） | 41 行は §3.2-15 に近い |
| #16 | 設計書 §2・§3（`known` の引数・`ON DELETE CASCADE`）を実装に合わせる | 済み | — | `docs/guides/working/core-foundation-design.md:88,127,151` | — |
| #16 | `Unknown game` の message を見る試験が無い | 済み | — | `test/config.test.ts:210`・`test/admin.test.ts:302` | — |
| #17 | schema-conformance の `beforeEach` が `accounts`・`game_players` を消さない | 残る | 試験（低） | `test/schema-conformance.test.ts:204-210` | — |
| #17 | 判定役の小さな提案（設計書に `Statement.first` を書く） | 不要 | — | 合否に関わらない提案。設計書に実装の細部を足す方向（§4.3-6 の推しと逆） | — |
| #18・#19 | トークンの鍵が無い（`tokenSecret` が null）ときの 500 を HTTP で見る試験が無い | 残る | 試験（低） | 関数の単体だけ（`test/accounts.test.ts:137-144`） | — |
| #18 | `console.error` が DB のエラーをそのままログに出す | 残る | コード（低） | `src/worker.ts:24` | — |
| #20 | api-contract の「将来予定」にセーブが残る | 済み | — | `docs/api-contract.md:786-791`（掲示板・ゴーストだけ） | — |
| #20 | architecture §2 の「R2: セーブデータ」 | 済み | — | `docs/guides/working/architecture.md:29`（いまは使わない、と書いてある） | — |
| #21 | `MAX_SLOTS` を作るかで Issue と設計書が食い違う | 済み | — | `docs/guides/working/save-design.md:124`・`src/modules/saves/limits.ts` | — |
| #21 | core-foundation-design §5 の確認コマンドの記録に古い名前 | 不要 | — | 記録として残すもの（CLAUDE.md 原則 5 の「記録」） | — |
| #22 | PUT・DELETE の失敗の分け方（`hasLiveSlot`）が別の問い合わせで、競合時に返すコードが入れ替わりうる | 残る | コード（低） | `src/modules/saves/index.ts:94,132,177`。データは壊れない | — |
| #22 | `MAX_SLOTS` を下げると一覧の `LIMIT` で生きているスロットが見えなくなる | 残る | コード（低） | `src/modules/saves/index.ts:196` | — |
| #23・#34 | SHA-256 の 16 進・`isoSeconds` の写し | 残る | コード（低） | `src/core/idempotency.ts:19`・`src/modules/saves/checksum.ts:10`・`src/core/period.ts:55`・`src/core/admin/audit.ts:58`・`src/modules/inventory/shape.ts:46` | §3.2-12 と同じ |
| #23 | CORS で `ETag` を読ませる見出しが未定 | 済み | — | `src/core/cors.ts:16,27`（`Retry-After`・`ETag`） | — |
| #24 | `GameModule.name` のコメントに `config` が無い | 済み | — | `src/core/module.ts:16`（8 つ全部） | — |
| #24 | 数字だけのフラグ名が JS のオブジェクトで先に並び、`flags` が厳密に昇順にならない | 残る | コード（低） | `src/modules/config/index.ts:58,66` | — |
| #24 | `scripts/cli-mock.mjs` の頭書きに流れの説明が無い | 済み | — | `scripts/cli-mock.mjs:2-5` | — |
| #25 | config-design の `size: 24`・demo-rpg の items の INSERT・toMatchObject の注 | 済み | — | `docs/guides/working/config-design.md:169`（`size: 23`）。demo-rpg の items の INSERT は §2 に無い（107-110 行） | — |
| #25 | demo-rpg にマスターデータが無く `cli:smoke` がその流れを通らない | 残る | コード（低） | `docs/guides/working/config-design.md:341`（範囲外の表に後の仕事として記録）。`migrations/` に demo-rpg の master data の INSERT が無い | — |
| #26 | 送信 ID の試験が既存の二重送信の試験と中身が重なる | 不要 | — | 設計の選択として明記済み（報告の文）・`docs/guides/working/account-design.md:275` | — |
| #26 | failure-case-test-plan の K3 の連投の書き方が設計と違う | 済み | — | `docs/guides/working/failure-case-test-plan.md:179`（R1 で `test/rate-limits.test.ts` に作った） | — |
| #27 | abuse-protection §3 の検査の順でスコアの制限が JSON の前 | 済み | — | `docs/guides/working/abuse-protection-design.md:152`（形の後へ移したと書いてある） | — |
| #27 | account-design §3・§5 の検査の順に利用制限が無い | 済み | — | `docs/guides/working/account-design.md:126,130,200` | — |
| #27 | save-design・config-design に「11 個のエラーコード」の名前が残る | 不要 | — | その束の記録としての記述（`save-design.md:354`・`config-design.md:48`）。いまの数の正は `docs/api-contract.md:723` | — |
| #27 | IP のハッシュに塩が無く IPv4 は総当たりで戻せる | 残る | コード（中） | `src/core/rate-limit.ts:33`（素の SHA-256） | — |
| #27 | 同点がたまると `cli:smoke` が上位 10 件の確かめで落ちる | 済み | — | 回ごとに新しいボードを作る（`clients/browser/rpg-online-client.mjs:472`） | — |
| #27 | CLAUDE.md の「認証・レート制限・不正対策は未実装」 | 済み | — | `CLAUDE.md:8`（ゲストのトークン・D1 の固定窓） | — |
| #28 | 同じミリ秒に 2 回回すと同じボード | 不要 | — | 実際には起きない（報告者の判断）。`clients/browser/rpg-online-client.mjs:472` | — |
| #28 | abuse-protection の例 `POST /v1/rankings/boss-score: 429` がいまのボード名・いまの CLI モックと違う | 残る | 文書（低） | `docs/guides/working/abuse-protection-design.md:291` | — |
| #29 | abuse-protection §7 の R2 のファイル名の食い違い | 済み | — | `docs/guides/working/abuse-protection-design.md:207`（`test/saves-rate-limits.test.ts`） | — |
| #29 | save-design §3 の検査の順に 429 が無い | 済み | — | `docs/guides/working/save-design.md:165,218,232` | — |
| #29 | 429 を直に見る試験が GET の一覧と PUT だけ（1 つの GET・DELETE は無い） | 残る | 試験（低） | `test/saves-rate-limits.test.ts:45-59` | §3.2-12 に近い（`checkAccess` の写し） |
| #30 | architecture の「冪等性」が報酬の受け取りに `Idempotency-Key` と書く | 済み | — | `docs/guides/working/architecture.md:40` | — |
| #31 | `limit=007` を受け付ける | 不要 | — | 害は無い・セーブと同じ作り（報告者の判断） | — |
| #31 | `0008_rate_limits.sql` の scope の注記に `rewards` が無い | 不要 | — | 既存のマイグレーションは書き換えない（CLAUDE.md「守るもの」）。正は `abuse-protection-design.md:105` | — |
| #32 | イベントの一覧の受け取りの文が 2+2×イベント数のバインドで 100 に当たりうる | 済み | — | 区切りの鍵を重ならない数個にした（`src/modules/events/index.ts:39-41`） | — |
| #32 | schema-conformance で入れたイベントと残高が試験の後に残る | 残る | 試験（低） | `test/schema-conformance.test.ts:204-210`（消すのはランキングとお知らせだけ） | — |
| #32・#47 | UTC 0 時をまたいで回すと揺れうる試験 | 残る | 試験（低） | 時計を差し替える口が無い | §3.2-13 と同じ |
| #32 | 並べて送る試験は実際は batch を続けて流すことを見ている | 不要 | — | 設計書 §5 の前提どおり（報告の文） | §3.2-13 に近い |
| #33 | `docs/inspecs/2026/` が git の追跡外 | 不要 | — | 人の入力の置き場で Claude は触らない（CLAUDE.md の置き場の表） | — |
| #34 | 設計書 §2 で audit.ts の書き込みの手伝いが O1 で作るように読める | 済み | — | `docs/guides/working/admin-design.md:92`（O1〜O3 を書き分け） | — |
| #34 | abuse-protection の単位の名前に `rewards`・`admin` が無い | 済み | — | `docs/guides/working/abuse-protection-design.md:76-77,105,219` | — |
| #35 | admin-design §5 の「止めていなければ null」と §9 の `'ban' in body` | 済み | — | `docs/guides/working/admin-design.md:219,414` | — |
| #35・#41 | 試験の検証関数が `type` の配列（`['string','null']`）を確かめない | 残る | 試験（低） | `test/support/schema-check.ts:65`（`typeof schema.type === 'string'` のときだけ） | — |
| #36 | 判定役の試験 3 つ（無い品目への負の delta が 404・batch と読み直しの間の分かれ道・監査の `request_key` が送った鍵と同じか） | 残る | 試験（低） | `test/admin.test.ts:646-650`（`request_key` は形だけ見る） | — |
| #36 | architecture に `src/core/ledger.ts` の置き場が無い | 済み | — | `docs/guides/working/architecture.md:63` | — |
| #37 | `0010_events.sql` の説明に消えた `limits.ts` の名前 | 不要 | — | 既存のマイグレーションは書き換えない（CLAUDE.md「守るもの」） | — |
| #37 | admin-design §7 の `MAX_REWARD_LINES` の置き場 | 済み | — | `docs/guides/working/admin-design.md:324`（`src/core/inventory.ts`） | — |
| #37 | `audit --limit abc` を送る前に止めない | 残る | コード（低） | `scripts/admin-cli.mjs:125`（`Number(f.limit)`。サーバーの 400 で止まる） | — |
| #38 | event-reward-design §13 の順 2・admin-design §13 を新しい設計書へ向ける | 済み | — | `docs/guides/working/event-reward-design.md:595-596` | — |
| #39 | `PlayerDataWrite.changes` に `minItems: 1` が無い（検証関数が `minItems` を知らない） | 残る | 試験（低） | `openapi/rpg-online.v1.json:4698-4701`・`test/support/schema-check.ts:51` | §3.2-14 に近い |
| #39 | `PlayerData.values` の `maxItems: 200` と定数の突き合わせ | 済み | — | `src/core/player-data.ts:14`（200）・`openapi/rpg-online.v1.json:4659` | — |
| #39 | `player_data_writes` の古い行の掃除 | 済み | — | `src/core/cleanup.ts:20` | — |
| #40 | 試験の stderr に偽の DB の `no such table` が出る | 不要 | — | 偽の DB の試験の意図どおり | — |
| #41 | キーの宣言で競合したとき 400 の message が `tooManyKeys` になりうる | 残る | コード（低） | `src/core/admin/routes.ts:666` | — |
| #41 | 実績の `threshold` がキーの `maxValue` を超えても通る | 残る | コード（低） | `src/core/admin/routes.ts:266-272` | §3.2-6 と同じ |
| #42・#44 | D1 の `batch` の文の数の上限が「要確認」のままで、63 文の書き込みを見る試験も無い | 残る | 試験（低）・文書 | `docs/guides/working/quest-design.md:331`・`docs/guides/working/analytics-design.md:59` | — |
| #42 | `npm run dev -- --var ADMIN_API_KEY:<鍵>` の形が未確認 | 済み | — | `docs/guides/working/analytics-design.md:35,265`（会話の側の通しで使った） | — |
| #43 | 設計書の「文 1 のバインドは 18 前後」が実際は 16 | 残る | 文書（低） | `docs/guides/working/quest-design.md:297` | §4.3-6 に近い（設計書に実装の細部） |
| #44 | `loadKeyPeriods` が add のキーの無い書き込みでも読む | 残る | コード（低） | `src/modules/player-data/index.ts:197` | — |
| #44 | 区切りの宣言を batch の外で読むので、読んだ後に宣言が変わる隙間がある | 残る | コード（低） | `src/modules/player-data/index.ts:197-200`（Q3 で宣言を書く口が入った） | — |
| #45・#47 | admin-design §7 の管理コマンドの操作の一覧が古い（`put-quest`・`put-data-key` などが無い） | 残る | 文書（低） | `docs/guides/working/admin-design.md:334`。実物は `scripts/admin-cli.mjs:5-21` | §4.3-6 に近い |
| #45 | 受け取りの無いクエストのキーや区切りを変えても、前のキーの `player_data_key_periods` が残る | 残る | コード（低） | 消す口が無い | §3.2-7 と同じ |
| #45 | 競合の後に理由が見つからないとき、どの原因でも「claimed quest」の 400 | 残る | コード（低） | `src/core/admin/routes.ts:371` | — |
| #46 | 「掃除は分析で」の文が古くなる | 済み | — | `player-data-design.md:327`・`quest-design.md:175`・`admin-design.md:197` | — |
| #47 | analytics-design §4 の遊んだ行の文が 4 バインドの EXISTS と違う | 済み | — | `docs/guides/working/analytics-design.md:145` | — |
| #47 | モジュールの頭書きに遊んだ記録の一言が無い | 残る | 文書（低） | 6 つのうち `src/modules/player-data/index.ts` の頭書きだけ無い（ほか 5 つは有り） | — |
| #47 | BAN（403）で断った要求も遊んだ行に数えることを見る試験が無い | 残る | 試験（低） | 429 の版はある（`test/analytics.test.ts:211`）。403 の版は無い | — |
| #47 | 今日の D1 はその日の途中の数、と管理コマンドの出力に書くとよい | 残る | 文書（低） | `scripts/admin-cli.mjs:19` に注が無い | — |
| #48 | audit.ts・`0011_admin.sql` に「消す仕組みは後で足す」 | 不要 | — | audit.ts は直っている（`src/core/admin/audit.ts:14`「cleanup.ts の掃除が…消す」）。残りは `migrations/0011_admin.sql:4` で書き換えない | §3.2-15 と同じ（ただし §3.2-15 が挙げる `audit.ts:14` は main で直っている） |
| #48 | event-reward-design・abuse-protection に掃除を後の仕事とする文 | 残る | 文書（低） | `docs/guides/working/abuse-protection-design.md:370`（`rate_limit_counters` は `src/core/cleanup.ts:22` で掃除済み）・`docs/guides/working/event-reward-design.md:612`（受け取り・履歴は消さない決定 `analytics-design.md:27` と食い違う） | — |
| #48 | 文の数の上限の試験が実の DB では合計だけ見る | 不要 | — | 偽の DB と上限を小さくした回で確かめている（報告の文） | — |
| #49 | クエストの達成率を管理コマンドで出す仕組みが無い | 残る | コード（低） | `scripts/admin-cli.mjs:20`（応答の JSON だけ） | — |
| #50 | api-contract の「現PoCの代表コード」で 19 個が全部と読めない | 済み | — | `docs/api-contract.md:723`（「19 個で全部」） | — |
| #51 | エラーコードの表の試験が種類だけ見る | 不要 | — | 設計 §9 の粒度どおり。表の値は B2 の SDK の試験で比べる（報告の文） | — |
| #51 | api-schema-design が拡張の欄に `x-error-codes` しか挙げない | 不要 | — | `x-client-policy`・`x-retry` の正は `client-integration-design.md:188` | — |
| #52 | `scripts/cli-requests.mjs` の頭書き「CLI モックがここを読み込む」が事実と違う | 残る | 文書（低） | `scripts/cli-requests.mjs:3`（CLI モックは SDK を読む。`scripts/cli-mock.mjs:10-11`） | §3.2-15 に近い（古い注記。ただし §3.2-15 に載っていない） |
| #52 | 多くの設計書が「`scripts/cli-mock.mjs` の流れ」を指す（中身は SDK の `runScenario`） | 残る | 文書（低） | `cli-mock` を含む設計書 13 個（例 `config-design.md:255`・`save-design.md`・`quest-design.md`） | §4.3-6 に近い |
| #52 | 再試行の前の待ちを途中で止められない | 済み | — | `clients/browser/rpg-online-client.mjs:117-121`（`signal` で解く） | — |
| #53 | analytics-design §5 の「更新の口が無い」 | 済み | — | `docs/guides/working/analytics-design.md:172` | — |
| #53 | 設計書 §10 の B3 の行に `bans.test.ts` が無い | 済み | — | `docs/guides/working/client-integration-design.md:419` | — |
| #53 | 「利用制限 → 止めた印」の順を 1 本で見る試験が無い | 残る | 試験（低） | `test/bans.test.ts`・`test/rate-limits.test.ts` に該当の名前が無い | — |
| #54 | config-design の範囲外の表に「CORS は Phase 3 で決める」 | 済み | — | `docs/guides/working/config-design.md` に CORS の行が無い（341-342 行は master data だけ） | — |
| #56 | お知らせの `LIMIT 50` が定数になっていない | 残る | コード（低） | `src/modules/announcements/index.ts:24` | — |
| #57 | C# の再試行の動きは Mac で確かめられない（専用 PC で Unity の試験） | 残る | 試験（低） | 人の確かめ（専用 PC） | §4.3-2 と同じ |
| #58 | Unity の層がセッションの無いとき同期で返す | 不要 | — | 同期で終わる前提で扱っている（`clients/unity/Runtime/RpgOnlineClient.cs:246`）。C# の `Task` は呼び手の `await` が同じに動く | — |
| #59 | roadmap の Phase 3 の印が付いていない | 残る | 文書（低） | `docs/guides/decisions/roadmap.md:49-52`（`[ ]`） | §4.3-2 と同じ |
| #59 | 試験 `トークンの更新はAPP_ENVがlocalでなければ403を返す` の新しい名前を P6 で決める | 残る | 試験（低） | `test/accounts.test.ts:257` | §3.2-1 に近い（P6 の守りを外す束の入力） |
| #60 | README の「認証実装が必要です」が古い | 済み | — | `README.md:7,40` | — |
| #60 | `package.json` に `license` が無い | 不要 | — | Issue の決定で P1 では足さない（報告の文）。`LICENSE` はある | — |
| #61 | README の 40 行目と「いまの制限」（66 行目）が 403 の説明で重なる | 残る | 文書（低） | `README.md:40,66` | — |
| #62 | Time Travel の日数・restore の確認・予算アラートの Free での可否が「要確認」 | 残る | 文書（低） | `docs/guides/manuals/backup-restore.md:19,59,103`・`docs/guides/manuals/cost-alerts.md:15,26` | §4.3-2 に近い（人がダッシュボードで確かめる） |

## 残るもののうち、レビューに無いもの

重なりの列が空の 32 件（「に近い」の 8 件と「と同じ」の 6 件は除く。#15 は 41 行の一部だけが §3.2-15 に近いので、ここに入れた）。

### コード（14）

- #27 IP のハッシュに塩が無い（`src/core/rate-limit.ts:33`）— **中**。公開の前に鍵付きのハッシュ。
- #11 ランキングの DB の CHECK が応答のスキーマより緩い（`migrations/0001_initial.sql:14`）。
- #18 `console.error` が DB のエラーをそのまま出す（`src/worker.ts:24`）。
- #22 `hasLiveSlot` が別の問い合わせで、競合時にコードが入れ替わる（`src/modules/saves/index.ts:94`）。
- #22 `MAX_SLOTS` を下げると一覧の `LIMIT` で見えなくなる（`src/modules/saves/index.ts:196`）。
- #24 数字だけのフラグ名で `flags` の並びが崩れる（`src/modules/config/index.ts:66`）。
- #25 demo-rpg のマスターデータが無く `cli:smoke` がその流れを通らない（`config-design.md:341` に記録済み）。
- #37 `audit --limit abc` を手元で止めない（`scripts/admin-cli.mjs:125`）。
- #41 競合時の 400 の message が `tooManyKeys` になる（`src/core/admin/routes.ts:666`）。
- #44 `loadKeyPeriods` が要らない時も読む・区切りの宣言を batch の外で読む隙間（`src/modules/player-data/index.ts:197`。2 件）。
- #45 理由が見つからないとき一律に「claimed quest」の 400（`src/core/admin/routes.ts:371`）。
- #49 クエストの達成率を管理コマンドで出せない（`scripts/admin-cli.mjs:20`）。
- #56 お知らせの `LIMIT 50` の直書き（`src/modules/announcements/index.ts:24`）。

### 試験（10）

- #12 `getHealth` の 500・`Object required` の 400 を HTTP で起こす試験が無い。
- #14 ルートの重なりを文字列の一致でしか見ない（`test/modules.test.ts:16`）。
- #17・#32 schema-conformance の `beforeEach` が消さない表がある（`test/schema-conformance.test.ts:204`。2 件）。
- #18・#19 トークンの鍵が無いときの 500 を HTTP で見ない。
- #35・#41 検証関数が `type` の配列を見ない（`test/support/schema-check.ts:65`）。
- #36 管理の増減の試験 3 つ（負の delta の 404・batch の分かれ道・`request_key` の値）。
- #42・#44 `batch` の文の数の上限（要確認）と 63 文の書き込みの試験。
- #47 BAN（403）で断った要求も遊んだ行に数えることの試験。
- #53 「利用制限 → 止めた印」の順を 1 本で見る試験。

### 文書（8）

- #5 CLAUDE.md の入口の表に設計書が無い（`docs/guides/README.md:25` の決まりとの差）。
- #12 api-schema-design の `resolveJsonModule` の文（`api-schema-design.md:57`）。
- #15 api-schema-design の表の「200 と空の items」（`api-schema-design.md:39`）。
- #28 abuse-protection の例のボード名・CLI モックの書き方（`abuse-protection-design.md:291`）。
- #47 player-data の頭書きに遊んだ記録の一言・管理コマンドの「今日は途中の数」の注（2 件）。
- #48 掃除を後の仕事とする古い文（`abuse-protection-design.md:370`・`event-reward-design.md:612`）。
- #61 README の 403 の説明の重なり（`README.md:40,66`）。

### 仕組み（issue-run・キット）

- なし（#13 の `gitClean` の `base` は手順に入っていて済み）。

## 仕分けの補足

- レビュー §3.2-15 が古い注記として挙げる `src/core/admin/audit.ts:14` は、main（`e3a109e`）ではもう直っている（「cleanup.ts の掃除が…消す」）。残っているのは書き換えない `migrations/0011_admin.sql:4` だけ。
- §3.2-15 に、同じ型の古い注記 `scripts/cli-requests.mjs:3`（#52）が載っていない。

## 対応（2026-11-10。この記録と同じ日の会話で）

`01-repo-and-issue-driven-review-report.md` §4.3 の 1 の「Phase の区切りで未採用の改善を見直し、採るものを Issue にし、採らないものは理由を残す」の 1 回目。手順は `docs/guides/procedures/issue-goal-setting.md` §8 の 5 に足した。

### 会話の側で直した（文書と注記。挙動は変えていない）

| 元 | 直した所 |
| --- | --- |
| #12 | `api-schema-design.md` の `resolveJsonModule` の文 |
| #15 | `api-schema-design.md` の `GET /v1/announcements` の行（404 を足す） |
| #28 | `abuse-protection-design.md` の 429 の例のボード名 |
| #48 | `abuse-protection-design.md` の範囲の外の「掃除」の行を消す・`event-reward-design.md` の行を「消さない決定」に |
| #43 | `quest-design.md` のバインドの数（16） |
| #45・#47 | `admin-design.md` §7 の管理コマンドの操作の一覧を `scripts/admin-cli.mjs` の頭書きへ向ける |
| #47 | 管理コマンドの `analytics` の注に「今日の行はその日の途中の数」 |
| #52 | `scripts/cli-requests.mjs` の頭書き（読み込む側） |
| #61 | `README.md` の 403 の説明の重なり（「いまの制限」の節へ寄せる） |
| レビュー §3.2 の 15 | `analytics.ts`・`audit.ts`・`guards.ts`・`worker.ts` の注記・`displayName` の長さの検証の場所 |

### Issue にした

| 元 | Issue |
| --- | --- |
| #23・#34・#29（`checkAccess` の写し）・#14（ルートの突き合わせ）・レビュー §3.2 の 11・12・14 | #69（T1。挙動を変えない片付け） |
| コードの残り（#11・#18・#22・#24・#25・#27・#37・#41・#44・#45・#49・#56）・試験の残り（#12・#17・#18・#19・#29・#32・#35・#36・#39・#41・#42・#44・#47・#53）・レビュー §3.2 の 2〜10・13 と SDK の `issueGuest` の送り直し・`Vary: Origin` | 公開の前の堅めの設計書の Issue（下の G の設計書） |
| #57・#59（Phase 3 の人の確かめと印） | #63（H1）・#64（H2〜H6） |
| #62（説明書の要確認） | #65（staging の人の操作） |
| #59（P6 で置き換える試験の名前）・レビュー §3.2 の 1 | #67（`APP_ENV` の役を分けるか。P6 の前に決める） |
| #5（CLAUDE.md の入口の表に設計書が無い） | #68 で決める（`docs/guides/README.md` の「`working/` に足したら入口の表に 1 行」は、CLAUDE.md を短く保つ決まりと両立していない） |

### 採らない（理由）

| 元 | 理由 |
| --- | --- |
| #47（player-data の頭書きに遊んだ記録の一言） | ほかのモジュールの頭書きにも無い（仕分けの「ほか 5 つは有り」は誤り）。遊んだ記録の正は `src/core/activity.ts` の頭書き |
| #52（13 の設計書が「`scripts/cli-mock.mjs` の流れ」を指す） | 入口はいまも `scripts/cli-mock.mjs` で、中身の正（SDK の `runScenario`）は `client-integration-design.md` §4 から辿れる。設計書を 13 個書き換える益が小さい |
