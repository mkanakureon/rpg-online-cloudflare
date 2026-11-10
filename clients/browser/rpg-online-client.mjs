// rpg-online-client.mjs — ブラウザの SDK（依存の無い ES モジュール）。ゲームのクライアントの口 20 個・タイムアウト・再試行・Retry-After・画面の文の種類・トークンの更新。
//
// 決まりの正はスキーマ openapi/rpg-online.v1.json の x-client-policy と各操作の x-retry（設計は
// docs/guides/working/client-integration-design.md §2〜§5）。ブラウザで JSON を取りに行かないため、値はここへ書き写す。
// 食い違いは試験「SDKの決まりの値はスキーマのクライアントの決まりと一致する」（test/browser-sdk.test.ts）が見る。
// 再試行は request() の 1 か所だけで決め、操作の関数には書かない。失敗は例外にせず { ok: false, error } で返す。
// ブラウザ・Node.js（scripts/cli-flow.mjs）・Workers のランタイム（vitest）のどれでも読めるよう、scripts/ と Node.js だけの部品を読み込まない。
// 自分で console に出さない（ログは createClient の log の口だけ）。トークンは storage にだけ置き、結果にもログにも出さない。型は rpg-online-client.d.mts。
// トークンの要る要求の前に、期限までの残りが tokenRefreshBeforeSeconds（7 日）を切っていれば POST /v1/accounts/token で更新する（設計書 §2.7）。
// 期限切れ・壊れたトークン（TOKEN_EXPIRED・UNAUTHENTICATED）は session の結果を返すだけで、ゲストを自動で発行し直さない。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

/** 3 つのクライアントで共通の決まり（スキーマの x-client-policy から description を除いて書き写したもの）。 */
export const CLIENT_POLICY = Object.freeze({
  timeoutSeconds: 10,
  maxAttempts: 3,
  backoff: Object.freeze({ baseSeconds: 1, factor: 2, maxSeconds: 8, jitter: 'full' }),
  retryAfter: Object.freeze({ maxWaitSeconds: 60, maxRetries: 1 }),
  retryStatuses: Object.freeze([429, 500, 502, 503, 504]),
  tokenRefreshBeforeSeconds: 604800,
  errorCatalog: Object.freeze({
    INVALID_ARGUMENT: { category: 'client-bug', retry: false },
    INVALID_JSON: { category: 'client-bug', retry: false },
    PERMISSION_DENIED: { category: 'client-bug', retry: false },
    IDEMPOTENCY_KEY_REUSED: { category: 'client-bug', retry: false },
    PAYLOAD_TOO_LARGE: { category: 'client-bug', retry: false },
    NOT_FOUND: { category: 'not-found', retry: false },
    NOT_READY_FOR_PRODUCTION: { category: 'unavailable', retry: false },
    INTERNAL_ERROR: { category: 'network', retry: true },
    RATE_LIMITED: { category: 'busy', retry: true },
    UNAUTHENTICATED: { category: 'session', retry: false },
    TOKEN_EXPIRED: { category: 'session', retry: false },
    PLAYER_BANNED: { category: 'banned', retry: false },
    SAVE_CONFLICT: { category: 'conflict', retry: false },
    SLOT_LIMIT_EXCEEDED: { category: 'limit', retry: false },
    INVENTORY_LIMIT_EXCEEDED: { category: 'limit', retry: false },
    PLAYER_DATA_LIMIT_EXCEEDED: { category: 'limit', retry: false },
    RANKING_LIMIT_EXCEEDED: { category: 'limit', retry: false },
    EVENT_NOT_ACTIVE: { category: 'expired', retry: false },
    QUEST_NOT_ACTIVE: { category: 'expired', retry: false },
    QUEST_NOT_COMPLETED: { category: 'not-ready', retry: false },
  }),
});

/** 操作ごとの再試行の種類（スキーマの各操作の x-retry。設計書 §2.2）。 */
export const OPERATION_RETRY = Object.freeze({
  getHealth: 'safe',
  issueGuest: 'new-resource',
  listAnnouncements: 'safe',
  getRanking: 'safe',
  submitScore: 'natural-key',
  listSaves: 'safe',
  getSave: 'safe',
  putSave: 'revision',
  deleteSave: 'revision',
  getConfig: 'safe',
  getMasterData: 'safe',
  getInventory: 'safe',
  listInventoryHistory: 'safe',
  listEvents: 'safe',
  claimEventReward: 'natural-key',
  getPlayerData: 'safe',
  writePlayerData: 'idempotency-key',
  listQuests: 'safe',
  claimQuest: 'natural-key',
  refreshToken: 'new-resource',
});

/** §4 の同一の API シナリオの手順の名前（順。6 のトークンの更新は B3 で足した）。Unity・Unreal も同じ名前で書く。 */
export const SCENARIO_STEPS = Object.freeze([
  'health', 'config', 'master-data', 'announcements', 'guest', 'token-refresh', 'ranking', 'saves', 'event-reward', 'player-data', 'quests',
]);

/** シナリオが使う demo-rpg の手本（migrations の初期データ。scripts/cli-requests.mjs の SMOKE_* と同じ値）。 */
export const SCENARIO_DEFAULTS = Object.freeze({
  clientVersion: '1.0.0',
  boardPrefix: 'boss-score',
  displayName: 'Mac CLI Tester',
  score: 1200,
  slotId: 'cli-smoke',
  eventId: 'daily-login',
  playerDataKey: 'slimes-defeated',
  achievementId: 'first-slime',
  questId: 'first-hunt',
});

/**
 * エラーのコードと状態コードから画面の文の種類を決める（設計書 §2.5）。
 * 表にあるコードは表の種類。表に無いコードと JSON でない 4xx は unknown。コードの無い回線断・タイムアウト・5xx は network。
 */
export function categorize(status, code) {
  if (typeof code === 'string' && code !== '') return CLIENT_POLICY.errorCatalog[code]?.category ?? 'unknown';
  if (status === null || status === undefined || status >= 500) return 'network';
  if (status === 429) return 'busy';
  return 'unknown';
}

/** 再試行の n 回目（1 から）の前に待つ上限の秒（基本 × 倍率の n-1 乗・上限で頭打ち）。 */
export function backoffCapSeconds(retryNumber) {
  const { baseSeconds, factor, maxSeconds } = CLIENT_POLICY.backoff;
  return Math.min(maxSeconds, baseSeconds * factor ** (retryNumber - 1));
}

/** Retry-After の見出しの値を秒（1〜60）にする。無い・数でない・0・上限を超えるときは null（待たずに返す。設計書 §2.3）。 */
export function parseRetryAfter(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const seconds = Number(value.trim());
  return seconds >= 1 && seconds <= CLIENT_POLICY.retryAfter.maxWaitSeconds ? seconds : null;
}

/** text の UTF-8 のバイト列の SHA-256 を小文字の 16 進で返す（セーブの checksum）。 */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 止められる待ち（既定の sleep）。signal が止まったら待ちを解いて解決する。 */
function realSleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

/** 既定の storage（その場の入れ物。ブラウザでは localStorage を渡す）。 */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const TIMED_OUT = Symbol('timeout');
const enc = encodeURIComponent;

/**
 * SDK の入口。fetch・sleep・now・random・storage・log を差し替えられる（試験で実時間を待たずに確かめるため）。
 * sleep(ms, signal) は ms ミリ秒待つ Promise を返し、signal が止まったら早めに解決してよい。log は要求ごとの記録（トークンと本文を含まない）を受ける。
 */
export function createClient(options = {}) {
  const {
    baseUrl = 'http://127.0.0.1:8787',
    gameId = 'demo-rpg',
    fetch: fetchImpl = (url, init) => globalThis.fetch(url, init),
    sleep = realSleep,
    now = () => Date.now(),
    random = Math.random,
    storage = memoryStorage(),
    log = () => {},
  } = options;
  const root = baseUrl.replace(/\/+$/, '');
  const sessionKey = `rpg-online:${gameId}:session`;

  function readSession() {
    try {
      const raw = storage.getItem(sessionKey);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed.token === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  /** 応答の本文（gameId・playerId・token・expiresAt）を storage に置き、トークンを除いた本文を返す。 */
  function storeSession(data) {
    const { token, ...rest } = data;
    storage.setItem(sessionKey, JSON.stringify({ ...rest, token }));
    return rest;
  }

  /** 保存したトークンの期限まで tokenRefreshBeforeSeconds を切っているか（期限の読めないトークンは更新しない）。 */
  function needsRefresh(session) {
    const expiresAt = Date.parse(session.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt - now() < CLIENT_POLICY.tokenRefreshBeforeSeconds * 1000;
  }

  // 同時に送った要求が更新を重ねて送らないよう、進行中の更新を 1 つだけ持つ
  let refreshing = null;
  function refreshOnce() {
    refreshing ??= (async () => {
      try {
        const res = await request('refreshToken', { method: 'POST', path: '/v1/accounts/token', auth: true, skipRefresh: true });
        if (!res.ok || !res.data) return res;
        return { ...res, data: storeSession(res.data) };
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  function emit(event) {
    try { log(event); } catch { /* ログの口の失敗で送り方を変えない */ }
  }

  /** 1 回だけ送り、本文を読み終えるまでをタイムアウトで切る。応答か { failure: 'timeout' | 'network' } を返す。 */
  async function sendOnce(url, init) {
    const controller = new AbortController();
    const timer = new AbortController();
    const work = (async () => {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      const text = res.status === 304 ? '' : await res.text();
      return { status: res.status, headers: res.headers, text };
    })();
    work.catch(() => {});
    const timeout = Promise.resolve(sleep(CLIENT_POLICY.timeoutSeconds * 1000, timer.signal)).then(() => TIMED_OUT);
    try {
      const outcome = await Promise.race([work, timeout]);
      if (outcome === TIMED_OUT) {
        controller.abort();
        return { failure: 'timeout' };
      }
      return outcome;
    } catch {
      return { failure: 'network' };
    } finally {
      timer.abort();
    }
  }

  /**
   * 操作を 1 つ送る。再試行・Retry-After・画面の文の種類はここだけで決める（設計書 §2.1〜§2.5）。
   * 成功は { ok: true, status, data, etag, attempts }、失敗は { ok: false, error: { code, category, status, retryable, reason, outcomeUnknown }, attempts }。
   */
  async function request(operationId, { method = 'GET', path, query, body, auth = false, headers: extra = {}, skipRefresh = false }) {
    const kind = OPERATION_RETRY[operationId];
    const autoRetry = kind !== undefined && kind !== 'revision';
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) qs.set(k, String(v));
    const queryText = qs.toString();
    const pathWithQuery = queryText ? `${path}?${queryText}` : path;
    const headers = { ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      let session = readSession();
      if (!session) {
        return { ok: false, attempts: 0, error: { code: null, category: 'session', status: null, retryable: false, reason: 'no-session', outcomeUnknown: false } };
      }
      if (!skipRefresh && needsRefresh(session)) {
        const refreshed = await refreshOnce();
        // 期限切れ・壊れたトークンは更新できない。ゲストを発行し直さず session を返す（§2.7）。
        // ほかの失敗（回線・混雑など）は、まだ期限の前のトークンでそのまま送る（次の要求でまた更新を試す）
        if (!refreshed.ok && refreshed.error.category === 'session') return refreshed;
        session = readSession() ?? session;
      }
      headers.Authorization = 'Bearer ' + session.token;
    }
    const init = { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) };
    let attempts = 0;
    let rateLimitRetries = 0;
    for (;;) {
      attempts += 1;
      const started = now();
      const outcome = await sendOnce(root + pathWithQuery, init);
      const status = outcome.failure ? null : outcome.status;
      emit({ operationId, method, path: pathWithQuery, attempt: attempts, status, reason: outcome.failure ?? null, durationMs: now() - started });

      if (!outcome.failure && ((status >= 200 && status < 300) || status === 304)) {
        let data = null;
        if (outcome.text !== '') {
          try { data = JSON.parse(outcome.text); } catch { data = null; }
        }
        return { ok: true, status, data, etag: outcome.headers.get('etag'), attempts };
      }

      let code = null;
      if (!outcome.failure) {
        try {
          const parsed = JSON.parse(outcome.text);
          if (parsed && typeof parsed.error?.code === 'string') code = parsed.error.code;
        } catch { /* JSON でない応答は状態コードだけで扱う（§2.4） */ }
      }
      const category = categorize(status, code);
      const reason = outcome.failure ?? (code ? `HTTP ${status} ${code}` : `HTTP ${status}`);
      // 決まりの上で再試行してよい失敗か（コードが表にあれば表の retry、コードが無ければ回線断・タイムアウトと再試行する状態）
      const retryableByPolicy = code !== null
        ? CLIENT_POLICY.errorCatalog[code]?.retry === true
        : outcome.failure !== undefined || CLIENT_POLICY.retryStatuses.includes(status);
      const fail = (extraReason) => ({
        ok: false,
        attempts,
        error: {
          code,
          category,
          status,
          retryable: autoRetry && retryableByPolicy,
          reason: extraReason ? `${reason} (${extraReason})` : reason,
          // revision の操作が通信の失敗・5xx で終わったら、書けたかどうか分からない（§2.4。confirmSave で読み直す）
          outcomeUnknown: kind === 'revision' && category === 'network',
        },
      });

      if (!autoRetry || !retryableByPolicy) return fail(kind === 'revision' && category === 'network' ? 'not retried: revision' : '');
      if (attempts >= CLIENT_POLICY.maxAttempts) return fail(`gave up after ${attempts} attempts`);

      let waitMs;
      if (status === 429) {
        const seconds = parseRetryAfter(outcome.headers.get('retry-after'));
        if (seconds === null) return fail('no usable Retry-After');
        if (rateLimitRetries >= CLIENT_POLICY.retryAfter.maxRetries) return fail('rate limited again');
        rateLimitRetries += 1;
        waitMs = seconds * 1000;
      } else {
        const cap = backoffCapSeconds(attempts) * 1000;
        waitMs = CLIENT_POLICY.backoff.jitter === 'full' ? Math.round(random() * cap) : cap;
      }
      emit({ operationId, method, path: pathWithQuery, attempt: attempts, status, reason: 'retry-wait', waitMs });
      await sleep(waitMs);
    }
  }

  const client = {
    gameId,

    /** 保存したセッション（トークンを除く）。無ければ null。 */
    session() {
      const s = readSession();
      return s ? { gameId: s.gameId, playerId: s.playerId, expiresAt: s.expiresAt } : null;
    },
    /** 保存したセッションを消す（ゲームが「新しく始める」を選んだとき）。 */
    clearSession() { storage.removeItem(sessionKey); },

    getHealth: () => request('getHealth', { path: '/health' }),

    /** ゲストを発行し、トークンを storage に置く。結果の data にトークンは入れない。 */
    async issueGuest() {
      const res = await request('issueGuest', { method: 'POST', path: '/v1/accounts/guest', body: { gameId } });
      if (!res.ok || !res.data) return res;
      return { ...res, data: storeSession(res.data) };
    },
    /**
     * 保存したトークンを、期限を 30 日先にした新しいトークンに取り替えて storage に置く（POST /v1/accounts/token）。結果の data にトークンは入れない。
     * トークンの要る要求の前に、期限まで 7 日を切っていれば SDK が自分で呼ぶ。期限切れ・壊れたトークンは session の結果になる。
     */
    refreshToken: () => refreshOnce(),

    listAnnouncements: () => request('listAnnouncements', { path: '/v1/announcements', query: { gameId } }),

    getRanking: (boardId, { limit } = {}) => request('getRanking', { path: `/v1/rankings/${enc(boardId)}`, query: { gameId, limit } }),
    submitScore(boardId, { score, displayName, playerId } = {}) {
      const pid = playerId ?? readSession()?.playerId;
      return request('submitScore', {
        method: 'POST', path: `/v1/rankings/${enc(boardId)}`, auth: true, body: { gameId, playerId: pid, displayName, score },
      });
    },

    listSaves: () => request('listSaves', { path: '/v1/saves', query: { gameId }, auth: true }),
    getSave: (slotId) => request('getSave', { path: `/v1/saves/${enc(slotId)}`, query: { gameId }, auth: true }),
    putSave: (slotId, { formatVersion = 1, data, checksum, baseRevision }) => request('putSave', {
      method: 'PUT', path: `/v1/saves/${enc(slotId)}`, query: { gameId }, auth: true, body: { formatVersion, data, checksum, baseRevision },
    }),
    deleteSave: (slotId, baseRevision) => request('deleteSave', {
      method: 'DELETE', path: `/v1/saves/${enc(slotId)}`, query: { gameId, baseRevision }, auth: true,
    }),
    /**
     * 結果が分からない（outcomeUnknown）セーブの書き込み・削除を読み直して確かめる（設計書 §2.4）。
     * expected が null なら消えている（404）こと、そうでなければ revision と checksum が同じことを見る。
     */
    async confirmSave(slotId, expected) {
      const res = await client.getSave(slotId);
      if (expected === null) return { ok: true, confirmed: !res.ok && res.error.status === 404 };
      if (!res.ok) return { ok: res.error.status === 404, confirmed: false, error: res.error };
      return { ok: true, confirmed: res.data.revision === expected.revision && res.data.checksum === expected.checksum };
    },

    getConfig: ({ clientVersion, etag } = {}) => request('getConfig', {
      path: '/v1/config', query: { gameId, clientVersion }, headers: etag ? { 'If-None-Match': etag } : {},
    }),
    getMasterData: (key, { etag } = {}) => request('getMasterData', {
      path: `/v1/config/master/${enc(key)}`, query: { gameId }, headers: etag ? { 'If-None-Match': etag } : {},
    }),

    getInventory: () => request('getInventory', { path: '/v1/inventory', query: { gameId }, auth: true }),
    listInventoryHistory: ({ limit, before } = {}) => request('listInventoryHistory', {
      path: '/v1/inventory/history', query: { gameId, limit, before }, auth: true,
    }),
    /** 受領の履歴を nextBefore が無くなるまで読む（設計書 §2.6。1 回の呼び出しで読むページの上限は maxPages）。 */
    async readAllInventoryHistory({ limit = 100, maxPages = 10 } = {}) {
      const items = [];
      let before;
      let pages = 0;
      for (;;) {
        const res = await client.listInventoryHistory({ limit, before });
        pages += 1;
        if (!res.ok) return { ...res, pages };
        items.push(...res.data.items);
        before = res.data.nextBefore;
        if (before === undefined) return { ok: true, status: res.status, data: { gameId: res.data.gameId, items }, pages, complete: true };
        if (pages >= maxPages) return { ok: true, status: res.status, data: { gameId: res.data.gameId, items, nextBefore: before }, pages, complete: false };
      }
    },

    listEvents: () => request('listEvents', { path: '/v1/events', query: { gameId }, auth: true }),
    claimEventReward: (eventId) => request('claimEventReward', {
      method: 'POST', path: `/v1/events/${enc(eventId)}/claim`, query: { gameId }, auth: true,
    }),

    getPlayerData: () => request('getPlayerData', { path: '/v1/player-data', query: { gameId }, auth: true }),
    /** 呼び出しごとに新しい Idempotency-Key（crypto.randomUUID()）を作る。再試行では同じ鍵を使う。同じ書き込みを送り直すときだけ鍵を渡す。 */
    writePlayerData: (changes, { idempotencyKey = crypto.randomUUID() } = {}) => request('writePlayerData', {
      method: 'POST', path: '/v1/player-data', query: { gameId }, auth: true, body: { changes }, headers: { 'Idempotency-Key': idempotencyKey },
    }),

    listQuests: () => request('listQuests', { path: '/v1/quests', query: { gameId }, auth: true }),
    claimQuest: (questId) => request('claimQuest', {
      method: 'POST', path: `/v1/quests/${enc(questId)}/claim`, query: { gameId }, auth: true,
    }),
  };
  return client;
}

/**
 * §4 の同一の API シナリオを流す（scripts/cli-mock.mjs の通しと同じ順と確かめ）。手順の名前は SCENARIO_STEPS。
 * 失敗した手順で止まり、{ ok, steps: [{ name, ok, detail }], failed?: { name, category, reason } } を返す（例外にしない）。
 * トークンとセーブの本体は結果に入れない。
 */
export async function runScenario(client, options = {}) {
  const o = { ...SCENARIO_DEFAULTS, ...options };
  const steps = [];
  class StepFailure {
    constructor(category, reason) { this.category = category; this.reason = reason; }
  }
  /** SDK の結果を確かめる。失敗なら手順を止める。 */
  const need = (res, what) => {
    if (!res.ok) throw new StepFailure(res.error.category, `${what}: ${res.error.reason}`);
    return res;
  };
  const check = (cond, reason) => { if (!cond) throw new StepFailure('unknown', reason); };

  const plan = {
    health: async () => {
      const res = need(await client.getHealth(), 'GET /health');
      check(res.data?.status === 'ok', 'Health check failed');
      return 'ok';
    },
    config: async () => {
      const first = need(await client.getConfig({ clientVersion: o.clientVersion }), 'GET /v1/config');
      check(first.status === 200 && first.etag, 'Config could not be read');
      check(first.data.clientVersion.update !== 'required', 'Client version is older than the minimum');
      o.config = first.data;
      const again = need(await client.getConfig({ clientVersion: o.clientVersion, etag: first.etag }), 'GET /v1/config (If-None-Match)');
      check(again.status === 304, 'Unchanged config was sent again (expected 304)');
      return '200 then 304';
    },
    'master-data': async () => {
      const [firstMaster] = o.config?.masterData ?? [];
      if (!firstMaster) return 'none (skipped)';
      const res = need(await client.getMasterData(firstMaster.key), 'GET /v1/config/master');
      const size = typeof res.data?.data === 'string' ? new TextEncoder().encode(res.data.data).length : null;
      check(size === firstMaster.size, 'Master data does not match the size in the config');
      return `${firstMaster.key} size=${size}`;
    },
    announcements: async () => {
      const res = need(await client.listAnnouncements(), 'GET /v1/announcements');
      return `${res.data.items.length} items`;
    },
    guest: async () => {
      const res = need(await client.issueGuest(), 'POST /v1/accounts/guest');
      o.playerId = res.data.playerId;
      o.expiresAt = res.data.expiresAt;
      return `player issued (expiresAt=${res.data.expiresAt})`;
    },
    'token-refresh': async () => {
      const res = need(await client.refreshToken(), 'POST /v1/accounts/token');
      check(res.data.playerId === o.playerId && res.data.gameId === client.gameId, 'Refreshed token is for a different player');
      check(Date.parse(res.data.expiresAt) >= Date.parse(o.expiresAt), 'Refreshed token expires earlier than the issued one');
      return `same player (expiresAt=${res.data.expiresAt})`;
    },
    ranking: async () => {
      const boardId = o.boardId ?? `${o.boardPrefix}-${Math.floor(o.now ?? Date.now()).toString(36)}`;
      need(await client.submitScore(boardId, { score: o.score, displayName: o.displayName }), 'POST /v1/rankings');
      const res = need(await client.getRanking(boardId, { limit: 10 }), 'GET /v1/rankings');
      check(res.data.items.some((e) => e.playerId === o.playerId && e.score >= o.score), 'Submitted score not found in top 10');
      return `${boardId} found`;
    },
    saves: async () => {
      const data = JSON.stringify({ hp: 30, map: 'town' });
      const checksum = await sha256Hex(data);
      const written = need(await client.putSave(o.slotId, { formatVersion: 1, data, checksum, baseRevision: 0 }), 'PUT /v1/saves');
      const loaded = need(await client.getSave(o.slotId), 'GET /v1/saves/{slotId}');
      check(loaded.data.data === data && loaded.data.checksum === checksum && loaded.data.revision === written.data.revision
        && await sha256Hex(loaded.data.data) === loaded.data.checksum, 'Loaded save does not match the written one');
      const listed = need(await client.listSaves(), 'GET /v1/saves');
      const slot = listed.data.items.find((item) => item.slotId === o.slotId);
      check(slot, 'Written save not found in the save list');
      need(await client.deleteSave(o.slotId, slot.revision), 'DELETE /v1/saves');
      const gone = await client.getSave(o.slotId);
      check(!gone.ok && gone.error.status === 404, 'Deleted save is still readable');
      return `revision=${written.data.revision} written, read, listed, deleted`;
    },
    'event-reward': async () => {
      const listed = need(await client.listEvents(), 'GET /v1/events');
      if (listed.data.items.length === 0) return 'none (skipped)';
      const event = listed.data.items.find((item) => item.eventId === o.eventId);
      check(event && event.claimed === false, `Event ${o.eventId} is not open and unclaimed`);
      const goldOf = (inv) => inv.currencies.find((c) => c.itemId === 'gold')?.amount ?? 0;
      const claimed = need(await client.claimEventReward(o.eventId), 'POST /v1/events/{eventId}/claim');
      const granted = claimed.data.grants.find((g) => g.itemId === 'gold')?.amount ?? 0;
      const afterFirst = need(await client.getInventory(), 'GET /v1/inventory');
      check(granted > 0 && goldOf(afterFirst.data) === granted, 'Claimed gold is not in the inventory');
      const again = need(await client.claimEventReward(o.eventId), 'POST /v1/events/{eventId}/claim (again)');
      check(again.data.claimId === claimed.data.claimId, 'Second claim returned a different claimId');
      const afterSecond = need(await client.getInventory(), 'GET /v1/inventory');
      check(goldOf(afterSecond.data) === granted, 'Second claim granted the reward twice');
      const history = need(await client.readAllInventoryHistory({ limit: 20 }), 'GET /v1/inventory/history');
      check(history.data.items.length === claimed.data.grants.length && history.data.items.every((i) => i.sourceId === claimed.data.claimId),
        'Inventory history does not have exactly the claimed rows');
      return `gold +${granted} once (serverTime=${listed.data.serverTime})`;
    },
    'player-data': async () => {
      const before = need(await client.getPlayerData(), 'GET /v1/player-data');
      check(before.data.values.length === 0 && before.data.achievements.length === 0, 'New guest already has player data');
      const idempotencyKey = crypto.randomUUID();
      const changes = [{ key: o.playerDataKey, value: 1 }];
      const written = need(await client.writePlayerData(changes, { idempotencyKey }), 'POST /v1/player-data');
      const valueOf = (body) => body.values.find((v) => v.key === o.playerDataKey)?.value;
      check(valueOf(written.data) === 1 && written.data.unlocked.some((a) => a.achievementId === o.achievementId),
        `Writing ${o.playerDataKey} did not unlock ${o.achievementId}`);
      const resent = need(await client.writePlayerData(changes, { idempotencyKey }), 'POST /v1/player-data (resend)');
      check(JSON.stringify(resent.data) === JSON.stringify(written.data), 'Resent player data write returned a different body');
      const after = need(await client.getPlayerData(), 'GET /v1/player-data');
      check(valueOf(after.data) === 1, 'Resent player data write was counted twice');
      check(after.data.achievements.filter((a) => a.achievementId === o.achievementId).length === 1,
        `Achievement ${o.achievementId} is not unlocked exactly once`);
      return `${o.playerDataKey}=1 once, ${o.achievementId} unlocked`;
    },
    quests: async () => {
      const questOf = (body) => body.items.find((item) => item.questId === o.questId);
      const before = need(await client.listQuests(), 'GET /v1/quests');
      const quest = questOf(before.data);
      check(quest && quest.completed === true && quest.claimed === false, `Quest ${o.questId} is not completed and unclaimed`);
      const claimed = need(await client.claimQuest(o.questId), 'POST /v1/quests/{questId}/claim');
      check(claimed.data.grants.some((g) => g.itemId === 'gold' && g.amount > 0), `Quest ${o.questId} granted no gold`);
      const again = need(await client.claimQuest(o.questId), 'POST /v1/quests/{questId}/claim (again)');
      check(JSON.stringify(again.data) === JSON.stringify(claimed.data), 'Second quest claim returned a different body');
      const after = need(await client.listQuests(), 'GET /v1/quests');
      check(questOf(after.data)?.claimed === true, `Quest ${o.questId} is not marked as claimed`);
      return `${o.questId} claimed once`;
    },
  };

  for (const name of SCENARIO_STEPS) {
    try {
      const detail = await plan[name]();
      steps.push({ name, ok: true, detail });
      options.onStep?.({ name, ok: true, detail });
    } catch (e) {
      const failure = e instanceof StepFailure ? e : new StepFailure('unknown', `unexpected: ${e?.message ?? e}`);
      steps.push({ name, ok: false, detail: failure.reason });
      options.onStep?.({ name, ok: false, detail: failure.reason, category: failure.category });
      return { ok: false, steps, failed: { name, category: failure.category, reason: failure.reason } };
    }
  }
  return { ok: true, steps };
}
