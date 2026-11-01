# Unreal のクライアント層を専用 PC で確かめる手順（H5・H6）

`clients/unreal/RpgOnlineClient/`（Unreal のクライアント層とイベントコマンドの橋渡し。UE のプラグインの形のソースだけ）を、専用 PC の UE のプロジェクトに取り込み、Mac のローカルの Worker に当てて、人が H5・H6 を見る手順。
H5・H6 の中身の正は `docs/guides/working/client-integration-design.md` §9。決まり（タイムアウト・再試行・`Retry-After`・画面の文の種類）の正はスキーマ `openapi/rpg-online.v1.json` の `x-client-policy`。イベントコマンドの決まりは同じ設計書の §6.4。

Mac の無人の回では C++ をビルドしない。Mac で機械が確かめるのは、決まりの値・エラーコードの表・イベントコマンドの一覧・シナリオの手順の名前が揃っていることだけ（`test/unreal-client.test.ts`）。**ビルドが通るかは、この手順の 1 で初めて分かる。**

## 0. 前提

| 物 | 値 | 確かめ |
| --- | --- | --- |
| UE の版 | 5.1 以上を前提に書いた（`RpgOnlineClient.uplugin` の `EngineVersion` が `5.1.0`） | **要確認**: 専用 PC の UE の版。版が違うと、取り込むときに「別の版で作られたプラグイン」と出ることがある（そのまま作り直してよい） |
| 依存のモジュール | `Core`・`HTTP`・`Json`（公開）、`CoreUObject`・`Engine`・`JsonUtilities`（非公開）。どれも UE に同梱 | **要確認**: 専用 PC の版でモジュールの名前が同じか |
| 版に依る API | タイムアウトは `IHttpRequest::SetTimeout` を使わず、`FTSTicker` のタイマーで 10 秒たったら `CancelRequest` で切る。待ちも `FTSTicker`（UE 5.0 から） | **要確認**: `CancelRequest` のあと `OnProcessRequestComplete` が接続の失敗（`bConnectedSuccessfully=false`）で 1 回呼ばれるか。`ProcessRequest` が `false` を返したとき完了が呼ばれないか |
| 完了のスレッド | `OnProcessRequestComplete` はゲームのスレッドで呼ばれる前提 | **要確認**: UE 5.4 以降の完了のスレッドの設定（既定はゲームのスレッド） |
| 文字の符号 | ソースは UTF-8（BOM 無し）。注釈は日本語、文字列の値は英語だけ | **要確認**: 日本語の Windows で警告 C4819 や注釈の後ろの行が消える誤りが出たら、そのファイルを UTF-8（BOM 付き）で保存し直して記録に残す |
| トークンの保存先 | 既定はメモリーだけ（ゲームを閉じると消える）。`IRpgOnlineSessionStore` で差し替えられる | **要確認**: 長く置くときの UE の保存の API（`USaveGame` など。設計書 §2.7） |
| RPG 制作ツール | イベントコマンドの橋渡しは差し替え口 `IRpgOnlineEventHost`（変数の読み書き）と実行の口 `FRpgOnlineEventCommandRunner` まで | **要確認**: 制作ツールのイベント実行機構に、非同期の完了を待つコマンドの仕組みがあるか・変数の API |
| Mac | このリポジトリと Node.js 22.14.0。`npm install` 済み | Mac の手順は `CLAUDE.md` のコマンドの表 |
| 同じ LAN | 専用 PC から Mac の IP に TCP の 8787 で届く | **要確認**: Mac のファイアウォールが 8787 の受け付けを許すか |

## 1. プラグインを取り込んでビルドする（専用 PC）

1. 専用 PC にこのリポジトリを置く（`git clone` か、Mac からフォルダーを写す）。
2. 確かめ用の新しい UE の C++ のプロジェクトを作る（空のテンプレート〔Blank・C++〕でよい）。ゲームのプロジェクトには入れない（サンプルのゲームは Phase 4）。
3. プロジェクトの `Plugins/` の下に `clients/unreal/RpgOnlineClient/` を丸ごと写す（`Plugins/RpgOnlineClient/RpgOnlineClient.uplugin` になる形）。
   - 写さずに参照したいときは、シンボリックリンク（Windows は `mklink /J`）でもよい（**要確認**: 専用 PC の OS での作り方）。
4. エディタを開くと、プラグインのモジュールを作るか聞かれるので作る（または Visual Studio などでプロジェクトをビルドする）。**Edit → Plugins** で `RPG Online Client` が有効なことを見る。
5. ビルドの誤りがあれば、その全文を記録に残す（H5・H6 は通らない）。
6. ビルドで UE が作る `Binaries/`・`Intermediate/` は**このリポジトリにコミットしない**（ソースだけを置く決まり。設計書 §6.1）。

## 2. Mac で Worker を LAN に向けて起動する

`package.json` の `dev`（`127.0.0.1` で待つ）は変えない。引数を足して、同じ LAN から届くように待たせる。

```text
npm run db:migrate:local
npm run dev -- --ip 0.0.0.0
```

- `npm run dev` の後ろの `-- --ip 0.0.0.0` は `wrangler dev` に渡る（`docs/guides/procedures/unity-client-check.md` の 2 と同じ）。`APP_ENV=local` は `dev` の中で渡るので、書き込みも通る。
- Mac の LAN の IP を調べる（例: `ipconfig getifaddr en0`）。専用 PC のブラウザで `http://<Mac の IP>:8787/health` を開き、`{"status":"ok",...}` が出ることを先に見る。
- **0.0.0.0 で待つ間は、同じ LAN の誰でも認証の無い書き込みの API を呼べる。** 自宅などの信頼できる LAN だけで行い、見終わったら Worker を止める（Ctrl+C）。
- 届かなければ、専用 PC の中で Worker を起動する（このリポジトリで同じ `npm run db:migrate:local` と `npm run dev`。URL は `http://127.0.0.1:8787`）。

## 3. 見る口（専用 PC）

エディタで任意のマップを Play（PIE）し、コンソール（`` ` `` キー）で次を打つ。結果は画面の左上（`AddOnScreenDebugMessage`）と Output Log の `LogRpgOnline` に出る。

| コンソールのコマンド | すること |
| --- | --- |
| `RpgOnline.BaseUrl http://<Mac の IP>:8787` | 当てる Worker を決める（既定は `http://127.0.0.1:8787`） |
| `RpgOnline.Scenario` | §4 のシナリオをクライアント層で直に流す |
| `RpgOnline.EventScenario` | 同じ手順を、イベントコマンド（`online.<機能>.<操作>` の JSON）で流す |
| `RpgOnline.Probe` | `GET /health` を 1 回聞く（再試行を含む） |
| `RpgOnline.Events` | ゲストを発行してイベントの一覧を読み、サーバーの時刻と端末の時刻と、期間の内外・残りを出す |

- 待ちの間は、画面の左上に `frame …  (waiting for server)` が出続け、数が増える（ゲームのフレームが止まっていない印）。
- 画面にもログにもトークンとセーブの本体は出ない（出たら不具合として記録する）。

## 4. H5・H6 を見る

### H5: 500 で再試行のあと通信エラーが出て、ゲームが止まらない

失敗ケースの計画の K4 の `UEクライアントは500を受けたら再試行して利用者に通信エラーを出す` を、人が見る。

500 を返すだけの小さなサーバーを Mac で起動し（パッケージを足さない。Mac の `python3` を使う。**要確認**: その Mac の `python3` の有無）、そこへ向ける。

```text
python3 -c "
from http.server import BaseHTTPRequestHandler, HTTPServer
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        b = b'{\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"test\"}}'
        self.send_response(500); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
HTTPServer(('0.0.0.0', 8788), H).serve_forever()
"
```

1. コンソールで `RpgOnline.BaseUrl http://<Mac の IP>:8788` を打ち、`RpgOnline.Probe` を打つ。
2. 見ること:
   - 要求の行が 3 回（`getHealth #1 -> 500`・`#2`・`#3`）出て、その間に `retry after … ms` が 2 回（1 回目は 0〜1000 ms、2 回目は 0〜2000 ms）出る。
   - 最後に `Health: network after 3 attempts (HTTP 500 INTERNAL_ERROR (gave up after 3 attempts))` が出る。
   - その間ずっと、左上の `frame …` の数が増え続け、キャラクターやカメラを動かせる（ゲームが止まらない）。
3. 見終わったら 500 のサーバーを止める（Ctrl+C）。
4. あわせて、Mac の Worker も 500 のサーバーも止めた状態で `RpgOnline.Probe` を打ち、`network` が出てフレームが止まらないことも見る（応答が無いときは 1 回 10 秒のタイマーで切れるので、最大で約 33 秒かかる。切れた行は `#n -> timeout` か `#n -> network`）。

### H6: 端末の時計をずらしても、期間がサーバーの時刻で決まる。あわせて、イベントコマンドでシナリオが通る

失敗ケースの計画の K4 の `UEクライアントは端末の時刻がずれていても期間の判定にサーバーの時刻を使う` を、人が見る。

1. `RpgOnline.BaseUrl` を Worker（8787）に戻し、`RpgOnline.Events` を打つ。`serverTime=… device=…` の行と、イベントごとに `[open]`／`[closed]`・`claimed=`・`reset in …` の行が出る。値を写す。
2. 専用 PC の時計を 1 日進める（OS の日時の設定で自動の同期を切ってから。**要確認**: 専用 PC の OS での手順）。
3. もう一度 `RpgOnline.Events` を打つ。
4. 見ること: `device=` は 1 日ずれるが、`serverTime=` はずれない。イベントの `[open]`／`[closed]` と `reset in …` は、1 のときと（打つまでに過ぎた時間の分のほかは）変わらない。
5. 時計を元に戻す（自動の同期を戻す）。

シナリオ（H6 のあわせて見るもの）:

1. `RpgOnline.Scenario` を打つ。11 の手順（`health`・`config`・`master-data`・`announcements`・`guest`・`token-refresh`・`ranking`・`saves`・`event-reward`・`player-data`・`quests`）が上から `OK` で並び、最後に `Scenario: all steps passed` が出れば通った。
2. `RpgOnline.EventScenario` を打つ。同じ 11 の手順が、イベントコマンドの実行で `OK`（`n commands`）で並び、最後に `Scenario: all steps passed` が出れば、イベントコマンドでシナリオが通った。
   - 各コマンドは `responseVariable`（この確かめでは変数 1）に、成功なら 0、失敗なら画面の文の種類の番号（`RpgOnlineEventCommands.h` の `ResponseNumbers`。例: `not-found` は 2、`network` は 4）を書く。`saves` の最後の読み直しは、消した後なので 2（`not-found`）が来るのが正しい。
   - `master-data` は、設定にマスターデータが載っていなければ `none (skipped)` になる（クライアント層の流し方と同じ）。
3. 途中で `FAIL` になったら、その行（手順の名前・理由・`[種類]`）と、その上の要求の行（`操作 #回 -> 状態`）を写す。
   - 同じ Worker で 2 回続けて流しても、どちらの流し方も新しいゲストなので `event-reward`・`quests` は通る。通らないときは、イベントの期間など初期データの側を疑う。

### 制作ツールにつなぐ（専用 PC の作業。要確認）

このリポジトリにあるのは差し替え口までで、制作ツールのクラスは読み込まない。専用 PC で次を作り、つないだ結果を記録に残す。

1. `IRpgOnlineEventHost` を実装し、`GetVariable`・`SetVariable` を制作ツールの変数（番号）の読み書きにつなぐ。
2. 制作ツールのイベントの「オンライン」のコマンドが来たら、`{ "command": "online.ranking.submit", "params": { "boardId": "boss-score", "scoreVariable": 120, "responseVariable": 121 } }` の形の JSON を `FRpgOnlineEventCommandRunner::ExecuteJson` に渡す。`true` が返ったらイベントを「待ち」にし、`OnFinished` が来たら次のコマンドへ進める。待ちの間もマップの描画と入力を止めない。
3. コマンドの名前と params の入力・出力の名前は `RpgOnlineEventCommands.h` の `Commands` の表がただ 1 つの正（この手順書に写さない）。

## 5. 見た結果を残す

- 見た結果は `docs/reports/YYYY/MM/DD/` に 1 本の記録として残す（例: `docs/reports/2026/11/02/unreal-client-check.md`）。この手順書には書き込まない。
- 書くこと: 専用 PC の OS と UE の版・取り込み方（1 の 3 のどちらか）・ビルドの結果・Worker の場所（Mac か専用 PC か）・H5・H6 のそれぞれの「通った／通らない」と画面の行の写し・制作ツールにつないだか・この手順の「要確認」で分かったこと。
- 合否はユーザーが決める（機械の合否と分ける。`CLAUDE.md` 原則 4）。不具合が見つかったら、記録を元に Issue にする。
- 「要確認」が確かめられたら、この手順書の該当の行を確かめた値に置き換える（例外を追記しない）。
