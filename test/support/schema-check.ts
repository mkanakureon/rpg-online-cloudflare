/**
 * スキーマの検証関数（パッケージを足さない自前の小さな版）。openapi/rpg-online.v1.json が使う JSON Schema の語だけを見る。
 * 見る語と決まりの正は docs/guides/working/api-schema-design.md §2・§3。語を増やすときは、ここと
 * test/schema-conformance.test.ts の自己試験（スキーマの検証関数は型と必須と範囲と形の外れを見つける）を同じコミットで直す。
 * 知らない語があれば黙って通さず例外にする（見ていない制約で「合う」と言わないため）。
 * `type` は 1 つの名前か名前の配列（`['string', 'null']` はどれか 1 つに合えばよい）。配列の要素の数は `minItems`・`maxItems` で見る
 * （docs/guides/working/hardening-design.md §7 の #35・#41・#39）。
 *
 * 概要記述: Claude Opus 5.5 — 2026-10-24
 */

export type Schema = { [key: string]: unknown };
/** `$ref` を解くための、スキーマのファイル全体（`components.schemas` を持つ）。 */
export type SchemaRoot = { components?: { schemas?: Record<string, Schema> } };

/** 検証で見る語。 */
const checkedKeywords = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'pattern',
  'minLength', 'maxLength', 'minimum', 'maximum', 'const', 'enum', '$ref',
]);
/** 値の合否に関わらない注釈の語（見ずに通す）。 */
const annotationKeywords = new Set(['description', 'default', 'title', 'examples']);

const refPrefix = '#/components/schemas/';

/** `#/components/schemas/<名前>` の `$ref` を解く。外を指す・無い名前なら例外。 */
export function resolveRef(ref: string, root: SchemaRoot): Schema {
  if (!ref.startsWith(refPrefix)) throw new Error(`$ref は ${refPrefix} の中だけ: ${ref}`);
  const target = root.components?.schemas?.[ref.slice(refPrefix.length)];
  if (!target) throw new Error(`$ref の先が無い: ${ref}`);
  return target;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

/** `type` の語を名前の配列にする（無ければ null）。名前でも名前の配列でもなければ例外（見ていない形で「合う」と言わない）。 */
function typeNames(type: unknown, path: string): string[] | null {
  if (type === undefined) return null;
  if (typeof type === 'string') return [type];
  if (Array.isArray(type) && type.length > 0 && type.every((t) => typeof t === 'string')) return type as string[];
  throw new Error(`type の形が読めない: ${JSON.stringify(type)}（${path}）`);
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
}

/**
 * 値をスキーマに当て、外れを「場所: 理由」の文の配列で返す（合えば空）。
 * 文字列の長さは src/modules/rankings/validate.ts に合わせて `.length`（UTF-16 の単位）で数える。
 */
export function validate(value: unknown, schema: Schema, root: SchemaRoot, path = '$'): string[] {
  for (const key of Object.keys(schema)) {
    if (!checkedKeywords.has(key) && !annotationKeywords.has(key) && !key.startsWith('x-')) {
      throw new Error(`検証関数が見ない語: ${key}（${path}）`);
    }
  }
  if (typeof schema.$ref === 'string') return validate(value, resolveRef(schema.$ref, root), root, path);

  const errors: string[] = [];
  const fail = (why: string) => errors.push(`${path}: ${why}`);

  if ('const' in schema && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    fail(`${JSON.stringify(schema.const)} でない（${JSON.stringify(value)}）`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => JSON.stringify(v) === JSON.stringify(value))) {
    fail(`列挙 ${JSON.stringify(schema.enum)} に無い（${JSON.stringify(value)}）`);
  }
  const types = typeNames(schema.type, path);
  if (types && !types.some((t) => matchesType(value, t))) {
    fail(`型が ${types.join('|')} でない（${typeOf(value)}）`);
    return errors; // 型が違えば、その型の語は見ない
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) fail(`長さが ${schema.minLength} 未満（${value.length}）`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) fail(`長さが ${schema.maxLength} 超え（${value.length}）`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) fail(`形 ${schema.pattern} に合わない`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) fail(`${schema.minimum} 未満（${value}）`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) fail(`${schema.maximum} 超え（${value}）`);
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) fail(`要素が ${schema.minItems} 個未満（${value.length}）`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) fail(`要素が ${schema.maxItems} 個超え（${value.length}）`);
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, i) => errors.push(...validate(item, schema.items as Schema, root, `${path}[${i}]`)));
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const name of (schema.required ?? []) as string[]) {
      if (!(name in obj)) fail(`必須の欄 ${name} が無い`);
    }
    for (const [name, v] of Object.entries(obj)) {
      if (name in properties) errors.push(...validate(v, properties[name], root, `${path}.${name}`));
      else if (schema.additionalProperties === false) fail(`スキーマに無い欄 ${name}`);
    }
  }
  return errors;
}
