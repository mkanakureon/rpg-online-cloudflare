/**
 * クライアント統合の試験 B1: 3 つのクライアントで共通の決まり（スキーマ openapi/rpg-online.v1.json の
 * 最上位の x-client-policy と、操作ごとの x-retry）の値と、ErrorCode の列挙・Idempotency-Key との揃いを見る。
 * 名前と期待する値の正は docs/guides/working/client-integration-design.md §2・§3・§9（B1 の 5 本）。
 * どれも L1（スキーマのファイルを読むだけで、Worker を呼ばない）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { describe, expect, it } from 'vitest';
import specJson from '../openapi/rpg-online.v1.json';

type Parameter = { name: string; in: string; required?: boolean };
type Operation = { operationId: string; 'x-retry'?: string; parameters?: Parameter[] };
type PathItem = { parameters?: Parameter[] } & Partial<Record<(typeof methods)[number], Operation>>;
type CatalogEntry = { category: string; retry: boolean };
type ClientPolicy = {
  timeoutSeconds: number;
  maxAttempts: number;
  backoff: { baseSeconds: number; factor: number; maxSeconds: number; jitter: string };
  retryAfter: { maxWaitSeconds: number; maxRetries: number };
  retryStatuses: number[];
  errorCatalog: Record<string, CatalogEntry>;
};
type Spec = {
  'x-client-policy': ClientPolicy;
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, { enum?: string[] }> };
};

const methods = ['get', 'post', 'put', 'delete', 'patch'] as const;
const spec = specJson as unknown as Spec;
const policy = spec['x-client-policy'];

/** パスの項目ごとに、操作と、パスの段の parameters を合わせた引数の一覧を並べる。 */
function operations(): { op: Operation; params: Parameter[] }[] {
  return Object.values(spec.paths).flatMap((item) =>
    methods.flatMap((m) => {
      const op = item[m];
      return op ? [{ op, params: [...(item.parameters ?? []), ...(op.parameters ?? [])] }] : [];
    }),
  );
}

/** 設計書 §2.2 の表（操作 → 再試行の種類）。B3 で refreshToken を足した（§10）。 */
const expectedRetry: Record<string, string> = {
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
};
const retryKinds = ['safe', 'natural-key', 'idempotency-key', 'new-resource', 'revision'];
/** 設計書 §2.5 の画面の文の種類（unknown はコードの無い失敗のためで、表には出ない）。 */
const categories = [
  'client-bug', 'not-found', 'unavailable', 'network', 'busy', 'session',
  'banned', 'conflict', 'limit', 'expired', 'not-ready',
];

describe('クライアントの共通の決まり（スキーマの x-client-policy・x-retry）', () => {
  it('スキーマのクライアントの決まりはタイムアウトと再試行の回数と間隔を持つ', () => {
    expect(policy.timeoutSeconds).toBe(10);
    expect(policy.maxAttempts).toBe(3);
    expect(policy.backoff).toEqual({ baseSeconds: 1, factor: 2, maxSeconds: 8, jitter: 'full' });
    expect(policy.retryAfter).toEqual({ maxWaitSeconds: 60, maxRetries: 1 });
    expect([...policy.retryStatuses].sort((a, b) => a - b)).toEqual([429, 500, 502, 503, 504]);
    // 形の定義（components.schemas）と混ぜない（§3）
    expect(spec.components.schemas).not.toHaveProperty('x-client-policy');
  });

  it('スキーマの全部の操作が再試行の種類を持つ', () => {
    const actual = Object.fromEntries(operations().map(({ op }) => [op.operationId, op['x-retry']]));
    expect(Object.keys(actual)).toHaveLength(20);
    for (const [id, kind] of Object.entries(actual)) expect(retryKinds, `${id} の x-retry`).toContain(kind);
    expect(actual).toEqual(expectedRetry);
  });

  it('スキーマのエラーコードの表はErrorCodeの列挙と同じコードを持つ', () => {
    const codes = spec.components.schemas.ErrorCode.enum ?? [];
    expect(codes.length).toBeGreaterThan(0);
    expect(Object.keys(policy.errorCatalog).sort()).toEqual([...codes].sort());
    for (const [code, entry] of Object.entries(policy.errorCatalog)) {
      expect(categories, `${code} の category`).toContain(entry.category);
      expect(typeof entry.retry, `${code} の retry`).toBe('boolean');
    }
  });

  it('Idempotency-Keyが必須の操作だけが再試行の種類idempotency-keyを持つ', () => {
    const required = operations()
      .filter(({ params }) => params.some((p) => p.in === 'header' && p.name === 'Idempotency-Key' && p.required === true))
      .map(({ op }) => op.operationId);
    const withKind = operations()
      .filter(({ op }) => op['x-retry'] === 'idempotency-key')
      .map(({ op }) => op.operationId);
    expect(required).toEqual(['writePlayerData']);
    expect(withKind).toEqual(required);
  });

  it('再試行してよいエラーコードはRATE_LIMITEDとINTERNAL_ERRORだけ', () => {
    const retryable = Object.entries(policy.errorCatalog)
      .filter(([, entry]) => entry.retry === true)
      .map(([code]) => code)
      .sort();
    expect(retryable).toEqual(['INTERNAL_ERROR', 'RATE_LIMITED']);
  });
});
