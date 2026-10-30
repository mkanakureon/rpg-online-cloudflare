// config/index.ts — 設定配信のモジュール（GET /v1/config・GET /v1/config/master/{key}）。
//
// GET /v1/config は機能フラグ・クライアントの版・マスターデータのキーと大きさの一覧（masterData）を返す。
// マスターデータの中身はキーごとに GET /v1/config/master/{key} で返す（サーバーは中身を解釈しない文字列のまま）。
// 読むだけ（書き換えの口は無い）で、トークンも APP_ENV の守りも掛けない（公開の情報。秘密を入れない）。
// 設定の検査の順: gameId の形 → clientVersion の形 → ゲームの登録と機能の設定（config）→ 表を引く → ETag と If-None-Match（304）。
// マスターデータの検査の順: キーの形（ルートの pattern。外れは 404 Endpoint not found）→ gameId の形 → ゲームの登録と機能の設定
// → 表を引く（無ければ 404 Master data not found）→ ETag と If-None-Match（304）。
// masterData はマスターデータが 1 つも無いゲームでは載せない（C1 の形の応答のまま。スキーマで必須にしない）。
// 200 と 304 は jsonHeaders を広げて cache-control: no-cache と etag を付ける（エラーは error() のまま no-store）。
// 表の版が形に合わなければマイグレーションの誤りとして throw し、入口の try/catch で 500 にする。
// 設計の正は docs/guides/working/config-design.md §3、形の正は docs/api-contract.md と openapi/rpg-online.v1.json。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import { requireGame } from '../../core/games';
import { error, jsonHeaders } from '../../core/http';
import { validId } from '../../core/ids';
import type { GameModule } from '../../core/module';
import { etagOf, matchesIfNoneMatch } from './etag';
import { parseVersion, updateStatus } from './version';

/** 表の版を数の配列にする。NULL は null、形の外れは throw（500）。 */
function storedVersion(text: string | null): number[] | null {
  if (text === null) return null;
  const parsed = parseVersion(text);
  if (!parsed) throw new Error('Invalid client version in game_configs');
  return parsed;
}

/** 本文に ETag と no-cache を付けて返す。If-None-Match が合えば本文の無い 304。 */
async function cachedJson(req: Request, body: string): Promise<Response> {
  const etag = await etagOf(body);
  if (matchesIfNoneMatch(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: { 'cache-control': 'no-cache', etag } });
  }
  return new Response(body, { status: 200, headers: { ...jsonHeaders, 'cache-control': 'no-cache', etag } });
}

export const config: GameModule = {
  name: 'config',
  routes: [
    {
      method: 'GET',
      pattern: /^\/v1\/config$/,
      async handle(req, env, _match, url, known) {
        const gameId = url.searchParams.get('gameId');
        if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
        const rawVersion = url.searchParams.get('clientVersion');
        const client = rawVersion === null ? null : parseVersion(rawVersion);
        if (rawVersion !== null && !client) return error('INVALID_ARGUMENT', 'Invalid clientVersion', 400);
        const unknown = await requireGame(env, gameId, config.name, known);
        if (unknown) return unknown;

        const versions = await env.DB.prepare(
          'SELECT min_client_version, latest_client_version FROM game_configs WHERE game_id = ?'
        ).bind(gameId).all<{ min_client_version: string | null; latest_client_version: string | null }>();
        const flagRows = await env.DB.prepare(
          'SELECT name, enabled FROM config_flags WHERE game_id = ? ORDER BY name ASC'
        ).bind(gameId).all<{ name: string; enabled: number }>();
        const masterRows = await env.DB.prepare(
          'SELECT key, length(CAST(data AS BLOB)) AS size FROM config_master_data WHERE game_id = ? ORDER BY key ASC'
        ).bind(gameId).all<{ key: string; size: number }>();
        const row = versions.results[0];
        const minimum = row?.min_client_version ?? null;
        const latest = row?.latest_client_version ?? null;
        const flags = Object.fromEntries(flagRows.results.map((f) => [f.name, f.enabled === 1]));
        const masterData = masterRows.results.map((m) => ({ key: m.key, size: m.size }));
        return cachedJson(req, JSON.stringify({
          gameId,
          clientVersion: { minimum, latest, update: updateStatus(client, storedVersion(minimum), storedVersion(latest)) },
          flags,
          ...(masterData.length > 0 ? { masterData } : {}),
        }));
      },
    },
    {
      method: 'GET',
      pattern: /^\/v1\/config\/master\/([a-zA-Z0-9_-]{1,64})$/,
      async handle(req, env, match, url, known) {
        const key = match[1];
        const gameId = url.searchParams.get('gameId');
        if (!validId(gameId)) return error('INVALID_ARGUMENT', 'Invalid gameId', 400);
        const unknown = await requireGame(env, gameId, config.name, known);
        if (unknown) return unknown;

        const rows = await env.DB.prepare(
          'SELECT data FROM config_master_data WHERE game_id = ? AND key = ?'
        ).bind(gameId, key).all<{ data: string }>();
        const row = rows.results[0];
        if (!row) return error('NOT_FOUND', 'Master data not found', 404);
        return cachedJson(req, JSON.stringify({ gameId, key, data: row.data }));
      },
    },
  ],
};
