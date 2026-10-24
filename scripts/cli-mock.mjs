#!/usr/bin/env node
/** Mac-side CLI replacement for a future UE HTTP client. Local testing only. */
import { SMOKE_BOARD_ID, scoreSubmission } from './cli-requests.mjs';

const base = process.env.API_BASE_URL || 'http://127.0.0.1:8787';

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const body = await response.json();
  console.log(`${options.method || 'GET'} ${path}:`, response.status, JSON.stringify(body));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return body;
}

try {
  const health = await call('/health');
  if (health.status !== 'ok') throw new Error('Health check failed');
  await call('/v1/announcements?gameId=demo-rpg');

  const submission = scoreSubmission();
  await call(`/v1/rankings/${SMOKE_BOARD_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission)
  });
  const result = await call(`/v1/rankings/${SMOKE_BOARD_ID}?gameId=${submission.gameId}&limit=10`);
  if (!result.items.some((entry) => entry.playerId === submission.playerId && entry.score >= submission.score)) {
    throw new Error('Submitted score not found in top 10');
  }
  console.log('\nPASS: local CLI smoke test');
} catch (error) {
  console.error('\nFAIL: local CLI smoke test', error);
  process.exitCode = 1;
}
