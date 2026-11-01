/**
 * クライアント統合の試験 B6: Unreal の C++ のクライアント層（clients/unreal/RpgOnlineClient/）の決まりの値・エラーコードの表・イベントコマンドの一覧が、
 * スキーマとブラウザの SDK に揃っていること。名前と期待する結果の正は docs/guides/working/client-integration-design.md §9 の B6 の 3 本。
 * Mac には Unreal Engine が無いので C++ はビルドしない。ヘッダーを `?raw` で文字列として読み、決めた形の行
 * （RpgOnlineClientPolicy.h・RpgOnlineEventCommands.h の冒頭の注釈に書いた形）から値を取り出して、スキーマの x-client-policy・x-retry と SDK の SCENARIO_STEPS に比べる。
 * ビルドとゲームの中での動き（H5・H6）は人が専用 PC で見る（docs/guides/procedures/unreal-client-check.md）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-11-01
 */
import { describe, expect, it } from 'vitest';
import specJson from '../openapi/rpg-online.v1.json';
import policyH from '../clients/unreal/RpgOnlineClient/Source/RpgOnlineClient/Public/RpgOnlineClientPolicy.h?raw';
import commandsH from '../clients/unreal/RpgOnlineClient/Source/RpgOnlineClient/Public/RpgOnlineEventCommands.h?raw';
import scenarioCpp from '../clients/unreal/RpgOnlineClient/Source/RpgOnlineClient/Private/RpgOnlineScenario.cpp?raw';
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

/** C++ の注釈（// と /* *\/）を除く。注釈の中の例の行を値として読まないため。 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const policy = stripComments(policyH);
const commands = stripComments(commandsH);
const scenario = stripComments(scenarioCpp);

/** `inline constexpr int32 Name = 数;` の数。無ければ undefined。 */
function constInt(name: string): number | undefined {
  const m = policy.match(new RegExp(`inline\\s+constexpr\\s+int32\\s+${name}\\s*=\\s*(\\d+)\\s*;`));
  return m ? Number(m[1]) : undefined;
}
/** `inline constexpr const TCHAR* Name = TEXT("文字");` の文字。無ければ undefined。 */
function constString(src: string, name: string): string | undefined {
  const m = src.match(new RegExp(`inline\\s+constexpr\\s+const\\s+TCHAR\\*\\s+${name}\\s*=\\s*TEXT\\("([^"]*)"\\)\\s*;`));
  return m ? m[1] : undefined;
}
/** `inline constexpr int32 Name[] = { 数, ... };` の数の並び。 */
function intArray(name: string): number[] | undefined {
  const m = policy.match(new RegExp(`inline\\s+constexpr\\s+int32\\s+${name}\\[\\]\\s*=\\s*\\{([^}]*)\\}\\s*;`));
  return m ? m[1].split(',').map((x) => x.trim()).filter((x) => x !== '').map(Number) : undefined;
}
/** `inline constexpr 型 Name[] = { ... };` の中身（行の並び。入れ子の { } を 1 段まで許す）。 */
function tableBody(src: string, type: string, name: string): string {
  const m = src.match(new RegExp(`inline\\s+constexpr\\s+${type}\\s+${name}\\[\\]\\s*=\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}\\s*;`));
  return m ? m[1] : '';
}

/** C++ の定数から、スキーマの x-client-policy と同じ形の値を組み直す（errorCatalog を除く）。 */
function policyFromCpp() {
  return {
    timeoutSeconds: constInt('TimeoutSeconds'),
    maxAttempts: constInt('MaxAttempts'),
    backoff: {
      baseSeconds: constInt('BackoffBaseSeconds'),
      factor: constInt('BackoffFactor'),
      maxSeconds: constInt('BackoffMaxSeconds'),
      jitter: constString(policy, 'BackoffJitter'),
    },
    retryAfter: { maxWaitSeconds: constInt('RetryAfterMaxWaitSeconds'), maxRetries: constInt('RetryAfterMaxRetries') },
    retryStatuses: intArray('RetryStatuses'),
    tokenRefreshBeforeSeconds: constInt('TokenRefreshBeforeSeconds'),
  };
}

/** ErrorCatalog の `{ TEXT("コード"), TEXT("種類"), true|false },` の行（順のまま）。 */
const errorRules = () =>
  [...tableBody(policy, 'FRpgOnlineErrorRule', 'ErrorCatalog').matchAll(
    /\{\s*TEXT\("([A-Z_]+)"\)\s*,\s*TEXT\("([a-z-]+)"\)\s*,\s*(true|false)\s*\}/g,
  )].map((m) => ({ code: m[1], category: m[2], retry: m[3] === 'true' }));
/** OperationRetry の `{ TEXT("operationId"), TEXT("種類") },` の行（順のまま）。 */
const operationRules = () =>
  [...tableBody(policy, 'FRpgOnlineOperationRule', 'OperationRetry').matchAll(
    /\{\s*TEXT\("([A-Za-z]+)"\)\s*,\s*TEXT\("([a-z-]+)"\)\s*\}/g,
  )].map((m) => [m[1], m[2]] as const);
/** Commands の `{ TEXT("online.…"), TEXT("operationId"), TEXT("入力"), TEXT("出力") },` の行（順のまま）。 */
const commandRows = () =>
  [...tableBody(commands, 'FRpgOnlineEventCommandDef', 'Commands').matchAll(
    /\{\s*TEXT\("([^"]*)"\)\s*,\s*TEXT\("([^"]*)"\)\s*,\s*TEXT\("([^"]*)"\)\s*,\s*TEXT\("([^"]*)"\)\s*\}/g,
  )].map((m) => ({ name: m[1], operationId: m[2], inputs: m[3], outputs: m[4] }));
/** ResponseNumbers の `{ TEXT("種類"), 番号 },` の行（順のまま）。 */
const responseNumbers = () =>
  [...tableBody(commands, 'FRpgOnlineResponseNumber', 'ResponseNumbers').matchAll(/\{\s*TEXT\("([a-z-]+)"\)\s*,\s*(\d+)\s*\}/g)].map(
    (m) => ({ category: m[1], number: Number(m[2]) }),
  );

describe('Unreal のクライアント層（B6）', () => {
  it('Unrealのクライアント層の決まりの値はスキーマと一致する', () => {
    const { description, errorCatalog, ...rest } = spec['x-client-policy'];
    expect(typeof description).toBe('string');
    expect(errorCatalog).toBeTypeOf('object');
    // 値の欄を足したらここで落ちる（C++ にも同じコミットで足す）
    expect(Object.keys(rest).sort()).toEqual(
      ['backoff', 'maxAttempts', 'retryAfter', 'retryStatuses', 'timeoutSeconds', 'tokenRefreshBeforeSeconds'],
    );
    expect(policyFromCpp()).toEqual(rest);

    // 操作ごとの再試行の種類（x-retry）。重なりも漏れも無い
    const rules = operationRules();
    expect(new Set(rules.map(([id]) => id)).size).toBe(rules.length);
    const fromSpec = Object.fromEntries(operations().map((op) => [op.operationId, op['x-retry']]));
    expect(Object.fromEntries(rules)).toEqual(fromSpec);
    // 自動で送り直さない種類の名前もスキーマの 5 つの種類の 1 つ
    expect(constString(policy, 'NoAutoRetryKind')).toBe('revision');
  });

  it('Unrealのクライアント層はエラーコードの表の全部のコードを持つ', () => {
    const rules = errorRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(new Set(rules.map((r) => r.code)).size).toBe(rules.length);
    const fromCpp = Object.fromEntries(rules.map((r) => [r.code, { category: r.category, retry: r.retry }]));
    expect(fromCpp).toEqual(spec['x-client-policy'].errorCatalog);
    // コードの無い失敗の種類（§2.4・§2.5）
    expect(constString(policy, 'UnknownCategory')).toBe('unknown');
    expect(constString(policy, 'NetworkCategory')).toBe('network');
    expect(constString(policy, 'BusyCategory')).toBe('busy');
    expect(constString(policy, 'SessionCategory')).toBe('session');
  });

  it('Unrealのイベントコマンドの一覧はシナリオの全部の操作を持つ', () => {
    const rows = commandRows();
    // 名前は online.<機能>.<操作> の形で、重ならない
    for (const r of rows) expect(r.name).toMatch(/^online\.[a-z0-9-]+\.[a-z0-9-]+$/);
    expect(new Set(rows.map((r) => r.name)).size).toBe(rows.length);
    // 一覧の外のコードにコマンドの名前を書いていない（一覧は 1 か所）
    const namesInFile = [...commands.matchAll(/"(online\.[a-z0-9-]+\.[a-z0-9-]+)"/g)].map((m) => m[1]);
    expect([...namesInFile].sort()).toEqual(rows.map((r) => r.name).sort());
    // スキーマの全部の操作（§4 のシナリオの操作。更新の refreshToken を含む）が、ちょうど 1 つずつコマンドに当たる
    const ops = operations().map((op) => op.operationId);
    expect(ops).toContain('refreshToken');
    expect(rows.map((r) => r.operationId).sort()).toEqual([...ops].sort());
    // params の入力と出力の名前は英字だけの欄の名前（変数の番号は名前が Variable で終わる）
    for (const r of rows) {
      for (const p of [r.inputs, r.outputs].join(',').split(',').filter((x) => x !== '')) expect(p).toMatch(/^[a-z][A-Za-z]*$/);
      for (const p of r.outputs.split(',').filter((x) => x !== '')) expect(p).toMatch(/Variable$/);
    }

    // 結果を書く変数 responseVariable: 成功は 0、失敗は §2.5 の 12 の種類の番号（重ならず 1 から）
    expect(constString(commands, 'ResponseVariableParam')).toBe('responseVariable');
    expect(commands).toMatch(/inline\s+constexpr\s+int32\s+SuccessNumber\s*=\s*0\s*;/);
    const numbers = responseNumbers();
    const categories = new Set(Object.values(spec['x-client-policy'].errorCatalog).map((r) => r.category));
    categories.add('unknown');
    expect(numbers.map((n) => n.category).sort()).toEqual([...categories].sort());
    expect(numbers.length).toBe(12);
    expect(numbers.map((n) => n.number)).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));

    // シナリオ（クライアント層とイベントコマンドの 2 つの流し方）の手順の名前が §4 と同じで、手順ごとに中身がある
    const steps = [...(scenario.match(/StepList\[\]\s*=\s*\{([^}]*)\}\s*;/)?.[1] ?? '').matchAll(/TEXT\("([a-z-]+)"\)/g)].map((m) => m[1]);
    expect(steps).toEqual([...SCENARIO_STEPS]);
    const handled = new Set([...scenario.matchAll(/Name\s*==\s*TEXT\("([a-z-]+)"\)/g)].map((m) => m[1]));
    expect([...handled].sort()).toEqual([...SCENARIO_STEPS].sort());
    // イベントコマンドで流す形が使うコマンドは、どれも一覧にある
    const used = [...scenario.matchAll(/TEXT\("(online\.[a-z0-9-]+\.[a-z0-9-]+)"\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const u of used) expect(rows.map((r) => r.name)).toContain(u);
  });
});
