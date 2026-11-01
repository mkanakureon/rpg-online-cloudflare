# 利用上限とコストの見積もり

この説明書は、自分の Cloudflare に Worker と D1 を置いた作者（`docs/guides/manuals/deploy.md` と同じ読み手）に向けた、費用と上限を見積もるための手引きです。
**料金の額と無料の枠の数は書きません。** Cloudflare の料金と上限は変わるため、公式の価格表を見てください（`docs/guides/decisions/operations-security.md` の「Cloudflare利用料について」）。
ここには、額を見積もるための**このリポジトリ側の材料**（どの表がどれだけ増えるか・何日で消えるか・1 回の掃除の文の数）だけを書きます。

## 前提

- 公式の価格表（このリポジトリが使うのは Workers と D1。セーブは D1 に入れる）:
  - Workers: https://developers.cloudflare.com/workers/platform/pricing/
  - D1: https://developers.cloudflare.com/d1/platform/pricing/
  - R2・Durable Objects はいまのコードでは使いません（`operations-security.md` に URL がある）。
- D1 の料金は、読んだ行・書いた行・保存の量で数えます（`docs/guides/working/analytics-design.md` §8）。それぞれの単価と無料の枠は上の公式で見ます。
- 費用の見張りは `docs/guides/manuals/cost-alerts.md` で作ります。

## 手順

### 1. 増える表と消える日数を知る

掃除の Cron（毎日 UTC 18:30。`src/core/cleanup.ts` の `CLEANUP_CRON`）が、次の 5 つの表から保持の日数を過ぎた行を消します。日数は `src/core/cleanup.ts` の `RETENTION_DAYS` と `src/core/admin/audit.ts` の `AUDIT_RETENTION_DAYS` が正で、試験がこの表と比べます。

| 表 | 保持の日数 | 何が増えるか |
| --- | --- | --- |
| `admin_audit_log` | 365 日 | 管理の口の操作 1 回に 1 行 |
| `player_data_writes` | 30 日 | プレイヤーデータの書き込み 1 回に 1 行（`Idempotency-Key` と応答の写し） |
| `player_data_period_values` | 35 日 | デイリー・週間の区切りの値。プレイヤー × 区切り × 鍵ごとに 1 行 |
| `rate_limit_counters` | 1 日 | 利用制限の窓 × 鍵ごとに 1 行 |
| `player_activity_days` | 400 日 | 遊んだプレイヤー 1 人に 1 日 1 行 |

- **いまの版では、掃除は `APP_ENV` が `local` のときだけ動きます**（`src/core/cleanup.ts` の `runScheduled`）。staging・production では、守りを外す束 P6 までは何も消えないので、上の表も消さない表と同じに増えます。
- `player_activity_days` の行の数は、ならすと **DAU × 400 日**です（1 日に遊んだ人の数 × 保持の日数）。

### 2. 消さない表の増え方を知る

次の 3 つの表は消しません（消すと二重に受け取れる・増減の証拠が無くなる。`src/core/cleanup.ts` の頭書き）。

| 表 | 増え方 |
| --- | --- |
| `quest_claims` | クエストの受け取りの数だけ増える |
| `event_claims` | イベントの報酬の受け取りの数だけ増える |
| `inventory_ledger` | 所持品の増減（受け取りと管理の増減）の数だけ増える |

ほかの表（プレイヤーデータ・セーブ・ランキング・アカウントなど）は、プレイヤーの数とそれぞれの上限（`docs/api-contract.md`）で量が決まります。

### 3. 掃除の 1 回の量を知る

- 1 つの `DELETE` が消すのは `CLEANUP_ROWS_PER_STATEMENT`（1000 行）まで、1 回の掃除で送る文は `CLEANUP_MAX_STATEMENTS`（40 文）までです（`src/core/cleanup.ts`）。残りは次の日に消します。
- 40 文は、D1 の Free の 1 回の起動の文の数の上限（50 文と `analytics-design.md` §6 に控えた）の内に収めるための数です。いまの上限は**要確認**で、公式の D1 の上限の文書で見てください。
- 1 日に消える行は多くて 40 × 1000 行です。保持の日数を過ぎる行がそれより多い日が続くと、表が増え続けます。

### 4. 利用上限を知る

| 上限 | どこで見るか |
| --- | --- |
| D1 の 1 データベースの容量・1 アカウントのデータベースの数・要求の逐次の処理 | 公式の D1 の上限と価格表（上の URL）。数は**要確認**で、ここには写さない |
| Workers の要求の数・CPU の時間 | 公式の Workers の価格表（上の URL）。数は**要確認** |
| 利用制限の回数（ゲストの発行・スコアの投稿・セーブなど、IP・プレイヤー・ゲームごと） | `src/core/rate-limit-policy.ts` の `RATE_LIMITS`（回数と窓の秒）。ここには写さない |
| セーブのスロットの数・プレイヤーデータの値の上限 | `docs/api-contract.md` |

### 5. 見積もる

1. 見込みの DAU と、1 人が 1 日に送る要求の数（読み取り・書き込み）を決めます。
2. 手順 1・2 の表から、1 か月の後の行の数（読んだ行・書いた行・保存の量の手がかり）を出します。
3. 公式の価格表の単価と無料の枠に当てはめて、額を自分で出します（このリポジトリには額を書かない）。
4. 出した額をもとに、`cost-alerts.md` で予算のアラートを作ります。

## 確かめ方

| 確かめ | どうするか |
| --- | --- |
| 保持の日数がいまのコードと同じ | `src/core/cleanup.ts` の `RETENTION_DAYS` と `src/core/admin/audit.ts` の `AUDIT_RETENTION_DAYS` を見る。`npm test` の `利用上限の説明書の保持の日数は掃除の定数と一致する` が通る |
| 実際の量 | Cloudflare のダッシュボードの D1 の画面で、保存の量と読んだ行・書いた行を見る |

## 困ったとき

| 起きたこと | 見るところ |
| --- | --- |
| D1 の保存の量が増え続ける | 手順 1 の注意（P6 までは掃除が動かない）と、手順 2 の消さない 3 つの表の行の数を見る |
| 429 `RATE_LIMITED` が多い | `src/core/rate-limit-policy.ts` の回数と、クライアントの再試行を見る |
| 公式の数がこの説明書の控えと違う | 公式が正です。控え（`analytics-design.md` の数）は当時の記録です |
