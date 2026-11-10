// clock.ts — サーバーの時刻（UNIX 秒）を取る、src/ でただ 1 つの所。
//
// ハンドラー・モジュール・core の既定の引数（認証・BAN・利用制限・遊んだ日）はどれもここから時刻を取る。
// 試験は Date.now を vi.spyOn で差し替えると、全部の口が同じ時刻に従う（test/clock.test.ts。設計は
// docs/guides/working/hardening-design.md §6 の案 A）。クライアントの時刻（本文・問い合わせ・Date の見出し）は読まない。
//
// 概要記述: Claude Opus 5.5 — 2026-11-10

/** サーバーの時刻（UNIX 秒。小数を切り捨てる）。 */
export function serverNow(): number {
  return Math.floor(Date.now() / 1000);
}
