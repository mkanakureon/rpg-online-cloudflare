// rankings/index.ts — ランキングのモジュール（GET・POST /v1/rankings/{boardId}）。
//
// GET は gameId → limit → ゲームの登録と機能の設定の順に確かめて上位を返す。POST は APP_ENV=local の門（本文を読む前）
// → トークン（本文を読む前）→ 本文の大きさ（413。src/core/body.ts）→ JSON の読み取り → 形の検証（validate.ts）→ トークンのプレイヤーごとの利用制限（429。DB を引くので
// 形の検証の後。形の外れは DB を引かずに 400）→ 止めた印（403 PLAYER_BANNED）→ トークンと本文の突き合わせ
// → ゲームの登録と機能の設定 → 書き込み（高いほうのスコアを残す。updated_at はスコアが上がったときだけ進め、同点は先にそのスコアに届いた人が上）。順の正は docs/guides/working/account-design.md §5。
// 新しいボードへの書き込みは、そのプレイヤーの行が MAX_BOARDS_PER_PLAYER（limits.ts）に届いていれば書かずに 409 RANKING_LIMIT_EXCEEDED。
// 判定は書き込みの 1 文の条件に入れる（読んでから書く隙間を作らない。docs/guides/working/hardening-design.md §2.1）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { consumeForPlayer } from '../../core/activity';
import { requireAuth, requireSamePlayer } from '../../core/auth';
import { requireNotBanned } from '../../core/bans';
import { MAX_JSON_BODY_BYTES, readJson } from '../../core/body';
import { requireGame } from '../../core/games';
import { requireLocalWrite } from '../../core/guards';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';
import { RATE_LIMITS } from '../../core/rate-limit-policy';
import { MAX_BOARDS_PER_PLAYER } from './limits';
import { parseLimit, parseScoreSubmission } from './validate';

type RankingEntry = {
  playerId: string;
  displayName: string;
  score: number;
};

const boardPath = /^\/v1\/rankings\/([a-zA-Z0-9_-]{1,64})$/;

// そのボードに行がある（上書き）か、そのプレイヤーの行の数が上限より少ないときだけ書く。書かなければ何も返らない
const upsertScore = `INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score)
  SELECT ?, ?, ?, ?, ?
  WHERE EXISTS (SELECT 1 FROM ranking_entries WHERE game_id = ? AND board_id = ? AND player_id = ?)
    OR (SELECT COUNT(*) FROM ranking_entries WHERE game_id = ? AND player_id = ?) < ?
  ON CONFLICT(game_id, board_id, player_id) DO UPDATE SET
    score = MAX(ranking_entries.score, excluded.score),
    display_name = excluded.display_name,
    updated_at = CASE WHEN excluded.score > ranking_entries.score THEN datetime('now') ELSE ranking_entries.updated_at END
  RETURNING board_id AS boardId`;

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
        const body = await readJson(req, MAX_JSON_BODY_BYTES);
        if (!body.ok) return body.response;
        const parsed = parseScoreSubmission(body.value);
        if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
        const { gameId, playerId, displayName, score } = parsed.value;
        // 本文の playerId でなくトークンのプレイヤーで数える（偽れない鍵）
        const limited = await consumeForPlayer(env.DB, RATE_LIMITS.score, auth.claims);
        if (limited) return limited;
        // 止めたプレイヤーは利用制限で数えた後に断る（トークンの g・p で引く）
        const banned = await requireNotBanned(env, auth.claims);
        if (banned) return banned;
        const denied = requireSamePlayer(auth.claims, gameId, playerId);
        if (denied) return denied;
        const unknown = await requireGame(env, gameId, rankings.name, known);
        if (unknown) return unknown;
        const written = await env.DB.prepare(upsertScore)
          .bind(gameId, boardId, playerId, displayName, score, gameId, boardId, playerId, gameId, playerId, MAX_BOARDS_PER_PLAYER)
          .all<{ boardId: string }>();
        if (written.results.length === 0) {
          return error('RANKING_LIMIT_EXCEEDED', `At most ${MAX_BOARDS_PER_PLAYER} ranking boards per player`, 409);
        }
        return json({ ok: true, gameId, boardId, playerId });
      },
    },
  ],
};
