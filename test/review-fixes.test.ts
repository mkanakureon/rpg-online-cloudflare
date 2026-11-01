/**
 * ソースのレビューの欠陥の直し F1 の試験（docs/reports/2026/11/01/01-source-review-report.md の §3.1・§3.2。Issue #55）。
 * イベントの一覧が開いているイベントの数によらず引数の上限に届かないこと・管理のイベントの定義の口の宣言の数の上限（MAX_EVENTS）・
 * ランキングの同点の順（低いスコアを出し直しても updated_at を進めない）を、src/worker.ts の default.fetch を直に呼んで確かめる（L2）。
 * 試験のゲームは専用の fix-game（イベントと管理）と demo-rpg のランキングの板 fix-board。時計は動かさず、順は updated_at を直に入れて作る。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_EVENTS } from '../src/core/inventory';
import { adminRequest, putEventOp, type EventDefinitionBody } from '../scripts/admin-requests.mjs';
import { bearer, bearerForBody } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local', ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'fix-game';
const board = 'fix-board';

type EventItem = { eventId: string; claimed: boolean };
const nowSeconds = () => Math.floor(Date.now() / 1000);
const isoAt = (seconds: number) => new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM event_claims WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM inventory_ledger WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM inventory_balances WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM admin_audit_log WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM event_rewards WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM events WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM inventory_items WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare("DELETE FROM ranking_entries WHERE game_id = 'demo-rpg' AND board_id = ?").bind(board),
  ]);
  await resetRateLimits(baseEnv.DB);
  await registerGame(baseEnv.DB, game, ['inventory', 'events']);
  await baseEnv.DB.prepare("INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, 'gold', 'currency')").bind(game).run();
});

/** 開いている（いまの 1 時間前から 1 日後まで）デイリーのイベントを n 個、表に直に入れる（報酬は gold 1）。 */
async function addOpenEvents(n: number): Promise<string[]> {
  const now = nowSeconds();
  const ids = Array.from({ length: n }, (_, i) => `ev-${String(i).padStart(3, '0')}`);
  const event = baseEnv.DB.prepare("INSERT INTO events (game_id, event_id, kind, starts_at, ends_at, reset_offset_minutes) VALUES (?, ?, 'daily', ?, ?, 0)");
  const reward = baseEnv.DB.prepare("INSERT INTO event_rewards (game_id, event_id, item_id, amount) VALUES (?, ?, 'gold', 1)");
  await baseEnv.DB.batch(ids.flatMap((id) => [event.bind(game, id, now - 3600, now + 86_400), reward.bind(game, id)]));
  return ids;
}

async function playerSend(method: 'GET' | 'POST', path: string): Promise<Response> {
  return worker.fetch(new Request(`${base}${path}?gameId=${game}`, { method, headers: { authorization: await bearer(game, 'p1') } }),
    localEnv as never);
}

describe('F1 イベントの一覧の引数の上限（記録 §3.1）', () => {
  it('開いているイベントが50個以上あっても一覧は200で受け取り済みを返す', async () => {
    const ids = await addOpenEvents(60);
    expect((await playerSend('POST', `/v1/events/${ids[7]}/claim`)).status).toBe(200);
    const res = await playerSend('GET', '/v1/events');
    expect(res.status).toBe(200);
    const items = (await res.json<{ items: EventItem[] }>()).items;
    expect(items).toHaveLength(60);
    expect(items.map((i) => i.eventId)).toEqual(ids);
    expect(items.filter((i) => i.claimed).map((i) => i.eventId)).toEqual([ids[7]]);
  });

  it('イベントの定義が上限の数を超えると400を返す', async () => {
    expect(MAX_EVENTS).toBe(200);
    await addOpenEvents(MAX_EVENTS);
    const now = nowSeconds();
    const definition: EventDefinitionBody = { kind: 'daily', startsAt: isoAt(now - 3600), endsAt: isoAt(now + 86_400),
      resetOffsetMinutes: 0, rewards: [{ itemId: 'gold', amount: 5 }], reason: '試験のイベント' };
    const put = (eventId: string) => worker.fetch(adminRequest(base, adminKey, putEventOp(eventId, definition, game)), localEnv as never);
    const snapshot = async () => ({
      events: (await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE game_id = ?').bind(game).first<{ n: number }>())?.n,
      audits: (await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM admin_audit_log WHERE game_id = ?').bind(game).first<{ n: number }>())?.n,
      rewards: (await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM event_rewards WHERE game_id = ?').bind(game).first<{ n: number }>())?.n,
    });
    const before = await snapshot();
    const res = await put('one-more');
    expect(res.status).toBe(400);
    expect((await res.json<{ error: { code: string } }>()).error.code).toBe('INVALID_ARGUMENT');
    expect(await snapshot()).toEqual(before);
    // あるイベントの置き換えは通る
    expect((await put('ev-000')).status).toBe(200);
    const reward = await baseEnv.DB.prepare("SELECT amount FROM event_rewards WHERE game_id = ? AND event_id = 'ev-000'").bind(game)
      .first<{ amount: number }>();
    expect(reward?.amount).toBe(5);
  });
});

describe('F1 ランキングの同点の順（記録 §3.2）', () => {
  async function submit(playerId: string, score: number): Promise<void> {
    const body = JSON.stringify({ gameId: 'demo-rpg', playerId, displayName: playerId, score });
    const res = await worker.fetch(new Request(`${base}/v1/rankings/${board}`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: await bearerForBody(body) }, body,
    }), localEnv as never);
    expect(res.status).toBe(200);
  }

  it('同点のスコアは先に取った人が低いスコアを出し直しても上のまま', async () => {
    // ID の順では B（aa-b）が先になる名前にして、時刻の順だけで A が上になることを確かめる
    const a = 'zz-a';
    const b = 'aa-b';
    await submit(a, 100);
    await baseEnv.DB.prepare("UPDATE ranking_entries SET updated_at = datetime('now', '-1 day') WHERE game_id = 'demo-rpg' AND board_id = ? AND player_id = ?")
      .bind(board, a).run();
    await submit(b, 100);
    await submit(a, 50);
    const res = await worker.fetch(new Request(`${base}/v1/rankings/${board}?gameId=demo-rpg`), localEnv as never);
    expect(res.status).toBe(200);
    const items = (await res.json<{ items: Array<{ playerId: string; score: number }> }>()).items;
    expect(items.map((i) => i.playerId)).toEqual([a, b]);
    expect(items.find((i) => i.playerId === a)?.score).toBe(100);
  });
});
