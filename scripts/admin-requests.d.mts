// admin-requests.d.mts — scripts/admin-requests.mjs の型の宣言（TypeScript のテストから読み込むため）。
//
// 中身の正は admin-requests.mjs。欄を変えたらここも合わせる。
//
// 概要記述: Claude Opus 5.5 — 2026-10-31

export declare const DEFAULT_GAME_ID: string;

export declare const DEFAULT_ACTOR: string;

/** 管理の口への 1 つの操作（idempotent は Idempotency-Key を付ける増減の操作）。 */
export type AdminOp = { method: string; path: string; body?: unknown; idempotent?: boolean };

export declare function playerOp(playerId: string, gameId?: string): AdminOp;

export declare function auditOp(gameId?: string, page?: { limit?: number; before?: number }): AdminOp;

export declare function adjustOp(playerId: string, itemId: string, delta: number, reason: string, gameId?: string): AdminOp;

export declare function banOp(playerId: string, reason: string, expiresAt?: string, gameId?: string): AdminOp;

export declare function unbanOp(playerId: string, reason: string, gameId?: string): AdminOp;

export declare function deleteScoreOp(boardId: string, playerId: string, reason: string, gameId?: string): AdminOp;

export declare function putItemOp(itemId: string, kind: string, reason: string, gameId?: string): AdminOp;

export type EventDefinitionBody = {
  kind: string;
  startsAt: string;
  endsAt: string;
  resetOffsetMinutes?: number;
  rewards: Array<{ itemId: string; amount: number }>;
  reason: string;
};

export declare function putEventOp(eventId: string, definition: EventDefinitionBody, gameId?: string): AdminOp;

export type PlayerDataKeyDeclaration = { mode: string; maxValue: number; maxDelta?: number | null };

export declare function putDataKeyOp(key: string, declaration: PlayerDataKeyDeclaration, reason: string, gameId?: string): AdminOp;

export declare function putAchievementOp(achievementId: string, key: string, threshold: number, reason: string, gameId?: string): AdminOp;

export declare function setDataOp(playerId: string, key: string, value: number, reason: string, gameId?: string): AdminOp;

export declare function revokeAchievementOp(playerId: string, achievementId: string, reason: string, gameId?: string): AdminOp;

export declare function newIdempotencyKey(): string;

export declare function adminRequest(
  baseUrl: string,
  adminKey: string,
  op: AdminOp,
  options?: { actor?: string; idempotencyKey?: string },
): Request;

export declare function smokeIds(now?: number): { itemId: string; eventId: string };

export declare function smokeEventDefinition(itemId: string, now?: number): EventDefinitionBody;

export declare const SMOKE_AUDIT_ACTIONS: string[];

export type SmokeAuditItem = {
  auditId: number;
  actor: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
  reason: string;
  createdAt: string;
};

export declare function runSmoke(options: {
  send: (request: Request) => Promise<Response>;
  baseUrl: string;
  adminKey: string;
  actor?: string;
  now?: number;
  log?: (step: string, status: number, body: unknown) => void;
}): Promise<{ gameId: string; playerId: string; itemId: string; eventId: string; audit: SmokeAuditItem[] }>;
