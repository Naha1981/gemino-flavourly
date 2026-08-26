import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

// `neonConfig.fetchConnectionCache = true` used to be set here — as of
// @neondatabase/serverless >= 0.9, connection caching is always on;
// setting it is a deprecated no-op (it was even logging a warning on
// every build). Removed rather than left as dead config.

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // Build-time exception: `next build` imports every page module during
  // "Collecting page data", so a preview environment without DATABASE_URL
  // would fail the whole build even though no query ever runs at build
  // time. In that phase only, construct the client with a placeholder;
  // NEXT_PHASE is only set by the Next build itself, never at runtime, so
  // a genuinely misconfigured deployment still fails loud below.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.warn('[db] DATABASE_URL unset during build — using placeholder (no queries run at build time)');
  } else {
    // neon('') throws "No database connection string was provided" — an
    // opaque message with no indication of which env var is missing or
    // where to fix it. Since every route in this app imports `db`, that
    // opaque error was surfacing on literally any route the moment
    // DATABASE_URL was unset for any reason (a new Vercel preview
    // environment missing the var, a typo'd variable name, etc.). Fail
    // with a message that actually says what's wrong.
    throw new Error(
      'DATABASE_URL is not set. Add it in Vercel -> Settings -> Environment Variables (and locally in apps/main/.env.local).'
    );
  }
}

const sql = neon(connectionString || 'postgres://build:build@localhost:5432/build_placeholder');
export const db = drizzleNeon(sql, { schema });

export { schema };
