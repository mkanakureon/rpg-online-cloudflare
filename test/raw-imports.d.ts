// raw-imports.d.ts — 試験が Vite の `?raw` で読むファイル（中身の文字列）の型。test/cleanup.test.ts が wrangler.jsonc を読むのに使う。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
declare module '*?raw' {
  const text: string;
  export default text;
}
