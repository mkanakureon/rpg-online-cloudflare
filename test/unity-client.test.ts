/**
 * クライアント統合の試験 B5: Unity の C# のクライアント層（clients/unity/Runtime/）の決まりの値と手順の名前が、スキーマとブラウザの SDK に揃っていること。
 * 名前と期待する結果の正は docs/guides/working/client-integration-design.md §9 の B5 の 3 本。
 * Mac には Unity が無いので C# はビルドしない。C# のファイルを `?raw` で文字列として読み、決めた形の行
 * （RpgOnlineClientPolicy.cs の冒頭の注釈に書いた形）から値を取り出して、スキーマの x-client-policy・x-retry と SDK の SCENARIO_STEPS に比べる。
 * ビルドとゲームの中での動き（H2〜H4）は人が専用 PC で見る（docs/guides/procedures/unity-client-check.md）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { describe, expect, it } from 'vitest';
import specJson from '../openapi/rpg-online.v1.json';
import policyCs from '../clients/unity/Runtime/RpgOnlineClientPolicy.cs?raw';
import scenarioCs from '../clients/unity/Runtime/RpgOnlineScenario.cs?raw';
import { SCENARIO_STEPS } from '../clients/browser/rpg-online-client.mjs';

type Operation = { operationId: string; 'x-retry'?: string };
type ErrorRule = { category: string; retry: boolean };
type Spec = {
  'x-client-policy': Record<string, unknown> & { errorCatalog: Record<string, ErrorRule> };
  paths: Record<string, Record<string, Operation>>;
};
const spec = specJson as unknown as Spec;
const httpMethods = ['get', 'post', 'put', 'delete', 'patch'];
const operations = (): Operation[] =>
  Object.values(spec.paths).flatMap((item) => httpMethods.filter((m) => m in item).map((m) => item[m]));

/** C# の注釈（// と /* *\/）を除く。注釈の中の例の行を値として読まないため。 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const policy = stripComments(policyCs);
const scenario = stripComments(scenarioCs);

/** `public const int Name = 数;` の数。無ければ undefined。 */
function constInt(name: string): number | undefined {
  const m = policy.match(new RegExp(`public\\s+const\\s+int\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  return m ? Number(m[1]) : undefined;
}
/** `public const string Name = "文字";` の文字。無ければ undefined。 */
function constString(name: string): string | undefined {
  const m = policy.match(new RegExp(`public\\s+const\\s+string\\s+${name}\\s*=\\s*"([^"]*)"\\s*;`));
  return m ? m[1] : undefined;
}
/** `public static readonly int[] Name = { 数, ... };` の数の並び。 */
function intArray(name: string): number[] | undefined {
  const m = policy.match(new RegExp(`public\\s+static\\s+readonly\\s+int\\[\\]\\s+${name}\\s*=\\s*\\{([^}]*)\\}\\s*;`));
  return m ? m[1].split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number) : undefined;
}
/** `public static readonly string[] Name = { "a", ... };` の文字の並び（シナリオのファイル）。 */
function stringArray(src: string, name: string): string[] | undefined {
  const m = src.match(new RegExp(`public\\s+static\\s+readonly\\s+string\\[\\]\\s+${name}\\s*=\\s*\\{([^}]*)\\}\\s*;`));
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]) : undefined;
}

/** C# の定数から、スキーマの x-client-policy と同じ形の値を組み直す（errorCatalog を除く）。 */
function policyFromCs() {
  return {
    timeoutSeconds: constInt('TimeoutSeconds'),
    maxAttempts: constInt('MaxAttempts'),
    backoff: {
      baseSeconds: constInt('BackoffBaseSeconds'),
      factor: constInt('BackoffFactor'),
      maxSeconds: constInt('BackoffMaxSeconds'),
      jitter: constString('BackoffJitter'),
    },
    retryAfter: { maxWaitSeconds: constInt('RetryAfterMaxWaitSeconds'), maxRetries: constInt('RetryAfterMaxRetries') },
    retryStatuses: intArray('RetryStatuses'),
    tokenRefreshBeforeSeconds: constInt('TokenRefreshBeforeSeconds'),
  };
}

/** `new ErrorRule("コード", "種類", true|false)` の行（順のまま）。 */
const errorRules = () =>
  [...policy.matchAll(/new\s+ErrorRule\(\s*"([A-Z_]+)"\s*,\s*"([a-z-]+)"\s*,\s*(true|false)\s*\)/g)].map((m) => ({
    code: m[1], category: m[2], retry: m[3] === 'true',
  }));
/** `new OperationRule("operationId", "種類")` の行（順のまま）。 */
const operationRules = () =>
  [...policy.matchAll(/new\s+OperationRule\(\s*"([A-Za-z]+)"\s*,\s*"([a-z-]+)"\s*\)/g)].map((m) => [m[1], m[2]] as const);

describe('Unity のクライアント層（B5）', () => {
  it('Unityのクライアント層の決まりの値はスキーマと一致する', () => {
    const { description, errorCatalog, ...rest } = spec['x-client-policy'];
    expect(typeof description).toBe('string');
    expect(errorCatalog).toBeTypeOf('object');
    // 値の欄を足したらここで落ちる（C# にも同じコミットで足す）
    expect(Object.keys(rest).sort()).toEqual(
      ['backoff', 'maxAttempts', 'retryAfter', 'retryStatuses', 'timeoutSeconds', 'tokenRefreshBeforeSeconds'],
    );
    expect(policyFromCs()).toEqual(rest);

    // 操作ごとの再試行の種類（x-retry）。重なりも漏れも無い
    const rules = operationRules();
    expect(new Set(rules.map(([id]) => id)).size).toBe(rules.length);
    const fromSpec = Object.fromEntries(operations().map((op) => [op.operationId, op['x-retry']]));
    expect(Object.fromEntries(rules)).toEqual(fromSpec);
    // 自動で送り直さない種類の名前もスキーマの 5 つの種類の 1 つ
    expect(constString('NoAutoRetryKind')).toBe('revision');
  });

  it('Unityのクライアント層はエラーコードの表の全部のコードを持つ', () => {
    const rules = errorRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(new Set(rules.map((r) => r.code)).size).toBe(rules.length);
    const fromCs = Object.fromEntries(rules.map((r) => [r.code, { category: r.category, retry: r.retry }]));
    expect(fromCs).toEqual(spec['x-client-policy'].errorCatalog);
    // コードの無い失敗の種類（§2.4・§2.5）
    expect(constString('UnknownCategory')).toBe('unknown');
    expect(constString('NetworkCategory')).toBe('network');
    expect(constString('BusyCategory')).toBe('busy');
    expect(constString('SessionCategory')).toBe('session');
  });

  it('Unityのクライアント層はシナリオの全部の手順を持つ', () => {
    const steps = stringArray(scenario, 'Steps');
    expect(steps).toEqual([...SCENARIO_STEPS]);
    // 手順の名前ごとに中身（case の行）がある。名前だけ並べて中身の無い手順を見逃さない
    const cases = [...scenario.matchAll(/case\s+"([a-z-]+)"\s*:/g)].map((m) => m[1]);
    expect([...cases].sort()).toEqual([...SCENARIO_STEPS].sort());
  });
});
