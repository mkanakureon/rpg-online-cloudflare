#!/usr/bin/env node
// issue-run.mjs — GitHub Issue を 1 件ずつ、無人の Claude Code（claude -p）に合格まで進めさせる（Node 版・Windows と Mac）。
// 仕様の正: キットの shared/spec/issue-run-spec.md。使い方と Issue の書き方: docs/guides/working/issue-run.md
//   node scripts/issue-run/issue-run.mjs                 # 札の付いた Issue を全部、順に
//   node scripts/issue-run/issue-run.mjs --issue 12      # 1 件だけ
//   node scripts/issue-run/issue-run.mjs --dry-run       # 対象・合格の条件・渡す指示文を見るだけ（Claude は起動しない）
// 合格かどうかを Claude に決めさせない。報告の「## 結果: 合格」・守るファイルが開始時のまま・確認コマンドの終了コード 0 の 3 つがそろったときだけ合格。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import * as L from './lib.mjs';
import { run, runWithTimeout, processName, keepAwake, resolveCmd } from './proc.mjs';

const args = parseArgs(process.argv.slice(2));
const MAX_ISSUES = num(args['max-issues'], 20);
const ROUND_MINUTES = num(args['round-minutes'], 90);
const MAX_ROUNDS = num(args['max-rounds'], 4);
const LIMIT_WAIT_MINUTES = num(args['limit-wait-minutes'], 30);
const MAX_LIMIT_WAITS = num(args['max-limit-waits'], 16);
const MAX_STOP_BLOCKS = 30;
const MODEL = args.model ?? 'claude-opus-5-5';
const DRY_RUN = !!args['dry-run'];
const ONE_ISSUE = num(args.issue, 0);
const LOG_BASE = '.issue-run/logs';
const SKIP = [L.LABELS.working.name, L.LABELS.done.name, L.LABELS.failed.name];

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2);
    if (i + 1 < a.length && !a[i + 1].startsWith('--')) o[k] = a[++i]; else o[k] = true;
  }
  return o;
}
function num(v, d) { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== true ? n : d; }
const now = () => new Date();
const step = (t) => console.log(`[${L.hm(now())}:${String(now().getSeconds()).padStart(2, '0')}] ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gitTop(dir) {
  const r = run('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
  return r.code === 0 ? resolve(r.stdout.trim()) : '';
}
function worktrees(any) {
  const list = []; let cur = null;
  for (const line of run('git', ['-C', any, 'worktree', 'list', '--porcelain']).stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) { cur = { path: resolve(line.slice(9)), branch: '' }; list.push(cur); }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached' && cur) cur.branch = '(detached)';
  }
  return list;
}
// その worktree で issue-run.mjs が動いていれば PID、いなければ 0（自分は数えない）
function runningPid(root) {
  const lock = join(root, LOG_BASE, 'run.lock');
  if (!existsSync(lock)) return 0;
  const p = Number(readFileSync(lock, 'utf8').trim());
  if (!p || p === process.pid) return 0;
  return processName(p) === 'node' ? p : 0;
}

// 作業場所を決める（仕様 7 章）。--work-dir → それ。窓から起動 → 一覧から選ぶ。窓でない → 起動したフォルダー
async function resolveWorkRoot() {
  if (args['work-dir']) {
    const t = gitTop(args['work-dir']);
    if (!t) throw new Error(`--work-dir が git の作業フォルダーでない: ${args['work-dir']}`);
    return t;
  }
  const here = gitTop(process.cwd());
  if (!process.stdin.isTTY) {
    if (!here) throw new Error(`起動したフォルダーが git の作業フォルダーでない: ${process.cwd()}。--work-dir で指定する`);
    return here;
  }
  const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const trees = worktrees(here || scriptRoot);
  if (trees.length <= 1 && here) return here;
  console.log('作業場所（worktree）を選ぶ。* が起動したフォルダー（Enter でそれ）:');
  trees.forEach((w, i) => {
    const busy = runningPid(w.path);
    console.log(`  ${w.path === here ? '*' : ' '} ${i + 1}) ${w.path}  [${w.branch}]${busy ? `  ← 実行中（PID ${busy}）` : ''}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const ans = (await rl.question('番号: ')).trim();
      const pick = !ans ? here : (Number(ans) >= 1 && Number(ans) <= trees.length ? trees[Number(ans) - 1].path : '');
      if (!pick) { console.log(`1〜${trees.length} の番号を入れる`); continue; }
      if (runningPid(pick)) { console.log('そこでは別の issue-run が動いている。ほかを選ぶ'); continue; }
      return pick;
    }
  } finally { rl.close(); }
}

const ROOT = await resolveWorkRoot();
const BRANCH = run('git', ['-C', ROOT, 'branch', '--show-current']).stdout.trim();
let REPO = args.repo ?? '';
if (!REPO) {
  const origin = run('git', ['-C', ROOT, 'remote', 'get-url', 'origin']).stdout.trim();
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(origin);
  if (!m) { console.error(`origin が GitHub でない（${origin}）。--repo owner/name で指定するか、docs/guides/working/github-repo.md の手順で origin を作る`); process.exit(1); }
  REPO = `${m[1]}/${m[2]}`;
}
console.log(`作業場所: ${ROOT}（${BRANCH}）・リポジトリ ${REPO}`);
const PROMPT_FILE = join(ROOT, '.claude/issue-run/prompt.md');
const SETTINGS_TEMPLATE = join(ROOT, '.claude/issue-run/settings.json');
const STOP_HOOK = join(ROOT, '.claude/issue-run/stop-hook.mjs');
const RUN_STAMP = L.stamp(now());
const LOG_DIR_REL = `${LOG_BASE}/${RUN_STAMP}/`;
const LOG_DIR = join(ROOT, LOG_BASE, RUN_STAMP);
const LOCK_FILE = join(ROOT, LOG_BASE, 'run.lock');
const ISSUE_FILE = join(ROOT, LOG_BASE, 'run.issue');
const RUNTIME_SETTINGS = join(LOG_DIR, 'settings.json');

function gh(ghArgs) {
  const r = run('gh', ghArgs, { cwd: ROOT });
  if (r.code !== 0) throw new Error(`gh ${ghArgs.join(' ')} が失敗: ${r.stdout}${r.stderr}`);
  return r.stdout;
}
const ghJson = (a) => JSON.parse(gh(a) || 'null');
function setLabel(n, add = [], remove = []) {
  const a = ['issue', 'edit', String(n), '--repo', REPO];
  for (const l of add) a.push('--add-label', l);
  for (const l of remove) a.push('--remove-label', l);
  gh(a);
}
// コメントの本文はファイルで渡す（引数だと長さと引用符で壊れる）
function comment(n, body) {
  const tmp = join(LOG_DIR, `comment-${n}-${Math.floor(Math.random() * 1e9)}.md`);
  writeFileSync(tmp, body, 'utf8');
  gh(['issue', 'comment', String(n), '--repo', REPO, '--body-file', tmp]);
}
function initLabels() {
  const have = ghJson(['label', 'list', '--repo', REPO, '--limit', '200', '--json', 'name']).map((x) => x.name);
  for (const l of Object.values(L.LABELS)) {
    if (have.includes(l.name)) continue;
    gh(['label', 'create', l.name, '--repo', REPO, '--color', l.color, '--description', l.description]);
    step(`ラベルを作った: ${l.name}`);
  }
}
function targetIssues() {
  if (ONE_ISSUE > 0) return [ghJson(['issue', 'view', String(ONE_ISSUE), '--repo', REPO, '--json', 'number,title,labels,body'])];
  const list = ghJson(['issue', 'list', '--repo', REPO, '--label', L.LABELS.run.name, '--state', 'open', '--limit', '200', '--json', 'number,title,labels,body']);
  return list.filter((t) => !t.labels.some((l) => SKIP.includes(l.name))).sort((a, b) => a.number - b.number).slice(0, MAX_ISSUES);
}
const trackedFiles = () => run('git', ['-C', ROOT, 'ls-files']).stdout.split(/\r?\n/).filter(Boolean);
const protectedOf = (code) => L.protectedFiles(code, { root: ROOT, trackedList: trackedFiles() });

// 前提の Issue のうち、まだ済んでいないもの（仕様 2.2）
function unmetPrerequisites(nums) {
  const unmet = [];
  for (const n of nums) {
    const v = ghJson(['issue', 'view', String(n), '--repo', REPO, '--json', 'state,labels,comments']);
    if (v.state === 'CLOSED') continue;
    if (!v.labels.some((l) => l.name === L.LABELS.done.name)) { unmet.push(`#${n}（合格していない）`); continue; }
    const last = v.comments.filter((c) => /^issue-run\.(ps1|mjs)/.test(c.body)).at(-1);
    if (!last) continue;
    const shas = L.headShasFromComment(last.body).filter((s) => run('git', ['-C', ROOT, 'cat-file', '-e', `${s}^{commit}`]).code === 0);
    const missing = shas.filter((s) => run('git', ['-C', ROOT, 'merge-base', '--is-ancestor', s, 'HEAD']).code !== 0);
    if (missing.length) unmet.push(`#${n}（合格したコミット ${missing[0]} がブランチ ${BRANCH} に無い）`);
  }
  return unmet;
}
// ほかの worktree の実行が、いま進めている Issue の番号
function otherRunningIssues() {
  const nums = [];
  for (const w of worktrees(ROOT)) {
    if (w.path === ROOT || !runningPid(w.path)) continue;
    const f = join(w.path, LOG_BASE, 'run.issue');
    if (existsSync(f)) { const n = Number(readFileSync(f, 'utf8').trim()); if (n) nums.push(n); }
  }
  return nums;
}

// 作業場所の使用中の判定（仕様 9 章）。Node 版は使用中にしない。wrangler dev が動いていれば知らせだけ
function workspaceState() {
  return 'この作業場所は使用中にしない。確かめは node scripts/test.mjs（vitest）で、変えた所に関係するものだけ --filter で回す。wrangler dev などの開発サーバーを起動したままにしない。';
}

async function invokeClaude(prompt, minutes, outFile, sessionId, resume, env) {
  const a = ['-p', '--output-format', 'json', '--permission-mode', 'auto', '--permission-prompts', 'none',
    '--disallowed-tools', 'AskUserQuestion', '--settings', RUNTIME_SETTINGS];
  if (sessionId) a.push(resume ? '--resume' : '--session-id', sessionId);
  if (MODEL) a.push('--model', MODEL);
  const r = await runWithTimeout('claude', a, { cwd: ROOT, input: prompt, env: { ISSUE_RUN_ROOT: ROOT, ...env }, timeoutMs: minutes * 60 * 1000 });
  writeFileSync(outFile, r.stdout, 'utf8');
  if (r.stderr) writeFileSync(`${outFile}.stderr.txt`, r.stderr, 'utf8');
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* JSON でない出力（認証切れ・上限の文など） */ }
  return { timedOut: r.timedOut, json, raw: `${r.stdout}\n${r.stderr}` };
}

function passCheck(code, outFile) {
  writeFileSync(outFile.replace(/\.txt$/, '.mjs'), code, 'utf8');
  const r = run('node', ['--input-type=module'], { cwd: ROOT, input: code });
  const out = `${r.stdout}${r.stderr}`;
  writeFileSync(outFile, `exit=${r.code}\n${out}`, 'utf8');
  return { passed: r.code === 0, exitCode: r.code, tail: out.trim().split('\n').slice(-30).join('\n') };
}

// --- 二重起動を防ぐ ---
mkdirSync(dirname(LOCK_FILE), { recursive: true });
if (existsSync(LOCK_FILE)) {
  const other = Number(readFileSync(LOCK_FILE, 'utf8').trim());
  if (other && other !== process.pid && processName(other) === 'node') { step(`別の issue-run が動いている（PID ${other}）。終了する。`); process.exit(3); }
}
for (const f of [PROMPT_FILE, SETTINGS_TEMPLATE, STOP_HOOK]) if (!existsSync(f)) { console.error(`無人実行の部品が無い: ${f} — docs/guides/working/issue-run.md の「準備」`); process.exit(1); }
if (!resolveCmd('gh')) { console.error('gh が無い。GitHub CLI を入れる'); process.exit(1); }
if (run('gh', ['auth', 'status']).code !== 0) { console.error('gh にログインしていない。gh auth login を先に。'); process.exit(1); }

const targets = targetIssues();
step(`対象 ${targets.length} 件: ${targets.map((t) => `#${t.number}`).join(' ')}`);
if (DRY_RUN) {
  for (const t of targets) {
    const c = L.parsePassCriteria(t.body);
    console.log(`#${t.number} 合格の条件 ${c.items.length} 行・確認コマンド ${c.check ? 'あり' : 'なし'}`);
    if (!c.items.length || !c.check) { console.log('  → 合格の条件か確認コマンドが無いので起動しない'); continue; }
    console.log(`  守るファイル: ${protectedOf(c.check).join(', ')}`);
    const pre = L.parsePrerequisites(t.body);
    if (pre.length) console.log(`  前提: ${pre.map((n) => `#${n}`).join(' ')}（いま済んでいないもの: ${unmetPrerequisites(pre).join(' ')}）`);
  }
  if (targets.length) {
    const c0 = L.parsePassCriteria(targets[0].body);
    console.log('--- 1件目に渡す指示文 ---');
    console.log(L.issuePrompt(L.readText(PROMPT_FILE), { repo: REPO, number: targets[0].number, branch: BRANCH, state: workspaceState(), report: '<報告ファイル>', protectedList: protectedOf(c0.check) }));
  }
  process.exit(0);
}
if (!targets.length) process.exit(0);

writeFileSync(LOCK_FILE, String(process.pid), 'ascii');
mkdirSync(LOG_DIR, { recursive: true });
const awake = keepAwake();
if (awake.how === 'none-windows') step('Windows では Node だけで眠りを止められない。電源につないで「電源とスリープ」で眠らない設定にしておく');
const results = [];
let aborted = '';

try {
  initLabels();

  // 前回が途中で落ちていたら、実行中の札が残っている。外して対象に戻す（ほかの worktree の実行の分は外さない）
  const othersBusy = otherRunningIssues();
  for (const s of ghJson(['issue', 'list', '--repo', REPO, '--label', L.LABELS.working.name, '--state', 'open', '--json', 'number'])) {
    if (othersBusy.includes(s.number)) continue;
    setLabel(s.number, [], [L.LABELS.working.name]); step(`前回の実行中の札を外した: #${s.number}`);
  }

  // 設定の実体を作る（仕様 3.2）
  writeFileSync(RUNTIME_SETTINGS, L.buildSettings(L.readText(SETTINGS_TEMPLATE), { stopHook: STOP_HOOK, root: ROOT }), 'utf8');

  // 起動前の点検（仕様 3.3）
  const probeMark = join(LOG_DIR, 'probe-stop-hook.txt');
  const probe = await invokeClaude('これは点検。Bash ツールで `git stash list` を1回だけ実行し、結果を1行で答えて終わる。断られたら、断られたと1行で答えて終わる。', 5, join(LOG_DIR, 'probe.json'), '', false, { ISSUE_RUN_PROBE: probeMark });
  if (L.isAuthError(probe.raw) || !probe.json || probe.json.is_error) throw new Error(`claude -p が動かない（認証切れなど）: ${probe.json?.result ?? L.tail(probe.raw, 300)} — 手順は docs/guides/working/issue-run.md の「準備」`);
  if (!existsSync(probeMark)) throw new Error(`Stop hook が呼ばれなかった（設定が読まれていない）。${RUNTIME_SETTINGS} と claude の版を確かめる`);
  if (!(probe.json.permission_denials ?? []).length) throw new Error(`deny が効かなかった（git stash が断られなかった）。${RUNTIME_SETTINGS} を確かめる`);
  step('点検: 認証・Stop hook・deny とも効いている');

  const seen = new Set();
  while (seen.size < MAX_ISSUES) {
    const t = targetIssues().find((x) => !seen.has(x.number));
    if (!t) break;
    seen.add(t.number);
    const number = t.number;
    const criteria = L.parsePassCriteria(t.body);
    if (!criteria.items.length || !criteria.check) {
      const missing = [];
      if (!criteria.items.length) missing.push('「## 合格の条件」の箇条書き');
      if (!criteria.check) missing.push('「## 合格の条件」の中の ```js の確認コマンド（exit 0 で合格）');
      step(`#${number} 合格の条件か確認コマンドが無いので起動しない`);
      comment(number, `issue-run.mjs: **起動しなかった** — 本文に ${missing.join(' と ')} が無い。書いて ${L.LABELS.failed.name} を外すと次の回で対象になる。`);
      setLabel(number, [L.LABELS.failed.name]);
      results.push({ number, title: t.title, status: 'NO-CRITERIA', minutes: 0, rounds: 0, commits: [], denials: [], report: '' });
      continue;
    }
    const unmet = unmetPrerequisites(L.parsePrerequisites(t.body));
    if (unmet.length) {
      step(`#${number} 前提 ${unmet.join(' ')} が済んでいないので、今回は始めない`);
      results.push({ number, title: t.title, status: 'WAITING', minutes: 0, rounds: 0, commits: [], denials: [], report: '', reason: `前提 ${unmet.join(' ')} が済んでいない（合格か閉じられるか、合格したコミットをこのブランチに入れると次の実行で始まる）` });
      continue;
    }
    // 番号を先に書いてから、ほかの worktree の実行と取り合っていないか見る
    writeFileSync(ISSUE_FILE, String(number), 'ascii');
    if (otherRunningIssues().includes(number)) { rmSync(ISSUE_FILE, { force: true }); step(`#${number} はほかの worktree の実行が進めているので飛ばす`); continue; }

    const prot = protectedOf(criteria.check);
    step(`#${number} ${t.title} を始める（条件 ${criteria.items.length} 行・守るファイル ${prot.length} 件）`);
    setLabel(number, [L.LABELS.working.name]);
    const reportPath = join(LOG_DIR, `issue-${number}-report.md`);
    const headBefore = run('git', ['-C', ROOT, 'rev-parse', 'HEAD']).stdout.trim();
    const started = now();
    let sessionId = randomUUID();
    let haveSession = false;
    writeFileSync(join(LOG_DIR, `issue-${number}-check.mjs`), criteria.check, 'utf8');
    const protectFile = join(LOG_DIR, `issue-${number}-protect.tsv`);
    writeFileSync(protectFile, L.snapshotLines(ROOT, prot).join('\n') + (prot.length ? '\n' : ''), 'utf8');
    const env = { ISSUE_RUN_REPORT: reportPath, ISSUE_RUN_PROTECT: protectFile, ISSUE_RUN_STATE: join(LOG_DIR, `issue-${number}-stopblocks.txt`), ISSUE_RUN_MAXBLOCKS: String(MAX_STOP_BLOCKS) };
    const denials = [];
    let status = 'NOT-PASS', reason = '', round = 0, waits = 0, lastResult = '';

    while (round < MAX_ROUNDS) {
      round++;
      const prompt = haveSession ? L.continuePrompt(reason, workspaceState())
        : L.issuePrompt(L.readText(PROMPT_FILE), { repo: REPO, number, branch: BRANCH, state: workspaceState(), report: reportPath, protectedList: prot });
      step(`#${number} 回 ${round}/${MAX_ROUNDS}`);
      const res = await invokeClaude(prompt, ROUND_MINUTES, join(LOG_DIR, `issue-${number}-round${round}.json`), sessionId, haveSession, env);
      if (haveSession && /no conversation found/i.test(res.raw)) { sessionId = randomUUID(); haveSession = false; round--; continue; }
      haveSession = true;
      if (L.isAuthError(res.raw)) { aborted = `認証が切れた（#${number} の途中）`; status = 'ABORTED'; break; }
      if (L.isLimitError(res.json, res.raw) && waits < MAX_LIMIT_WAITS) {
        waits++; round--;   // 上限待ちは回数に数えない
        reason = '利用上限で中断した。中断したところから続ける。';
        step(`利用上限。${LIMIT_WAIT_MINUTES} 分待ってやり直す（${waits}/${MAX_LIMIT_WAITS}）`);
        await sleep(LIMIT_WAIT_MINUTES * 60 * 1000);
        continue;
      }
      for (const d of res.json?.permission_denials ?? []) denials.push(String(d.tool_name));
      lastResult = String(res.json?.result ?? '');
      if (res.timedOut) { reason = `1回の上限 ${ROUND_MINUTES} 分を超えて打ち切った。途中から続ける。`; continue; }
      if (!(existsSync(reportPath) && L.reportClaimsPass(L.readText(reportPath)))) {
        reason = `報告ファイルが「## 結果: 合格」になっていない。判定表で未合格の条件を満たす。最後の返答: ${L.tail(lastResult, 400)}`;
        continue;
      }
      const changed = L.changedProtected(ROOT, L.readText(protectFile));
      if (changed.length) {
        reason = `確認コマンドが使うファイルを変えた: ${changed.join(', ')}。合格の判定に使うファイルは変えない。git で開始時の中身に戻してから、作る側を直す。`;
        step(`#${number} 守るファイルが変わった（${changed.join(', ')}）。続けさせる`);
        continue;
      }
      const chk = passCheck(criteria.check, join(LOG_DIR, `issue-${number}-check${round}.txt`));
      if (!chk.passed) {
        reason = `「合格」と書いたが、Issue の確認コマンドが失敗した（exit ${chk.exitCode}）。出力の末尾:\n${chk.tail}`;
        step(`#${number} 確認コマンドが失敗（exit ${chk.exitCode}）。続けさせる`);
        continue;
      }
      status = 'PASS';
      break;
    }
    if (status === 'NOT-PASS') reason = `${MAX_ROUNDS} 回で合格しなかった。最後の理由: ${reason}`;

    const commits = run('git', ['-C', ROOT, 'log', '--oneline', `${headBefore}..HEAD`]).stdout.split(/\r?\n/).filter(Boolean);
    const report = existsSync(reportPath) ? L.readText(reportPath) : `（報告ファイルが無い）\n\n最後の返答:\n${L.tail(lastResult)}`;
    const ended = now();
    const minutes = Math.round((ended - started) / 60000);
    const span = L.formatSpan(started, ended);
    const head = run('git', ['-C', ROOT, 'rev-parse', '--short=8', 'HEAD']).stdout.trim();
    const uniq = [...new Set(denials)].sort();
    const lines = [L.headLine({ status, minutes, span, rounds: round, commits: commits.length, folder: basename(ROOT), branch: BRANCH, head, logDir: LOG_DIR_REL })];
    if (status !== 'PASS') lines.push(`合格しなかった理由: ${reason}`);
    if (uniq.length) lines.push(`auto mode に断られたツール: ${uniq.join(', ')}`);
    let body = [...lines, '', report].join('\n');
    if (body.length > 60000) body = body.slice(0, 60000) + `\n\n…（長いので切った。全文は ${reportPath}）`;
    comment(number, body);
    setLabel(number, [status === 'PASS' ? L.LABELS.done.name : L.LABELS.failed.name], [L.LABELS.working.name]);
    results.push({ number, title: t.title, status, minutes, span, rounds: round, commits, denials: uniq, report, reason });
    rmSync(ISSUE_FILE, { force: true });
    step(`#${number} → ${status}（${round} 回・コミット ${commits.length} 件）`);
    if (aborted) break;
  }
} catch (e) {
  aborted = e.message;
  step(`中断: ${aborted}`);
} finally {
  awake.stop();
  rmSync(LOCK_FILE, { force: true }); rmSync(ISSUE_FILE, { force: true });
  // まとめ（仕様 6 章）
  const d = now();
  const dayDir = join(ROOT, 'docs/reports', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'));
  mkdirSync(dayDir, { recursive: true });
  const nums = readdirSync(dayDir).map((n) => /^(\d{2})-/.exec(n)?.[1]).filter(Boolean).map(Number);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const summaryPath = join(dayDir, `${String(next).padStart(2, '0')}-issue-run.md`);
  writeFileSync(summaryPath, L.summaryMarkdown({ runStamp: RUN_STAMP, repo: REPO, root: ROOT, logDir: LOG_DIR_REL, aborted, results }), 'utf8');
  step(`まとめ: ${summaryPath}`);
}
process.exit(aborted ? 1 : 0);
