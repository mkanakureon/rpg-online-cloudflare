# Issue の無人実行のまとめ（20261110-232549）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261110-232549/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #75 G5: 1 人が行を持てるランキングのボードの数に上限（20）を置き、超える新しいボードに RANKING_LIMIT_EXCEEDED の 409 を返す（契約が変わる・足すだけ。堅めの設計書の G5） | PASS | 7 | 2026-11-10 23:26〜23:33 | 1 | 1 |  |
| #76 G6: セーブの墓石を含めた行を 1 人 100 までにし、上限では一番古い墓石を使い回す（契約は文だけ。堅めの設計書の G6） | PASS | 4 | 2026-11-10 23:33〜23:37 | 1 | 1 |  |
| #77 G7: 管理の定義どうしの整合（実績の取り消し・キーと閾値・送り直しの順・競合の文）（管理の口の契約が変わる。堅めの設計書の G7） | PASS | 11 | 2026-11-10 23:37〜23:48 | 1 | 1 |  |
| #78 G8: クエストの定義の口が区切りの宣言を付け替える（時差の変更・参照の無くなった宣言を消す）（管理の口の契約が変わる・緩める向き。堅めの設計書の G8） | PASS | 7 | 2026-11-10 23:48〜23:56 | 1 | 2 |  |
| #79 G9: トークンの鍵の取り替えの重なり・管理の利用制限は鍵の外れだけを数える・利用制限の IP を鍵付きのハッシュに（管理の口の説明が変わる。堅めの設計書の G9） | PASS | 8 | 2026-11-10 23:56〜2026-11-11 00:04 | 1 | 1 |  |
| #80 G10: クライアントの層は new-resource（ゲストの発行・トークンの更新）を 429 だけ送り直す（クライアントの決まりが変わる。堅めの設計書の G10） | PASS | 4 | 2026-11-11 00:04〜00:08 | 1 | 1 | Bash |

## #75 G5: 1 人が行を持てるランキングのボードの数に上限（20）を置き、超える新しいボードに RANKING_LIMIT_EXCEEDED の 409 を返す（契約が変わる・足すだけ。堅めの設計書の G5） — PASS

- `5a35173 feat: 1 人が行を持てるランキングのボードの数に上限（20）を置き、超える新しいボードに 409 RANKING_LIMIT_EXCEEDED を返す（#75。堅めの G5）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| この Issue のコミット（`#75`）が 1 件以上 | OK | `git log` → `5a35173 feat: …（#75。堅めの G5）` |
| 公開のスキーマの `ErrorCode`・`errorCatalog`（limit・再試行しない）・ランキングの POST の 409 の `x-error-codes` | OK | `openapi/rpg-online.v1.json` の差分（列挙・表・新しい 409 の応答）。判定役が差分で確かめた |
| 契約のエラーコードの表が「次の 20 個で全部」で `RANKING_LIMIT_EXCEEDED`（409）を持つ | OK | `docs/api-contract.md` の差分 |
| 3 つのクライアントの層に行があり、行を消していない | OK | `git diff 7fef388..HEAD -- clients` で消した行 0、各ファイル +1 |
| 管理のスキーマは説明の文のほかを変えない | OK | `openapi/rpg-online-admin.v1.json` は `rankings.description` の 1 行だけ |
| `APP_ENV=local` の守りが残る・`src/core/` がモジュールを読まない | OK | `src/core/` の変更なし |
| 型の確かめ | OK | `npm run typecheck` → exit 0（`g5-typecheck.log`） |
| 変えないもの・`scripts/`・`docs/guides/manuals/`・既存のマイグレーションに触れない | OK | コミットのファイルは `clients/`・`docs/api-contract.md`・`docs/guides/working/client-integration-design.md`・`openapi/`・`src/modules/rankings/`・`test/` だけ |
| 直してよい試験のファイルのほかを変えず、expect の数を減らさない | OK | 変えた base の試験は `test/schema-conformance.test.ts`（131→131）・`test/browser-sdk.test.ts`（113→113）。新しい `test/hardening-g5.test.ts` |
| テストの入口が PASS・新しい 4 本と base の試験（互換の試験を含む） | OK | `node scripts/test.mjs` → `Result: PASS 452/452`（`g5-test.log`）。G5 の 3 本・`スキーマのErrorCodeの列挙は20個のエラーコードと一致する`・`旧CLIはスキーマ変更後のAPIでもランキングを送って読める` が通る |
| ユーザーの最終判定（契約の文・試験の読みやすさ） | ユーザー | 機械では見ない |

判定は別のエージェントが差分とログを読んで出した（全部の条件が OK、欠陥なし）。

### やったこと
- `src/modules/rankings/limits.ts`（新）に `MAX_BOARDS_PER_PLAYER = 20`。
- `src/modules/rankings/index.ts` の書き込みを 1 文の条件つきの upsert にした（`WHERE EXISTS(そのボードの行) OR (プレイヤーの行の数) < 上限`・`RETURNING`）。行が返らなければ 409 `RANKING_LIMIT_EXCEEDED`。
- 公開のスキーマ（`ErrorCode`・`errorCatalog`・ランキングの POST の 409）、管理のスキーマ（`rankings` の説明に最大 20 件）。
- 契約（ランキングの POST の上限と確かめの順・エラーコードの表を 20 個に・コードの説明・管理の `rankings` の最大 20 件）。`client-integration-design.md` のエラーの表と数。
- ブラウザの SDK・Unity・Unreal のエラーの表に 1 行ずつ。
- 試験: `test/hardening-g5.test.ts`（3 本）、`test/schema-conformance.test.ts`（数の試験の置き換え・エラーの組の表に 409 の行）、`test/browser-sdk.test.ts`（表の数 19→20）。

### コミット
- `5a35173` feat: 1 人が行を持てるランキングのボードの数に上限（20）を置き、超える新しいボードに 409 RANKING_LIMIT_EXCEEDED を返す（#75。堅めの G5）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 上限の定数は `src/modules/rankings/limits.ts` に置き、管理の読む口（`src/core/`）の SQL には `LIMIT` を足さなかった（core はモジュールを読み込めないため。件数は書き込みの上限で止まる）。違っていれば定数を core へ移して `LIMIT ?` を足す。
- マイグレーションは足さなかった（数えるのは 1 人 20 行まで）。要るなら新しい番号で `(game_id, player_id)` の索引を足す。
- `client-integration-design.md` の古い「103 か所」（`x-error-codes` の数。開始時に既に 110 で合っていなかった）は、数を書き直さずに消した。戻すなら数を書き直す。

### やらなかったこと・断られた操作
- Unity・Unreal の表の上のコメント「errorCatalog と同じ 19 行」は直していない（直すと行を消すことになり、「行を消さない」の条件に当たる）。いまは 20 行で、コメントが古い。
- 専用 PC での Unity・Unreal の確かめはしていない（G10 の後の human の Issue）。
- 断られた操作はない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 管理の読む口の `rankings` の SQL に `LIMIT` を入れれば、上限より前からある行にも「最大 20 件」が効く。
- `analytics-design.md`・`quest-design.md`・`distribution-design.md` に、`…19個のエラーコードと一致する` の試験の名前が昔の束の記録として残っている。


## #76 G6: セーブの墓石を含めた行を 1 人 100 までにし、上限では一番古い墓石を使い回す（契約は文だけ。堅めの設計書の G6） — PASS

- `1747db8 feat: セーブの墓石も数えた行を 1 人 100 までにし、上限では新しい名前の書き込みが同じ batch で一番古い墓石を使い回す（#76。堅めの G6）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| メッセージに `#76` があるコミットが 1 件以上ある | 満たす | `git log --oneline -1` → 1747db8「…（#76。堅めの G6）」 |
| api-contract.md のセーブの節に「使い回」と「100」を同じ行に含む行がある | 満たす | DELETE の節に「消したスロットの印は 1 人（1 ゲーム）100 個まで残り、それより古いものから使い回す…リビジョンは 1 から」を足した |
| save-design.md に「墓石の数の上限と掃除は範囲の外」が残っていない | 満たす | §2 の文を置き換えた。§9 の行は消した |
| 公開と管理のスキーマは説明の文のほかを変えない | 満たす | 公開のスキーマは DELETE 200 の `description` を 1 つだけ変えた。管理のスキーマには手を付けていない |
| `APP_ENV=local` の守りが残り、`src/core/` がモジュールを読み込まない | 満たす | guards.ts には手を付けていない。src/core の変更は無い |
| 型の確かめが通る | 満たす | `npm run typecheck` → exit 0 |
| 変えてはいけないパス・clients/・scripts/・既存のマイグレーションに触れていない | 満たす | 変えたのは 6 ファイル（docs/api-contract.md・save-design.md・openapi/rpg-online.v1.json・src/modules/saves/index.ts・limits.ts・test/saves-manage.test.ts） |
| 直してよいファイルのほかに既存の試験を変えず、確かめの数を減らさない | 満たす | 変えた試験は test/saves-manage.test.ts だけで、足しただけ（消えた行は import の 1 行で、新しい定数を足した形に置き換えた） |
| `node scripts/test.mjs` が PASS で、新しい 3 本と base の試験がある | 満たす | `node scripts/test.mjs` → `Result: PASS 455/455`。junit に新しい 3 本があり、failure は 0 |
| 判定役のレビュー | 満たす | 別のエージェントが差分とログを読み、全部の条件を満たすと判定した。SQL に誤りは見つからなかった |
| ユーザーの最終判定（契約の文と試験の読みやすさ） | ユーザーが決める | 機械では見ない |

### やったこと
- `limits.ts` に `MAX_SAVE_ROWS = 100` を足した（墓石も数えた行の上限。定義はこの 1 か所）。
- `index.ts` の PUT（`baseRevision = 0` のとき）で、`reuseTombstone` の DELETE を `insertFirst` と同じ `batch` で流すようにした。墓石を消すのは次の 3 つが揃うときだけ:
  - その名前の行が無い
  - 墓石も数えた行が 100 以上ある
  - 生きているスロットが `MAX_SLOTS` 未満
  消すのは一番古い墓石（`updated_at`、同じなら `slot_id` の昇順）の 1 つだけ。
- 文書を直した: api-contract.md・save-design.md（§2・定数の表・§3 の SQL・§9・決めること 10）・openapi の説明の文。
- 試験を 3 本足した（test/saves-manage.test.ts の「G6 墓石の使い回し」）。

### コミット
- 1747db8 feat: セーブの墓石も数えた行を 1 人 100 までにし、上限では新しい名前の書き込みが同じ batch で一番古い墓石を使い回す（#76。堅めの G6）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 「一番古い」は `updated_at`（墓石になった時刻）で決め、同じ時刻なら `slot_id` の昇順にした。違っていたら `reuseTombstone` の ORDER BY を直す。
- `INSERT` の側には行の数の条件を足していない。消すのは DELETE の側の条件だけで決まる（API だけでは 100 行を超えないため）。違っていたら `insertFirst` の WHERE に条件を足す。
- 試験の墓石は DB に直に入れた（API で 100 行を作ると利用制限の 60 回／分に当たるため）。

### やらなかったこと・断られた操作
- 無し。push と Issue への書き込みはスクリプトが行う。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- G6 の前から 100 行を超えていたプレイヤーは、新しく書くたびに墓石が 1 つ消えるだけで、行の数は 100 まで下がらない。API だけではこの状態にならない。


## #77 G7: 管理の定義どうしの整合（実績の取り消し・キーと閾値・送り直しの順・競合の文）（管理の口の契約が変わる。堅めの設計書の G7） — PASS

- `4aea345 feat: 管理の定義どうしの整合を断る（実績の取り消しは値が閾値より小さいときだけ・キーと閾値・送り直しは宣言の前に記録を引く・競合の文を 1 つに。#77。堅めの G7）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| `#77` のコミットが 1 件以上 | 満たす | `git log --grep "#77" 7fef388..HEAD` → 4aea345 |
| `docs/api-contract.md` の管理の API に「同時の変更とぶつかった」 | 満たす | `grep -c 同時の変更とぶつかった docs/api-contract.md` → 1（管理の API の共通の決まり） |
| 公開のスキーマは説明の文のほかを変えない | 満たす | 4aea345 は `openapi/rpg-online.v1.json` に触れていない（変えたのは管理のスキーマの description だけ） |
| `APP_ENV=local` の守り・`src/core/` がモジュールを読まない | 満たす | `src/core/guards.ts` は変えていない。`grep -rn "from '(../)*modules/" src/core` → 0 件 |
| `npm run typecheck` が通る | 満たす | `tsc --noEmit` がエラー無しで終わった |
| 変えないもの・`clients/`・`scripts/`・`docs/guides/manuals/` に触れていない | 満たす | `git show --stat 4aea345` の 10 件はどれもその外 |
| 既存の試験は直してよいファイルだけ・確かめの数を減らさない | 満たす | 直したのは `test/admin.test.ts` だけ（準備の 2 行）。expect の数は base 420 → いま 420 |
| テストの入口が PASS・新しい 7 本と base の試験 | 満たす | `node scripts/test.mjs` → `Result: PASS 462/462`、`--filter G7` → `Result: PASS 7/7` |
| ユーザーの最終判定（読みやすさ） | 機械では見ない | ユーザーが決める |

判定は別のエージェントにさせた。結果は全部「満たす」で、不具合は見つからなかった（SQL の `?` の数とバインドの数も 4 つの文で突き合わせた）。

### やったこと
- §3.1: 実績の取り消し（`routes-player-data.ts`）。先に `revokeRefusal` で見る。解いた行が無ければ 404、値が閾値以上なら 400（`… lower the value first`）。同じ条件を監査の行の文の `NOT EXISTS` にも入れた。
- §3.2 キーの宣言: 区切りで数えるキーを `add` 以外にする宣言を 400 で断る。区切りで数えるキーとは、区切りの宣言があるか、`once` でないクエストが見るキー。
- §3.2 キーの宣言: 見る実績・クエストの一番高い閾値より `maxValue` を下げる宣言を 400 で断る。
- §3.2 実績・クエストの宣言: `threshold` がキーの `maxValue` を超えれば 400。どれも先に読み、監査の行の文の条件にも入れた。
- §3.4: プレイヤーデータの POST は、宣言を読む前に同じ鍵の記録を引く。中身のハッシュが同じなら 1 回目の本文（200）、違えば 422。batch の後の読み直しは残した。応答を作る所は `replyFromWrite` にまとめた。
- §3.5: `common.ts` に `CONFLICT_MESSAGE` と `conflicted()` を置いた。読み直しても断る理由が無いときは、キー・実績・値・取り消し・クエスト・イベントの口がどれもこの文を返す。イベントの口は、読み直しで受け取りの守りも見るようにした。
- 契約の文: `docs/api-contract.md` の管理の API（競合の文 1 か所・各口の 400 と確かめの順）と、POST /v1/player-data の送り直し・確かめの順を直した。管理のスキーマの 400 の説明、`player-data-design.md` §8、`quest-design.md` §8 も直した。
- 試験: 新しいファイル `test/hardening-g7.test.ts` に §11 の G7 の 7 本を置いた。競合は、監査の行を 1 文目に持つ batch だけを流さない D1 の包みで作った。
- 既存の試験の準備を 2 つ直した（名前と確かめは変えていない）:
  - `管理で実績を取り消すと解いた行が消え監査に残る`: 値 10 のまま取り消すと G7 では 400 になる。Issue の指示どおり、取り消しの前に値を 9 に下げる準備を足した。監査の件数の確かめを変えないよう、表を直に直した。
  - `値のあるキーの書き方は変えられない`: kills の上限を 2 に下げる所で、見る実績 kill-10（閾値 10）より下になるので 400 になる。上限を下げる前に kill-10 の閾値を 2 にする準備を、表に直に足した。

### コミット
- 4aea345 feat: 管理の定義どうしの整合を断る（…#77。堅めの G7）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- **競合の文は `Conflicted with a concurrent change; send the request again`（400 `INVALID_ARGUMENT`）にした。** 違っていたら `common.ts` の `CONFLICT_MESSAGE` と契約の 1 行を直す。
- **品目の口は競合の文に含めなかった。** 書けない理由はいつも「種類が違う」で、文が正しいため。ランキングの行を消す口と BAN の口も含めなかった。
- **閾値の比べはクエストの全部の種類（`once` も）を見る。** 書き方を `add` に限るのは区切りのあるクエストだけ。
- **新しい試験は新しいファイル `test/hardening-g7.test.ts` に置いた。** 既存のファイルの確かめの数を守るため。違っていたら `git mv` で移す。

### やらなかったこと・断られた操作
- 断られた操作は無い。
- `player-data-design.md` の §4・§6 にある POST の確かめの順の文は直していない。Issue が直してよいとした範囲は §8 と §10 の行だけのため。契約の正の `docs/api-contract.md` は直した。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `player-data-design.md` §4・§6 の POST の順の文に「同じ鍵の記録を先に引く」を足す（いまは契約の文と食い違う）。
- 品目の口とランキングの行を消す口は、書けなかった後に読み直さない。理由はいつも 1 つなので文は正しいが、ほかの口と形がそろっていない。


## #78 G8: クエストの定義の口が区切りの宣言を付け替える（時差の変更・参照の無くなった宣言を消す）（管理の口の契約が変わる・緩める向き。堅めの設計書の G8） — PASS

- `4480c00 docs: クエストの設計書の試験の表と管理の口の頭書きを、区切りの宣言の付け替えに合わせる（#78。堅めの G8）`
- `51d10a0 feat: クエストの定義の口が区切りの宣言を付け替える（ほかのクエストが参照しなければ時差を置き換え区切りの値を消す・参照の無くなった宣言を消す。#78。堅めの G8）`

### 結果: 合格

判定は別のエージェントにさせた。そのエージェントは差分とログだけを読み、確認コマンドは回していない。

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| この Issue のコミット（メッセージに `#78`）が 1 件以上ある | 合格 | 51d10a0・4480c00 |
| 公開のスキーマ（`openapi/rpg-online.v1.json`）は説明の文のほかを変えない | 合格 | 触れていない。変えたのは管理のスキーマ `openapi/rpg-online-admin.v1.json` の summary・description の文だけ |
| `APP_ENV=local` の守りが残り、`src/core/` がモジュールを読み込まない | 合格 | `src/core/guards.ts` は変えていない。`src/core` に `../modules/` を読み込む行は無い |
| 型の確かめ（`npm run typecheck`）が通る | 合格 | `tsc --noEmit` が exit 0（直しのコミットの後にも回した） |
| 変えないもの（decisions・procedures・adr・scripts・clients・manuals・hardening-design.md・設定・package・既存のマイグレーション）に触れていない | 合格 | 変えたのは `docs/api-contract.md`・`docs/guides/working/quest-design.md`・`openapi/rpg-online-admin.v1.json`・`src/core/admin/routes-definitions.ts`・`src/core/admin/routes.ts`・`test/admin.test.ts` だけ |
| 既存の試験は直してよいファイルだけを変え、確かめの数を減らさない | 合格 | 変えたのは `test/admin.test.ts` だけで、expect は 420 → 452。`test/quests.test.ts` は変えていない |
| テストの入口が PASS で、新しい 3 本と base の試験（互換の試験を含む）がある | 合格 | `node scripts/test.mjs` が `Result: PASS 464/464`。junit に新しい 3 本があり、どれも通った。置き換えた旧い試験の名前は無い。base の試験は全部残っていて通る（`旧CLIはスキーマ変更後のAPIでもランキングを送って読める` を含む）。直しのコミットの後は `--filter 'クエスト'` だけを回し、`PASS 49/49` |
| ユーザーの最終判定（契約の文と試験の読みやすさ） | ユーザーが決める | 機械では見ない |

### やったこと
- `quest.put` は、同じキー・区切りで時差の違う宣言があっても、**ほかの**クエストがそのキー・区切りを参照していなければ通るようにした。その場合は同じ batch で次の 2 つを行う。
  - 宣言を新しい時差に置き換える（`ON CONFLICT DO UPDATE`）。
  - そのキー・区切りの区切りの値を消す。
- ほかのクエストが参照していれば、いまと同じく 400 を返す。文は `… for another quest` にした。この条件は、先に読んで断る所と、監査の行の文の条件の両方に入れた。
- 定義を変えて（`key`・`kind` の変更）参照の無くなった前の宣言は、同じ batch で区切りの値と一緒に消す。値が宣言を外部キーで指すので、値から先に消す。
- 試験は、`時差の違う区切りを同じキーに宣言するクエストの定義は400を返す` を `ほかのクエストが同じキーの区切りを使っていれば時差の付け替えは400` に置き換え、新しい試験を 2 本足した。
- 契約の文は旧文を置き換えた（`docs/api-contract.md` のクエストの定義の節、`quest-design.md` §6・§7・§8 と試験の表）。管理のスキーマは説明の文だけを直した。

### コミット
- 51d10a0 feat: クエストの定義の口が区切りの宣言を付け替える（#78）
- 4480c00 docs: クエストの設計書の試験の表と管理の口の頭書きを、付け替えに合わせる（#78）。判定役が見つけた古い記述の直し

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 「どのクエストにも受け取りが無ければ」は、「そのキー・区切りを参照するクエストに受け取りが無ければ」と読んだ。
  - 理由: 参照するほかのクエストがあれば、もともと 400 になる。自分に受け取りがあれば、いまある受け取りの守りで 400 になる。だから受け取りを見る条件を新しく足していない。
  - 違っていたら: ゲームの中に受け取りが 1 つでもあれば断る条件を、`questRefusal` と `insertQuestAudit` に足す。
- 参照の無くなった宣言を消すのは、このクエストの前のキー・区切りに限った。ゲーム全体の、参照の無い宣言は掃除しない（範囲を小さくするため）。
- 付け替えた宣言の `created_at` は、付け替えた時刻にした。戻すなら `upsertKeyPeriod` の SET から外す。

### やらなかったこと・断られた操作
- 断られた操作は無い。開発サーバーは起動していない。
- 区切りの宣言を消す管理の口（§3.3 の案 A）は、Issue の「やらないこと」なので作っていない。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- 前からある、どのクエストも参照しない区切りの宣言（G8 の前に残ったもの）を一度に掃除する手段が無い。


## #79 G9: トークンの鍵の取り替えの重なり・管理の利用制限は鍵の外れだけを数える・利用制限の IP を鍵付きのハッシュに（管理の口の説明が変わる。堅めの設計書の G9） — PASS

- `45d7753 feat: トークンの鍵の取り替えに重なりを作り、管理の口は鍵の外れだけを IP ごとに数え、利用制限の IP をトークンの鍵から作った HMAC にする（#79。堅めの G9）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| #79 のコミットが 1 件以上 | 満たす | `git log` で 45d7753（メッセージに「#79」） |
| 管理のスキーマと契約が「鍵を確かめる前」を言わない | 満たす | grep で 0 件（管理のスキーマの 429 の説明 15 か所を置き換え） |
| 公開と管理のスキーマは説明の文のほかを変えない | 満たす | description と summary を除いた JSON を HEAD と比べて同じ（node で比べた） |
| `デプロイの説明書は秘密の名前をEnvの型と同じ集合で挙げる` が通る | 満たす | `AUTH_TOKEN_SECRET_PREVIOUS` を `Env` の型と deploy.md に足した。試験は PASS |
| APP_ENV=local の守りが残る・core がモジュールを読まない | 満たす | guards.ts は変えていない。`src/core/` に `../modules/` の import は 0 件 |
| 型の確かめ | 満たす | `npm run typecheck` が exit 0 |
| 変えないものに触れていない | 満たす | 変えたのは src/core・test・openapi の管理のスキーマ・docs/api-contract.md・deploy.md・working の設計書 4 つ |
| 直してよい試験のファイルだけを変え、expect を減らさない | 満たす | admin 420→457、browser-cors 36→36、rate-limits 37→37、support 0→0 |
| テストが PASS で新しい 6 本と base の試験がある | 満たす | `node scripts/test.mjs` → `Result: PASS 469/469`（新しい 6 本と、互換の試験を含む base の試験が全部 PASS） |

判定は別のエージェントにさせた。実行のログと差分を読んで、全部の条件を「満たす」・欠陥は「なし」と判定した。

### やったこと
- §4 の案 A: `verificationSecrets`・`verifyTokenWithSecrets`・`previousTokenSecret`（src/core/token.ts）を足した。`requireAuth` は、いまの鍵と前の鍵（`AUTH_TOKEN_SECRET_PREVIOUS`）の両方で確かめる。署名はいまの鍵だけで、更新の口では新しい鍵のトークンになる。
- §5.1 の案 A: `checkAdmin` は鍵を確かめた後に数える。外れは `RATE_LIMITS.admin`（admin-ip。IP ごとで、no-ip も含む）で数え、上限を超えたら 429・ほかは 401。正しい鍵は新しい `RATE_LIMITS.adminKey`（admin-key。subject は 1 つ）で数える。
- §5.2 の案 A: `ipSubject(req, env)` を `HMAC(HMAC(tokenSecret, 'rpg-online/rate-limit-ip/v1'), ip)` にした。トークンの鍵が無いときは投げて 500 になる。
- 契約・管理のスキーマ・admin/abuse-protection/account の設計書・deploy.md（前の鍵を入れる手順と消す手順）を書き直した。core-foundation-design の hash.ts の置き場の行も直した。
- 試験: test/hardening-g9.test.ts に 5 本を足し、admin.test.ts で 1 本を置き換えた。スキーマの突き合わせの準備は外れを数える形に直し、IP の行の埋め方は `ipKey` の手伝いに替えた。

### コミット
- 45d7753 feat: トークンの鍵の取り替えに重なりを作り…（#79。堅めの G9）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- 正しい鍵の上限は 60 回／60 秒（`adminKey`、単位 admin-key）にした。subject は定数 `admin-key` にした。違っていたら rate-limit-policy.ts の値と、契約・設計書の表を直す。
- `AUTH_TOKEN_SECRET_PREVIOUS` が 32 文字未満のときは、500 にせず使わないことにした（いまの鍵だけで確かめる）。違っていたら `previousTokenSecret` を変える。
- トークンの鍵が無いときは、CF-Connecting-IP の見出しが無くても `ipSubject` が投げるようにした。これで管理の口とゲストの発行は、見出しの有無にかかわらず 500 になる。違っていたら `ipSubject` の確かめの順を入れ替える。

### やらなかったこと・断られた操作
- 無し（断られた操作も無し）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- abuse-protection-design.md §2 の表のゲストの発行の行は「IP（CF-Connecting-IP のハッシュ）」のままで、「鍵付きの」と書いていない（§3 の「鍵」に正があるので、そのままにした）。


## #80 G10: クライアントの層は new-resource（ゲストの発行・トークンの更新）を 429 だけ送り直す（クライアントの決まりが変わる。堅めの設計書の G10） — PASS

- `0bd223a feat: 3 つのクライアントの層は new-resource（ゲストの発行・トークンの更新）を 429 だけ送り直し、回線断・タイムアウト・5xx は呼び手に返す（#80。堅めの G10）`

### 結果: 合格
| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| この Issue のコミット（`#80`）が 1 件以上 | OK | `0bd223a`（メッセージに `#80`） |
| スキーマの `x-retry` の値を変えず、説明の文のほかを変えない | OK | `git show 0bd223a -- openapi/` の差は `x-client-policy.description` の 1 行だけ。管理のスキーマは触れていない |
| client-integration-design.md の `new-resource` の行が 429 だけ送り直すと書く | OK | §2.2 の表の行「`new-resource` … **429 だけ**する …」（87 行目） |
| `src/`・`migrations/` に触れていない／守りが残る／`src/core/` がモジュールを読まない | OK | コミットの 11 ファイルは `clients/`・`openapi/rpg-online.v1.json`・`docs/api-contract.md`・`docs/guides/working/client-integration-design.md`・`test/` の 2 本だけ |
| 型の確かめ | OK | `npm run typecheck` → tsc --noEmit がエラー無しで終了 |
| 変えないもの（decisions・procedures・adr・scripts・manuals・hardening-design・設定・package・CLAUDE.md・.claude）に触れていない | OK | 同上の 11 ファイルのみ。未コミットは `docs/inspecs/2026/`（追跡外・確認コマンドが除く）だけ |
| 直してよい試験のファイルのほかを変えず、expect の数を減らさない | OK | 変えたのは `test/browser-sdk.test.ts`・`test/client-policy.test.ts` だけで、足しただけ（消した行なし） |
| テストの入口が PASS・新しい 2 本と base の試験が全部通る | OK | `node scripts/test.mjs` → `Result: PASS 471/471`。junit に新しい 2 本が通ったものとして入っている |
| ユーザーの最終判定（読みやすさ） | 人が判定 | 機械では見ない |

判定は別のエージェントが差分と上のログを読んで行い、全部 OK・実装の誤りなしとした。

### やったこと
- ブラウザの SDK（`clients/browser/rpg-online-client.mjs`）: `new-resource` の操作は状態が 429 のときだけ送り直す（`retryableByKind`）。回線断・タイムアウト・5xx は 1 回で `not retried: new-resource` の理由を付けて返し、`retryable` は false。`.d.mts` の `retryable` の説明を合わせた。
- Unity（`RpgOnlineClientPolicy.cs` に `RateLimitOnlyKind = "new-resource"`・`RpgOnlineClient.cs`）と Unreal（`RpgOnlineClientPolicy.h`・`RpgOnlineClient.cpp`）に同じ手順を入れた。
- 契約の文を置き換えた: スキーマの `x-client-policy` の説明・`docs/api-contract.md` のクライアントの決まり（2 か所）・`client-integration-design.md` §2.2 の表（種類の行と `issueGuest`・`refreshToken` の行）。
- 試験を 2 本足した: `SDKはゲストの発行を500とタイムアウトで自動で送り直さず429だけ送り直す`（偽の fetch で 500・コード無しの 503・タイムアウト・429・refreshToken の 500 を確かめる）、`UnityとUnrealのクライアント層の再試行の決まりはnew-resourceを429だけ送り直す`（L1。注釈を除いて定数と手順の行を突き合わせる）。

### コミット
- `0bd223a` feat: 3 つのクライアントの層は new-resource（ゲストの発行・トークンの更新）を 429 だけ送り直し、回線断・タイムアウト・5xx は呼び手に返す（#80。堅めの G10）

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- `new-resource` の 429 のほかの失敗では `retryable` を false にした（ゲームが自分で送り直しても同じく新しいものができるため）。true にするなら 3 つの層の `&& retryableByKind` を外して戻す。
- Unity と Unreal の試験は `test/client-policy.test.ts` に新しい describe として置いた（両方の層を 1 本で見るため）。分けるなら `unity-client.test.ts`・`unreal-client.test.ts` へ移す。
- 新しい定数の名前は `RateLimitOnlyKind` にした（`NoAutoRetryKind` に並べた）。

### やらなかったこと・断られた操作
- 実装を一時的に外して新しい試験が落ちることを確かめるため `git stash` を試したが、断られた。代わりに試験の期待（送った回数 1 回・待ち無し）を読み、前の挙動（3 回送る）では落ちることを確かめた。
- Unity・Unreal のビルドと実機の確かめはしていない（Mac の L1 まで。専用 PC の確かめは後の human の Issue）。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- `client-integration-design.md` §9 の試験の表と `test/browser-sdk.test.ts` の頭書きにある「B2 の 13 本」の数に、G10 の 1 本が入っていない（試験の名前の正は hardening-design §11）。
- ブラウザの試験に、タイムアウトでない回線断と、`refreshToken` の 429 の送り直しのケースが無い。

