// lib.mjs — 無人の Issue 実行（Node 版）の、外に触らない部品。仕様の正: キットの shared/spec/issue-run-spec.md。
// issue-run.mjs・stop-hook.mjs・doctor.mjs・check-lib.mjs とキットの試験が使う。Node.js の標準の部品だけで書く。
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LABELS = {
  run: { name: 'claude-run', color: '1d76db', description: 'Claude に無人で進めさせてよい' },
  working: { name: 'claude-working', color: 'fbca04', description: 'issue-run.mjs が実行中' },
  done: { name: 'claude-done', color: '0e8a16', description: 'Claude が合格させた・確認待ち' },
  failed: { name: 'claude-failed', color: 'b60205', description: '合格の条件が無い・回数切れ・異常終了' },
};

// 確認コマンドの塊の言語（仕様 9 章）。Node 版は js・javascript・mjs
export const CHECK_LANGS = { node: ['js', 'javascript', 'mjs'] };

const END = '(?![\\s\\S])';   // 文字列の終わり（.NET の \z）

// 読む前に \r と HTML のコメントを消す（仕様 2 章）
export function normalizeBody(body) {
  return String(body ?? '').replace(/\r/g, '').replace(/<!--[\s\S]*?-->/g, '');
}

function section(text, title) {
  const m = new RegExp(`^##\\s*${title}\\s*$([\\s\\S]*?)(?=^##\\s|${END})`, 'mu').exec(text);
  return m ? m[1] : null;
}

// 2.1 合格の条件：条件の行と確認コマンド
export function parsePassCriteria(body, langs = CHECK_LANGS.node) {
  const sec = section(normalizeBody(body), '合格の条件');
  if (sec === null) return { items: [], check: '' };
  const cm = new RegExp(`^\`\`\`(?:${langs.join('|')})\\s*$([\\s\\S]*?)^\`\`\``, 'mu').exec(sec);
  const check = cm ? cm[1].trim() : '';
  const noCode = sec.replace(/^```[\s\S]*?^```/gmu, '');
  const items = noCode.split('\n').map((l) => l.trim()).filter((l) => /^(-|\*|\p{Nd}+\.)\s+\S/u.test(l));
  return { items, check };
}

// 1.2 書き込みの権限（GitHub の collaborators/<login>/permission の permission）
export const WRITE_PERMISSIONS = ['write', 'maintain', 'admin'];

// 1.2 同じ人を 1 回だけ問う。permissionOf(login) は権限の名前を返すか、読めなければ投げる
export function permissionChecker(permissionOf) {
  const cache = new Map();
  return (login) => {
    const key = String(login ?? '');
    if (!cache.has(key)) {
      let r;
      if (!key) r = { ok: false, why: '作った人が分からない' };
      else {
        try {
          const p = String(permissionOf(key) ?? '');
          r = WRITE_PERMISSIONS.includes(p) ? { ok: true, why: '' } : { ok: false, why: `作った人 ${key} に書き込みの権限が無い（${p || '権限なし'}）` };
        } catch (e) { r = { ok: false, why: `作った人 ${key} の権限が読めない（${String(e?.message ?? e).split('\n')[0]}）` }; }
      }
      cache.set(key, r);
    }
    return cache.get(key);
  };
}

// 1 章：対象の Issue を選ぶ。issues は { number, labels, author: { login } }。外したものは理由と一緒に返す
export function selectTargets(issues, { canWrite, skip = [], max = Infinity }) {
  const targets = [], excluded = [];
  for (const t of [...issues].sort((a, b) => a.number - b.number)) {
    if ((t.labels ?? []).some((l) => skip.includes(l.name))) continue;
    const w = canWrite(t.author?.login);
    if (w.ok) targets.push(t); else excluded.push({ number: t.number, reason: w.why });
  }
  return { targets: targets.slice(0, max), excluded };
}

// 2.2：前提の確かめに使うコメント。脚本の名前で始まり、書き込みの権限のある人が書いた最後のもの
export function lastRunComment(comments, canWrite) {
  return (comments ?? []).filter((c) => /^issue-run\.(ps1|mjs)/.test(String(c.body ?? '')) && canWrite(c.author?.login).ok).at(-1);
}

// 2.2 前提：#番号を重複なしで出てきた順
export function parsePrerequisites(body) {
  const sec = section(normalizeBody(body), '前提');
  if (sec === null) return [];
  const seen = [];
  for (const m of sec.matchAll(/#([0-9]+)/g)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
  }
  return seen;
}

// 2.3 守るファイル。isFile(語のままのパス)・isTracked(整えたパス) は差し替えられる（試験で使う）
export function protectedFiles(code, { root = '.', trackedList = [], isFile, isTracked } = {}) {
  const tracked = new Set(trackedList.map((p) => p.toLowerCase()));
  const fileOk = isFile ?? ((p) => { const f = join(root, p); return existsSync(f) && statSync(f).isFile(); });
  const trackedOk = isTracked ?? ((rel) => tracked.has(rel.toLowerCase()));
  const found = [];
  for (const raw of String(code).split(/[\s;|&(){}=,]+/u)) {
    const p = raw.trim().replace(/^["'`]+|["'`]+$/g, '');
    if (!p || p.startsWith('-')) continue;
    const rel = p.replaceAll('\\', '/').replace(/^(\.\/|\/)+/, '');
    if (fileOk(p) && trackedOk(rel) && !found.includes(rel)) found.push(rel);
  }
  return found;
}

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
}

// 守るファイルの指紋（「指紋<TAB>パス」の行）
export function snapshotLines(root, files) {
  return files.map((f) => `${sha256File(join(root, f))}\t${f}`);
}

export function changedProtected(root, snapshotText) {
  const changed = [];
  for (const line of String(snapshotText).replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)) {
    const tab = line.indexOf('\t');
    const hash = line.slice(0, tab);
    const rel = line.slice(tab + 1);
    const full = join(root, rel);
    if (!existsSync(full) || !statSync(full).isFile()) { changed.push(rel); continue; }
    if (sha256File(full) !== hash.toUpperCase()) changed.push(rel);
  }
  return changed;
}

export function reportClaimsPass(text) {
  return /^##\s*結果:\s*合格\s*$/mu.test(String(text ?? '').replace(/\r/g, ''));
}

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

// 5 章：開始〜終了（同じ日なら終わりは時刻だけ）
export function formatSpan(from, to) {
  const end = ymd(from) === ymd(to) ? hm(to) : `${ymd(to)} ${hm(to)}`;
  return `${ymd(from)} ${hm(from)}〜${end}`;
}

// 5 章：結果のコメントの 1 行目（形を変えない。前提の判定が「・HEAD <sha>）」を読む）
export function headLine({ script = 'issue-run.mjs', status, minutes, span, rounds, commits, folder, branch, head, logDir }) {
  return `${script}: **${status}** — ${minutes} 分（${span}）・${rounds} 回・コミット ${commits} 件・作業場所 ${folder}（${branch}・HEAD ${head}）・ログ ${logDir}`;
}

// 2.2：前提の Issue の最後の結果のコメントから、合格したコミットの候補を出す
export function headShasFromComment(body) {
  const m = /・HEAD ([0-9a-f]{7,40})）/.exec(body);
  if (m) return [m[1]];
  return [...new Set([...body.matchAll(/\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g)].map((x) => x[0]))];
}

// 3.2：作業場所の POSIX 形（Windows の D:\x\y → d/x/y、Mac の /Users/x/y → Users/x/y）
export function repoPosix(root) {
  const s = root.replaceAll('\\', '/').replace(/\/+$/, '');
  const drive = /^([A-Za-z]):\//.exec(s);
  if (drive) return drive[1].toLowerCase() + s.slice(2);
  return s.replace(/^\/+/, '');
}

export function buildSettings(templateText, { stopHook, root }) {
  const text = templateText.replaceAll('{{STOP_HOOK}}', stopHook.replaceAll('\\', '/')).replaceAll('{{REPO}}', repoPosix(root));
  JSON.parse(text);   // 読めなければここで止める
  return text;
}

export function issuePrompt(templateText, { repo, number, branch, state, report, protectedList }) {
  const prot = protectedList.length ? protectedList.map((p) => `\`${p}\``).join('・') : '（なし）';
  return templateText.replaceAll('{{REPO}}', repo).replaceAll('{{NUMBER}}', String(number)).replaceAll('{{BRANCH}}', branch)
    .replaceAll('{{WORKSPACE_STATE}}', state).replaceAll('{{REPORT}}', report).replaceAll('{{PROTECTED}}', prot);
}

export function continuePrompt(reason, state) {
  return ['まだ合格していない。続けて。', `理由: ${reason}`, `作業場所: ${state}`,
    '合格の条件を全部、実行結果で満たすまで進める。報告ファイルを最新にし、全部満たしたら「## 結果: 合格」と書く。'].join('\n');
}

export function isAuthError(raw) {
  return /Failed to authenticate|OAuth session expired|Invalid API key|\/login/.test(raw);
}

export function isLimitError(json, raw) {
  if (json && !json.is_error) return false;
  if (json && (String(json.api_error ?? '') === 'usage_limit_reached' || Number(json.api_error_status) === 429)) return true;
  return /usage limit|rate limit|session limit|limit reached|limit will reset|resets at|resets \d/i.test(raw);
}

export function tail(text, max = 1500) {
  const t = String(text ?? '').trim();
  return t.length > max ? '…' + t.slice(t.length - max) : t;
}

export function readText(path) {
  return readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
}

// 6 章：まとめの並び
export const STATUS_ORDER = { 'ABORTED': 0, 'NOT-PASS': 1, 'NO-CRITERIA': 2, 'WAITING': 3, 'PASS': 4 };

export function summaryMarkdown({ runStamp, script = 'scripts/issue-run/issue-run.mjs', repo, root, logDir, aborted, results }) {
  const lines = [`# Issue の無人実行のまとめ（${runStamp}）`, '', `\`${script}\` が自動で書いた。リポジトリ ${repo}・作業場所 \`${root}\`・ログ \`${logDir}\``, ''];
  if (aborted) lines.push(`**途中で止まった: ${aborted}**`, '');
  lines.push('| Issue | 結果 | 分 | 時刻 | 回 | コミット | 断られたツール |', '|---|---|---|---|---|---|---|');
  const sorted = [...results].sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (a.number - b.number));
  for (const r of sorted) lines.push(`| #${r.number} ${r.title} | ${r.status} | ${r.minutes} | ${r.span ?? ''} | ${r.rounds} | ${r.commits.length} | ${r.denials.join(', ')} |`);
  for (const r of sorted) {
    lines.push('', `## #${r.number} ${r.title} — ${r.status}`, '');
    if (r.status !== 'PASS' && r.reason) lines.push(`理由: ${r.reason}`, '');
    for (const c of r.commits) lines.push(`- \`${c}\``);
    if (r.report) lines.push('', r.report.replace(/^## /gm, '### '));
  }
  return lines.join('\n') + '\n';
}
