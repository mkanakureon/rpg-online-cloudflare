/**
 * 試験の準備（setup）: vitest.config.ts が読んだ D1 のマイグレーションを、試験の D1 に当てる。
 * 当てた記録（d1_migrations）を見て飛ばすので、試験のファイルごとに呼ばれても 1 回分になる。
 */
import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

const e = env as unknown as { DB: D1Database; TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] };
await applyD1Migrations(e.DB, e.TEST_MIGRATIONS);
