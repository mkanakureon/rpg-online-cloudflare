#!/usr/bin/env node
// test.mjs — テストの入口（Node 版）。vitest か node --test を回し、最後の 1 行に Result: を出す。合否は終了コード（PASS 0・FAIL 1）。
//   node scripts/test.mjs                   # 全部
//   node scripts/test.mjs --filter <名前>    # テストの名前で絞る（vitest の -t・node --test の --test-name-pattern）
//   node scripts/test.mjs --file <パス>      # ファイルで絞る
// どちらで回すかは package.json の issueKit の欄で決める。欄が無ければ vitest。
//   "issueKit": { "testRunner": "node", "testFiles": "tests/*.test.mjs" }   # node --test で回す（testFiles は文字列か配列）
// テストが 0 件なら FAIL（名前の打ち間違いやテストの消し忘れで「合格」にしない）。結果の XML は .issue-run/test-results/junit.xml。
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const fail = (why) => { console.log(`Result: FAIL (${why})`); process.exit(1); };

const pkgPath = join(root, 'package.json');
let kit = {};
if (existsSync(pkgPath)) {
  try { kit = JSON.parse(readFileSync(pkgPath, 'utf8')).issueKit ?? {}; } catch (e) { fail(`package.json が JSON として読めない: ${e.message}`); }
}
const runner = kit.testRunner ?? 'vitest';
if (runner !== 'vitest' && runner !== 'node') fail(`package.json の issueKit.testRunner は vitest か node（いま: ${runner}）`);

const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
if (runner === 'vitest' && !existsSync(vitest)) fail('vitest が無い。npm install を先に（devDependencies に vitest が要る）');
const testFiles = [kit.testFiles ?? []].flat();
if (runner === 'node' && !opt('--file') && !testFiles.length) fail('package.json の issueKit.testFiles が無い（node --test で回すファイル。例 "tests/*.test.mjs"）');
const xml = join(root, '.issue-run', 'test-results', 'junit.xml');
mkdirSync(dirname(xml), { recursive: true });
rmSync(xml, { force: true });

let args;
if (runner === 'vitest') {
  args = [vitest, 'run', '--reporter=default', '--reporter=junit', `--outputFile.junit=${xml}`, '--passWithNoTests'];
  if (opt('--filter')) args.push('-t', opt('--filter'));
  if (opt('--file')) args.push(opt('--file'));
} else {
  args = ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${xml}`];
  if (opt('--filter')) args.push(`--test-name-pattern=${opt('--filter')}`);
  args.push(...(opt('--file') ? [opt('--file')] : testFiles));
}
// node --test の中から呼ばれたときの印（NODE_TEST_CONTEXT）を渡すと、子が結果を親へ送って XML を書かない。外して渡す
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env });

if (!existsSync(xml)) fail(`結果の XML が無い・${runner === 'vitest' ? 'vitest' : 'node --test'} の終了コード ${r.status}`);
const text = readFileSync(xml, 'utf8');
let ran, bad;
if (runner === 'vitest') {
  const attr = (name) => { const m = new RegExp(`<testsuites[^>]*\\s${name}="(\\d+)"`).exec(text); return m ? Number(m[1]) : 0; };
  bad = attr('failures') + attr('errors');
  ran = attr('tests') - [...text.matchAll(/<testcase\b[^>]*>\s*<skipped\b/g)].length;
} else {
  // node --test は、名前で絞って 1 本も当たらなかったファイルを「ファイルの名前の testcase」として書く。それは試験の数に入れない
  const isFileEntry = (attrs) => { const n = /\sname="([^"]*)"/.exec(attrs)?.[1] ?? ''; return /\.(mjs|cjs|js|ts|mts|cts)$/.test(n) && existsSync(join(root, n)); };
  const cases = [...text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)].filter((c) => !isFileEntry(c[1])).map((c) => c[3] ?? '');
  bad = cases.filter((body) => /<(failure|error)\b/.test(body)).length;
  ran = cases.length - cases.filter((body) => /<skipped\b/.test(body)).length;
}
if (ran <= 0) fail('0/0（テストが 0 件）');
if (bad > 0 || r.status !== 0) fail(`${ran - bad}/${ran}`);
console.log(`Result: PASS ${ran}/${ran}`);
process.exit(0);
