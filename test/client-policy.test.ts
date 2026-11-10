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
import unityPolicyCs from '../clients/unity/Runtime/RpgOnlineClientPolicy.cs?raw';
import unityClientCs from '../clients/unity/Runtime/RpgOnlineClient.cs?raw';
import unrealPolicyH from '../clients/unreal/RpgOnlineClient/Source/RpgOnlineClient/Public/RpgOnlineClientPolicy.h?raw';
import unrealClientCpp from '../clients/unreal/RpgOnlineClient/Source/RpgOnlineClient/Private/RpgOnlineClient.cpp?raw';

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

/** C# と C++ の注釈（// と /* *\/）を除く。注釈の中の文を手順として読まないため。 */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
/** 空白を 1 つに詰める（行の折り返しと字下げに依らずに手順の形を探す）。 */
const squash = (src: string) => stripComments(src).replace(/\s+/g, ' ');

describe('Unity と Unreal のクライアント層の再試行の決まり（G10。L1）', () => {
  it('UnityとUnrealのクライアント層の再試行の決まりはnew-resourceを429だけ送り直す', () => {
    // スキーマで new-resource の操作は issueGuest と refreshToken（x-retry の値は変えない）
    const newResource = operations().filter(({ op }) => op['x-retry'] === 'new-resource').map(({ op }) => op.operationId).sort();
    expect(newResource).toEqual(['issueGuest', 'refreshToken']);

    // Unity: 決まりの定数と、Request の中で 429 のほかは送り直さず返す手順
    const unityPolicy = squash(unityPolicyCs);
    expect(unityPolicy).toMatch(/public const string RateLimitOnlyKind = "new-resource";/);
    const unity = squash(unityClientCs);
    expect(unity).toMatch(/var isRateLimitOnly = kind == RpgOnlineClientPolicy\.RateLimitOnlyKind;/);
    expect(unity).toMatch(/var retryableByKind = !isRateLimitOnly \|\| status == 429;/);
    expect(unity).toMatch(/retryable = autoRetry && retryableByPolicy && retryableByKind,/);
    expect(unity).toMatch(/if \(!retryableByKind\) return Fail\("not retried: new-resource"\);/);
    // 送り直しの判定（回数・Retry-After・待ち）より前で返す
    expect(unity.indexOf('if (!retryableByKind)')).toBeLessThan(unity.indexOf('if (attempts >= RpgOnlineClientPolicy.MaxAttempts)'));

    // Unreal: 同じ定数と手順
    const unrealPolicy = squash(unrealPolicyH);
    expect(unrealPolicy).toMatch(/inline constexpr const TCHAR\* RateLimitOnlyKind = TEXT\("new-resource"\);/);
    const unreal = squash(unrealClientCpp);
    expect(unreal).toMatch(/const bool bIsRateLimitOnly = Kind != nullptr && FCString::Strcmp\(Kind, RpgOnlineClientPolicy::RateLimitOnlyKind\) == 0;/);
    expect(unreal).toMatch(/const bool bRetryableByKind = !bIsRateLimitOnly \|\| Status == 429;/);
    expect(unreal).toMatch(/Res\.Error\.bRetryable = bAutoRetry && bRetryableByPolicy && bRetryableByKind;/);
    expect(unreal).toMatch(/if \(!bRetryableByKind\) \{ Fail\(TEXT\("not retried: new-resource"\)\); return; \}/);
    expect(unreal.indexOf('if (!bRetryableByKind)')).toBeLessThan(unreal.indexOf('if (State->Attempts >= RpgOnlineClientPolicy::MaxAttempts)'));
  });
});
