# Issue の無人実行のまとめ（20261101-171213）

`scripts/issue-run/issue-run.mjs` が自動で書いた。リポジトリ mkanakureon/rpg-online-cloudflare・作業場所 `/Users/mukunashikentarou/Documents/Projects/rpg-online-cloudflare`・ログ `.issue-run/logs/20261101-171213/`

| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |
|---|---|---|---|---|---|---|
| #60 P1: LICENSE（MIT）と ADR 0003（配布の形・ライセンス・サポートの範囲）と README のライセンス・サポートの範囲・ゲストは本人確認でない・いまは書き込みが 403 の節 | PASS | 7 | 2026-11-01 17:12〜17:19 | 1 | 2 |  |

## #60 P1: LICENSE（MIT）と ADR 0003（配布の形・ライセンス・サポートの範囲）と README のライセンス・サポートの範囲・ゲストは本人確認でない・いまは書き込みが 403 の節 — PASS

- `c447578 docs: README の cli:smoke が呼ぶ手順を SCENARIO_STEPS の全部に合わせる（Issue #60）`
- `a345a92 feat: P1 の LICENSE（MIT）・ADR 0003（配布の形・ライセンス・サポートの範囲）・README のライセンスとサポートの範囲といまの制限の節・試験 4 本（Issue #60）`

### 結果: 合格

| 合格の条件 | 判定 | 根拠（コマンドと結果） |
|---|---|---|
| ADR 0003 が 1 つ・LICENSE・試験が git に入っている | 満たす | `docs/adr/0003-distribution-license-support.md`・`LICENSE`・`test/distribution.test.ts` をコミット a345a92 で追加 |
| LICENSE の見出しの行・著作者の行・MIT の本文 | 満たす | 確認コマンドと同じ正規表現と文字列を node で評価して全部 true。MIT の標準の全文を使った |
| README の節・MIT と LICENSE・本人確認・改ざん・403 NOT_READY_FOR_PRODUCTION・ADR 0003・古い文が無い・無保証／再現できる不具合／料金 | 満たす | 同じ評価で 8 項目とも true |
| ADR 0003 の見出し・状態・6 語 | 満たす | 同じ評価で true |
| dependencies が無い・clients/ に node_modules が無い・manuals を作らない・APP_ENV の守り | 満たす | `existsSync` で false を確認、`package.json` と `src/` の差分 0 |
| typecheck | 満たす | `npm run typecheck` が exit 0 |
| テストの入口が PASS・P1 の 4 本・base の試験 | 満たす | `node scripts/test.mjs` が `Result: PASS 411/411`、`test/distribution.test.ts (4 tests)` が通過。base の試験のファイルは変えていない |
| 守るパスを base から変えていない | 満たす | `git diff --name-only 5da2613 -- src migrations openapi scripts clients docs/guides docs/api-contract.md wrangler.jsonc vitest.config.ts tsconfig.json package.json package-lock.json CLAUDE.md .claude test/support` が 0 件 |
| 判定役（別のエージェント） | 全部満たす | 差分とログを読ませた。必ず直す点は無し。任意の指摘 1（cli:smoke の手順の並びが全部でない）は作る物の中なので c447578 で直した |
| ユーザーの最終判定（著作者の名前・文の読みやすさ） | ユーザー | 機械では見ない |

### やったこと
- `LICENSE` を置いた（MIT の全文・`Copyright (c) 2026 mkanakureon`）。
- ADR 0003 を書いた（ゲーム別独立デプロイ・MIT・サポートの範囲・リポジトリの名前の案・Fab の境目・設計書を指す）。
- README を直した。状態の行を置き換え、「いまの制限」の節（ゲストは本人確認でない・スコアは改ざんできる・競争の強い機能に使わない・いまは書き込みが 403）を足した。5 つの口だけだった API の表を機能ごとの表にし、「ライセンス」「サポートの範囲」の節を足した。「将来の接続」は「クライアント」の節にして、いまの `clients/` に合わせた。設計資料の一覧に ADR 0003 と配布の設計書を足した。
- `test/distribution.test.ts` に P1 の 4 本を書いた（`?raw` で読む。`import.meta.glob` で `clients/**/node_modules` が空であることと、ブラウザの SDK が相対の import だけであることを見る）。node_modules を名指しした glob がファイルを拾うことは、一時の試験で確かめた（`../node_modules/vitest/**/package.json` が 1 件。試験は後で外した）。

### コミット
- a345a92 feat: P1 の LICENSE・ADR 0003・README の節・試験 4 本
- c447578 docs: README の cli:smoke が呼ぶ手順を SCENARIO_STEPS の全部に合わせる

### 選んだこと（自分で決めた点・違っていたときの戻し方）
- ADR のファイル名は `0003-distribution-license-support.md` にした。違えば `git mv` し、README のリンクと試験の import を直す。
- リポジトリの名前の案は `game-backend-cloudflare`（推し）・`cf-game-backend`・`open-game-backend` にした。違えば ADR 0003 の 1 行を直す。
- README の制限の文は新しい「いまの制限」の節に置いた（状態の行からも参照する）。違えば節を動かすだけでよい。

### やらなかったこと・断られた操作
- 一時の試験 `test/zz-probe.test.ts` は `rm` ではなく `mv` で `/tmp/` へ出した（追跡外のファイル）。
- 断られた操作は無い。

### 未採用の改善（気づいたがブロッカーでないもの。直さない）
- README の「Macでローカル動作確認」の「認証実装が必要です」「無認証APIのデプロイは行わないでください」は、ゲストのトークンができる前の言い方のまま（CLAUDE.md の「無認証の API をデプロイしない」とは合っている）。P2 のデプロイの説明書を書くときに合わせるとよい。
- `package.json` に `license: "MIT"` の欄が無い（Issue の決定で P1 では足さない）。

