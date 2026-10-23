#!/usr/bin/env node
// stop-hook.mjs — issue-run.mjs の Claude が返答を終えようとしたときに呼ばれる（Stop hook・Node 版）。仕様の正: キットの shared/spec/issue-run-spec.md 4 章。
// 合格していなければ {"decision":"block"} を返して、同じプロセスのまま作業を続けさせる。
// 見るのは、報告ファイルが「## 結果: 合格」・守るファイルが開始時のまま、の 2 つだけ。確認コマンドは回さない（issue-run.mjs が回の後に 1 回だけ回す）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { reportClaimsPass, changedProtected } from '../../scripts/issue-run/lib.mjs';

try { readFileSync(0); } catch { /* hook の入力（使わないが読み切る） */ }
const env = process.env;
if (env.ISSUE_RUN_PROBE) { writeFileSync(env.ISSUE_RUN_PROBE, 'stop-hook ran\n', 'utf8'); process.exit(0); }
if (!env.ISSUE_RUN_REPORT) process.exit(0);
const root = env.ISSUE_RUN_ROOT ?? process.cwd();

function notPassReason() {
  const claimed = existsSync(env.ISSUE_RUN_REPORT) && reportClaimsPass(readFileSync(env.ISSUE_RUN_REPORT, 'utf8'));
  if (!claimed) return `報告ファイル ${env.ISSUE_RUN_REPORT} に「## 結果: 合格」が無い。合格の条件を全部、実行結果で満たしてから書く。`;
  if (env.ISSUE_RUN_PROTECT && existsSync(env.ISSUE_RUN_PROTECT)) {
    const changed = changedProtected(root, readFileSync(env.ISSUE_RUN_PROTECT, 'utf8'));
    if (changed.length) return `確認コマンドが使うファイルを変えた: ${changed.join(', ')}。合格の判定に使うファイルは変えない。git で開始時の中身に戻してから、作る側を直す。`;
  }
  return '';
}

const why = notPassReason();
if (!why) process.exit(0);
let count = 0;
if (env.ISSUE_RUN_STATE && existsSync(env.ISSUE_RUN_STATE)) count = Number(readFileSync(env.ISSUE_RUN_STATE, 'utf8').trim()) || 0;
count++;
if (env.ISSUE_RUN_STATE) writeFileSync(env.ISSUE_RUN_STATE, String(count), 'ascii');
const max = Number(env.ISSUE_RUN_MAXBLOCKS) || 30;
if (count > max) process.exit(0);
process.stdout.write(JSON.stringify({ decision: 'block', reason: `${why}\nまだ終われない（無人実行・${count}/${max} 回目の押し返し）。質問せず、自分で選んで進める。断られた操作は使わずに、できる作業を続ける。` }));
process.exit(0);
