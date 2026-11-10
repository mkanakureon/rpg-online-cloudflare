// rpg-online-client.d.mts — clients/browser/rpg-online-client.mjs の型の宣言（手で書く。型を作る道具は足さない。設計書 §5.2）。
//
// 応答の型の名前と欄はスキーマ openapi/rpg-online.v1.json の components.schemas と同じにする（GuestIssued〔ゲストの発行とトークンの更新の応答〕だけは、SDK がトークンを
// 結果に出さないので token を除いた GuestSession）。欄の食い違いは試験「SDKの応答の型はスキーマの応答と同じ欄を持つ」が、
// このファイルを文字列として読んで見る。そのため interface の欄は 1 行に 1 つ、2 つの空白の字下げで書く。
// DOM の型に頼らない（tsconfig.json の lib は ES2022 だけ）。
//
// 概要記述: Claude Opus 5.5 — 2026-11-01

export type RetryKind = 'safe' | 'natural-key' | 'idempotency-key' | 'new-resource' | 'revision';
export type ErrorCategory =
  | 'client-bug' | 'not-found' | 'unavailable' | 'network' | 'busy' | 'session'
  | 'banned' | 'conflict' | 'limit' | 'expired' | 'not-ready' | 'unknown';
export type OperationId =
  | 'getHealth' | 'issueGuest' | 'listAnnouncements' | 'getRanking' | 'submitScore' | 'listSaves' | 'getSave' | 'putSave'
  | 'deleteSave' | 'getConfig' | 'getMasterData' | 'getInventory' | 'listInventoryHistory' | 'listEvents' | 'claimEventReward'
  | 'getPlayerData' | 'writePlayerData' | 'listQuests' | 'claimQuest' | 'refreshToken';
export type ScenarioStep =
  | 'health' | 'config' | 'master-data' | 'announcements' | 'guest' | 'token-refresh' | 'ranking' | 'saves' | 'event-reward'
  | 'player-data' | 'quests';

export interface ClientPolicy {
  readonly timeoutSeconds: number;
  readonly maxAttempts: number;
  readonly backoff: { readonly baseSeconds: number; readonly factor: number; readonly maxSeconds: number; readonly jitter: 'full' };
  readonly retryAfter: { readonly maxWaitSeconds: number; readonly maxRetries: number };
  readonly retryStatuses: readonly number[];
  /** 期限までの残りがこの秒を切ったら、トークンの要る次の要求の前に更新する（7 日）。 */
  readonly tokenRefreshBeforeSeconds: number;
  readonly errorCatalog: Readonly<Record<string, { category: ErrorCategory; retry: boolean }>>;
}

export declare const CLIENT_POLICY: ClientPolicy;
export declare const OPERATION_RETRY: Readonly<Record<OperationId, RetryKind>>;
export declare const SCENARIO_STEPS: readonly ScenarioStep[];
export declare const SCENARIO_DEFAULTS: Readonly<{
  clientVersion: string;
  boardPrefix: string;
  displayName: string;
  score: number;
  slotId: string;
  eventId: string;
  playerDataKey: string;
  achievementId: string;
  questId: string;
}>;

export declare function categorize(status: number | null | undefined, code: string | null | undefined): ErrorCategory;
export declare function backoffCapSeconds(retryNumber: number): number;
export declare function parseRetryAfter(value: string | null | undefined): number | null;
export declare function sha256Hex(text: string): Promise<string>;

// ---- 差し替えの口 ----

/** fetch の応答のうち SDK が使う部分。 */
export interface ResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export interface RequestInitLike {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: unknown;
}
export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;
/** ms ミリ秒待つ。signal（AbortSignal）が止まったら早めに解決してよい。 */
export type SleepLike = (ms: number, signal?: unknown) => Promise<void>;
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
/** 要求ごとの記録（トークン・見出し・本文を含まない）。reason は timeout・network・retry-wait か null。 */
export interface RequestLogEvent {
  operationId: OperationId;
  method: string;
  path: string;
  attempt: number;
  status: number | null;
  reason: string | null;
  durationMs?: number;
  waitMs?: number;
}
export interface ClientOptions {
  baseUrl?: string;
  gameId?: string;
  fetch?: FetchLike;
  sleep?: SleepLike;
  now?: () => number;
  random?: () => number;
  storage?: StorageLike;
  log?: (event: RequestLogEvent) => void;
}

// ---- 結果 ----

export interface ClientError {
  /** サーバーの error.code。コードの無い失敗（回線断・タイムアウト・JSON でない応答）は null。 */
  code: string | null;
  category: ErrorCategory;
  /** 状態コード。応答が無い（回線断・タイムアウト）ときは null。 */
  status: number | null;
  /** 決まりの上で、後でゲームが送り直してよいか（revision の操作と、new-resource の操作の 429 のほかの失敗は false）。 */
  retryable: boolean;
  /** 人が読む理由（ログ向け。画面には category で選んだ文を出す）。 */
  reason: string;
  /** revision の操作（putSave・deleteSave）が通信の失敗で終わり、書けたか分からない。confirmSave で読み直す。 */
  outcomeUnknown: boolean;
}
export type Ok<T> = { ok: true; status: number; data: T; etag: string | null; attempts: number };
export type Fail = { ok: false; error: ClientError; attempts: number };
export type Result<T> = Ok<T> | Fail;

// ---- 応答の型（スキーマの components.schemas と同じ名前と欄） ----

export interface Health {
  status: 'ok';
  service: 'rpg-online-backend';
}
export interface Announcement {
  id: string;
  title: string;
  body: string;
}
export interface AnnouncementList {
  gameId: string;
  items: Announcement[];
}
export interface RankingEntry {
  playerId: string;
  displayName: string;
  score: number;
}
export interface RankingList {
  gameId: string;
  boardId: string;
  items: RankingEntry[];
}
export interface ScoreAccepted {
  ok: true;
  gameId: string;
  boardId: string;
  playerId: string;
}
/** GuestIssued から token を除いたもの（トークンは storage にだけ置く）。 */
export interface GuestSession {
  gameId: string;
  playerId: string;
  expiresAt: string;
}
export interface SaveMeta {
  gameId: string;
  slotId: string;
  revision: number;
  formatVersion: number;
  checksum: string;
  size: number;
  updatedAt: string;
}
export interface Save {
  gameId: string;
  slotId: string;
  revision: number;
  formatVersion: number;
  data: string;
  checksum: string;
  size: number;
  updatedAt: string;
}
export interface SaveListItem {
  slotId: string;
  revision: number;
  formatVersion: number;
  checksum: string;
  size: number;
  updatedAt: string;
}
export interface SaveList {
  gameId: string;
  items: SaveListItem[];
}
export interface SaveDeleted {
  ok: true;
  gameId: string;
  slotId: string;
}
export interface ClientVersion {
  minimum: string;
  latest: string | null;
  update: 'none' | 'available' | 'required' | 'unknown';
}
export interface MasterDataEntry {
  key: string;
  size: number;
}
export interface Config {
  gameId: string;
  clientVersion: ClientVersion;
  flags: Record<string, boolean>;
  masterData?: MasterDataEntry[];
}
export interface MasterData {
  gameId: string;
  key: string;
  data: string;
}
export interface InventoryEntry {
  itemId: string;
  amount: number;
}
export interface Inventory {
  gameId: string;
  currencies: InventoryEntry[];
  items: InventoryEntry[];
}
export interface InventoryHistoryEntry {
  entryId: number;
  itemId: string;
  delta: number;
  sourceType: string;
  sourceId: string;
  createdAt: string;
}
export interface InventoryHistory {
  gameId: string;
  items: InventoryHistoryEntry[];
  nextBefore?: number;
}
export interface EventReward {
  itemId: string;
  amount: number;
}
export interface Event {
  eventId: string;
  kind: 'once' | 'daily' | 'weekly';
  startsAt: string;
  endsAt: string;
  periodKey: string;
  nextResetAt?: string;
  rewards: EventReward[];
  claimed: boolean;
}
export interface EventList {
  gameId: string;
  serverTime: string;
  items: Event[];
}
export interface EventClaim {
  gameId: string;
  eventId: string;
  periodKey: string;
  claimId: string;
  claimedAt: string;
  grants: EventReward[];
}
export interface PlayerDataValue {
  key: string;
  mode: 'add' | 'max' | 'set' | 'flag';
  value: number;
  updatedAt: string;
}
export interface PlayerAchievement {
  achievementId: string;
  unlockedAt: string;
}
export interface PlayerData {
  gameId: string;
  values: PlayerDataValue[];
  achievements: PlayerAchievement[];
}
export interface PlayerDataWritten {
  gameId: string;
  writeId: string;
  values: Array<{ key: string; value: number }>;
  unlocked: PlayerAchievement[];
}
export interface Quest {
  questId: string;
  kind: 'once' | 'daily' | 'weekly';
  startsAt: string;
  endsAt: string;
  periodKey: string;
  nextResetAt?: string;
  key: string;
  threshold: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  rewards: EventReward[];
}
export interface QuestList {
  gameId: string;
  serverTime: string;
  items: Quest[];
}
export interface QuestClaim {
  gameId: string;
  questId: string;
  periodKey: string;
  claimId: string;
  claimedAt: string;
  grants: EventReward[];
}

// ---- クライアント ----

export interface SaveWriteInput {
  formatVersion?: number;
  data: string;
  checksum: string;
  baseRevision: number;
}
export type ReadAllResult =
  | { ok: true; status: number; data: InventoryHistory; pages: number; complete: boolean }
  | (Fail & { pages: number });

export interface RpgOnlineClient {
  readonly gameId: string;
  session(): GuestSession | null;
  clearSession(): void;
  getHealth(): Promise<Result<Health>>;
  issueGuest(): Promise<Result<GuestSession>>;
  /** 保存したトークンを期限を 30 日先にした新しいトークンに取り替える（POST /v1/accounts/token）。期限切れ・壊れたトークンは session の失敗。 */
  refreshToken(): Promise<Result<GuestSession>>;
  listAnnouncements(): Promise<Result<AnnouncementList>>;
  getRanking(boardId: string, options?: { limit?: number }): Promise<Result<RankingList>>;
  submitScore(boardId: string, entry: { score: number; displayName: string; playerId?: string }): Promise<Result<ScoreAccepted>>;
  listSaves(): Promise<Result<SaveList>>;
  getSave(slotId: string): Promise<Result<Save>>;
  putSave(slotId: string, save: SaveWriteInput): Promise<Result<SaveMeta>>;
  deleteSave(slotId: string, baseRevision: number): Promise<Result<SaveDeleted>>;
  confirmSave(slotId: string, expected: { revision: number; checksum: string } | null): Promise<{ ok: boolean; confirmed: boolean; error?: ClientError }>;
  /** 304 のときは data が null で status が 304。 */
  getConfig(options?: { clientVersion?: string; etag?: string }): Promise<Result<Config | null>>;
  getMasterData(key: string, options?: { etag?: string }): Promise<Result<MasterData | null>>;
  getInventory(): Promise<Result<Inventory>>;
  listInventoryHistory(options?: { limit?: number; before?: number }): Promise<Result<InventoryHistory>>;
  readAllInventoryHistory(options?: { limit?: number; maxPages?: number }): Promise<ReadAllResult>;
  listEvents(): Promise<Result<EventList>>;
  claimEventReward(eventId: string): Promise<Result<EventClaim>>;
  getPlayerData(): Promise<Result<PlayerData>>;
  writePlayerData(changes: Array<{ key: string; value: number }>, options?: { idempotencyKey?: string }): Promise<Result<PlayerDataWritten>>;
  listQuests(): Promise<Result<QuestList>>;
  claimQuest(questId: string): Promise<Result<QuestClaim>>;
}

export declare function createClient(options?: ClientOptions): RpgOnlineClient;

// ---- シナリオ ----

export interface ScenarioStepResult {
  name: ScenarioStep;
  ok: boolean;
  detail: string;
  category?: ErrorCategory;
}
export interface ScenarioResult {
  ok: boolean;
  steps: ScenarioStepResult[];
  failed?: { name: ScenarioStep; category: ErrorCategory; reason: string };
}
export interface ScenarioOptions extends Partial<typeof SCENARIO_DEFAULTS> {
  /** スコアを送るボード。無ければ boardPrefix と now から作る（回すたびに別のボード）。 */
  boardId?: string;
  now?: number;
  onStep?: (step: ScenarioStepResult) => void;
}
export declare function runScenario(client: RpgOnlineClient, options?: ScenarioOptions): Promise<ScenarioResult>;
