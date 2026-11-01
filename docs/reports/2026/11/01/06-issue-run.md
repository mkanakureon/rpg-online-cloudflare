# Issue の無人実行のまとめ（20261101-132313）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261101-132313/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #58 B6: Unreal の C++ のクライアント層とイベントコマンドの橋渡しと専用 PC の手順書（プラグインの形・決まりの値のヘッダー・FHttpModule の非同期・H5・H6） | PASS | 23 | 2026-11-01 13:23〜13:46 | 1 | 2 |  |

## #58 B6: Unreal の C++ のクライアント層とイベントコマンドの橋渡しと専用 PC の手順書（プラグインの形・決まりの値のヘッダー・FHttpModule の非同期・H5・H6） — PASS

- `b694d32 fix: Unreal のイベントコマンドで期間の外の行に 0 を書き・送らずに終わる結果も次のフレームで返し・ProcessRequest の失敗で完了を二重にしない・手順書を実装に合わせる（Issue #58）`
- `c60a588 feat: Unreal の C++ のクライアント層（プラグインの形・決まりの値のヘッダー・FHttpModule の非同期・シナリオ）とイベントコマンドの橋渡しと専用 PC の手順書 H5・H6・B6 の試験 3 本（Issue #58）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 新しいファイル 9 つがあり git に入っている | OK | `git ls-files` に 7 つのプラグインのファイル・手順書・試験がある（ほかに足したファイル: `RpgOnlineClientModule.cpp`・`RpgOnlineEventCommands.cpp`・`RpgOnlineScenario.h`） |
| `.uplugin` が JSON で Runtime のモジュール `RpgOnlineClient` を持つ | OK | `JSON.parse` の結果 `Modules: [{Name: RpgOnlineClient, Type: Runtime}]` |
| `Build.cs` が `HTTP`・`Json` に依存する | OK | `Build.cs` の公開の依存が Core・HTTP・Json（Issue の正規表現 true） |
| ビルドの成果物を置かない | OK | `clients/unreal/` に `Binaries`・`Intermediate`・`Saved`・`DerivedDataCache` が無い |
| クライアント層: FHttpModule で送り OnProcessRequestComplete で受ける・Sleep/Wait 無し・FGuid::NewGuid の Idempotency-Key・`RpgOnlineClientPolicy::` から読む・UE_LOG にトークンを出さない | OK | Issue の確認コマンドと同じ正規表現 6 つを `node -e` で回し、修正の後も 6 つとも true |
| シナリオに `SCENARIO_STEPS` の全部の名前がある | OK | 同じ正規表現で true。試験の中でも `StepList` が SCENARIO_STEPS と同じ順で一致する |
| コマンドの名前 `online.<機能>.<操作>` が 20 個以上で重ならず、`responseVariable` を持つ | OK | 名前は 20 個で、重なりも 20 個（重ならない）。`responseVariable` は true |
| 手順書に H5・H6・K4 の UE の 2 本の名前・要確認・`docs/reports/`・`--ip` がある | OK | 判定役が 7 つの文字列を確かめた（`unreal-client-check.md`） |
| `npm run typecheck` が通る・`APP_ENV=local` の守りが残る | OK | `/tmp/b6-tc.log`: `typecheck exit=0`。`src/core/guards.ts:12` は変えていない |
| テストの入口が PASS・B6 の 3 本がある・base の試験が全部残って通る | OK | `node scripts/test.mjs` が `Result: PASS 407/407`（base の 404 本 + B6 の 3 本）。junit で base の名前の漏れは 0 |
| 守るもの（src・migrations・openapi・scripts・clients/browser・clients/unity・既存の試験・test/support・設定）を変えていない | OK | `git diff 79cc37c --stat` は、足した 12 のファイルだけ |
| ユーザーの最終判定 H5・H6 | 人が見る | 専用 PC の UE で、`docs/guides/procedures/unreal-client-check.md` のとおりに見る。**Mac では C++ をビルドしていない（ビルドできたとは言えない）** |

### やったこと
- `clients/unreal/RpgOnlineClient/` に UE のプラグインの形でソースを置いた。中身は `.uplugin`・`Build.cs`・モジュールの登録・決まりの値の `RpgOnlineClientPolicy.h`・`RpgOnlineClient.h/.cpp`。
  - 送り方: FHttpModule で送り、完了は OnProcessRequestComplete で受ける。再試行の待ちとタイムアウト（10 秒で CancelRequest）は FTSTicker で待つ。
  - 失敗の扱い: §2 の再試行・Retry-After・revision の操作を自動で送り直さないことを入れた。結果は `{ok, error{code, category, status, retryable}}` に当たる構造体で返す。
  - SHA-256: 版に依らないよう自前で書いた。
- イベントコマンドの橋渡しを作った（`RpgOnlineEventCommands.h/.cpp`）。
  - 一覧: 20 のコマンドが、スキーマの 20 の操作に 1 つずつ当たる。
  - 応答の番号: 12 の種類に 1〜12、成功は 0。
  - つなぎ口: 差し替え口 `IRpgOnlineEventHost` と、実行の口 `FRpgOnlineEventCommandRunner`（ExecuteJson）。
- シナリオを 2 つの流し方で作った（`RpgOnlineScenario.h/.cpp`）。クライアント層で直に流す形と、イベントコマンドで流す形。人が見るためのコンソールのコマンドは `RpgOnline.BaseUrl`・`Scenario`・`EventScenario`・`Probe`・`Events`。
- 手順書 `docs/guides/procedures/unreal-client-check.md` と、試験 `test/unreal-client.test.ts`（B6 の 3 本）を書いた。
- 判定役（別のエージェント）が欠陥を 5 つ見つけたので直した（直した後、同じ判定役が 5 つとも解消・合格の条件の後退なし・新しい欠陥なしと確かめた）。
  - 一覧に無い行（期間の外）の出力の変数に 0 を書く。
  - 送らずに終わる結果も、次のフレームで返す。
  - ProcessRequest が失敗したとき、完了を二重にしない。
  - 手順書を実装に合わせた（2 か所）。

### コミット
- c60a588 feat: Unreal の C++ のクライアント層 … B6 の試験 3 本（Issue #58）
- b694d32 fix: Unreal のイベントコマンドで期間の外の行に 0 を書き … 手順書を実装に合わせる（Issue #58）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 構造体は USTRUCT にせず、ふつうの C++ にした（UHT を要らなくするため）。人の確かめの口はアクターでなく、コンソールのコマンドにした。Blueprint から使うなら、別の Issue で USTRUCT／UFUNCTION の包みを足す。
- タイムアウトは SetTimeout を使わず、FTSTicker と CancelRequest で切る（Issue の推しのとおり）。戻すなら `SendAttempt` を直す。
- トークンの保存先の既定は、メモリーだけにした。長く置く API は要確認なので、`IRpgOnlineSessionStore` で差し替える。
- コマンドの名前（例: `online.save.put`・`online.player-data.write`）と、params の入力・出力の名前は、自分で決めた。変えるときは `RpgOnlineEventCommands.h` の表 1 か所を直す（試験が形と対応を見る）。
- イベントコマンドの流し方では、`master-data` はいつも飛ばす（キーが応答で決まるため）。戻すなら `CommandsFor` に行を足す。

### やらなかったこと・断られた操作
- C++ のビルドと UE の中での動き（H5・H6）は、Mac に UE が無いのでできない。人が専用 PC で見る。
- 断られた操作は無い。追跡外の `docs/inspecs/2026/` には触れていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- Unity の層（`clients/unity/`）も、送らずに終わる結果（セッションが無いとき）を同期で返している。B6 では守るファイルなので直していない。

