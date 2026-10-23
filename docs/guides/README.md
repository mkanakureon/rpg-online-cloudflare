# docs/guides — 用途別の分類

**直下に README 以外の文書を置かない。** 読む場面と使い方で分ける。

| 置き場 | 何を置くか | いつ読むか |
|---|---|---|
| [`working/`](working/) | 仕組み・方式・運用の**正** | **関連作業のとき。実装を変えたら対応箇所を更新する** |
| [`procedures/`](procedures/) | 実行順・コマンド・結果の読み方 | 作業を再現するとき |
| `manuals/` | 使う人に渡す説明書 | 使うとき |
| [`decisions/`](decisions/) | 方針・決定の**正** | 決めるとき・変わったとき |
| `reading/` | 読み物・参考 | 学ぶとき（**作業中には引かない**） |

## 足すとき

「実装を変えたら、この文書も直すか」で決まる。

```text
直す           → working/     （直さないなら、それは正ではない）
使う人に渡す   → manuals/
順番に実行する → procedures/
決定そのもの   → decisions/
一度読めば済む → reading/
```

`working/` に足したら **CLAUDE.md の入口の表にも1行足す**。入口に無い文書は読まれない。
その時点の記録（更新しない）は `docs/reports/YYYY/MM/DD/`（`save-report` スキル）。
人が書く入力の文書（例: 要件のメモ・一覧の表）は `docs/inspecs/YYYY/MM/` だけに置く。Claude はそこを読むだけで書き換えず、ここ（`docs/guides/`）と `docs/reports/` の文書を書く。
