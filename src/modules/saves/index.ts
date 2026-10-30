// saves/index.ts — セーブのモジュール（PUT・GET /v1/saves/{slotId}）。
//
// どちらも APP_ENV=local の門 → トークン → gameId の形 → トークンのゲームとの突き合わせの順に確かめる（本文を読む前）。
// PUT はその後に本文の大きさ → JSON → 形（validate.ts）→ data の大きさ → チェックサム（checksum.ts）→ ゲームの登録と
// 機能の設定 → 書き込み（リビジョンを比べて書く 1 つの文。合わなければ 409 SAVE_CONFLICT）。GET は登録と設定の後に読む。
// プレイヤーはトークンの p だけで決める。data は解釈せず、ログにも出さない。順と SQL の正は docs/guides/working/save-design.md §3。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { requireAuth } from '../../core/auth';
import type { Env } from '../../core/env';
import { requireGame } from '../../core/games';
import { requireLocalWrite } from '../../core/guards';
import { error, json } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';
import type { TokenClaims } from '../../core/token';
import { sha256Hex } from './checksum';
import { MAX_REQUEST_BYTES, MAX_SAVE_BYTES } from './limits';
import { parseSaveWrite, utf8Size } from './validate';

type SaveRow = {
  revision: number;
  formatVersion: number;
  data: string;
  checksum: string;
  size: number;
  updatedAt: string;
};
type Written = { revision: number; updatedAt: string };

const slotPath = /^\/v1\/saves\/([a-zA-Z0-9_-]{1,64})$/;

// baseRevision = 0（初めて。行が無いか墓石の行）。V1 には墓石が無いが、V2 で文を変えずに済むよう同じ形にする（§3）
const insertFirst = `INSERT INTO saves (game_id, player_id, slot_id, revision, format_version, data, checksum, size)
  SELECT ?, ?, ?, 1, ?, ?, ?, ? WHERE true
  ON CONFLICT (game_id, player_id, slot_id) DO UPDATE SET
    revision = saves.revision + 1, deleted = 0, format_version = excluded.format_version, data = excluded.data,
    checksum = excluded.checksum, size = excluded.size, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE saves.deleted = 1
  RETURNING revision, updated_at AS updatedAt`;
// baseRevision >= 1（いまのリビジョンと同じときだけ進める）
const updateAt = `UPDATE saves SET revision = revision + 1, format_version = ?, data = ?, checksum = ?, size = ?,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE game_id = ? AND player_id = ? AND slot_id = ? AND revision = ? AND deleted = 0
  RETURNING revision, updated_at AS updatedAt`;

type Checked = { ok: true; claims: TokenClaims; gameId: string } | { ok: false; response: Response };

/** 本文を読む前の確かめ（門 → トークン → gameId → トークンのゲーム）。PUT と GET で同じ。 */
async function checkAccess(req: Request, env: Env, url: URL): Promise<Checked> {
  const blocked = requireLocalWrite(env);
  if (blocked) return { ok: false, response: blocked };
  const auth = await requireAuth(req, env);
  if (!auth.ok) return auth;
  const gameId = url.searchParams.get('gameId');
  if (!validId(gameId)) return { ok: false, response: error('INVALID_ARGUMENT', 'Invalid gameId', 400) };
  if (auth.claims.gameId !== gameId) {
    return { ok: false, response: error('PERMISSION_DENIED', 'Token does not match game', 403) };
  }
  return { ok: true, claims: auth.claims, gameId };
}

/** 本文を MAX_REQUEST_BYTES まで読む。超えれば null（Content-Length があれば読まずに断る）。 */
async function readBody(req: Request): Promise<string | null> {
  const length = req.headers.get('Content-Length');
  if (length !== null && Number(length) > MAX_REQUEST_BYTES) return null;
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength > MAX_REQUEST_BYTES) return null;
  return new TextDecoder().decode(bytes);
}

export const saves: GameModule = {
  name: 'saves',
  routes: [
    {
      method: 'PUT',
      pattern: slotPath,
      async handle(req, env, match, url, known) {
        const slotId = match[1];
        const access = await checkAccess(req, env, url);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const text = await readBody(req);
        if (text === null) return error('PAYLOAD_TOO_LARGE', 'Request body too large', 413);
        let value: unknown;
        try { value = JSON.parse(text); }
        catch { return error('INVALID_JSON', 'Request body must be JSON', 400); }
        const parsed = parseSaveWrite(value);
        if (!parsed.ok) return error('INVALID_ARGUMENT', parsed.message, 400);
        const { formatVersion, data, checksum, baseRevision } = parsed.value;
        const size = utf8Size(data);
        if (size > MAX_SAVE_BYTES) return error('PAYLOAD_TOO_LARGE', 'data too large', 413);
        if (await sha256Hex(data) !== checksum) return error('INVALID_ARGUMENT', 'checksum does not match data', 400);
        const unknown = await requireGame(env, gameId, saves.name, known);
        if (unknown) return unknown;
        const rows = baseRevision === 0
          ? await env.DB.prepare(insertFirst)
            .bind(gameId, claims.playerId, slotId, formatVersion, data, checksum, size).all<Written>()
          : await env.DB.prepare(updateAt)
            .bind(formatVersion, data, checksum, size, gameId, claims.playerId, slotId, baseRevision).all<Written>();
        const written = rows.results[0];
        if (!written) return error('SAVE_CONFLICT', 'baseRevision does not match the current revision', 409);
        return json({ gameId, slotId, revision: written.revision, formatVersion, checksum, size, updatedAt: written.updatedAt });
      },
    },
    {
      method: 'GET',
      pattern: slotPath,
      async handle(req, env, match, url, known) {
        const slotId = match[1];
        const access = await checkAccess(req, env, url);
        if (!access.ok) return access.response;
        const { gameId, claims } = access;
        const unknown = await requireGame(env, gameId, saves.name, known);
        if (unknown) return unknown;
        const rows = await env.DB.prepare(
          'SELECT revision, format_version AS formatVersion, data, checksum, size, updated_at AS updatedAt FROM saves '
          + 'WHERE game_id = ? AND player_id = ? AND slot_id = ? AND deleted = 0'
        ).bind(gameId, claims.playerId, slotId).all<SaveRow>();
        const row = rows.results[0];
        if (!row) return error('NOT_FOUND', 'Save not found', 404);
        return json({
          gameId, slotId, revision: row.revision, formatVersion: row.formatVersion,
          data: row.data, checksum: row.checksum, size: row.size, updatedAt: row.updatedAt,
        });
      },
    },
  ],
};
