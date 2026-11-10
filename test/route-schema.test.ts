/**
 * ルーターのルートと、公開と管理のスキーマ（openapi/rpg-online.v1.json・openapi/rpg-online-admin.v1.json）の paths の突き合わせ。
 * ルーターが当てる（メソッド, パス）は、GET /health（src/core/router.ts が直に答える）・ゲストの発行とトークンの更新
 * （src/core/accounts.ts）・管理の口（src/core/admin/routes.ts の adminRoutes）・モジュールのルート（src/modules/index.ts）。
 * スキーマのパスの引数（{boardId} など）は例の値に置き換えてルートの正規表現に当てる。OPTIONS（CORS の事前確認。入口が答える）は除く。
 * どちらかにしか無い口があれば落ちる（どちらを直すかは決めない）。元は 11/10 のレビュー §3.2 の 14。
 */
import { describe, expect, it } from 'vitest';
import adminSpecJson from '../openapi/rpg-online-admin.v1.json';
import specJson from '../openapi/rpg-online.v1.json';
import { guestRoute, refreshRoute } from '../src/core/accounts';
import { adminRoutes } from '../src/core/admin/routes';
import { modules } from '../src/modules';

type Spec = { paths: Record<string, Record<string, unknown>> };
type Op = { method: string; path: string };

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head'];

/** スキーマの paths の（メソッド, パス）。parameters などのメソッドでない鍵と options は数えない。 */
function operations(spec: Spec): Op[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.keys(item).filter((k) => METHODS.includes(k)).map((k) => ({ method: k.toUpperCase(), path })));
}

/** パスの引数を例の値（ID の形に合う文字列）に置き換える。 */
const example = (path: string) => path.replace(/\{[^}]+\}/g, 'example-1');

describe('ルートとスキーマの突き合わせ', () => {
  it('ルーターのルートと公開と管理のスキーマのpathsとメソッドが一対一で対応する', () => {
    const routes = [
      { method: 'GET', pattern: /^\/health$/ },
      guestRoute, refreshRoute, ...adminRoutes, ...modules.flatMap((m) => m.routes),
    ].map((r) => ({ method: r.method, pattern: r.pattern }));
    const ops = [...operations(specJson as Spec), ...operations(adminSpecJson as Spec)];

    const matches = (r: { method: string; pattern: RegExp }, op: Op) => r.method === op.method && r.pattern.test(example(op.path));
    // スキーマの口ごとに、当たるルートがちょうど 1 つ
    const opsOff = ops.filter((op) => routes.filter((r) => matches(r, op)).length !== 1).map((op) => `${op.method} ${op.path}`);
    // ルートごとに、当たるスキーマの口がちょうど 1 つ
    const routesOff = routes.filter((r) => ops.filter((op) => matches(r, op)).length !== 1).map((r) => `${r.method} ${r.pattern.source}`);
    expect(opsOff).toEqual([]);
    expect(routesOff).toEqual([]);
    expect(routes.length).toBe(ops.length);
  });
});
