#!/usr/bin/env node
// sync-lanes.mjs — レーン同期（Node 版）。各レーン（worktree のブランチ）を main に入れ、その main を各レーンに入れる。
// レーンの決まりの正: docs/guides/working/worktree-lanes.md。手順はスキル .claude/skills/lane-sync/SKILL.md。
// 統合セッション（main の worktree）から 1 回だけ叩く。レーンのセッションは叩かない。
//   node scripts/issue-run/sync-lanes.mjs            # 実行
//   node scripts/issue-run/sync-lanes.mjs --dry-run  # 何が起きるかだけ出す（git を書き換えない）
// やること（順番が契約）：0 前提（main の worktree・main に追跡ファイルの未コミット変更が無い・各レーンが clean）
//   1 レーン → main（git merge --no-edit。衝突したら --abort して FAIL）  2 main → レーン（git merge --ff-only main）
//   3 取り込んだ差分から、レーン側で次に要る作業（依存の入れ直し・テスト）を出す
// 最後の行が Result: PASS か Result: FAIL。終了コード 0 = 全レーン同期済み。
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './proc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dry = process.argv.includes('--dry-run');
const git = (dir, ...a) => { const r = run('git', ['-C', dir, ...a]); return { code: r.code, text: `${r.stdout}${r.stderr}`.trim() }; };
const fail = [];

const mainBranch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').text;
if (mainBranch !== 'main') { console.log(`Result: FAIL  main の worktree ではない（HEAD=${mainBranch}）。${root} から叩く`); process.exit(1); }
const mainDirty = git(root, 'status', '--porcelain', '--untracked-files=no').text;
if (mainDirty) { console.log(`main に追跡ファイルの未コミット変更がある。先にコミットする（スキル lane-sync の手順 1）:\n${mainDirty}\nResult: FAIL  main dirty`); process.exit(1); }
const untracked = git(root, 'status', '--porcelain', '--untracked-files=all').text.split('\n').filter((l) => l.startsWith('??'));
if (untracked.length) { console.log('main の未追跡ファイル（同期は止めない。コミットするか捨てるかは手順 1 で決める）:'); untracked.forEach((u) => console.log(`  ${u}`)); }

const lanes = []; let cur = {};
for (const line of [...git(root, 'worktree', 'list', '--porcelain').text.split('\n'), '']) {
  if (line.startsWith('worktree ')) cur = { path: line.slice(9) };
  else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  else if (line === '') { if (cur.path && cur.branch && cur.branch !== 'main') lanes.push(cur); cur = {}; }
}
if (!lanes.length) { console.log('Result: FAIL  レーンの worktree が見つからない（まだ作っていなければ docs/guides/working/worktree-lanes.md の「レーンを作る」）'); process.exit(1); }

const mainBefore = git(root, 'rev-parse', '--short', 'HEAD').text;
const rows = lanes.map((l) => ({
  lane: basename(l.path), branch: l.branch, path: l.path,
  before: git(l.path, 'rev-parse', '--short', 'HEAD').text,
  ahead: Number(git(root, 'rev-list', '--count', `main..${l.branch}`).text),
  behind: Number(git(root, 'rev-list', '--count', `${l.branch}..main`).text),
  dirty: git(l.path, 'status', '--porcelain').text, toMain: '', toLane: '', after: '', next: '',
}));
console.log(`main ${mainBefore}  レーン ${rows.length} 本`);
for (const r of rows) {
  console.log(`  ${r.lane.padEnd(24)} ${r.branch.padEnd(28)} ${r.before}  レーン独自 ${r.ahead} / main独自 ${r.behind}  ${r.dirty ? 'DIRTY' : 'clean'}`);
  if (r.dirty) console.log(r.dirty.split('\n').map((x) => `      ${x}`).join('\n'));
}
if (dry) { console.log('Result: DRY-RUN  (git は書き換えていない)'); process.exit(0); }

for (const r of rows) {
  if (r.dirty) { r.toMain = 'SKIP(dirty)'; fail.push(`${r.lane}: worktree が汚れている。レーンのセッションがコミットしてから`); continue; }
  if (r.ahead === 0) { r.toMain = 'nothing'; continue; }
  const m = git(root, 'merge', '--no-edit', r.branch);
  if (m.code !== 0) { git(root, 'merge', '--abort'); r.toMain = 'CONFLICT'; fail.push(`${r.lane}: main へのマージが衝突。abort 済み。手で解く:\n${m.text}`); continue; }
  r.toMain = /Fast-forward/.test(m.text) ? `ff(+${r.ahead})` : `merge(+${r.ahead})`;
}
const mainAfter = git(root, 'rev-parse', '--short', 'HEAD').text;

for (const r of rows) {
  if (r.toMain.startsWith('SKIP') || r.toMain === 'CONFLICT') { r.toLane = 'SKIP'; r.after = r.before; continue; }
  const m = git(r.path, 'merge', '--ff-only', 'main');
  r.after = git(r.path, 'rev-parse', '--short', 'HEAD').text;
  if (m.code !== 0) { r.toLane = 'FAIL'; fail.push(`${r.lane}: main の ff 取り込みに失敗:\n${m.text}`); continue; }
  r.toLane = /Already up to date/.test(m.text) ? 'up-to-date' : 'ff';
  if (r.before !== r.after) {
    const files = git(r.path, 'diff', '--name-only', `${r.before}..${r.after}`).text.split('\n').filter(Boolean);
    const next = [];
    // 依存が動いた → そのレーンで npm install（npm ci）
    if (files.some((f) => /(^|\/)package(-lock)?\.json$/.test(f))) next.push('npm install');
    // コード・テスト・設定が動いた → そのレーンでテスト
    if (files.some((f) => /\.(ts|tsx|js|mjs|cjs|json|sql)$/.test(f) || f.startsWith('migrations/'))) next.push('テスト');
    r.next = next.length ? next.join('+') : '-';
  } else r.next = '-';
}

console.log(`\nmain: ${mainBefore} -> ${mainAfter}`);
console.log(`${'lane'.padEnd(24)} ${'branch'.padEnd(28)} ${'before'.padEnd(9)} ${'lane->main'.padEnd(12)} ${'main->lane'.padEnd(12)} ${'after'.padEnd(9)} next`);
for (const r of rows) console.log(`${r.lane.padEnd(24)} ${r.branch.padEnd(28)} ${r.before.padEnd(9)} ${r.toMain.padEnd(12)} ${r.toLane.padEnd(12)} ${r.after.padEnd(9)} ${r.next}`);
if (rows.some((r) => r.next.includes('テスト'))) console.log('\nnext=テスト のレーンは、そのレーンのセッションが作業前に node scripts/test.mjs を回す。next=npm install なら先に npm install。');
if (fail.length) { console.log(''); fail.forEach((f) => console.log(`FAIL: ${f}`)); console.log(`Result: FAIL  ${fail.length}/${rows.length} レーン未同期`); process.exit(1); }
console.log(`\nResult: PASS  ${rows.length} レーンすべて ${mainAfter}`);
process.exit(0);
