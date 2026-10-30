/**
 * 共通 API の土台 M1: モジュールの一覧と、外へ出した検証関数の L1 の試験。
 * 名前と確かめることの正は docs/guides/working/core-foundation-design.md §4 の M1 の行。ただし機能の一覧の試験は、
 * イベントの E2 で置き換えたもので docs/guides/working/event-reward-design.md §8 が正。
 * HTTP と D1 に触らない。挙動を変えないことは、いまの L2 の試験がそのまま通ることで見る。
 */
import { describe, expect, it } from 'vitest';
import { validId } from '../src/core/ids';
import { modules } from '../src/modules';
import { parseLimit, parseScoreSubmission } from '../src/modules/rankings/validate';

describe('M1 モジュールへの分割', () => {
  it('モジュールの一覧はannouncementsとrankingsとsavesとconfigとinventoryとeventsでルートが重ならない', () => {
    expect(modules.map((m) => m.name).sort()).toEqual(['announcements', 'config', 'events', 'inventory', 'rankings', 'saves']);
    const routes = modules.flatMap((m) => m.routes);
    const keys = routes.map((r) => `${r.method} ${r.pattern.source}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of routes) expect(r.pattern.test('/health')).toBe(false);
  });

  it('limitの検証関数は1から50の数字だけを通し無ければ10にする', () => {
    expect(parseLimit(null)).toBe(10);
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit('50')).toBe(50);
    for (const raw of ['0', '51', '1.5', '-1', '1e1', ' 5']) expect(parseLimit(raw)).toBeNull();
  });

  it('スコアの投稿の検証関数はいまのAPIと同じ所で合否を分ける', () => {
    const good = { gameId: 'demo-rpg', playerId: 'p1', displayName: 'A', score: 0 };
    for (const ok of [
      good,
      { ...good, score: 1_000_000_000 },
      { ...good, displayName: 'x'.repeat(40) },
    ]) expect(parseScoreSubmission(ok).ok).toBe(true);
    for (const ng of [
      { ...good, score: -1 },
      { ...good, score: 1.5 },
      { ...good, score: 1_000_000_001 },
      { ...good, score: '10' },
      { ...good, displayName: '' },
      { ...good, displayName: 'x'.repeat(41) },
      { ...good, gameId: 'bad id' },
      { ...good, playerId: "p'1" },
    ]) expect(parseScoreSubmission(ng)).toEqual({ ok: false, message: 'Invalid ranking payload' });
    for (const ng of [[], null]) expect(parseScoreSubmission(ng)).toEqual({ ok: false, message: 'Object required' });
    expect(parseScoreSubmission({ ...good, extra: 'x' })).toEqual({ ok: true, value: good });
  });

  it('IDの検証関数は英数字とハイフンと下線の1から64文字だけを通す', () => {
    expect(validId('a'.repeat(64))).toBe(true);
    expect(validId('A-z_09')).toBe(true);
    for (const v of ['a'.repeat(65), '', 'a b', "a'b", 1, null, undefined, ['a']]) expect(validId(v)).toBe(false);
  });
});
