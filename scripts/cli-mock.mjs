#!/usr/bin/env node
/** CLI モック（将来の UE・Unity・ブラウザの HTTP クライアントの代わり。ローカル専用）: 設定とマスターデータ → スコア → セーブ → イベントの報酬 → プレイヤーデータと実績 → クエストの流れを通す。 */
import {
  SMOKE_ACHIEVEMENT_ID, SMOKE_EVENT_ID, SMOKE_PLAYER_DATA_KEY, SMOKE_QUEST_ID, SMOKE_SLOT_ID, authHeaders, claimPath, configPath, eventsPath,
  guestRequest, historyPath, inventoryPath, masterDataPath, newIdempotencyKey, playerDataHeaders, playerDataPath, playerDataWrite, questClaimPath,
  questsPath, saveData, saveWrite, scoreSubmission, sha256Hex, smokeBoardId, utf8Bytes
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
  // 回すたびに別のボードに送る（同点の前の回の行が上位 10 件を埋めていても、自分の行が見つかる）
  const boardId = smokeBoardId(Date.now());
  const submission = scoreSubmission(guest.playerId);
  await call(`/v1/rankings/${boardId}`, {
    method: 'POST',
    headers: authHeaders(guest.token),
    body: JSON.stringify(submission)
  });
  const result = await call(`/v1/rankings/${boardId}?gameId=${submission.gameId}&limit=10`);
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

  // 同じトークンでイベントの一覧を読み、デイリーの報酬を受け取る。もう一度受け取っても同じ claimId で、金貨も履歴も増えない
  // （docs/guides/working/event-reward-design.md §10）。一覧が空なら飛ばす。一覧の 404 は 0010 の当て忘れなので call() が止める
  const listedEvents = await call(eventsPath(submission.gameId), { headers: authHeaders(guest.token) });
  console.log(`serverTime=${listedEvents.serverTime}`);
  if (listedEvents.items.length === 0) {
    console.log('events: none (skipped)');
  } else {
    const event = listedEvents.items.find((item) => item.eventId === SMOKE_EVENT_ID);
    if (!event || event.claimed !== false) throw new Error(`Event ${SMOKE_EVENT_ID} is not open and unclaimed`);
    const claimUrl = claimPath(SMOKE_EVENT_ID, submission.gameId);
    const claimed = await call(claimUrl, { method: 'POST', headers: authHeaders(guest.token) });
    const goldOf = (inventory) => inventory.currencies.find((c) => c.itemId === 'gold')?.amount ?? 0;
    const granted = claimed.grants.find((g) => g.itemId === 'gold')?.amount ?? 0;
    const afterFirst = await call(inventoryPath(submission.gameId), { headers: authHeaders(guest.token) });
    if (granted <= 0 || goldOf(afterFirst) !== granted) throw new Error('Claimed gold is not in the inventory');
    const again = await call(claimUrl, { method: 'POST', headers: authHeaders(guest.token) });
    if (again.claimId !== claimed.claimId) throw new Error('Second claim returned a different claimId');
    const afterSecond = await call(inventoryPath(submission.gameId), { headers: authHeaders(guest.token) });
    if (goldOf(afterSecond) !== granted) throw new Error('Second claim granted the reward twice');
    const history = await call(historyPath(submission.gameId), { headers: authHeaders(guest.token) });
    if (history.items.length !== claimed.grants.length || history.items.some((item) => item.sourceId !== claimed.claimId)) {
      throw new Error('Inventory history does not have exactly the claimed rows');
    }
  }

  // 同じトークンでプレイヤーデータを読み、新しい Idempotency-Key で統計値を 1 増やす（実績 first-slime が解ける）。同じ鍵と本文で送り直しても
  // 同じ writeId の同じ本文で、値は 1 のまま・実績は 1 つ（docs/guides/working/player-data-design.md §12）。404 は 0013・0014 の当て忘れなので call() が止める
  const playerDataUrl = playerDataPath(submission.gameId);
  const before = await call(playerDataUrl, { headers: authHeaders(guest.token) });
  if (before.values.length !== 0 || before.achievements.length !== 0) throw new Error('New guest already has player data');
  const idempotencyKey = newIdempotencyKey();
  const writeOnce = () => call(playerDataUrl, {
    method: 'POST',
    headers: playerDataHeaders(guest.token, idempotencyKey),
    body: JSON.stringify(playerDataWrite(SMOKE_PLAYER_DATA_KEY, 1))
  });
  const playerDataWritten = await writeOnce();
  const valueOf = (body) => body.values.find((v) => v.key === SMOKE_PLAYER_DATA_KEY)?.value;
  if (valueOf(playerDataWritten) !== 1 || !playerDataWritten.unlocked.some((a) => a.achievementId === SMOKE_ACHIEVEMENT_ID)) {
    throw new Error(`Writing ${SMOKE_PLAYER_DATA_KEY} did not unlock ${SMOKE_ACHIEVEMENT_ID}`);
  }
  const resent = await writeOnce();
  if (JSON.stringify(resent) !== JSON.stringify(playerDataWritten)) throw new Error('Resent player data write returned a different body');
  const after = await call(playerDataUrl, { headers: authHeaders(guest.token) });
  if (after.values.find((v) => v.key === SMOKE_PLAYER_DATA_KEY)?.value !== 1) throw new Error('Resent player data write was counted twice');
  if (after.achievements.filter((a) => a.achievementId === SMOKE_ACHIEVEMENT_ID).length !== 1) {
    throw new Error(`Achievement ${SMOKE_ACHIEVEMENT_ID} is not unlocked exactly once`);
  }

  // 同じトークンでクエストの一覧を読み、統計値の 1 で達成した一度きりのクエストを受け取る。もう一度受け取っても同じ本文で、
  // 最後の一覧で受け取り済みになる（docs/guides/working/quest-design.md §12）。404 は 0015 の当て忘れなので call() が止める
  const questOf = (body) => body.items.find((item) => item.questId === SMOKE_QUEST_ID);
  const questsBefore = await call(questsPath(submission.gameId), { headers: authHeaders(guest.token) });
  const quest = questOf(questsBefore);
  if (!quest || quest.completed !== true || quest.claimed !== false) throw new Error(`Quest ${SMOKE_QUEST_ID} is not completed and unclaimed`);
  const questClaimUrl = questClaimPath(SMOKE_QUEST_ID, submission.gameId);
  const questClaimed = await call(questClaimUrl, { method: 'POST', headers: authHeaders(guest.token) });
  if (!questClaimed.grants.some((g) => g.itemId === 'gold' && g.amount > 0)) throw new Error(`Quest ${SMOKE_QUEST_ID} granted no gold`);
  const questAgain = await call(questClaimUrl, { method: 'POST', headers: authHeaders(guest.token) });
  if (JSON.stringify(questAgain) !== JSON.stringify(questClaimed)) throw new Error('Second quest claim returned a different body');
  const questsAfter = await call(questsPath(submission.gameId), { headers: authHeaders(guest.token) });
  if (questOf(questsAfter)?.claimed !== true) throw new Error(`Quest ${SMOKE_QUEST_ID} is not marked as claimed`);
  console.log('\nPASS: local CLI smoke test');
} catch (error) {
  console.error('\nFAIL: local CLI smoke test', error);
  process.exitCode = 1;
}
