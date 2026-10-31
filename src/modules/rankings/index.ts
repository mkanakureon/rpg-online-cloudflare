// rankings/index.ts — ランキングのモジュール（GET・POST /v1/rankings/{boardId}）。
//
// GET は gameId → limit → ゲームの登録と機能の設定の順に確かめて上位を返す。POST は APP_ENV=local の門（本文を読む前）
// → トークン（本文を読む前）→ JSON の読み取り → 形の検証（validate.ts）→ トークンのプレイヤーごとの利用制限（429。DB を引くので
// 形の検証の後。形の外れは DB を引かずに 400）→ 止めた印（403 PLAYER_BANNED）→ トークンと本文の突き合わせ
// → ゲームの登録と機能の設定 → 書き込み（高いほうのスコアを残す）。順の正は docs/guides/working/account-design.md §5。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { requireAuth, requireSamePlayer } from '../../core/auth';
import { requireNotBanned } from '../../core/bans';
import { requireGame } from '../../core/games';
import { requireLocalWrite } from '../../core/guards';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';
import { consume } from '../../core/rate-limit';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import { parseLimit, parseScoreSubmission } from './validate';

type RankingEntry = {
  playerId: string;
  displayName: string;
  score: number;
};

const boardPath = /^\/v1\/rankings\/([a-zA-Z0-9_-]{1,64})$/;

export const rankings: GameModule = {
  name: 'rankings',
  routes: [
    {
      method: 'GET',
      pattern: boardPath,
      async handle(_req, env, match, url, known) {
        const boardId = match[1];
        const gameId = url.searchParams.get('gameId');
        if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
        const limit = parseLimit(url.searchParams.get('limit'));
        if (limit === null) return error('INVALID_ARGUMENT', 'limit must be 1..50', 400);
        const unknown = await requireGame(env, gameId, rankings.name, known);
        if (unknown) return unknown;
        const rows = await env.DB.prepare(
          'SELECT player_id AS playerId, display_name AS displayName, score FROM ranking_entries '
          + 'WHERE game_id = ? AND board_id = ? ORDER BY score DESC, updated_at ASC, player_id ASC LIMIT ?'
        ).bind(gameId, boardId, limit).all<RankingEntry>();
        return json({ gameId, boardId, items: rows.results });
      },
    },
    {
      method: 'POST',
      pattern: boardPath,
      async handle(req, env, match, _url, known) {
        const boardId = match[1];
        const blocked = requireLocalWrite(env);
        if (blocked) return blocked;
        const auth = await requireAuth(req, env);
        if (!auth.ok) return auth.response;
        let value: unknown;
        try { value = await req.json(); }
        catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
        const parsed = parseScoreSubmission(value);
        if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
        const { gameId, playerId, displayName, score } = parsed.value;
        // 本文の playerId でなくトークンのプレイヤーで数える（偽れない鍵）
        const limited = await consume(env.DB, RATE_LIMITS.score, `${auth.claims.gameId}:${auth.claims.playerId}`);
        if (limited) return limited;
        // 止めたプレイヤーは利用制限で数えた後に断る（トークンの g・p で引く）
        const banned = await requireNotBanned(env, auth.claims);
        if (banned) return banned;
        const denied = requireSamePlayer(auth.claims, gameId, playerId);
        if (denied) return denied;
        const unknown = await requireGame(env, gameId, rankings.name, known);
        if (unknown) return unknown;
        await env.DB.prepare(
          `INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(game_id, board_id, player_id) DO UPDATE SET
           score = MAX(ranking_entries.score, excluded.score),
           display_name = excluded.display_name,
           updated_at = datetime('now')`
        ).bind(gameId, boardId, playerId, displayName, score).run();
        return json({ ok: true, gameId, boardId, playerId });
      },
    },
  ],
};
