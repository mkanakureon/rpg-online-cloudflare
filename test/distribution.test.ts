/**
 * 配布の試験 P1: LICENSE（MIT）・README のライセンスとサポートの範囲の節・配るものに第三者の包みが入らないこと・ADR 0003 の決定。
 * 名前と見ることの正は docs/guides/working/distribution-design.md §9 の P1 の 4 本。
 * 文書は `?raw` で文字列として読み（test/raw-imports.d.ts）、clients/ の下のファイルは import.meta.glob で集める。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { describe, expect, it } from 'vitest';
import license from '../LICENSE?raw';
import readme from '../README.md?raw';
import adr from '../docs/adr/0003-distribution-license-support.md?raw';
import pkg from '../package.json';
import unityPkg from '../clients/unity/package.json';

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
