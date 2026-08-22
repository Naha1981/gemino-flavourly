import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

type AnyDb = ReturnType<typeof drizzleNeon<typeof schema>>;

const globalForDb = globalThis as unknown as { __flavourlyDb?: AnyDb };

let dbInstance: AnyDb | null = globalForDb.__flavourlyDb ?? null;

function trySyncNeon(): AnyDb | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  try {
    const sql = neon(connectionString);
    return drizzleNeon({ client: sql as any, schema }) as AnyDb;
  } catch (err) {
    console.error('[db] Failed to initialise Neon client', err);
    return null;
  }
}

dbInstance = trySyncNeon();

export async function initDb(): Promise<AnyDb> {
  if (dbInstance) return dbInstance;

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { getBootstrapSql } = await import('./bootstrap');
  const { seedDemoWorkspace } = await import('./seed');

  // In-memory by default so Next's first compile does not depend on mkdir.
  // Set PGLITE_DATA_DIR to persist across restarts.
  const dataDir = process.env.PGLITE_DATA_DIR;
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  await client.waitReady;
  await client.exec(getBootstrapSql());
  dbInstance = drizzle(client, { schema }) as unknown as AnyDb;
  globalForDb.__flavourlyDb = dbInstance;
  await seedDemoWorkspace(dbInstance);
  return dbInstance;
}

export const db = new Proxy({} as AnyDb, {
  get(_target, prop, receiver) {
    if (!dbInstance) {
      throw new Error(
        'Database is not ready. Local/demo mode must call await initDb() before querying. Production requires DATABASE_URL.'
      );
    }
    return Reflect.get(dbInstance as object, prop, receiver);
  },
}) as AnyDb;

export function isDbReady(): boolean {
  return dbInstance !== null;
}

export { schema };
