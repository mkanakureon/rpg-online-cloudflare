/** Local-only proof of concept. NOT production safe: no authentication or anti-cheat. */

type Statement = {
  bind(...values: unknown[]): Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};
type Database = { prepare(sql: string): Statement };
type Env = { DB: Database; APP_ENV: string };

type RankingEntry = {
  playerId: string;
  displayName: string;
  score: number;
};

const idPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}
function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}
function validId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'ok', service: 'rpg-online-backend' });
  }

  if (req.method === 'GET' && url.pathname === '/v1/announcements') {
    const gameId = url.searchParams.get('gameId');
    if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
    const data = await env.DB.prepare(
      'SELECT id, title, body FROM announcements WHERE game_id = ? ORDER BY id ASC LIMIT 50'
    ).bind(gameId).all<{ id: string; title: string; body: string }>();
    return json({ gameId, items: data.results });
  }

  const rankingPath = /^\/v1\/rankings\/([a-zA-Z0-9_-]{1,64})$/.exec(url.pathname);
  if (rankingPath) {
    const boardId = rankingPath[1];
    if (req.method === 'GET') {
      const gameId = url.searchParams.get('gameId');
      if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
      const rawLimit = url.searchParams.get('limit') ?? '10';
      const limit = Number(rawLimit);
      if (!/^\d+$/.test(rawLimit) || !Number.isInteger(limit) || limit < 1 || limit > 50) {
        return error('INVALID_ARGUMENT', 'limit must be 1..50', 400);
      }
      const rows = await env.DB.prepare(
        'SELECT player_id AS playerId, display_name AS displayName, score FROM ranking_entries '
        + 'WHERE game_id = ? AND board_id = ? ORDER BY score DESC, updated_at ASC, player_id ASC LIMIT ?'
      ).bind(gameId, boardId, limit).all<RankingEntry>();
      return json({ gameId, boardId, items: rows.results });
    }

    if (req.method === 'POST') {
      // IMPORTANT: Block test-only unauthenticated writes outside local mode.
      if (env.APP_ENV !== 'local') {
        return error('NOT_READY_FOR_PRODUCTION', 'Authentication not implemented', 403);
      }
      let value: unknown;
      try { value = await req.json(); }
      catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return error('INVALID_ARGUMENT', 'Object required', 400);
      }
      const input = value as Record<string, unknown>;
      const { gameId, playerId, displayName, score } = input;
      if (!validId(gameId) || !validId(playerId)
        || typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 40
        || !Number.isSafeInteger(score) || (score as number) < 0 || (score as number) > 1_000_000_000) {
        return error('INVALID_ARGUMENT', 'Invalid ranking payload', 400);
      }
      await env.DB.prepare(
        `INSERT INTO ranking_entries (game_id, board_id, player_id, display_name, score)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(game_id, board_id, player_id) DO UPDATE SET
           score = MAX(ranking_entries.score, excluded.score),
           display_name = excluded.display_name,
           updated_at = datetime('now')`
      ).bind(gameId, boardId, playerId, displayName, score).run();
      return json({ ok: true, gameId, boardId, playerId });
    }
  }
  return error('NOT_FOUND', 'Endpoint not found', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try { return await route(req, env); }
    catch (err) {
      // Intentionally do not leak database errors to the client.
      console.error('Unhandled Worker error', err);
      return error('INTERNAL_ERROR', 'Internal server error', 500);
    }
  }
};
