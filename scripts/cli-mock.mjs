#!/usr/bin/env node
// cli-mock.mjs — CLI モックの入口（将来の UE・Unity・ブラウザの HTTP クライアントの代わり。ローカル専用）。
//
// 環境の変数 API_BASE_URL（既定 http://127.0.0.1:8787）を読み、ブラウザの SDK（clients/browser/rpg-online-client.mjs）で
// クライアントを作って scripts/cli-flow.mjs の runCli を呼ぶだけ。自分では送らない（タイムアウト・再試行・Retry-After は SDK。
// 設計書 docs/guides/working/client-integration-design.md §5.3）。流れ（設定とマスターデータ → ゲストの発行とトークンの更新 → スコア → セーブ → イベントの報酬 →
// プレイヤーデータと実績 → クエスト）と表示は cli-flow.mjs と SDK の runScenario。トークンは SDK が記録にも画面にも出さない。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01
import { createClient } from '../clients/browser/rpg-online-client.mjs';
import { requestLogLine, runCli } from './cli-flow.mjs';

const log = (line) => console.log(line);
const client = createClient({
  baseUrl: process.env.API_BASE_URL || 'http://127.0.0.1:8787',
  gameId: 'demo-rpg',
  log: (event) => log(requestLogLine(event)),
});
process.exitCode = await runCli({ client, log });
