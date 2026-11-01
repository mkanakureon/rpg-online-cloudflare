/**
 * 配布の試験 P1: LICENSE（MIT）・README のライセンスとサポートの範囲の節・配るものに第三者の包みが入らないこと・ADR 0003 の決定。
 * P2: デプロイの説明書 docs/guides/manuals/deploy.md の環境の手本（最初の ```jsonc の塊）・秘密の名前・冒頭の 403・npm run のコマンド。
 * P3: 運用の説明書 docs/guides/manuals/ の backup-restore・cost-alerts・limits-and-costs・versioning（保持の日数を掃除の定数と比べる・料金の額を書かない・
 * 復元が上書きだと書く・通知の宛先をファイルに書かない・Unity と Unreal の層の版が版の説明書の表と同じ）。
 * 名前と見ることの正は docs/guides/working/distribution-design.md §9 の P1 の 4 本・P2 の 5 本・P3 の 5 本。
 * 文書は `?raw` で文字列として読み（test/raw-imports.d.ts）、clients/ の下のファイルは import.meta.glob で集める。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { describe, expect, it } from 'vitest';
import license from '../LICENSE?raw';
import readme from '../README.md?raw';
import adr from '../docs/adr/0003-distribution-license-support.md?raw';
import deploy from '../docs/guides/manuals/deploy.md?raw';
import envSource from '../src/core/env.ts?raw';
import wranglerText from '../wrangler.jsonc?raw';
import pkg from '../package.json';
import openapi from '../openapi/rpg-online.v1.json';
import unityPkg from '../clients/unity/package.json';
import backupManual from '../docs/guides/manuals/backup-restore.md?raw';
import costManual from '../docs/guides/manuals/cost-alerts.md?raw';
import limitsManual from '../docs/guides/manuals/limits-and-costs.md?raw';
import versionManual from '../docs/guides/manuals/versioning.md?raw';
import cleanupSource from '../src/core/cleanup.ts?raw';
import auditSource from '../src/core/admin/audit.ts?raw';
import opsSecurity from '../docs/guides/decisions/operations-security.md?raw';
import unrealPlugin from '../clients/unreal/RpgOnlineClient/RpgOnlineClient.uplugin?raw';

// Vite が試験を変換するときに展開する（型は tsconfig の types に無いのでここで宣言する）
declare global {
  interface ImportMeta {
    glob(pattern: string | string[], options?: { eager?: boolean; query?: string; import?: string }): Record<string, unknown>;
  }
}

/** 空白（改行を含む）を 1 つの空白にまとめる。MIT の文が行の折り返しに依らず見つかるように。 */
const flat = (s: string) => s.replace(/\s+/g, ' ');
/** `## 見出し` の見出しの文。 */
const headings = (s: string) => [...s.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
/** 見出しの文に `word` を含む節の本文（次の `## ` まで）。 */
function section(s: string, word: string): string {
  const parts = s.split(/^(?=##\s)/m);
  return parts.find((p) => (p.match(/^##\s+(.+)$/m)?.[1] ?? '').includes(word)) ?? '';
}

describe('配布（P1）', () => {
  it('LICENSEはMITの全文と著作者の行を持つ', () => {
    expect(license.split('\n')[0].trim()).toBe('MIT License');
    expect(license).toMatch(/^Copyright \(c\) 2026 mkanakureon\s*$/m);
    const text = flat(license);
    for (const s of [
      'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software")',
      'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
      'IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY',
    ]) expect(text).toContain(s);
  });

  it('READMEはライセンスとサポートの範囲とゲストが本人確認でないことを書く', () => {
    const heads = headings(readme);
    expect(heads.some((h) => h.includes('ライセンス'))).toBe(true);
    expect(heads.some((h) => h.includes('サポートの範囲'))).toBe(true);
    const lic = section(readme, 'ライセンス');
    expect(lic).toContain('MIT');
    expect(lic).toMatch(/\]\((\.\/)?LICENSE\)/);
    const support = section(readme, 'サポートの範囲');
    for (const w of ['無保証', '再現できる不具合', '料金']) expect(support).toContain(w);
    expect(readme).toContain('本人確認');
    expect(readme).toContain('改ざん');
    expect(readme).toContain('競争の強い機能');
    expect(readme).toMatch(/403[^\n]*NOT_READY_FOR_PRODUCTION/);
    expect(readme).toContain('docs/adr/0003-distribution-license-support.md');
    expect(readme).not.toContain('認証、レート制限、不正対策が未実装');
  });

  it('配る成果物に第三者の包みが入らずpackage.jsonにdependenciesが無い', () => {
    expect('dependencies' in pkg).toBe(false);
    // clients/ の下に node_modules が無い（パターンに node_modules を名指しすると Vite はそこも探す）
    const vendored = import.meta.glob('../clients/**/node_modules/**/*');
    expect(Object.keys(vendored)).toEqual([]);
    // Unity の包みの依存はエンジンの組み込み（com.unity.modules.*）だけ
    for (const name of Object.keys(unityPkg.dependencies)) expect(name).toMatch(/^com\.unity\.modules\./);
    // ブラウザの SDK とサンプルは相対のパスの他を読み込まない（npm の包みの名前を import しない）
    const browser = import.meta.glob(['../clients/browser/**/*.mjs', '../clients/browser/**/*.html'], { eager: true, query: '?raw', import: 'default' });
    expect(Object.keys(browser).length).toBeGreaterThan(0);
    for (const [file, src] of Object.entries(browser)) {
      const specs = [...String(src).matchAll(/(?:\bimport\b[^'"]*?\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of specs) expect(spec, file).toMatch(/^\.{1,2}\//);
    }
  });

  it('ADR 0003は配布の形とライセンスとサポートの範囲を決める', () => {
    expect(adr).toMatch(/^# ADR 0003/);
    expect(adr).toMatch(/^- \*\*状態:\*\* 採用/m);
    for (const h of ['背景', '決定', '理由', 'トレードオフ']) expect(headings(adr)).toContain(h);
    const decision = section(adr, '決定');
    for (const w of ['ゲーム別独立デプロイ', 'MIT', 'サポートの範囲', 'リポジトリの名前', 'Fab']) expect(decision).toContain(w);
    expect(adr).toContain('distribution-design.md');
  });
});

/** JSONC の注釈（行の注釈と塊の注釈）を外して JSON として読む。test/cleanup.test.ts と同じ形。 */
const parseJsonc = (text: string): unknown => JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
type D1Config = { binding?: string; database_name?: string; database_id?: string; migrations_dir?: string };
type EnvConfig = { name?: string; vars?: { APP_ENV?: string }; d1_databases?: D1Config[]; triggers?: { crons?: string[] } };
/** 説明書の最初の ```jsonc の塊（環境の手本）。 */
function sampleEnvs(): { staging: EnvConfig; production: EnvConfig } {
  const block = deploy.match(/```jsonc\n([\s\S]*?)```/)?.[1];
  expect(block, '説明書に ```jsonc の手本がある').toBeTruthy();
  const sample = parseJsonc(block!) as { env?: { staging?: EnvConfig; production?: EnvConfig } };
  return { staging: sample.env?.staging ?? {}, production: sample.env?.production ?? {} };
}
const DUMMY_D1_ID = '00000000-0000-0000-0000-000000000000';

describe('配布（P2）', () => {
  it('デプロイの説明書の環境の手本はstagingとproductionで別のD1を持ちAPP_ENVがlocalでない', () => {
    const { staging, production } = sampleEnvs();
    const top = parseJsonc(wranglerText) as EnvConfig;
    for (const e of [staging, production]) {
      expect(e.d1_databases).toHaveLength(1);
      expect(e.d1_databases![0].binding).toBe('DB');
      expect(e.d1_databases![0].migrations_dir).toBe('migrations');
      expect(e.d1_databases![0].database_name).toBeTruthy();
      expect(typeof e.vars?.APP_ENV).toBe('string');
      expect(e.vars!.APP_ENV).not.toBe('local');
      expect(e.name).toBeTruthy();
      expect(e.name).not.toBe(top.name);
    }
    expect(staging.d1_databases![0].database_name).not.toBe(production.d1_databases![0].database_name);
    expect(staging.name).not.toBe(production.name);
  });

  it('デプロイの説明書の環境の手本はcronがwranglerの設定と同じでD1のIDがダミー', () => {
    const { staging, production } = sampleEnvs();
    const crons = (parseJsonc(wranglerText) as EnvConfig).triggers?.crons;
    expect(crons?.length).toBeGreaterThan(0);
    for (const e of [staging, production]) {
      expect(e.triggers?.crons).toEqual(crons);
      expect(e.d1_databases?.[0]?.database_id).toBe(DUMMY_D1_ID);
    }
    // 説明書のどこにも本物らしい ID（0 だけでない UUID）が無い
    const uuids = [...deploy.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => m[0]);
    expect(uuids.filter((u) => u !== DUMMY_D1_ID)).toEqual([]);
  });

  it('デプロイの説明書は秘密の名前をEnvの型と同じ集合で挙げる', () => {
    // Env の型の、省いてよい文字列の欄（秘密）。DB・APP_ENV は wrangler.jsonc の結び付けと vars で渡す
    const envType = envSource.match(/export type Env = \{([^}]*)\}/)?.[1] ?? '';
    const secrets = [...envType.matchAll(/\b([A-Z][A-Z0-9_]*)\?:\s*string/g)].map((m) => m[1]).sort();
    expect(secrets.length).toBeGreaterThan(0);
    const put = [...deploy.matchAll(/wrangler secret put ([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]);
    expect([...new Set(put)].sort()).toEqual(secrets);
    for (const name of secrets) for (const env of ['staging', 'production'])
      expect(deploy).toContain(`wrangler secret put ${name} --env ${env}`);
    // 値をコマンドの引数に書かない（名前の後ろは --env か行・符号の終わりだけ）
    expect(deploy).not.toMatch(/wrangler secret put [A-Z_]+ [^-\s`]/);
  });

  it('デプロイの説明書は冒頭でいまは書き込みが403だと書く', () => {
    const head = deploy.split('\n').slice(0, 15).join('\n');
    expect(head).toContain('403');
    expect(head).toContain('NOT_READY_FOR_PRODUCTION');
    expect(head).toContain('P6');
  });

  it('デプロイの説明書が使うnpmのコマンドはpackage.jsonのscriptsにある', () => {
    const used = [...deploy.matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    const scripts = Object.keys(pkg.scripts);
    expect(used.filter((c) => !scripts.includes(c))).toEqual([]);
  });
});

/** 掃除の定数（src/core/cleanup.ts の RETENTION_DAYS）を表の名前と日数の組で読む。監査の日数は src/core/admin/audit.ts から読む。 */
function retentionFromSource(): Array<[string, number]> {
  const auditDays = Number(auditSource.match(/AUDIT_RETENTION_DAYS\s*=\s*(\d+)/)?.[1]);
  const body = cleanupSource.match(/RETENTION_DAYS\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  return [...body.matchAll(/(\w+):\s*(\w+)/g)].map((m) => [m[1], m[2] === 'AUDIT_RETENTION_DAYS' ? auditDays : Number(m[2])]);
}
const opsManuals = { 'backup-restore.md': backupManual, 'cost-alerts.md': costManual, 'limits-and-costs.md': limitsManual, 'versioning.md': versionManual };

describe('配布（P3）', () => {
  it('利用上限の説明書の保持の日数は掃除の定数と一致する', () => {
    const retention = retentionFromSource();
    expect(retention).toHaveLength(5);
    const lines = limitsManual.split('\n');
    for (const [table, days] of retention) {
      expect(Number.isFinite(days), table).toBe(true);
      // 表の名前と日数が同じ行にある（ほかの数の一部に当たらないよう、前が数字でない）
      expect(lines.some((l) => l.includes(table) && new RegExp(`(^|[^0-9])${days}\\s*日`).test(l)), `${table} ${days} 日`).toBe(true);
    }
    for (const w of ['quest_claims', 'event_claims', 'inventory_ledger', 'DAU', 'src/core/rate-limit-policy.ts', '要確認']) expect(limitsManual).toContain(w);
  });

  it('運用の説明書は料金の額を書かず公式の価格表を指す', () => {
    for (const [file, text] of Object.entries(opsManuals)) {
      const amounts = text.split('\n').filter((l) => /\$\s?\d|\d[\d,.]*\s?(円|ドル|USD|セント)/.test(l));
      expect(amounts, file).toEqual([]);
      // 本物らしい ID（0 だけでない UUID）とメールの宛先を書かない
      const uuids = [...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => m[0]);
      expect(uuids.filter((u) => !/^[0-]+$/.test(u)), file).toEqual([]);
      expect([...text.matchAll(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi)].map((m) => m[0]), file).toEqual([]);
      // 使う npm run のコマンドは package.json の scripts にある
      const used = [...text.matchAll(/npm run ([a-z0-9:_-]+)/g)].map((m) => m[1]);
      expect(used.filter((c) => !Object.keys(pkg.scripts).includes(c)), file).toEqual([]);
    }
    const priceUrls = opsSecurity.match(/https:\/\/developers\.cloudflare\.com\/\S+pricing\/?/g) ?? [];
    const workersAndD1 = priceUrls.filter((u) => /workers|d1/.test(u));
    expect(workersAndD1.length).toBeGreaterThanOrEqual(2);
    for (const u of workersAndD1) expect(limitsManual).toContain(u);
  });

  it('バックアップの説明書は復元が上書きする操作だと書き復元演習の手順を持つ', () => {
    for (const w of ['wrangler d1 time-travel info', 'wrangler d1 export', '--remote', 'wrangler d1 time-travel restore', '上書き', '復元演習', 'staging', '要確認'])
      expect(backupManual).toContain(w);
    expect(backupManual).toMatch(/wrangler d1 export [^\n]*--remote/);
    expect(backupManual).toMatch(/time-travel restore[^\n]*上書き|上書き[^\n]*time-travel restore/);
    // 復元演習の節に、印を控える → 行を足す → 戻す → 消えたことを見る の順がある
    const drillHead = backupManual.match(/^###\s.*復元演習.*$/m);
    expect(drillHead, '復元演習の見出しがある').toBeTruthy();
    const drillStart = backupManual.indexOf(drillHead![0]);
    const bodyStart = drillStart + drillHead![0].length;
    const drillEnd = backupManual.slice(bodyStart).search(/^##\s/m);
    const drill = backupManual.slice(drillStart, drillEnd < 0 ? undefined : bodyStart + drillEnd);
    expect(drill).toContain('staging');
    const order = ['time-travel info', 'INSERT', 'time-travel restore', '消えた'].map((w) => drill.indexOf(w));
    expect(order.every((i) => i >= 0), order.join(',')).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('費用アラートの説明書は通知の宛先をファイルに書かないと書く', () => {
    for (const w of ['予算', '通知', '宛先', '要確認']) expect(costManual).toContain(w);
    expect(costManual).toMatch(/宛先[^\n]*ファイルに書かない|ファイルに書かない[^\n]*宛先/);
    expect(costManual).toContain('止めません');
  });

  it('UnityとUnrealのクライアント層の版は同じで版の説明書の表と一致する', () => {
    const unrealVer = (JSON.parse(unrealPlugin) as { VersionName?: string }).VersionName;
    expect(unityPkg.version).toBeTruthy();
    expect(unrealVer).toBe(unityPkg.version);
    const rows = versionManual.split('\n').filter((l) => l.startsWith('|'));
    expect(rows.some((l) => l.includes('Unity') && l.includes(unityPkg.version))).toBe(true);
    expect(rows.some((l) => l.includes('Unreal') && l.includes(unrealVer!))).toBe(true);
    for (const w of ['/v1', '/v2', 'semver', 'info.version', openapi.info.version, 'wrangler d1 migrations apply', '旧CLIはスキーマ変更後のAPIでもランキングを送って読める'])
      expect(versionManual).toContain(w);
  });
});
