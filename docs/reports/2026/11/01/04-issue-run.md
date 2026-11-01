# Issue の無人実行のまとめ（20261101-121910）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261101-121910/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #54 B4: ローカルだけの CORS とブラウザのサンプル（決めた 2 つのオリジン・Retry-After と ETag の公開・1 枚のページ） | PASS | 5 | 2026-11-01 12:19〜12:25 | 1 | 1 |  |
| #55 F1: イベントの一覧が 50 個以上で 500 になるのを直す・ランキングの同点の順を直す（レビューの記録 §3.1・§3.2） | PASS | 4 | 2026-11-01 12:25〜12:29 | 1 | 1 | Bash |
| #56 F2: 古い注記をいまの実装に合わせる（モジュールの数・BAN の使い手・利用制限の列挙・一覧の上限・マイグレーションの注記の正。レビューの記録 §5） | PASS | 2 | 2026-11-01 12:29〜12:31 | 1 | 1 |  |

## #54 B4: ローカルだけの CORS とブラウザのサンプル（決めた 2 つのオリジン・Retry-After と ETag の公開・1 枚のページ） — PASS

- `990b87c feat: ローカルだけの CORS（決めた 2 つのオリジン・Retry-After と ETag の公開）とブラウザのサンプルの 1 枚のページ（Issue #54）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 前提: #53 のコミットが main にある | 満たす | `git log -1 --fixed-strings --grep='（Issue #53）'` → 8832c57（base） |
| サンプル: `clients/browser/sample/index.html` があり git に入っている | 満たす | コミット 990b87c で追加。`git ls-files` に出る |
| サンプル: `<script type="module">` で SDK を読む | 満たす | `import { createClient, runScenario } from '../rpg-online-client.mjs'` |
| サンプル: `127.0.0.1:5173` の案内 | 満たす | 画面に「127.0.0.1:5173 から開く」と `python3 -m http.server 5173 --bind 127.0.0.1` |
| サンプル: インターネットの部品を読み込まない | 満たす | 外の `src`・`href` 無し（試験 `ブラウザのサンプルは…` が見る） |
| CORS: `Access-Control-Allow-Origin` を作る所が `src/core/` の 1 か所 | 満たす | `src/core/cors.ts` だけ（判定役が `git ls-files src/` で確認） |
| CORS: 2 つのオリジン・`*` 無し・`APP_ENV` を見る・6 つの見出し | 満たす | `CORS_ORIGINS`・`CORS_ALLOW_HEADERS`・`CORS_EXPOSE_HEADERS`・`env.APP_ENV !== 'local'` |
| `APP_ENV=local` の守りが残る | 満たす | `src/core/guards.ts` は変えていない |
| 文書: 契約に CORS の決まり | 満たす | `docs/api-contract.md` の「CORS（ブラウザから呼ぶ。ローカルだけ）」 |
| 型: `npm run typecheck` | 満たす | `b4-typecheck.log`: tc=0 |
| 試験: `Result: PASS`・B4 の 4 本・base の試験が全部残って通る | 満たす | `node scripts/test.mjs` → `Result: PASS 398/398`（base 394 + B4 4） |
| 守るもの: migrations/・openapi/・src/modules/・scripts/・既存の試験・test/support/・設定を変えていない | 満たす | `git diff --stat 8832c57 HEAD` に出ない（判定役が確認） |
| Unity・Unreal を作らない | 満たす | `clients/` には `browser` だけ |
| ユーザーの最終判定 H1 | 未（人の確かめ） | 会話の側で、ブラウザでサンプルを開いて見る |

判定は別のエージェントが、ログ（`b4-full-test.log`・`b4-typecheck.log`）・差分（`b4-diff.patch`）・junit を読んで下した: OVERALL: PASS。

### やったこと
- `src/core/cors.ts` を作った。`corsHeaders`・`preflight`・`withCors` で、見出しは local かつ決めた 2 つのオリジンのときだけ足す。null・別のオリジン・Origin 無し・local でない環境には何も足さない。
- `src/worker.ts`: ルーターの前で事前確認（OPTIONS）に 204 を返す。500 も含めて全部の応答に `withCors` をかける。
- `clients/browser/sample/index.html`: ビルド無しの 1 枚のページ。ボタン 1 つで `runScenario` を流し、手順・結果・状態コード（SDK の `log` から）・画面の文の種類・中身を表に出す。文字は textContent で入れ、トークンとセーブの本体は出さない。
- `test/browser-cors.test.ts`: §9 の B4 の 4 本。200・304・429 で公開の見出しを確かめる。許さない側は 5 通り（disabled・別のオリジン・null・別のポート・Origin 無し）を確かめる。
- `docs/api-contract.md` に CORS の節を足した。

### コミット
- 990b87c feat: ローカルだけの CORS（決めた 2 つのオリジン・Retry-After と ETag の公開）とブラウザのサンプルの 1 枚のページ（Issue #54）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- CORS は router.ts でなく worker.ts の入口でかけた（500 の応答にも付けてページが INTERNAL_ERROR を読めるように）。違っていたら preflight と withCors を router.ts に移す。
- 許さない OPTIONS は何も足さずルーターへ流す（OPTIONS のルートが無いので 404）。違っていたら preflight を変える。
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE`、`Access-Control-Max-Age: 600`、`Vary: Origin` を足した。違っていたら cors.ts の定数を直す。
- サンプルは SDK の既定の記憶の場所（メモリ）を使い、localStorage を使わない（トークンをブラウザに残さない）。

### やらなかったこと・断られた操作
- 開発サーバーとサンプルのサーバーは起動していない（Issue の指示）。H1 は会話の側でやる。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `docs/guides/working/config-design.md:342` の範囲外の表に、「ブラウザから読むときの CORS（ETag の公開）は Phase 3 で決める」と残っている。B4 で決まったので、決まったと書き直す候補。


## #55 F1: イベントの一覧が 50 個以上で 500 になるのを直す・ランキングの同点の順を直す（レビューの記録 §3.1・§3.2） — PASS

- `bbde2fc fix: イベントの一覧の受け取りを period_key IN で引き MAX_EVENTS（200）を足す・ランキングの updated_at はスコアが上がったときだけ進める（Issue #55）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 前提: #54 のコミットが main にある | 合格 | `git log --grep='（Issue #54）'` → 990b87c。bbde2fc の直前のコミット |
| 新しいファイル `test/review-fixes.test.ts` があり、git が追跡している | 合格 | コミット bbde2fc に入っている（`git ls-files` で確かめた） |
| イベントの一覧が `(event_id = ? AND period_key = ?)` を使わず、`period_key IN (` で引く | 合格 | `src/modules/events/index.ts` の `claimedOf(n)`。重ならない区切りの鍵だけを bind し、イベントとの突き合わせは JS でする |
| `MAX_EVENTS = 200` が `src/core/inventory.ts` にあり、管理の口が確かめる | 合格 | `inventory.ts` の `export const MAX_EVENTS = 200`。`admin/routes.ts` は書く前に `eventsFull` で確かめ、監査の INSERT の WHERE でも確かめる |
| ランキングの `updated_at` を `CASE WHEN excluded.score > ranking_entries.score` で進め、`updated_at = datetime(` が残っていない | 合格 | `src/modules/rankings/index.ts:80` |
| 契約の文書に MAX_EVENTS と 200 の行・同点の順（先に届いた人が上）の行がある。`event-reward-design.md` に MAX_EVENTS がある | 合格 | `docs/api-contract.md` の管理のイベントの口とランキングの POST。`event-reward-design.md` の定数の表 |
| `npm run typecheck` が通り、`APP_ENV` の守りが残っている | 合格 | `tsc --noEmit` が exit 0。`src/core/guards.ts` は変えていない |
| 試験: `Result: PASS`・新しい 3 本がある・base の試験が全部残って通る | 合格 | `node scripts/test.mjs` → `Result: PASS 401/401`。`--filter F1` → `PASS 3/3`。既存の試験のファイルは変えていない |
| 守るもの: 許された 4 つのソース・文書・新しい試験のほかを変えていない | 合格 | `git diff --stat 990b87c HEAD` で変わったのは 8 ファイル: 4 つのソース・新しい試験・文書 3 つ |

判定は別のエージェントが、上の実行のログと差分を読んで行った（全部の条件が合格）。

### やったこと
- イベントの一覧: 受け取り済みかを、重ならない区切りの鍵の `period_key IN (…)` で引き、イベントとの突き合わせを JS でするようにした（クエストの一覧と同じ形）。
- `MAX_EVENTS = 200` を `src/core/inventory.ts` に足した。管理のイベントの定義の口は、新しいイベントで宣言が上限に届いていれば 400 `INVALID_ARGUMENT` を返し、何も書かない。書く前に確かめ、同時の要求に備えて監査の INSERT の WHERE でも確かめる（`MAX_QUESTS` と同じ形）。あるイベントの置き換えは通す。
- ランキング: `updated_at` はスコアが上がったときだけ進める。表示名は毎回書き換える。
- 文書: `api-contract.md` に `MAX_EVENTS` の行・確かめの順・同点の順の行を足した。`event-reward-design.md` に定数の行と一覧の引き方を足した。`abuse-protection-design.md` §193 の古い記述（`updated_at = datetime('now')`）を直した。
- 試験: `test/review-fixes.test.ts` に 3 本を足した。

### コミット
- bbde2fc fix: イベントの一覧の受け取りを period_key IN で引き MAX_EVENTS（200）を足す・ランキングの updated_at はスコアが上がったときだけ進める（Issue #55）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 上限の確かめを書く前だけでなく、監査の INSERT の WHERE にも入れた（クエストと同じく同時の要求に備える）。違っていたら、WHERE の 1 行と bind の 4 つの値を外せば戻る。
- `abuse-protection-design.md` の古い記述 1 行を、作る物の範囲として直した。違っていたら、その行を前の文に戻す。
- 同点の試験は、ID の順では B が上になる名前（A=`zz-a`、B=`aa-b`）にした。こうすると、時刻の順だけで A が上になることを確かめられる。

### やらなかったこと・断られた操作
- `git stash` で古いソースに戻して新しい試験が落ちるのを見る確かめは断られた。代わりに、別のエージェントがコードを読んで、3 本とも古いコードなら落ちることを確かめた（60 個のイベントで引数は 122 個になり上限 100 を超える・上限の確かめが無い・同点の時刻が進む）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- なし


## #56 F2: 古い注記をいまの実装に合わせる（モジュールの数・BAN の使い手・利用制限の列挙・一覧の上限・マイグレーションの注記の正。レビューの記録 §5） — PASS

- `41740e4 docs: 古い注記をいまの実装に合わせる（モジュールの数・BAN の使い手・利用制限の列挙・一覧の上限・マイグレーションの注記の正）（Issue #56）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 前提: #55 のコミットが main にある | 満たす | `git log --grep='（Issue #55）'` → bbde2fc |
| module.ts の name の注記に quests・3 つの列挙が無い | 満たす | 8 つを列挙（判定役が src/modules/index.ts と照合） |
| bans.ts の頭書きに player-data・quests・「4 つのモジュール」が無い | 満たす | 3〜5 行目が「6 つのモジュール（…player-data・quests）とトークンの更新」 |
| rate-limit-policy.ts の頭書きに guest-ip・score | 満たす | 5〜6 行目 |
| architecture.md 利用制限にクエスト | 満たす | 「クエストの一覧と受け取り・トークンの更新」を追加 |
| 「PoCは最大50件」が無い | 満たす | 口ごとの上限（MAX_EVENTS・MAX_QUESTS・ランキング 1〜50）を指す形に |
| player_bans の行に「4 つのモジュール」が無い | 満たす | 6 つ＋トークンの更新 |
| マイグレーションの注記と src/core/ の 1 行 | 満たす | §4 の末尾に段落を追加 |
| src/ の変更は注記だけ・新ファイル無し | 満たす | 注記を除いた diff が base と一致（3 ファイル）・`git status src` 空 |
| 型 | 満たす | `npm run typecheck` exit 0 |
| 試験 | 満たす | `node scripts/test.mjs` → `Result: PASS 401/401`・test/ 変更なし |
| 守るもの | 満たす | `git diff bbde2fc HEAD --name-only` は上の 4 ファイルだけ |

判定は別のエージェント（差分とログを読ませ、確認コマンドは回させていない）が全項目「満たす」とした。

### やったこと
- `src/core/module.ts`・`bans.ts`・`rate-limit-policy.ts` の注記をいまの実装に合わせた（コードは不変）
- `docs/guides/working/architecture.md` §3 の一覧の上限・利用制限の列挙、§4 の player_bans の行、マイグレーションの注記の正の 1 行

### コミット
- 41740e4 docs: 古い注記をいまの実装に合わせる…（Issue #56）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- BAN の使い手と利用制限の列挙に、B3 のトークンの更新（src/core/accounts.ts）も入れた（Issue が「あれば」と指定）。不要なら該当の語句を消すだけ。

### やらなかったこと・断られた操作
- なし（開発サーバーは起動していない）

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- announcements の一覧の `LIMIT 50` は定数になっていない（SQL に直書き）。

