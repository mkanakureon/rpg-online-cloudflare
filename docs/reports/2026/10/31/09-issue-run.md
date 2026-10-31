# Issue の無人実行のまとめ（20261031-155240）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261031-155240/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #41 Phase 2 の実装 U3: プレイヤーデータの管理の口と管理コマンド（キーと実績の宣言・値の直し・実績の取り消し） | PASS | 11 | 2026-10-31 15:52〜16:03 | 1 | 2 |  |

## #41 Phase 2 の実装 U3: プレイヤーデータの管理の口と管理コマンド（キーと実績の宣言・値の直し・実績の取り消し） — PASS

- `0b52d5b feat: プレイヤーデータの管理の口と管理コマンドを実装する（キーと実績の宣言・値を置く・実績の取り消しの 4 つの口と監査・プレイヤーを読む口の playerData・MAX_PLAYER_DATA_KEYS・admin-cli の 4 つの操作・§10 の U3 の試験 10 本）（Issue #41）`
- `caa20e4 docs: プレイヤーデータの管理の口の契約を書く（キーと実績の宣言・値を置く・実績の取り消しの 4 つの口と、プレイヤーを読む口の playerData・admin-design §13 の行を player-data-design §8 へ）（Issue #41）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| 監査に `player-data-key.put`・`achievement.put`・`player-data.set`・`achievement.revoke` を残す | 満たす | `src/core/admin/routes.ts` の 4 つの監査の文。U3 の試験の監査の確かめが PASS |
| `MAX_PLAYER_DATA_KEYS`（200）が `src/core/player-data.ts` にある | 満たす | `export const MAX_PLAYER_DATA_KEYS = 200;` |
| 管理のコードがモジュールを読み込まない | 満たす | `src/core/admin/*.ts` の import に `modules/` が 0 件 |
| `APP_ENV=local` の守りが残っている | 満たす | `src/core/guards.ts` は base から変わっていない。U3 の 403 の試験が PASS |
| 要求の形の関数が 4 つの口を呼び、管理コマンドに 4 つの操作があり、型のファイルにもある | 満たす | `admin-requests.mjs` の `putDataKeyOp`・`putAchievementOp`・`setDataOp`・`revokeAchievementOp`、`admin-cli.mjs` の 4 つの操作、`admin-requests.d.mts` |
| `SMOKE_AUDIT_ACTIONS` を変えていない | 満たす | 差分にこの行が無い。既存の smoke の試験が PASS |
| 管理コマンドがファイルを書かない | 満たす | `writeFile`・`appendFile` が 0 件 |
| 管理のスキーマに 4 つの操作と `playerData` | 満たす | `openapi/rpg-online-admin.v1.json` に 4 つのパス、`AdminPlayer.required` に `playerData` |
| `docs/api-contract.md` に 4 つの口と `playerData` | 満たす | 4 つの節と、プレイヤーを読む口の `playerData` |
| `admin-design.md` §13 の行の置き換え | 満たす | 「`player-data-design.md` §8 のとおり」になり、「直す口が要るなら」が残っていない |
| CLI モックと `wrangler.jsonc` に管理の鍵・管理の口が無い | 満たす | 3 つのファイルとも変えていない。該当の文字列が 0 件 |
| `npm run typecheck` が通る | 満たす | `tsc --noEmit` が exit 0 |
| テストの入口が `Result: PASS` | 満たす | `node scripts/test.mjs` が `Tests 294 passed (294)`・`Result: PASS 294/294` |
| §10 の U3 の 10 本がある | 満たす | junit に 10 本があり、失敗は 0 |
| base の試験が全部残って通る | 満たす | base の 284 本の名前が全部残り、全体の 294 本が通る |
| 守るものを変えていない | 満たす | 守るファイルを並べた `git diff --stat b6b9617 HEAD -- …` の出力が空 |

判定は別のエージェントにさせた。差分とログを読ませ、19 の条件の全部が「満たす」になった。

### やったこと
- 契約の文書を先に直した（`docs/api-contract.md` の管理の API・`openapi/rpg-online-admin.v1.json` の 4 つの操作と `playerData`・`admin-design.md` §13 の行）。
- `src/core/player-data.ts` に `MAX_PLAYER_DATA_KEYS` を足した。
- `src/core/admin/parse.ts` に `parsePlayerDataKey`・`parseAchievement`・`parsePlayerDataValue` を足した。
- `src/core/admin/routes.ts` に 4 つの口を足した。どの口も監査の行を 1 文目にした 1 つの batch で書き、先に読んで断る。断る条件は監査の文の条件にも入れた。プレイヤーを読む口には `playerData` を足した。
- `scripts/admin-requests.mjs`・`.d.mts`・`admin-cli.mjs` に 4 つの操作を足した。`player` の表示には、応答の `playerData` がそのまま出る。
- `test/admin.test.ts` に §10 の U3 の 10 本を足した。既存の行と期待は変えていない。プレイヤーデータの表は U3 の describe の前後で消す。

### コミット
- caa20e4 docs: プレイヤーデータの管理の口の契約を書く
- 0b52d5b feat: プレイヤーデータの管理の口と管理コマンドを実装する

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 4 つの口の 200 の応答の形は設計書に無かったので、次のようにした。違っていればスキーマ・契約・routes.ts・試験を同じコミットで直す。
  - キーの宣言: `{gameId,key,mode,maxValue,maxDelta}`
  - 実績の宣言: `{gameId,achievementId,key,threshold}`
  - 値を置く: `{gameId,playerId,key,value,auditId}`
  - 実績の取り消し: `{gameId,playerId,achievementId,revoked:true,auditId}`
- 監査の `target` は、キーの宣言を `player-data-key:<key>`、実績の宣言を `achievement:<id>` にした。値を置く口と取り消しは `player:<playerId>`（既存の増減と同じ形）にした。
- キーの宣言で add 以外のキーに `maxDelta: null` が来たときは、送らないのと同じとして通す。
- 値を置く口の確かめの順は、プレイヤー（404）→ キー（404）→ キーの maxValue（400）にした。
- 管理コマンドと同じ流れの試験は demo-rpg を使う。キーと実績の ID は回すたびに新しくし、試験の後で消す。

### やらなかったこと・断られた操作
- 断られた操作は無い。開発サーバーは起動していない（管理コマンドと `cli:smoke` の通しは会話の側でやる）。
- ロードマップの印は付けていない（Issue の指示どおり）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- キーの宣言の口で、読んでから書くまでの間に競合が起きたときの 400 の message が `tooManyKeys` になり、実際の理由と違うことがある（コードは 400 のままで契約には反しない）。
- 実績の宣言の口は、`threshold` がキーの `maxValue` を超えても通す（§8 に決まりが無い）。
- 試験の手伝いの schema-check は `type` の配列（`["integer","null"]`）を見ないので、`maxDelta` の型は確かめられていない。

