// cli-flow.mjs — CLI モックの流れと表示（読み込んでも何も送らない。終了コードを返す）。
//
// scripts/cli-mock.mjs（環境の変数を読む入口）がここの runCli を呼ぶ。送るのはブラウザの SDK（clients/browser/rpg-online-client.mjs）だけで、
// 手順の一覧と確かめは SDK の runScenario の 1 か所（設計書 docs/guides/working/client-integration-design.md §4・§5.3）。
// 失敗したら画面の文の種類（§2.5）と理由を出し、終了コード 1 を返す。Workers のランタイムの試験
// （test/browser-sdk.test.ts の「CLIはタイムアウトしたら決めた回数だけ再試行して失敗を表示する」）から読めるよう、Node.js の API を使わない。
// 要求の形の関数 scripts/cli-requests.mjs は互換の試験が見張り続けるので残す（ここからは読まない）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01
import { runScenario } from '../clients/browser/rpg-online-client.mjs';

/** SDK の要求ごとの記録を 1 行にする（トークン・見出し・本文は記録に入っていない）。 */
export function requestLogLine(event) {
  const where = `${event.method} ${event.path}`;
  if (event.reason === 'retry-wait') return `  ${where}: retry in ${event.waitMs}ms (after attempt ${event.attempt})`;
  const what = event.status === null ? `no response (${event.reason})` : String(event.status);
  return `  ${where}: ${what} [attempt ${event.attempt}]`;
}

/**
 * §4 のシナリオを client（createClient の結果）で流し、手順ごとの結果を log に 1 行ずつ出す。
 * 全部通れば 0、どれかが失敗したら画面の文の種類と理由を出して 1 を返す（例外にしない）。
 */
export async function runCli({ client, log, scenario = {} }) {
  const result = await runScenario(client, {
    ...scenario,
    onStep: (step) => log(step.ok ? `ok   ${step.name}: ${step.detail}` : `FAIL ${step.name}`),
  });
  if (result.ok) {
    log('\nPASS: local CLI smoke test');
    return 0;
  }
  const { name, category, reason } = result.failed;
  log(`\nFAIL: local CLI smoke test at step "${name}"`);
  log(`category: ${category}`);
  log(`reason: ${reason}`);
  return 1;
}
