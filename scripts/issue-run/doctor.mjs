#!/usr/bin/env node
// doctor.mjs — Issue 駆動（無人実行）に要るものが、この PC・この作業場所にそろっているかを点検する（Node 版・Windows と Mac）。
// 何も書き換えない（読むだけ）。新しい PC・新しい worktree・道具を更新した後に、issue-run.mjs を起動する前に回す。
//   node scripts/issue-run/doctor.mjs              # 点検だけ（数秒）
//   node scripts/issue-run/doctor.mjs --run-tests  # さらにテストの入口を回す
// 1 行ずつ OK / WARN / NG を出し、最後の行が Result: PASS（NG 0）か Result: FAIL。終了コード 0 / 1。
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, resolveCmd, which } from './proc.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
let ng = 0, warn = 0;
function report(level, item, text) {
  if (level === 'NG') ng++; else if (level === 'WARN') warn++;
  console.log(`${level.padEnd(4)} ${item}: ${text}`);
}

// --- 道具 ---
const wantNode = (existsSync(join(root, '.nvmrc')) ? readFileSync(join(root, '.nvmrc'), 'utf8').trim() : '22.14.0').replace(/^v/, '');
const haveNode = process.versions.node;
if (haveNode === wantNode) report('OK', 'node', `${haveNode}（${process.execPath}）`);
else if (Number(haveNode.split('.')[0]) >= 22) report('WARN', 'node', `${haveNode}。決めた版は ${wantNode}（.nvmrc）。そろえると Windows と Mac で同じに動く`);
else report('NG', 'node', `${haveNode}。22 以上が要る（決めた版は ${wantNode}）`);

const npmV = run('npm', ['--version']);
if (npmV.code === 0) report(npmV.stdout.trim() === '11.6.2' ? 'OK' : 'WARN', 'npm', npmV.stdout.trim() === '11.6.2' ? npmV.stdout.trim() : `${npmV.stdout.trim()}。決めた版は 11.6.2 → npm install -g npm@11.6.2`);
else report('WARN', 'npm', 'npm が見つからない');

const git = resolveCmd('git');
if (git) report('OK', 'git', run('git', ['--version']).stdout.trim()); else report('NG', 'git', isMac ? 'git が無い → xcode-select --install' : 'git が無い → winget install --id Git.Git -e');

const gh = resolveCmd('gh');
let ghOk = false;
if (!gh) report('NG', 'gh', isMac ? 'GitHub CLI が無い → brew install gh' : 'GitHub CLI が無い → winget install --id GitHub.cli -e');
else {
  report('OK', 'gh', `${run('gh', ['--version']).stdout.split('\n')[0]}（${gh}）`);
  if (!which('gh')) report('NG', 'gh の PATH', 'この窓の PATH に gh が無い。入れた後に開いた新しい窓で回す');
  const auth = run('gh', ['auth', 'status']);
  const text = auth.stdout + auth.stderr;
  if (auth.code !== 0) report('NG', 'gh のログイン', 'ログインしていない → gh auth login');
  else if (!/'repo'/.test(text)) report('NG', 'gh のログイン', '権限 repo が無い → gh auth refresh -s repo');
  else { ghOk = true; report('OK', 'gh のログイン', `${/account (\S+)/.exec(text)?.[1] ?? ''}・権限 repo あり`); }
}

const claude = resolveCmd('claude');
if (claude) report('OK', 'claude', run('claude', ['--version']).stdout.trim()); else report('NG', 'claude', 'Claude Code が無い（https://code.claude.com の手順で入れる）');
if (process.env.CLAUDE_CODE_OAUTH_TOKEN) report('OK', '長期トークン', 'CLAUDE_CODE_OAUTH_TOKEN がある');
else report('WARN', '長期トークン', 'CLAUDE_CODE_OAUTH_TOKEN が無い。無人の claude -p は対話のログインと別に切れることがある → claude setup-token の値を環境変数に入れる');

// 入っているキットの版（.issue-kit/version）を、キットのリポジトリの既定のブランチの最新と比べる。古くても NG にしない。
// 最新は gh api で読むだけ。環境変数 ISSUE_KIT_LATEST_COMMIT があればそれを使う（試験用。空なら「読めない」）
function kitVersion() {
  const again = 'node <キット>/editions/node/install.mjs --target . --update';
  const p = join(root, '.issue-kit', 'version');
  if (!existsSync(p)) return report('WARN', 'キットの版', `.issue-kit/version が無い → キットから入れる: ${again}`);
  let v;
  try { v = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { return report('WARN', 'キットの版', `.issue-kit/version が読めない: ${e.message}`); }
  if (!v.repo) return report('WARN', 'キットの版', `.issue-kit/version にキットのリポジトリが無い（古い install.mjs で入れた）→ ${again}`);
  let latest = process.env.ISSUE_KIT_LATEST_COMMIT;
  if (latest === undefined) {
    const r = run('gh', ['api', `repos/${v.repo}/commits/HEAD`, '--jq', '.sha']);
    latest = r.code === 0 ? r.stdout.trim() : '';
  }
  if (!/^[0-9a-f]{7,40}$/.test(latest)) report('WARN', 'キットの版', `キットの最新を読めない（${v.repo}）。gh のログインを確かめるか、手で比べる`);
  else if (latest === v.commit) report('OK', 'キットの版', `${v.repo} の最新 ${latest.slice(0, 7)} と同じ`);
  else report('WARN', 'キットの版', `古い。入っている ${(v.commit || '（不明）').slice(0, 7)}・キットの最新 ${latest.slice(0, 7)}（${v.repo}）→ キットを git pull してから ${again}`);
}

// --- 作業場所 ---
const top = run('git', ['-C', root, 'rev-parse', '--show-toplevel']);
if (top.code !== 0) report('NG', 'git の作業場所', `${root} が git の作業フォルダーでない`);
else {
  report('OK', 'git の作業場所', `${top.stdout.trim()}（${run('git', ['-C', root, 'branch', '--show-current']).stdout.trim()}）`);
  const origin = run('git', ['-C', root, 'remote', 'get-url', 'origin']).stdout.trim();
  const m = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(origin);
  if (!m) report('NG', 'origin', `GitHub でない（'${origin}'）→ docs/guides/working/github-repo.md`);
  else {
    const repo = `${m[1]}/${m[2]}`;
    report('OK', 'origin', repo);
    if (ghOk) {
      const l = run('gh', ['label', 'list', '--repo', repo, '--limit', '200', '--json', 'name']);
      const have = l.code === 0 ? JSON.parse(l.stdout).map((x) => x.name) : [];
      const missing = ['claude-run', 'claude-working', 'claude-done', 'claude-failed'].filter((x) => !have.includes(x));
      if (missing.length) report('WARN', 'ラベル', `まだ無い: ${missing.join(', ')}（issue-run.mjs の最初の実行で作られる。先に Issue に札を付けるなら → gh label create claude-run --repo ${repo}）`);
      else report('OK', 'ラベル', 'claude-run・claude-working・claude-done・claude-failed');
    }
  }
  kitVersion();
  const dirty = run('git', ['-C', root, 'status', '--porcelain']).stdout.split(/\r?\n/).filter(Boolean);
  if (dirty.length) report('WARN', '作業ツリー', `未コミットが ${dirty.length} 件。無人の回のコミットと混ざる`); else report('OK', '作業ツリー', '変更 0');
}

// --- 部品 ---
for (const f of ['.claude/issue-run/prompt.md', '.claude/issue-run/stop-hook.mjs', '.github/ISSUE_TEMPLATE/claude-run.md',
  'scripts/issue-run/issue-run.mjs', 'scripts/issue-run/lib.mjs', 'scripts/issue-run/proc.mjs', 'scripts/issue-run/check-lib.mjs', 'scripts/test.mjs']) {
  if (existsSync(join(root, f))) report('OK', '部品', f); else report('NG', '部品', `${f} が無い`);
}
const settingsPath = join(root, '.claude/issue-run/settings.json');
if (!existsSync(settingsPath)) report('NG', '設定', '.claude/issue-run/settings.json が無い');
else {
  const raw = readFileSync(settingsPath, 'utf8');
  try {
    const s = JSON.parse(raw);
    const deny = s.permissions?.deny ?? [];
    const need = ['AskUserQuestion', 'Bash(git push:*)', 'PowerShell(git push:*)', 'Edit(//{{REPO}}/CLAUDE.md)', 'Write(//{{REPO}}/.claude/**)',
      'Edit(//{{REPO}}/docs/inspecs/**)', 'Write(//{{REPO}}/docs/inspecs/**)', 'Bash(wrangler deploy:*)'];
    const lack = need.filter((x) => !deny.includes(x));
    if (lack.length) report('NG', '設定', `deny に無い: ${lack.join(', ')}`);
    else if (deny.includes('Edit(CLAUDE.md)') || deny.includes('Edit(**/CLAUDE.md)')) report('NG', '設定', '裸の CLAUDE.md の deny がある（どの深さにも効き、作る物の中の CLAUDE.md まで断る）');
    else if (!raw.includes('{{STOP_HOOK}}')) report('NG', '設定', 'Stop hook の {{STOP_HOOK}} が無い');
    else if (!/"command":\s*"node /.test(raw)) report('NG', '設定', 'Stop hook を node で起動していない');
    else report('OK', '設定', `deny ${deny.length} 個・Stop hook（node）・env ${Object.keys(s.env ?? {}).length} 個`);
  } catch (e) { report('NG', '設定', `JSON として読めない: ${e.message}`); }
}

// --- テストのしくみ ---
const pkgPath = join(root, 'package.json');
if (!existsSync(pkgPath)) report('NG', 'package.json', '無い');
else {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const runner = pkg.issueKit?.testRunner ?? 'vitest';
  if (runner === 'node') {
    const files = [pkg.issueKit.testFiles ?? []].flat();
    if (files.length) report('OK', 'テストの仕組み', `node --test（issueKit.testFiles: ${files.join(' ')}）`);
    else report('NG', 'テストの仕組み', 'issueKit.testRunner が node なのに issueKit.testFiles が無い → 例 "testFiles": "tests/*.test.mjs"');
  } else if (runner !== 'vitest') report('NG', 'テストの仕組み', `issueKit.testRunner は vitest か node（いま: ${runner}）`);
  else {
    if (deps.vitest) report('OK', 'vitest', `devDependencies ${deps.vitest}`); else report('NG', 'vitest', 'devDependencies に vitest が無い → npm install -D vitest');
    if (!existsSync(join(root, 'node_modules', 'vitest'))) report('NG', 'node_modules', 'vitest が入っていない → npm install');
  }
  if (/scripts\/test\.mjs/.test(pkg.scripts?.test ?? '')) report('OK', 'npm test', pkg.scripts.test);
  else report('WARN', 'npm test', `scripts.test が scripts/test.mjs を呼んでいない（いま: ${pkg.scripts?.test ?? '無い'}）`);
}

// --- 眠らせない ---
if (isMac) report(which('caffeinate', ['/usr/bin/caffeinate']) ? 'OK' : 'WARN', '眠らせない', which('caffeinate', ['/usr/bin/caffeinate']) ? 'caffeinate がある（issue-run.mjs が実行中だけ使う）' : 'caffeinate が無い');
else if (isWin) report('WARN', '眠らせない', 'Windows では Node だけで眠りを止められない。長く回すときは、電源につないで「設定 > システム > 電源とバッテリー」で眠らない設定にする');

if (process.argv.includes('--run-tests')) {
  const r = run('node', [join(root, 'scripts', 'test.mjs')], { cwd: root });
  const last = `${r.stdout}${r.stderr}`.trim().split(/\r?\n/).filter((l) => l.startsWith('Result:')).at(-1) ?? '（Result: 行が無い）';
  report(r.code === 0 ? 'OK' : 'NG', 'テスト', last);
}

if (ng) { console.log(`Result: FAIL  NG ${ng}・WARN ${warn}`); process.exit(1); }
console.log(`Result: PASS  WARN ${warn}`);
process.exit(0);
