// guards.ts — 書き込みの API を APP_ENV=local のときだけ通す門。
//
// 通るなら null、通さないなら 403 NOT_READY_FOR_PRODUCTION の応答を返す。書き込みの
// ルートは本文を読む前にこれを呼ぶ（検査の順は core-foundation-design.md §1）。
//
// 概要記述: Claude Opus 5.5 — 2026-10-30
import type { Env } from './env';
import { error } from './http';

export function requireLocalWrite(env: Env): Response | null {
  // IMPORTANT: Block test-only unauthenticated writes outside local mode.
  if (env.APP_ENV !== 'local') {
    return error('NOT_READY_FOR_PRODUCTION', 'Authentication not implemented', 403);
  }
  return null;
}
