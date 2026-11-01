# Unity のクライアント層を専用 PC で確かめる手順（H2〜H4）

`clients/unity/`（Unity のクライアント層。UPM の包みの形のソースだけ）を、専用 PC の Unity に取り込み、Mac のローカルの Worker に当てて、人が H2〜H4 を見る手順。
H2〜H4 の中身の正は `docs/guides/working/client-integration-design.md` §9。決まり（タイムアウト・再試行・`Retry-After`・画面の文の種類）の正はスキーマ `openapi/rpg-online.v1.json` の `x-client-policy`。

Mac の無人の回では C# をビルドしない。Mac で機械が確かめるのは、決まりの値・エラーコードの表・シナリオの手順の名前が揃っていることだけ（`test/unity-client.test.ts`）。**ビルドが通るかは、この手順の H2 で初めて分かる。**

## 0. 前提

| 物 | 値 | 確かめ |
| --- | --- | --- |
| Unity の版 | 2021.3 LTS 以上を前提に書いた（`clients/unity/package.json` の `unity` が `2021.3`） | **要確認**: 専用 PC の Unity の版。`Awaitable`（2023.1 から）は使っていない |
| Unity の組み込みの包み | `com.unity.modules.unitywebrequest`・`com.unity.modules.jsonserialize`（どちらも Unity に同梱） | **要確認**: 依存の版の書き方 `1.0.0` で取り込めるか |
| ビルドの先 | エディタの再生（Play）で見る。Windows・Mac のスタンドアロンを前提にした | **要確認**: WebGL では `Task.Delay` が使えず、CORS も要る（ローカルの CORS は `127.0.0.1:5173`・`localhost:5173` だけ）。WebGL は範囲の外 |
| Mac | このリポジトリと Node.js 22.14.0。`npm install` 済み | Mac の手順は `CLAUDE.md` のコマンドの表 |
| 同じ LAN | 専用 PC から Mac の IP に TCP の 8787 で届く | **要確認**: Mac のファイアウォールが 8787 の受け付けを許すか |

## 1. 包みを取り込む（専用 PC）

1. 専用 PC にこのリポジトリを置く（`git clone` か、Mac からフォルダーを写す）。
2. 確かめ用の新しい Unity のプロジェクトを作る（3D の空のテンプレートでよい）。ゲームのプロジェクトには入れない（サンプルのゲームは Phase 4）。
3. **Window → Package Manager → 左上の「+」→ Add package from disk…** で、`clients/unity/package.json` を選ぶ（ローカルの包みとして参照する）。
   - 代わりに、プロジェクトの `Packages/manifest.json` の `dependencies` に `"com.rpg-online.client": "file:<このリポジトリの場所>/clients/unity"` を足してもよい（**要確認**: 専用 PC のパスの書き方）。
4. 取り込むと Unity が `.meta` ファイルを作る。**`.meta` はこのリポジトリにコミットしない**（Mac ではエンジンが無く作れないので、リポジトリには置かない決まり）。
5. Console にコンパイルの誤りが無いことを見る。誤りがあれば、その全文を記録に残す（H2 は通らない）。

## 2. Mac で Worker を LAN に向けて起動する

`package.json` の `dev`（`127.0.0.1` で待つ）は変えない。引数を足して、同じ LAN から届くように待たせる。

```text
npm run db:migrate:local
npm run dev -- --ip 0.0.0.0
```

- `npm run dev` の後ろの `-- --ip 0.0.0.0` は `wrangler dev` に渡る（`wrangler dev --help` に `--ip` がある。Mac の wrangler 4 で確かめた）。`APP_ENV=local` は `dev` の中で渡るので、書き込みも通る。
- Mac の LAN の IP を調べる（例: `ipconfig getifaddr en0`）。専用 PC のブラウザで `http://<Mac の IP>:8787/health` を開き、`{"status":"ok",...}` が出ることを先に見る。
- **0.0.0.0 で待つ間は、同じ LAN の誰でも認証の無い書き込みの API を呼べる。** 自宅などの信頼できる LAN だけで行い、見終わったら Worker を止める（Ctrl+C）。
- 届かなければ、専用 PC の中で Worker を起動する（このリポジトリで同じ `npm run db:migrate:local` と `npm run dev`。`baseUrl` は `http://127.0.0.1:8787`）。

## 3. 見る部品を置く（専用 PC）

1. 空のシーンに空の GameObject を作り、コンポーネント **RpgOnlineScenario** を付ける。
2. Inspector で `Base Url` を `http://<Mac の IP>:8787` に、`Game Id` を `demo-rpg` にする。
3. Play を押す。左上にフレームの数（`frame …`）と 3 つのボタンが出る。
   - 画面にはトークンもセーブの本体も出ない（出たら不具合として記録する）。

## 4. H2〜H4 を見る

### H2: シナリオが通る

1. **H2: Run scenario** を押す。
2. 11 の手順（`health`・`config`・`master-data`・`announcements`・`guest`・`token-refresh`・`ranking`・`saves`・`event-reward`・`player-data`・`quests`）が上から `OK` で並び、最後に `Scenario: all steps passed` が出れば通った。
3. 途中で `FAIL` になったら、その行（手順の名前・理由・`[種類]`）と、その上の要求の行（`操作 #回 -> 状態`）を写す。
   - 同じ Worker で 2 回続けて流すと、`event-reward`・`quests` は新しいゲストなので通る。通らないときは、イベントの期間など初期データの側を疑う。

### H3: 500 で再試行のあと通信エラーが出て、フレームが止まらない

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

1. Inspector の `Base Url` を `http://<Mac の IP>:8788` にして、**H3: Probe health** を押す。
2. 見ること:
   - 要求の行が 3 回（`getHealth #1 -> 500`・`#2`・`#3`）出て、その間に `retry after … ms` が 2 回（1 回目は 0〜1000 ms、2 回目は 0〜2000 ms）出る。
   - 最後に `Health: network after 3 attempts (HTTP 500 INTERNAL_ERROR (gave up after 3 attempts))` が出る。
   - その間ずっと、左上の `frame …` の数が増え続ける（ゲームのフレームが止まらない）。
3. 見終わったら 500 のサーバーを止める（Ctrl+C）。
4. あわせて、Mac の Worker も 500 のサーバーも止めた状態で押し、`network` が出てフレームが止まらないことも見る（応答が無いときは 1 回 10 秒で切れるので、最大で約 33 秒かかる）。

### H4: 端末の時計をずらしても、期間がサーバーの時刻で出る

1. `Base Url` を Worker（8787）に戻し、**H4: Read events** を押す。`serverTime=… device=…` の行と、イベントごとに `[open]`／`[closed]`・`claimed=`・`reset in …` の行が出る。値を写す。
2. 専用 PC の時計を 1 日進める（OS の日時の設定で自動の同期を切ってから。**要確認**: 専用 PC の OS での手順）。
3. もう一度 **H4: Read events** を押す。
4. 見ること: `device=` は 1 日ずれるが、`serverTime=` はずれない。イベントの `[open]`／`[closed]` と `reset in …` は、1 のときと（押すまでに過ぎた時間の分のほかは）変わらない。
5. 時計を元に戻す（自動の同期を戻す）。

## 5. 見た結果を残す

- 見た結果は `docs/reports/YYYY/MM/DD/` に 1 本の記録として残す（例: `docs/reports/2026/11/02/unity-client-check.md`）。この手順書には書き込まない。
- 書くこと: 専用 PC の OS と Unity の版・取り込み方（1 の 3 のどちらか）・Worker の場所（Mac か専用 PC か）・H2〜H4 のそれぞれの「通った／通らない」と画面の行の写し・この手順の「要確認」で分かったこと。
- 合否はユーザーが決める（機械の合否と分ける。`CLAUDE.md` 原則 4）。不具合が見つかったら、記録を元に Issue にする。
- 「要確認」が確かめられたら、この手順書の該当の行を確かめた値に置き換える（例外を追記しない）。
