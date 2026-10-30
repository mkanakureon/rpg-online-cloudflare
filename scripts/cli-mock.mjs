#!/usr/bin/env node
/** CLI モック（将来の UE・Unity・ブラウザの HTTP クライアントの代わり。ローカル専用）: 設定とマスターデータ → スコア → セーブの流れを通す。 */
import {
  SMOKE_BOARD_ID, SMOKE_SLOT_ID, authHeaders, configPath, guestRequest, masterDataPath, saveData, saveWrite, scoreSubmission, sha256Hex,
  utf8Bytes
} from './cli-requests.mjs';

const base = process.env.API_BASE_URL || 'http://127.0.0.1:8787';

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  // トークンは画面に出さない（docs/guides/decisions/operations-security.md）
  // セーブの応答は本体（data）を出さず、size と revision だけ見せる（docs/guides/working/save-design.md §6）
  let shown = body && typeof body === 'object' && 'token' in body ? { ...body, token: '[redacted]' } : body;
  if (path.startsWith('/v1/saves/') && response.ok && options.method !== 'DELETE') shown = { size: body.size, revision: body.revision };
  // 利用制限（429 RATE_LIMITED）は Retry-After の秒を足して見せ、再試行せずに止まる（docs/guides/working/abuse-protection-design.md §11）
  const retryAfter = response.status === 429 ? [`retry-after=${response.headers.get('retry-after')}`] : [];
  console.log(`${options.method || 'GET'} ${path}:`, response.status, JSON.stringify(shown), ...retryAfter);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body;
}

try {
  const health = await call('/health');
  if (health.status !== 'ok') throw new Error('Health check failed');

  // 設定はトークン無しで読める（ゲストの発行の前）。2 回目は ETag を If-None-Match に付けて、本文の無い 304 を確かめる
  // （304 は本文が無いので call() を通さず fetch を直に使う。docs/guides/working/config-design.md §6）
  const configUrl = configPath();
  const first = await fetch(`${base}${configUrl}`);
  const settings = await first.json();
  const etag = first.headers.get('etag');
  console.log(`GET ${configUrl}:`, first.status, JSON.stringify(settings), `etag=${etag}`);
  if (first.status !== 200 || !etag) throw new Error('Config could not be read');
  if (settings.clientVersion.update === 'required') throw new Error('Client version is older than the minimum');
  const again = await fetch(`${base}${configUrl}`, { headers: { 'If-None-Match': etag } });
  console.log(`GET ${configUrl}:`, again.status, '(If-None-Match)');
  if (again.status !== 304) throw new Error('Unchanged config was sent again (expected 304)');
  // 設定の masterData に載った最初のキーを読み、data のバイト数が一覧の size と同じことを見る。
  // data は大きくなりうるので画面に出さず size だけ出す（docs/guides/working/config-design.md §6 の C2）
  const [firstMaster] = settings.masterData ?? [];
  if (firstMaster) {
    const masterUrl = masterDataPath(firstMaster.key);
    const masterRes = await fetch(`${base}${masterUrl}`);
    const master = await masterRes.json();
    const size = typeof master.data === 'string' ? utf8Bytes(master.data) : null;
    console.log(`GET ${masterUrl}:`, masterRes.status, JSON.stringify({ key: master.key, size }));
    if (masterRes.status !== 200 || size !== firstMaster.size) throw new Error('Master data does not match the size in the config');
  } else {
    console.log('masterData: none (this game has no master data; skipped)');
  }
  await call('/v1/announcements?gameId=demo-rpg');

  const guest = await call('/v1/accounts/guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(guestRequest())
  });
  const submission = scoreSubmission(guest.playerId);
  await call(`/v1/rankings/${SMOKE_BOARD_ID}`, {
    method: 'POST',
    headers: authHeaders(guest.token),
    body: JSON.stringify(submission)
  });
  const result = await call(`/v1/rankings/${SMOKE_BOARD_ID}?gameId=${submission.gameId}&limit=10`);
  if (!result.items.some((entry) => entry.playerId === submission.playerId && entry.score >= submission.score)) {
    throw new Error('Submitted score not found in top 10');
  }

  // 同じゲストのトークンでセーブを書いて読み直す（ゲストは毎回新しいので baseRevision: 0 が毎回通る）
  const data = saveData();
  const checksum = await sha256Hex(data);
  const savePath = `/v1/saves/${SMOKE_SLOT_ID}?gameId=${submission.gameId}`;
  const written = await call(savePath, {
    method: 'PUT',
    headers: authHeaders(guest.token),
    body: JSON.stringify(saveWrite(data, checksum, 0))
  });
  const loaded = await call(savePath, { headers: authHeaders(guest.token) });
  if (loaded.data !== data || loaded.checksum !== checksum || loaded.revision !== written.revision
    || await sha256Hex(loaded.data) !== loaded.checksum) {
    throw new Error('Loaded save does not match the written one');
  }

  // 一覧にスロットがあることを見て、読んだリビジョンで消す。消した後は読むと 404（docs/guides/working/save-design.md §6 の V2）
  const listed = await call(`/v1/saves?gameId=${submission.gameId}`, { headers: authHeaders(guest.token) });
  const slot = listed.items.find((item) => item.slotId === SMOKE_SLOT_ID);
  if (!slot) throw new Error('Written save not found in the save list');
  await call(`${savePath}&baseRevision=${slot.revision}`, { method: 'DELETE', headers: authHeaders(guest.token) });
  const gone = await fetch(`${base}${savePath}`, { headers: authHeaders(guest.token) });
  console.log(`GET ${savePath}:`, gone.status, '(after DELETE)');
  if (gone.status !== 404) throw new Error('Deleted save is still readable');
  console.log('\nPASS: local CLI smoke test');
} catch (error) {
  console.error('\nFAIL: local CLI smoke test', error);
  process.exitCode = 1;
}
