// proc.mjs — 子のプロセスを Windows と Mac で同じに起動する部品（Node 版）。シェルに文字列を組み立てて渡さない。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join, delimiter, extname } from 'node:path';
import { homedir } from 'node:os';

const isWin = process.platform === 'win32';

// PATH から実体を探す。Windows は .exe を先に、無ければ .cmd・.bat。extra は PATH に無いときに見る場所
export function which(name, extra = []) {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean);
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const ext of exts) {
    for (const d of dirs) {
      const p = join(d, name + ext);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
  }
  for (const p of extra) if (p && existsSync(p)) return p;
  return null;
}

// よく入る場所（PATH に無いとき）
export const KNOWN = {
  gh: isWin ? ['C:\\Program Files\\GitHub CLI\\gh.exe'] : ['/opt/homebrew/bin/gh', '/usr/local/bin/gh'],
  claude: isWin ? [join(homedir(), '.local', 'bin', 'claude.exe')] : [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'],
  git: isWin ? ['C:\\Program Files\\Git\\cmd\\git.exe'] : ['/usr/bin/git', '/opt/homebrew/bin/git'],
};

const resolved = new Map();
export function resolveCmd(name) {
  if (!resolved.has(name)) resolved.set(name, which(name, KNOWN[name] ?? []));
  return resolved.get(name);
}

// .cmd・.bat は Windows では直接起動できない（Node の決まり）ので cmd.exe を通す。引数は 1 つずつ引用符で囲む
function invocation(cmdPath, args) {
  if (isWin && ['.cmd', '.bat'].includes(extname(cmdPath).toLowerCase())) {
    const q = (a) => `"${String(a).replaceAll('"', '""')}"`;
    return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${[cmdPath, ...args].map(q).join(' ')}"`], verbatim: true };
  }
  return { file: cmdPath, args, verbatim: false };
}

// 同期で起動して、終了コードと出力を返す
export function run(name, args, { cwd, input, env } = {}) {
  const cmd = name === 'node' ? process.execPath : (resolveCmd(name) ?? name);
  const inv = invocation(cmd, args);
  const r = spawnSync(inv.file, inv.args, {
    cwd, input, env: env ? { ...process.env, ...env } : process.env, encoding: 'utf8',
    windowsVerbatimArguments: inv.verbatim, maxBuffer: 256 * 1024 * 1024,
  });
  return { code: r.status ?? (r.error ? 127 : 1), stdout: r.stdout ?? '', stderr: (r.stderr ?? '') + (r.error ? String(r.error.message) : '') };
}

// 時間の上限つきで起動する（無人の回の claude -p）。時間切れならプロセスの木ごと止める
export function runWithTimeout(name, args, { cwd, input, env, timeoutMs }) {
  const cmd = resolveCmd(name) ?? name;
  const inv = invocation(cmd, args);
  return new Promise((resolve) => {
    const child = spawn(inv.file, inv.args, {
      cwd, env: env ? { ...process.env, ...env } : process.env, windowsVerbatimArguments: inv.verbatim,
      stdio: ['pipe', 'pipe', 'pipe'], detached: !isWin,
    });
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d) => { stderr += d; });
    child.on('error', (e) => { stderr += String(e.message); });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid); }, timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
    child.stdin.end(input ?? '', 'utf8');
  });
}

export function killTree(pid) {
  if (!pid) return;
  if (isWin) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* もう無い */ } } }
}

// そのプロセスの名前（無ければ空）。二重起動の確かめに使う
export function processName(pid) {
  try { process.kill(pid, 0); } catch { return ''; }
  if (isWin) {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const m = /^"([^"]+)"/.exec((r.stdout ?? '').trim());
    return m ? m[1].replace(/\.exe$/i, '').toLowerCase() : '';
  }
  const r = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' });
  return (r.stdout ?? '').trim().split('/').pop().toLowerCase();
}

// 長く回す間、眠らせない。Mac は caffeinate。Windows は Node だけでは止められない（点検で知らせる）
export function keepAwake() {
  if (process.platform === 'darwin' && which('caffeinate', ['/usr/bin/caffeinate'])) {
    const c = spawn(which('caffeinate', ['/usr/bin/caffeinate']), ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
    return { how: 'caffeinate', stop: () => { try { c.kill(); } catch { /* 終わっている */ } } };
  }
  return { how: isWin ? 'none-windows' : 'none', stop: () => {} };
}
