/**
 * 堅め G7: 管理の定義どうしの整合の試験。実績の取り消しは値が閾値より小さいときだけ（§3.1）・キーと閾値の整合（区切りで数えるキーの書き方と、
 * キーの上限と実績・クエストの閾値。§3.2）・送り直しは宣言を読む前に記録を引く（§3.4）・読み直しても理由の無い競合の 400 の文（§3.5）。
 * 名前と期待する結果の正は docs/guides/working/hardening-design.md §11 の G7 の行。契約は docs/api-contract.md の管理の API。
 * L2 は src/worker.ts の default.fetch を直に呼ぶ。試験のゲームは専用の g7-game（player-data・quests）。
 * 競合は、監査の行を 1 文目に持つ batch だけを流さない D1 の包み（racingDb）で作る（読み直しでは断る理由が見つからない）。
 * 管理の鍵は試験の中で作る秘密でない値（'a'.repeat(32)）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-10
 */
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../src/worker';
import { CONFLICT_MESSAGE } from '../src/core/admin/common';
import {
  adminRequest, putAchievementOp, putDataKeyOp, putEventOp, putQuestOp, revokeAchievementOp, setDataOp, type AdminOp,
} from '../scripts/admin-requests.mjs';
import { authHeaders, playerDataHeaders, playerDataPath, playerDataWrite } from '../scripts/cli-requests.mjs';
import { bearer } from './support/auth';
import { registerGame } from './support/games';
import { resetRateLimits } from './support/rate-limits';

type TestEnv = { DB: D1Database; APP_ENV: string; ADMIN_API_KEY?: string };
const baseEnv = env as unknown as TestEnv;
const adminKey = 'a'.repeat(32);
const localEnv: TestEnv = { ...baseEnv, APP_ENV: 'local', ADMIN_API_KEY: adminKey };
const base = 'http://example.com';
const game = 'g7-game';
type ErrorBody = { error: { code: string; message: string } };
type WriteBody = { gameId: string; writeId: string; values: Array<{ key: string; value: number }>;
  unlocked: Array<{ achievementId: string; unlockedAt: string }> };

const adminSend = (op: AdminOp, e: TestEnv = localEnv) => worker.fetch(adminRequest(base, adminKey, op), e as never);
/** player のトークンで key に value を書く（鍵を渡さなければ毎回新しく）。 */
async function writeData(player: string, key: string, value: number, idempotencyKey: string = crypto.randomUUID()): Promise<Response> {
  return worker.fetch(new Request(`${base}${playerDataPath(game)}`, {
    method: 'POST', headers: playerDataHeaders((await bearer(game, player)).slice('Bearer '.length), idempotencyKey),
    body: JSON.stringify(playerDataWrite(key, value)),
  }), localEnv as never);
}
async function achievementsOf(player: string): Promise<unknown[]> {
  const res = await worker.fetch(new Request(`${base}${playerDataPath(game)}`, {
    headers: authHeaders((await bearer(game, player)).slice('Bearer '.length)),
  }), localEnv as never);
  return (await res.json<{ achievements: unknown[] }>()).achievements;
}
async function expectError(res: Response, status: number, code: string): Promise<ErrorBody> {
  expect(res.status, code).toBe(status);
  const body = await res.json<ErrorBody>();
  expect(body.error.code).toBe(code);
  return body;
}
async function valueOf(player: string, key: string): Promise<number | null> {
  return (await baseEnv.DB.prepare('SELECT value FROM player_data WHERE game_id = ? AND player_id = ? AND key = ?')
    .bind(game, player, key).first<{ value: number }>())?.value ?? null;
}
/** 何も書いていないことを見るための行（宣言・区切りの宣言・実績・クエスト・値・解いた実績・監査）。 */
async function snapshot(): Promise<unknown[]> {
  const all = (sql: string) => baseEnv.DB.prepare(sql).bind(game).all().then((r) => r.results);
  return [
    await all('SELECT key, mode, max_value, max_delta FROM player_data_keys WHERE game_id = ? ORDER BY key'),
    await all('SELECT key, kind, reset_offset_minutes FROM player_data_key_periods WHERE game_id = ? ORDER BY key, kind'),
    await all('SELECT achievement_id, key, threshold FROM achievements WHERE game_id = ? ORDER BY achievement_id'),
    await all('SELECT quest_id, kind, key, threshold FROM quests WHERE game_id = ? ORDER BY quest_id'),
    await all('SELECT event_id, kind FROM events WHERE game_id = ? ORDER BY event_id'),
    await all('SELECT player_id, key, value FROM player_data WHERE game_id = ? ORDER BY player_id, key'),
    await all('SELECT player_id, achievement_id, unlocked_at FROM player_achievements WHERE game_id = ? ORDER BY player_id, achievement_id'),
    await all('SELECT COUNT(*) AS n FROM admin_audit_log WHERE game_id = ?'),
  ];
}
const now = Math.floor(Date.now() / 1000);
const iso = (t: number) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** クエストの定義の本文（報酬は potion を 1 つ）。 */
const quest = (kind: 'once' | 'daily' | 'weekly', key: string, threshold: number) => ({
  kind, startsAt: iso(now - 3600), endsAt: iso(now + 86_400 * 30), resetOffsetMinutes: 0, key, threshold,
  rewards: [{ itemId: 'potion', amount: 1 }], reason: 'G7 の試験',
});

/**
 * 監査の行を 1 文目に持つ batch（管理の書き込み）だけを流さない D1。ほかの文（利用制限・読み取り）はそのまま流す。
 * 監査の行が入らず、読み直しても断る理由が無い（読み直した時には競合が解けていた）状態を作る。
 */
function racingDb(db: D1Database): D1Database {
  const sqlOf = new WeakMap<object, string>();
  const tag = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    sqlOf.set(stmt, sql);
    const bind = stmt.bind.bind(stmt);
    stmt.bind = (...values: unknown[]) => tag(bind(...values), sql);
    return stmt;
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => tag(target.prepare(sql), sql);
      if (prop === 'batch') {
        return async (stmts: D1PreparedStatement[]) =>
          (sqlOf.get(stmts[0]) ?? '').includes('INSERT INTO admin_audit_log') ? [] : target.batch(stmts);
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

beforeEach(async () => {
  const db = baseEnv.DB;
  await db.batch([
    'player_achievements', 'player_data_period_values', 'player_data', 'player_data_writes', 'player_data_key_periods', 'quest_claims',
    'quest_rewards', 'quests', 'event_rewards', 'events', 'achievements', 'player_data_keys', 'inventory_items', 'admin_audit_log',
    'game_players',
  ].map((t) => db.prepare(`DELETE FROM ${t} WHERE game_id = ?`).bind(game)));
  await db.prepare("DELETE FROM accounts WHERE account_id = 'acc-g7-game-p1'").run();
  await registerGame(db, game, ['player-data', 'quests']);
  await resetRateLimits(db);
  // kills（add・上限 1000・1 回 100）・floor（max・上限 999）と、kills が 10 以上で解ける実績 kill-10・報酬の品目 potion
  const key = db.prepare('INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, ?, ?, ?, ?)');
  await db.batch([
    key.bind(game, 'kills', 'add', 1000, 100), key.bind(game, 'floor', 'max', 999, null),
    db.prepare("INSERT INTO achievements (game_id, achievement_id, key, threshold) VALUES (?, 'kill-10', 'kills', 10)").bind(game),
    db.prepare("INSERT INTO inventory_items (game_id, item_id, kind) VALUES (?, 'potion', 'item')").bind(game),
    // 管理の値を置く口が見るプレイヤーの登録（p1）
    db.prepare("INSERT INTO accounts (account_id, kind) VALUES ('acc-g7-game-p1', 'guest')"),
    db.prepare("INSERT INTO game_players (game_id, player_id, account_id) VALUES (?, 'p1', 'acc-g7-game-p1')").bind(game),
  ]);
});

describe('堅め G7: 実績の取り消し（§3.1）', () => {
  it('閾値以上の値が残る実績の取り消しはINVALID_ARGUMENTの400で何も消さない', async () => {
    const written = await writeData('p1', 'kills', 12);
    expect((await written.json<WriteBody>()).unlocked.map((u) => u.achievementId)).toEqual(['kill-10']);
    const before = await snapshot();
    const res = await adminSend(revokeAchievementOp('p1', 'kill-10', '値を残したまま消す', game));
    const body = await expectError(res, 400, 'INVALID_ARGUMENT');
    expect(body.error.message).toContain('lower the value first');
    expect(await snapshot()).toEqual(before);
    // 閾値ちょうどの値でも断る
    expect((await adminSend(setDataOp('p1', 'kills', 10, '閾値ちょうど', game))).status).toBe(200);
    const exact = await snapshot();
    await expectError(await adminSend(revokeAchievementOp('p1', 'kill-10', '閾値ちょうど', game)), 400, 'INVALID_ARGUMENT');
    expect(await snapshot()).toEqual(exact);
    expect(await achievementsOf('p1')).toHaveLength(1);
    // 解いた行の無い取り消しは前のとおり 404
    expect((await expectError(await adminSend(revokeAchievementOp('p2', 'kill-10', '無い', game)), 404, 'NOT_FOUND')).error.message)
      .toBe('Unknown achievement');
  });

  it('値を閾値より下げた後の実績の取り消しは次の書き込みで解き直されない', async () => {
    expect((await (await writeData('p1', 'kills', 12)).json<WriteBody>()).unlocked).toHaveLength(1);
    // 値を下げる → 取り消す の 2 手
    expect((await adminSend(setDataOp('p1', 'kills', 0, '不正な値を戻す', game))).status).toBe(200);
    const revoked = await adminSend(revokeAchievementOp('p1', 'kill-10', '不正な値で解けた', game));
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ gameId: game, playerId: 'p1', achievementId: 'kill-10', revoked: true });
    // 別のキーの書き込みでも、閾値より小さい増加でも解き直されない
    expect((await (await writeData('p1', 'floor', 5)).json<WriteBody>()).unlocked).toEqual([]);
    expect((await (await writeData('p1', 'kills', 5)).json<WriteBody>()).unlocked).toEqual([]);
    expect(await valueOf('p1', 'kills')).toBe(5);
    expect(await achievementsOf('p1')).toEqual([]);
    const actions = (await baseEnv.DB.prepare('SELECT action FROM admin_audit_log WHERE game_id = ? ORDER BY audit_id').bind(game).all())
      .results.map((r) => r.action);
    expect(actions).toEqual(['player-data.set', 'achievement.revoke']);
  });
});

describe('堅め G7: キーと閾値の整合（§3.2）', () => {
  it('区切りのクエストが見るキーを増やすキー以外にする宣言は400で何も書かない', async () => {
    expect((await adminSend(putQuestOp('daily-kills', quest('daily', 'kills', 3), game))).status).toBe(200);
    const before = await snapshot();
    // 値の行が無くても、区切りのクエストが見る add のキーは add のまま
    for (const declaration of [{ mode: 'set', maxValue: 1000 }, { mode: 'max', maxValue: 1000 }, { mode: 'flag', maxValue: 1 }]) {
      const body = await expectError(await adminSend(putDataKeyOp('kills', declaration, '書き方を変える', game)), 400, 'INVALID_ARGUMENT');
      expect(body.error.message).toContain('must stay add');
    }
    // 区切りの宣言だけがあるキーも同じ
    await baseEnv.DB.batch([
      baseEnv.DB.prepare("INSERT INTO player_data_keys (game_id, key, mode, max_value, max_delta) VALUES (?, 'steps', 'add', 100, 10)").bind(game),
      baseEnv.DB.prepare("INSERT INTO player_data_key_periods (game_id, key, kind, reset_offset_minutes, created_at) VALUES (?, 'steps', 'weekly', 0, ?)")
        .bind(game, now),
    ]);
    const periodOnly = await snapshot();
    await expectError(await adminSend(putDataKeyOp('steps', { mode: 'set', maxValue: 100 }, '書き方を変える', game)), 400, 'INVALID_ARGUMENT');
    expect(await snapshot()).toEqual(periodOnly);
    expect(periodOnly.slice(0, 1)).not.toEqual(before.slice(0, 1));
    // add のままの変更（上限・1 回の増加）は通る。一度きりのクエストだけが見るキーは書き方を変えられる
    expect((await adminSend(putDataKeyOp('kills', { mode: 'add', maxValue: 500, maxDelta: 5 }, '上限を変える', game))).status).toBe(200);
    expect((await adminSend(putQuestOp('reach-floor', quest('once', 'floor', 5), game))).status).toBe(200);
    expect((await adminSend(putDataKeyOp('floor', { mode: 'set', maxValue: 999 }, '書き方を変える', game))).status).toBe(200);
  });

  it('キーの上限を超える閾値の実績とクエストの宣言は400で何も書かない', async () => {
    const before = await snapshot();
    for (const op of [putAchievementOp('kill-2000', 'kills', 1001, '解けない実績', game), putAchievementOp('kill-10', 'kills', 1001, '置き換え', game),
      putQuestOp('once-kills', quest('once', 'kills', 1001), game), putQuestOp('daily-kills', quest('daily', 'kills', 1001), game)]) {
      const body = await expectError(await adminSend(op), 400, 'INVALID_ARGUMENT');
      expect(body.error.message, op.path).toBe('threshold must be at most 1000, the maxValue of key kills');
    }
    expect(await snapshot()).toEqual(before);
    // 上限ちょうどは通る
    expect((await adminSend(putAchievementOp('kill-1000', 'kills', 1000, '上限ちょうど', game))).status).toBe(200);
    expect((await adminSend(putQuestOp('once-kills', quest('once', 'kills', 1000), game))).status).toBe(200);
  });

  it('参照する閾値より下へキーの上限を下げる宣言は400で何も書かない', async () => {
    expect((await adminSend(putQuestOp('reach-floor', quest('once', 'floor', 50), game))).status).toBe(200);
    const before = await snapshot();
    // 実績の閾値（kills の kill-10 は 10）・クエストの閾値（floor の reach-floor は 50）より下げない
    const kills = await expectError(await adminSend(putDataKeyOp('kills', { mode: 'add', maxValue: 9, maxDelta: 5 }, '下げる', game)),
      400, 'INVALID_ARGUMENT');
    expect(kills.error.message).toBe('maxValue must be at least 10, the highest threshold of achievements and quests on key kills');
    const floor = await expectError(await adminSend(putDataKeyOp('floor', { mode: 'max', maxValue: 49 }, '下げる', game)), 400, 'INVALID_ARGUMENT');
    expect(floor.error.message).toContain('at least 50');
    expect(await snapshot()).toEqual(before);
    // 一番高い閾値ちょうどまでは下げられる
    expect((await adminSend(putDataKeyOp('kills', { mode: 'add', maxValue: 10, maxDelta: 5 }, '閾値まで', game))).status).toBe(200);
    expect((await adminSend(putDataKeyOp('floor', { mode: 'max', maxValue: 50 }, '閾値まで', game))).status).toBe(200);
  });
});

describe('堅め G7: 送り直しの順（§3.4）', () => {
  it('maxDeltaを下げた後の同じIdempotency-Keyの送り直しは1回目と同じ本文の200を返す', async () => {
    const idem = 'g7-resend-0001';
    const first = await writeData('p1', 'kills', 50, idem);
    expect(first.status).toBe(200);
    const firstBody = await first.json<WriteBody>();
    expect(firstBody.values).toEqual([{ key: 'kills', value: 50 }]);
    // 応答を取りこぼした間に、管理が 1 回の増加の上限を下げた
    expect((await adminSend(putDataKeyOp('kills', { mode: 'add', maxValue: 1000, maxDelta: 10 }, '上限を下げる', game))).status).toBe(200);
    const again = await writeData('p1', 'kills', 50, idem);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(firstBody);
    expect(await valueOf('p1', 'kills')).toBe(50);
    // 同じ鍵で違う中身は 422。新しい鍵では下げた上限が効く（400）
    await expectError(await writeData('p1', 'kills', 5, idem), 422, 'IDEMPOTENCY_KEY_REUSED');
    await expectError(await writeData('p1', 'kills', 50), 400, 'INVALID_ARGUMENT');
    expect(await valueOf('p1', 'kills')).toBe(50);
  });
});

describe('堅め G7: 競合の文（§3.5）', () => {
  it('管理の宣言が同時の変更とぶつかったときの400は競合の文を返す', async () => {
    expect(CONFLICT_MESSAGE).toBe('Conflicted with a concurrent change; send the request again');
    // 取り消しの準備: 解いた行があり、値は閾値より小さい
    await writeData('p1', 'kills', 12);
    expect((await adminSend(setDataOp('p1', 'kills', 0, '戻す', game))).status).toBe(200);
    const racing: TestEnv = { ...localEnv, DB: racingDb(baseEnv.DB) };
    const before = await snapshot();
    const event = { kind: 'daily', startsAt: iso(now - 3600), endsAt: iso(now + 86_400), resetOffsetMinutes: 0,
      rewards: [{ itemId: 'potion', amount: 1 }], reason: '競合' };
    for (const op of [
      putDataKeyOp('kills', { mode: 'add', maxValue: 1000, maxDelta: 50 }, '競合', game), putDataKeyOp('fresh', { mode: 'set', maxValue: 10 }, '競合', game),
      putAchievementOp('kill-10', 'kills', 20, '競合', game), putQuestOp('daily-kills', quest('daily', 'kills', 3), game),
      putEventOp('login', event, game), setDataOp('p1', 'kills', 1, '競合', game), revokeAchievementOp('p1', 'kill-10', '競合', game),
    ]) {
      const body = await expectError(await adminSend(op, racing), 400, 'INVALID_ARGUMENT');
      expect(body.error.message, `${op.method} ${op.path}`).toBe(CONFLICT_MESSAGE);
    }
    expect(await snapshot()).toEqual(before);
    // 競合の無い送り直しは通る
    expect((await adminSend(revokeAchievementOp('p1', 'kill-10', '送り直す', game))).status).toBe(200);
  });
});
