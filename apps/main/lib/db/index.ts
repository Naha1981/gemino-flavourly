import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { neon, neonConfig } from '@neondatabase/serverless';
import * as schema from './schema';

// Disable connection caching for edge runtime compatibility if needed
neonConfig.fetchConnectionCache = true;

const connectionString = process.env.DATABASE_URL || '';

const sql = neon(connectionString);
export const db = drizzleNeon(sql, { schema });

export { schema };
