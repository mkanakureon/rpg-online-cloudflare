/**
 * 共通 API の土台 M3: ゲームごとの機能の設定（game_modules）と、使わない機能への要求を 404 NOT_FOUND で断ること。
 * 名前と確かめることの正は docs/guides/working/core-foundation-design.md §4 の M3。ただし demo-rpg の機能の設定の試験は、
 * 設定配信の C1 で置き換えたもので docs/guides/working/config-design.md §7 が正。
 * L2 の試験は src/worker.ts の default.fetch を直に呼ぶ。書き込みだけ APP_ENV=local を渡す。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-30
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { resetRateLimits } from './support/rate-limits';
import { bearerForBody } from './support/auth';
import { enabledModules } from '../src/core/games';
import { registerGame } from './support/games';

type TestEnv = { DB: D1Database; APP_ENV: string };
const baseEnv = env as unknown as TestEnv;
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local' };
const base = 'http://example.com';

function get(path: string): Promise<Response> {
  return worker.fetch(new Request(base + path), baseEnv as never);
}
async function post(boardId: string, body: unknown): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await bearerForBody(body) },
    body: JSON.stringify(body),
  }), localEnv as never);
}
async function countRows(): Promise<number> {
  const row = await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM ranking_entries').first<{ n: number }>();
  return row?.n ?? 0;
}
async function expectNotEnabled(res: Response): Promise<void> {
  expect(res.status).toBe(404);
  const body = await res.json<{ error: { code: string; message: string } }>();
  expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Feature not enabled for this game' });
}

// 試験の間で前のデータに頼らない。demo-rpg（マイグレーションの初期データ）と welcome だけ残す。
// game_modules が games を外部キーで指すので、game_modules → games の順に消す（設計書 §4）
beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries'),
    baseEnv.DB.prepare("DELETE FROM announcements WHERE id <> 'welcome'"),
    baseEnv.DB.prepare("DELETE FROM game_modules WHERE game_id <> 'demo-rpg'"),
    baseEnv.DB.prepare("DELETE FROM games WHERE game_id <> 'demo-rpg'"),
  ]);
  await resetRateLimits(baseEnv.DB);
});

describe('M3 ゲームごとの機能の設定', () => {
  it('ゲームの機能の設定の行から使える機能の集合を作り知らない名前は捨てる', () => {
    const set = enabledModules([{ module: 'rankings' }, { module: 'chat' }, { module: null }], ['announcements', 'rankings']);
    expect([...set]).toEqual(['rankings']);
  });

  it('demo-rpgはannouncementsとrankingsとsavesとconfigを使う設定で登録される', async () => {
    const rows = await baseEnv.DB.prepare("SELECT module FROM game_modules WHERE game_id = 'demo-rpg' ORDER BY module")
      .all<{ module: string }>();
    expect(rows.results.map((r) => r.module)).toEqual(['announcements', 'config', 'rankings', 'saves']);
  });

  it('rankingsを使わない設定のゲームのランキングはNOT_FOUNDの404を返す', async () => {
    await registerGame(baseEnv.DB, 'news-only', ['announcements']);
    await expectNotEnabled(await get('/v1/rankings/boss-score?gameId=news-only'));
  });

  it('rankingsを使わない設定のゲームへのスコアの投稿はNOT_FOUNDの404を返し記録しない', async () => {
    await registerGame(baseEnv.DB, 'news-only', ['announcements']);
    await expectNotEnabled(await post('boss-score', { gameId: 'news-only', playerId: 'p1', displayName: 'P1', score: 100 }));
    expect(await countRows()).toBe(0);
  });

  it('announcementsを使わない設定のゲームのお知らせはNOT_FOUNDの404を返す', async () => {
    await registerGame(baseEnv.DB, 'score-only', ['rankings']);
    await expectNotEnabled(await get('/v1/announcements?gameId=score-only'));
    const res = await get('/v1/rankings/boss-score?gameId=score-only');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gameId: 'score-only', boardId: 'boss-score', items: [] });
  });

  it('機能の設定はゲームごとで他のゲームの設定に引きずられない', async () => {
    await registerGame(baseEnv.DB, 'news-only', ['announcements']);
    expect((await get('/v1/rankings/boss-score?gameId=demo-rpg')).status).toBe(200);
    const news = await get('/v1/announcements?gameId=news-only');
    expect(news.status).toBe(200);
    expect(await news.json()).toEqual({ gameId: 'news-only', items: [] });
    await expectNotEnabled(await get('/v1/rankings/boss-score?gameId=news-only'));
  });
});
