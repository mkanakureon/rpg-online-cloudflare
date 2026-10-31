#!/usr/bin/env node
// admin-cli.mjs — ローカルの管理コマンド（管理の HTTP の口 /v1/admin/... を呼ぶだけ。D1 を直に触らない）。
//
// 呼び方: node scripts/admin-cli.mjs <操作> [引数] [--game <gameId>] [--actor <ラベル>]
//   player <playerId>                                  1 人のプレイヤーを読む（所持品・履歴・セーブの一覧・スコア・プレイヤーデータ・クエストの受け取り）
//   audit [--limit <n>] [--before <auditId>]            監査のログを新しい順に読む
//   grant <playerId> <itemId> <amount> --reason <理由> [--key <Idempotency-Key>]   付与（鍵を表示する。流し直しは --key で同じ鍵）
//   revoke <playerId> <itemId> <amount> --reason <理由> [--key <Idempotency-Key>]  取り消し（負の増減）
//   ban <playerId> --reason <理由> [--expires <ISO 8601 の UTC>]                   止める
//   unban <playerId> --reason <理由>                                               解く
//   delete-score <boardId> <playerId> --reason <理由>                              スコアを消す
//   put-item <itemId> <currency|item> --reason <理由>                              品目を入れる
//   put-event <eventId> <定義の JSON のファイル> [--reason <理由>]                 イベントの定義を入れる・置き換える
//   put-quest <questId> <定義の JSON のファイル> [--reason <理由>]                 クエストの定義を入れる・置き換える（見るキーと閾値つき）
//   put-data-key <key> <add|max|set|flag> <maxValue> [--max-delta <n>] --reason <理由>  プレイヤーデータのキーを宣言する（add は --max-delta が要る）
//   put-achievement <achievementId> <key> <threshold> --reason <理由>             実績を宣言する
//   set-data <playerId> <key> <value> --reason <理由>                              プレイヤーデータの値を置く（実績は判定しない）
//   revoke-achievement <playerId> <achievementId> --reason <理由>                  解いた実績を取り消す
//   smoke                                               通しの確かめ（docs/guides/working/admin-design.md §7。最後に PASS）
// 行き先は RPG_API_BASE（既定 http://127.0.0.1:8787。CLI モックと同じ）。X-Admin-Actor は --actor（既定 local-admin。OS の名前は使わない）。
// 管理の鍵は環境変数 ADMIN_API_KEY から読み、無ければ行き先が 127.0.0.1・localhost のときだけリポジトリの .dev.vars の ADMIN_API_KEY の行を
// 読む（読むだけ。作らない・書かない）。鍵は表示・記録しない。要求の形は scripts/admin-requests.mjs（試験と共有）。
// ゲームのクライアントの代わりの CLI モック（scripts/cli-mock.mjs）には管理の操作を入れない（管理の鍵を持たせない）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31
import { readFileSync } from 'node:fs';
import {
  DEFAULT_GAME_ID, adjustOp, adminRequest, auditOp, banOp, deleteScoreOp, newIdempotencyKey, playerOp, putAchievementOp, putDataKeyOp,
  putEventOp, putItemOp, putQuestOp, revokeAchievementOp, runSmoke, setDataOp, unbanOp
} from './admin-requests.mjs';

const base = process.env.RPG_API_BASE || 'http://127.0.0.1:8787';
const localHosts = ['127.0.0.1', 'localhost'];
/** X-Admin-Actor の既定（OS のユーザー名を使わない。admin-requests.mjs の DEFAULT_ACTOR と同じ値）。 */
const defaultActor = 'local-admin';

/** 引数を位置の引数と --名前 <値> に分ける。 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** 管理の鍵。環境変数 ADMIN_API_KEY、無ければローカルの行き先のときだけ .dev.vars の行（読むだけ）。 */
function loadAdminKey() {
  if (process.env.ADMIN_API_KEY) return process.env.ADMIN_API_KEY;
  if (!localHosts.includes(new URL(base).hostname)) return null;
  let text;
  try {
    text = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*ADMIN_API_KEY\s*=\s*(.*?)\s*$/.exec(line);
    if (m) return m[1].replace(/^(["'])(.*)\1$/, '$2') || null;
  }
  return null;
}

function required(value, name) {
  if (value === undefined || value === '') throw new Error(`missing ${name}`);
  return value;
}

function amountOf(raw) {
  const n = Number(required(raw, '<amount>'));
  if (!Number.isInteger(n) || n <= 0) throw new Error('<amount> must be a positive integer');
  return n;
}

/** min 以上の整数の引数。 */
function integerOf(raw, name, min) {
  const n = Number(required(raw, name));
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
}

/** 応答を表示する（管理の口の応答に鍵は入らない）。失敗の状態なら投げる。 */
async function show(op, res) {
  const body = await res.json();
  console.log(`${op.method} ${op.path}:`, res.status, JSON.stringify(body));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body;
}

async function send(adminKey, op, options) {
  return show(op, await fetch(adminRequest(base, adminKey, op, options)));
}

/** 定義の JSON のファイルを読む（読むだけ）。--reason があればファイルの reason より先に使う。 */
function definitionOf(file, flags) {
  const definition = JSON.parse(readFileSync(required(file, '<definition.json>'), 'utf8'));
  if (flags.reason !== undefined) definition.reason = flags.reason;
  required(definition.reason, '--reason (or "reason" in the definition file)');
  return definition;
}

/** 付与と取り消し。鍵を表示し、--key があればその鍵で流し直す。 */
async function adjust(adminKey, args, flags, sign, actor, gameId) {
  const [playerId, itemId, amount] = args;
  const op = adjustOp(required(playerId, '<playerId>'), required(itemId, '<itemId>'), sign * amountOf(amount),
    required(flags.reason, '--reason'), gameId);
  const idempotencyKey = flags.key ?? newIdempotencyKey();
  console.log(`Idempotency-Key: ${idempotencyKey}（流し直すときは --key ${idempotencyKey}）`);
  return send(adminKey, op, { actor, idempotencyKey });
}

const commands = {
  'player': (k, [playerId], _f, actor, gameId) => send(k, playerOp(required(playerId, '<playerId>'), gameId), { actor }),
  'audit': (k, _a, f, actor, gameId) => send(k, auditOp(gameId, {
    limit: f.limit === undefined ? undefined : Number(f.limit), before: f.before === undefined ? undefined : Number(f.before),
  }), { actor }),
  'grant': (k, a, f, actor, gameId) => adjust(k, a, f, 1, actor, gameId),
  'revoke': (k, a, f, actor, gameId) => adjust(k, a, f, -1, actor, gameId),
  'ban': (k, [playerId], f, actor, gameId) =>
    send(k, banOp(required(playerId, '<playerId>'), required(f.reason, '--reason'), f.expires, gameId), { actor }),
  'unban': (k, [playerId], f, actor, gameId) =>
    send(k, unbanOp(required(playerId, '<playerId>'), required(f.reason, '--reason'), gameId), { actor }),
  'delete-score': (k, [boardId, playerId], f, actor, gameId) =>
    send(k, deleteScoreOp(required(boardId, '<boardId>'), required(playerId, '<playerId>'), required(f.reason, '--reason'), gameId), { actor }),
  'put-item': (k, [itemId, kind], f, actor, gameId) =>
    send(k, putItemOp(required(itemId, '<itemId>'), required(kind, '<kind>'), required(f.reason, '--reason'), gameId), { actor }),
  'put-event': (k, [eventId, file], f, actor, gameId) =>
    send(k, putEventOp(required(eventId, '<eventId>'), definitionOf(file, f), gameId), { actor }),
  'put-quest': (k, [questId, file], f, actor, gameId) =>
    send(k, putQuestOp(required(questId, '<questId>'), definitionOf(file, f), gameId), { actor }),
  'put-data-key': (k, [key, mode, maxValue], f, actor, gameId) =>
    send(k, putDataKeyOp(required(key, '<key>'), {
      mode: required(mode, '<mode>'), maxValue: integerOf(maxValue, '<maxValue>', 1),
      maxDelta: f['max-delta'] === undefined ? undefined : integerOf(f['max-delta'], '--max-delta', 1),
    }, required(f.reason, '--reason'), gameId), { actor }),
  'put-achievement': (k, [achievementId, key, threshold], f, actor, gameId) =>
    send(k, putAchievementOp(required(achievementId, '<achievementId>'), required(key, '<key>'), integerOf(threshold, '<threshold>', 1),
      required(f.reason, '--reason'), gameId), { actor }),
  'set-data': (k, [playerId, key, value], f, actor, gameId) =>
    send(k, setDataOp(required(playerId, '<playerId>'), required(key, '<key>'), integerOf(value, '<value>', 0),
      required(f.reason, '--reason'), gameId), { actor }),
  'revoke-achievement': (k, [playerId, achievementId], f, actor, gameId) =>
    send(k, revokeAchievementOp(required(playerId, '<playerId>'), required(achievementId, '<achievementId>'), required(f.reason, '--reason'),
      gameId), { actor }),
  'smoke': async (k, _a, _f, actor) => {
    await runSmoke({
      send: (request) => fetch(request), baseUrl: base, adminKey: k, actor,
      log: (step, status, body) => console.log(`${step}:`, status, JSON.stringify(body)),
    });
    console.log('PASS');
  },
};

const usage = `usage: node scripts/admin-cli.mjs <${Object.keys(commands).join('|')}> [args] [--game <gameId>] [--actor <label>]`;

try {
  const [name, ...rest] = process.argv.slice(2);
  const run = commands[name];
  if (!run) {
    console.error(usage);
    process.exit(2);
  }
  const { positional, flags } = parseArgs(rest);
  const adminKey = loadAdminKey();
  if (!adminKey) {
    throw new Error('ADMIN_API_KEY is not set (set the environment variable, or write it in .dev.vars for a local target)');
  }
  await run(adminKey, positional, flags, flags.actor ?? defaultActor, flags.game ?? DEFAULT_GAME_ID);
} catch (e) {
  console.error('FAIL:', e instanceof Error ? e.message : e);
  process.exit(1);
}
