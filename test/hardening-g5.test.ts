/**
 * 堅め G5: 1 プレイヤー・1 ゲームが行を持てるランキングのボードの数の上限（src/modules/rankings/limits.ts の MAX_BOARDS_PER_PLAYER）と、
 * 上限を超える新しいボードへの投稿の 409 RANKING_LIMIT_EXCEEDED・管理のプレイヤーを読む口の rankings の件数の試験。
 * 名前と期待する結果の正は docs/guides/working/hardening-design.md §11 の G5 の行（§2.1）。契約は docs/api-contract.md のランキングの POST。
 * L2 は src/worker.ts の default.fetch を直に呼ぶ。試験のゲームは専用の board-game（rankings）。
 * 管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-10
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { MAX_BOARDS_PER_PLAYER } from '../src/modules/rankings/limits';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local', ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'board-game';
type ErrorBody = { error: { code: string; message: string } };
type Row = { boardId: string; score: number; displayName: string };

/** player のトークンで boardId に score を投稿する。 */
async function submit(player: string, boardId: string, score: number, displayName = 'Player'): Promise<Response> {
  return worker.fetch(new Request(`${base}/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: await bearer(game, player) },
    body: JSON.stringify({ gameId: game, playerId: player, displayName, score }),
  }), localEnv as never);
}
/** player に board-0 から上限の数まで、別々のボードの行を投稿で作る。 */
async function fillBoards(player: string): Promise<void> {
  for (let i = 0; i < MAX_BOARDS_PER_PLAYER; i++) {
    expect((await submit(player, `board-${i}`, 10)).status, `board-${i}`).toBe(200);
  }
}
async function expectError(res: Response, status: number, code: string): Promise<void> {
  expect(res.status, code).toBe(status);
  expect((await res.json<ErrorBody>()).error.code).toBe(code);
}
async function rowsOf(player: string): Promise<Row[]> {
  return (await baseEnv.DB.prepare('SELECT board_id AS boardId, score, display_name AS displayName FROM ranking_entries '
    + 'WHERE game_id = ? AND player_id = ? ORDER BY board_id').bind(game, player).all<Row>()).results;
}

beforeEach(async () => {
  await baseEnv.DB.batch([
    baseEnv.DB.prepare('DELETE FROM ranking_entries WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare('DELETE FROM game_players WHERE game_id = ?').bind(game),
    baseEnv.DB.prepare("DELETE FROM accounts WHERE account_id LIKE 'acc-board-game-%'"),
  ]);
  await registerGame(baseEnv.DB, game, ['rankings']);
  await resetRateLimits(baseEnv.DB);
});

describe('堅め G5: ランキングのボードの数の上限', () => {
  it('1人が行を持てるボードの数を超える新しいボードへの投稿はRANKING_LIMIT_EXCEEDEDの409を返し書かない', async () => {
    expect(MAX_BOARDS_PER_PLAYER).toBe(20);
    await fillBoards('p1');
    await expectError(await submit('p1', 'board-new', 99), 409, 'RANKING_LIMIT_EXCEEDED');
    // 書かない: 行は上限のまま・新しいボードに行が無い
    const rows = await rowsOf('p1');
    expect(rows).toHaveLength(MAX_BOARDS_PER_PLAYER);
    expect(rows.map((r) => r.boardId)).not.toContain('board-new');
    const board = await worker.fetch(new Request(`${base}/v1/rankings/board-new?gameId=${game}`), localEnv as never);
    expect((await board.json<{ items: unknown[] }>()).items).toEqual([]);
    // ほかの人のボードを塞がない: 別のプレイヤーは同じ新しいボードに書ける
    expect((await submit('p2', 'board-new', 5)).status).toBe(200);
    // 上限はプレイヤーごと: p2 の行は 1 つ
    expect((await baseEnv.DB.prepare('SELECT COUNT(*) AS n FROM ranking_entries WHERE game_id = ? AND player_id = ?')
      .bind(game, 'p2').first<{ n: number }>())?.n).toBe(1);
  });

  it('ボードの数が上限でも行のあるボードへの投稿は通る', async () => {
    await fillBoards('p1');
    // 高いスコアは書き換わり、表示名も変わる
    const res = await submit('p1', 'board-3', 50, 'Renamed');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, gameId: game, boardId: 'board-3', playerId: 'p1' });
    // 低いスコアも通り（200）、高いほうを残す
    expect((await submit('p1', 'board-3', 1, 'Renamed')).status).toBe(200);
    const rows = await rowsOf('p1');
    expect(rows).toHaveLength(MAX_BOARDS_PER_PLAYER);
    expect(rows.find((r) => r.boardId === 'board-3')).toEqual({ boardId: 'board-3', score: 50, displayName: 'Renamed' });
    // 新しいボードはまだ断る
    await expectError(await submit('p1', 'board-new', 99), 409, 'RANKING_LIMIT_EXCEEDED');
  });

  it('管理のプレイヤーを読む口のrankingsはボードの上限の件数で止まる', async () => {
    await baseEnv.DB.batch([
      baseEnv.DB.prepare("INSERT INTO accounts (account_id, kind) VALUES ('acc-board-game-p1', 'guest')"),
      baseEnv.DB.prepare("INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, 'p1', 'acc-board-game-p1')").bind(game),
    ]);
    await fillBoards('p1');
    await expectError(await submit('p1', 'board-new', 99), 409, 'RANKING_LIMIT_EXCEEDED');
    const res = await worker.fetch(new Request(`${base}/v1/admin/players/p1?gameId=${game}`, {
      headers: { authorization: `Bearer ${adminKey}` },
    }), localEnv as never);
    expect(res.status).toBe(200);
    const body = await res.json<{ rankings: Row[] }>();
    expect(body.rankings).toHaveLength(MAX_BOARDS_PER_PLAYER);
    expect(body.rankings.map((r) => r.boardId)).not.toContain('board-new');
  });
});
