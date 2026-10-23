#!/usr/bin/env node
// test.mjs — テストの入口（Node 版）。vitest を回し、最後の 1 行に Result: を出す。合否は終了コード（PASS 0・FAIL 1）。
//   node scripts/test.mjs                   # 全部
//   node scripts/test.mjs --filter <名前>    # テストの名前で絞る（vitest の -t）
//   node scripts/test.mjs --file <パス>      # ファイルで絞る
// テストが 0 件なら FAIL（名前の打ち間違いやテストの消し忘れで「合格」にしない）。結果の XML は .issue-run/test-results/junit.xml。
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const fail = (why) => { console.log(`Result: FAIL (${why})`); process.exit(1); };

const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs');
if (!existsSync(vitest)) fail('vitest が無い。npm install を先に（devDependencies に vitest が要る）');
const xml = join(root, '.issue-run', 'test-results', 'junit.xml');
mkdirSync(dirname(xml), { recursive: true });
rmSync(xml, { force: true });

const args = [vitest, 'run', '--reporter=default', '--reporter=junit', `--outputFile.junit=${xml}`, '--passWithNoTests'];
if (opt('--filter')) args.push('-t', opt('--filter'));
if (opt('--file')) args.push(opt('--file'));
const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });

if (!existsSync(xml)) fail(`結果の XML が無い・vitest の終了コード ${r.status}`);
const text = readFileSync(xml, 'utf8');
const attr = (name) => { const m = new RegExp(`<testsuites[^>]*\\s${name}="(\\d+)"`).exec(text); return m ? Number(m[1]) : 0; };
const total = attr('tests');
const bad = attr('failures') + attr('errors');
const skipped = [...text.matchAll(/<testcase\b[^>]*>\s*<skipped\b/g)].length;
const ran = total - skipped;
if (ran <= 0) fail('0/0（テストが 0 件）');
if (bad > 0 || r.status !== 0) fail(`${ran - bad}/${ran}`);
console.log(`Result: PASS ${ran}/${ran}`);
process.exit(0);
