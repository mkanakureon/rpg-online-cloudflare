# Issue の無人実行のまとめ（20261101-124855）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261101-124855/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #57 B5: Unity の C# のクライアント層と専用 PC の手順書（UPM の包みの形・決まりの値の定数・UnityWebRequest の非同期・H2〜H4） | PASS | 10 | 2026-11-01 12:49〜12:59 | 1 | 2 |  |

## #57 B5: Unity の C# のクライアント層と専用 PC の手順書（UPM の包みの形・決まりの値の定数・UnityWebRequest の非同期・H2〜H4） — PASS

- `25d77d8 fix: Unity のクライアント層で送る前の例外を回線断の結果にし・同期で終わったトークンの更新を持ち続けない・手順書に http の許可の要確認を足す（Issue #57）`
- `b66630d feat: Unity の C# のクライアント層（UPM の包みの形・決まりの値の定数・UnityWebRequest の非同期・シナリオ）と専用 PC の手順書 H2〜H4・B5 の試験 3 本（Issue #57）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 新しいファイル 6 つと `Runtime/` の `.asmdef` が git に入っている | 満たす | `git ls-files`：`clients/unity/package.json`・`Runtime/RpgOnline.Client.asmdef`・`RpgOnlineClientPolicy.cs`・`RpgOnlineClient.cs`・`RpgOnlineScenario.cs`・`docs/guides/procedures/unity-client-check.md`・`test/unity-client.test.ts` |
| UPM の包み（JSON・name の形・version と unity・依存は com.unity. だけ・lock も node_modules も無い） | 満たす | `com.rpg-online.client`・`0.1.0`・`2021.3`。依存は `com.unity.modules.unitywebrequest` と `com.unity.modules.jsonserialize` |
| クライアント層の 6 つ | 満たす | 確認コマンドの正規表現を `node -e` で、注釈を除いたコードに当てた。禁じた同期の待ちも `Debug.Log` のトークンも当たらない（false false）。`UnityWebRequest`・`Idempotency-Key`＋`Guid.NewGuid`・`RpgOnlineClientPolicy.` はある。Newtonsoft は使っていない |
| 手順書に H2・H3・H4・要確認・docs/reports/・--ip がある | 満たす | 判定役が 6 語とも見つけた |
| 型と守り | 満たす | `npm run typecheck` が exit 0。`src/core/guards.ts` に `APP_ENV !== 'local'` が残っている |
| 試験（全体・B5 の 3 本・base の試験） | 満たす | `node scripts/test.mjs` が `Result: PASS 404/404`。直した後の `--file test/unity-client.test.ts` は `Result: PASS 3/3`。値を一時的に壊すと `FAIL (0/3)` になる（試験がずれを見つけることを確かめた） |
| 守るものを変えていない・Unreal の層を作っていない | 満たす | `git diff b7b2677 HEAD` は新しいファイルと、自分で作った 2 つのファイルの直しだけ。`clients/` にあるのは `browser`・`unity` だけ |
| ユーザーの最終判定 H2〜H4 | 人が見る | 専用 PC で `docs/guides/procedures/unity-client-check.md` のとおりに見る。**Mac では C# をビルドできないので「ビルドできた」とは言えない** |

判定役（別のエージェント）は、差分とこの実行結果をもとに、全部の条件を「満たす」と判定した。

### やったこと
- `clients/unity/` を UPM の包みの形で作った。
  - `package.json` と `.asmdef` を置いた。
  - `RpgOnlineClientPolicy.cs`：スキーマの `x-client-policy` と `x-retry` を書き写した定数。行の形を決めてある。
  - `RpgOnlineClient.cs`：`UnityWebRequest` で送り、Task と `TaskCompletionSource` で待つ。再試行・Retry-After・画面の文の種類・トークンの更新・`Guid.NewGuid` の Idempotency-Key・`ServerClock`（§2.8）を持つ。
  - `RpgOnlineScenario.cs`：§4 のシナリオ。手順の名前は SDK と同じで、H2〜H4 を見るための OnGUI の部品も入れた。
- 手順書 `docs/guides/procedures/unity-client-check.md` を書いた。中身は包みの取り込み方、`npm run dev -- --ip 0.0.0.0`、H3 で使う 500 を返す python3 のサーバー、H4 で時計をずらす見方、`docs/reports/` に残すこと、要確認の点。
- 試験 `test/unity-client.test.ts` に B5 の 3 本を書いた。C# のファイルを `?raw` で読み、スキーマと SDK の `SCENARIO_STEPS` に比べる。
- 判定役の指摘 3 つを直した。どれもこの Issue で作った物の中。
  - 送る前の例外を、回線断の結果として返すようにした。
  - 同期で終わったトークンの更新の Task を持ち続けないようにした。
  - 手順書に「Unity 2022.1 以降は HTTP の許可が要る」ことを要確認として足した。

### コミット
- b66630d feat: Unity の C# のクライアント層と専用 PC の手順書・B5 の試験 3 本（Issue #57）
- 25d77d8 fix: 送る前の例外を回線断に・同期で終わった更新を持ち続けない・手順書に http の許可の要確認（Issue #57）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- UPM の名前を `com.rpg-online.client` にした。直すなら `clients/unity/package.json` の name を変える。
- 依存には Unity の組み込みの包み（`com.unity.modules.*`）を書いた。依存無しにするなら dependencies を空にする。
- 人が見るための MonoBehaviour を `RpgOnlineScenario` の中に入れた。こうするとファイルは 3 つのままで済む。分けるなら新しいファイルに移す。
- 待ちには Task（`Task.Delay`）を使い、コルーチンにしなかった。WebGL を相手にするなら Delay の差し替え口を使う。
- 手順書のファイルの名前を `unity-client-check.md` にした（Issue のとおり）。

### やらなかったこと・断られた操作
- C# のビルドと、ゲームの中での動き（H2〜H4）。Mac に Unity が無いので、人が専用 PC で見る。
- 開発サーバーは起動していない。断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 試験 B5 が比べるのは定数とシナリオの手順の名前だけで、C# の再試行の動きそのものは Mac では確かめられない。必要なら、専用 PC で Unity の Test Framework を使う試験を足す（別の Issue）。

