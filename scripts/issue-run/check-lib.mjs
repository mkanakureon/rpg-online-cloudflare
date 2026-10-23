// check-lib.mjs — Issue の確認コマンド（```js）から使う手伝い（Node 版）。確認コマンドが使うので、無人の回では守るファイルになる。
// 使い方（Issue の本文の ```js の中。作業場所の直下から読み込む）:
//   import { runTests, requireTests, mustExist, gitClean, check, done } from './scripts/issue-run/check-lib.mjs';
//   runTests();                                   // 全部回して Result: PASS か見る
//   requireTests(['health を返す', 'スコアがマイナスなら 400']);   // その名前のテストがあって通ったか
//   gitClean(['package.json', 'migrations/']);    // 変えていないか
//   done();                                       // ここまでに NG が 1 つでもあれば exit 1、無ければ exit 0
// NG はその場で止めず、全部出してから done() で終える（後ろの行まで見る）。
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
let ng = 0;

export function check(ok, message) {
  if (ok) console.log(`OK  ${message}`); else { ng++; console.log(`NG  ${message}`); }
  return ok;
}

// テストの入口を回す。filter・file で絞れる。最後の行が Result: PASS なら合格
export function runTests({ filter, file } = {}) {
  const a = [join(root, 'scripts', 'test.mjs')];
  if (filter) a.push('--filter', filter);
  if (file) a.push('--file', file);
  const r = spawnSync(process.execPath, a, { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const last = out.trim().split(/\r?\n/).filter((l) => l.startsWith('Result:')).at(-1) ?? '（Result: 行が無い）';
  check(r.status === 0 && last.startsWith('Result: PASS'), `テスト ${filter ?? file ?? '全部'}: ${last}`);
  return last;
}

// 最後に回したテストの結果（.issue-run/test-results/junit.xml）から、テストの名前と合否を読む
export function testResults() {
  const xml = join(root, '.issue-run', 'test-results', 'junit.xml');
  if (!existsSync(xml)) return [];
  const text = readFileSync(xml, 'utf8');
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const list = [];
  for (const m of text.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = unesc(/\sname="([^"]*)"/.exec(m[1])?.[1] ?? '');
    const body = m[3] ?? '';
    list.push({ name, passed: !/<(failure|error|skipped)\b/.test(body) });
  }
  return list;
}

// 名前のテストが、最後の結果にあって通ったか。名前は「describe > テスト」の最後の部分でも、全部でもよい
export function requireTests(names) {
  const results = testResults();
  for (const n of names) {
    const hit = results.filter((r) => r.name === n || r.name.endsWith(` > ${n}`));
    if (!hit.length) check(false, `テストが無い: ${n}`);
    else check(hit.every((h) => h.passed), `テスト ${n}${hit.every((h) => h.passed) ? '' : ' が通らない'}`);
  }
}

export function mustExist(paths) {
  for (const p of paths) check(existsSync(join(root, p)), `ある: ${p}`);
}

// git が管理しているか（新しく作ったファイルをコミットしたか）
export function gitTracked(paths) {
  for (const p of paths) {
    const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', p], { cwd: root, encoding: 'utf8' });
    check(r.status === 0, `git に入っている: ${p}`);
  }
}

// 変えていないか（作業ツリーとコミットの両方。base を渡すと、そのコミットから変わっていないかも見る）
export function gitClean(paths, { base } = {}) {
  for (const p of paths) {
    const s = spawnSync('git', ['status', '--porcelain', '--', p], { cwd: root, encoding: 'utf8' });
    let ok = s.status === 0 && !s.stdout.trim();
    if (ok && base) ok = spawnSync('git', ['diff', '--quiet', base, 'HEAD', '--', p], { cwd: root }).status === 0;
    check(ok, `変えていない: ${p}${base ? `（${base} から）` : ''}`);
  }
}

export function done() {
  if (ng) { console.log(`合格の条件を満たしていない（NG ${ng}）`); process.exit(1); }
  console.log('OK（全部満たす）');
  process.exit(0);
}
