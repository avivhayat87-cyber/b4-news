import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema';

export type Schema = typeof schema;
/** Driver-agnostic database handle used across the API and workers. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export type DbHandle = {
  db: Db;
  kind: 'pglite' | 'postgres';
  migrate(): Promise<void>;
  close(): Promise<void>;
};

const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Local default: an embedded PostgreSQL stored in <repo>/.data/b4 (no install needed). */
export function defaultDatabaseUrl(): string {
  return `pglite:${fileURLToPath(new URL('../../../.data/b4', import.meta.url))}`;
}

/**
 * DATABASE_URL forms:
 *   postgres://user:pass@host:5432/db   PostgreSQL (production)
 *   pglite:<folder>                     embedded PostgreSQL stored on disk (local development)
 *   memory:                             embedded PostgreSQL in memory (tests)
 */
export function createDb(url: string): DbHandle {
  if (url === 'memory:' || url.startsWith('pglite:')) {
    const dataDir = url === 'memory:' ? undefined : url.slice('pglite:'.length);
    if (dataDir) mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(dataDir);
    const db = drizzlePglite({ client, schema, casing: 'snake_case' });
    return {
      db: db as unknown as Db,
      kind: 'pglite',
      migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_DIR }),
      close: () => client.close(),
    };
  }

  const client = postgres(url, { max: 10 });
  const db = drizzlePostgres({ client, schema, casing: 'snake_case' });
  return {
    db: db as unknown as Db,
    kind: 'postgres',
    migrate: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_DIR }),
    close: () => client.end(),
  };
}
