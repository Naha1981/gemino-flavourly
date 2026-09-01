/**
 * GATE V4/V5 — In-memory Postgres (pg-mem) for the local gate harness.
 *
 * Active ONLY when GATE_MOCK=1 (the webpack alias in next.config.mjs swaps
 * this module in for `@/lib/db`, which uses Neon). The app under test then
 * runs its REAL Drizzle queries against an in-memory Postgres that is:
 *
 *   1. shaped by the project's own migrations — `ddl.sql` is generated from
 *      apps/main/drizzle/*.sql by scripts/gen-gate-ddl.mjs (no hand-written
 *      schema that could drift from production);
 *   2. seeded with the deterministic gate personas (see personas.ts):
 *      super admin, Tenant A owner, Tenant B owner, their tenants, WhatsApp
 *      accounts, contacts, conversations and one outbound message per
 *      delivery state (so J6 can verify truthful delivery rendering).
 *
 * The db instance is stored on globalThis so Next.js HMR / module
 * re-evaluation during `next dev` does not fork the database into per-module
 * copies (the classic "my data disappeared" dev-server trap).
 *
 * pg-mem compatibility notes (all handled below, all reported):
 *   - gen_random_uuid() is not implemented → registered
 *     (crypto.randomUUID, `impure: true` so pg-mem's planner does not cache
 *     the column default — without it every row got the same id);
 *   - `CREATE TABLE IF NOT EXISTS` on an already-existing table (duplicate
 *     DDL across migrations 0011/0012) is skipped via the table registry;
 *   - partial indexes are not supported → skipped (they are planner hints,
 *     not correctness invariants; the app's idempotency guards are the
 *     source of truth, not the indexes);
 *   - failed statements are COLLECTED, not swallowed: `gateDdlReport()`
 *     exposes them and the boot log prints them, so a schema/pg-mem
 *     incompatibility is always visible in the gate evidence.
 */
import { randomUUID } from 'node:crypto';
import { newDb, type IMemoryDb } from 'pg-mem';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { GATE_IDS, GATE_PERSONAS } from './personas';
import { GATE_DDL } from './ddl.generated';

interface GateDbModule {
  mem: IMemoryDb;
  pool: import('pg').Pool;
  db: ReturnType<typeof drizzlePg<typeof schema>>;
  ddlReport: { ok: number; failed: { head: string; error: string }[] };
  seeded: boolean;
}

const g = globalThis as unknown as { __gatePgmem?: GateDbModule };

/**
 * pg-mem compatibility patches, applied to the MemPg class returned by
 * `adapters.createPg()` (a fresh class per call, so patching the one class
 * we instantiate is precise — no global side effects).
 *
 * 1. `rowMode: 'array'` — drizzle-orm's node-postgres session sends it for
 *    every field-mapped query (`.select()`, relational `db.query.*`, …) and
 *    then maps the result rows POSITIONALLY (`row[columnIndex]`). pg-mem
 *    rejects `rowMode` outright ("Not supported: pg rowMode"), which would
 *    break virtually the whole app. The patch intercepts `adaptResults`,
 *    runs the query in pg-mem's native object-row mode, and re-projects each
 *    row into an array using the engine's own result-field order — exactly
 *    what node-postgres would have returned in array mode.
 *
 * 2. `CREATE TABLE IF NOT EXISTS` on an already-existing table — pg-mem
 *    crashes in its planner on the "not exists" re-parse path ("Not
 *    supported" for inline PRIMARY KEY / NOT NULL constraints) instead of
 *    being a no-op. Real Postgres is a no-op here, and the app's own
 *    super-admin-gated `GET /api/migrate` relies on that (it re-declares
 *    tables like staff_members/memberships/prospects on every run). The
 *    patch short-circuits such statements to a successful empty result —
 *    the exact Postgres semantics.
 */
function patchPgmemCompat(PoolCtor: new () => unknown, mem: IMemoryDb): void {
  const proto = (PoolCtor as unknown) as {
    prototype: {
      adaptResults?: (
        query: { rowMode?: string } | string,
        res: { rows: Record<string, unknown>[]; fields: { name: string }[] },
      ) => { rows: Record<string, unknown>[] };
      query?: (
        query: unknown,
        valuesOrCallback?: unknown,
        callback?: unknown,
      ) => unknown;
    };
    __gatePatched?: boolean;
  };
  if (proto.__gatePatched || !proto.prototype.adaptResults || !proto.prototype.query) {
    return;
  }

  const origAdapt = proto.prototype.adaptResults;
  proto.prototype.adaptResults = function patchedAdaptResults(
    query: { rowMode?: string } | string,
    res: { rows: Record<string, unknown>[]; fields: { name: string }[] },
  ) {
    if (query && typeof query === 'object' && query.rowMode === 'array') {
      // Run in object mode, then emit positional rows (field order = the
      // engine's own SELECT-list order, i.e. what node-pg would return).
      const out = origAdapt.call(this, { ...query, rowMode: undefined }, res);
      const names = (res.fields ?? []).map((f) => f.name);
      if (Array.isArray(out.rows) && names.length > 0) {
        // Positional arrays (node-pg's array rowMode contract) in the slot
        // whose declared type is object rows — the drizzle driver consumes
        // them positionally, which is the whole point of this emulation.
        out.rows = out.rows.map((row) => names.map((n) => row[n] ?? null)) as unknown as typeof out.rows;
      }
      return out;
    }
    return origAdapt.call(this, query, res);
  };

  const origQuery = proto.prototype.query;
  const relMap = (mem.public as unknown as { relsByNameCas?: Map<string, unknown> }).relsByNameCas;
  const sqlDebug = process.env.GATE_DEBUG_SQL === '1';
  if (sqlDebug) {
    console.log('[gate-mock] GATE_DEBUG_SQL=1 — logging every SQL statement');
  }
  const seenSql = new Map<string, number>();
  // `query` is typed unknown (the Pool.prototype.query slot accepts it);
  // the two shapes actually observed are a plain string or a config object.
  proto.prototype.query = function patchedQuery(
    query: unknown,
    valuesOrCallback?: unknown,
    callback?: unknown,
  ) {
    const q = query as { text?: string; rowMode?: string } | string;
    const text = typeof q === 'string' ? q : q?.text;
    if (sqlDebug && text) {
      const head = text.replace(/\s+/g, ' ').slice(0, 110);
      const n = (seenSql.get(head) ?? 0) + 1;
      seenSql.set(head, n);
      const params = Array.isArray(valuesOrCallback) ? JSON.stringify(valuesOrCallback).slice(0, 160) : '';
      console.log(`[gate-sql #${n}] ${head} ${params}`);
    }
    if (text && relMap) {
      const m = text.match(
        /^\s*CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:PUBLIC\s+)?["']?(\w+)["']?/i,
      );
      if (m && relMap.has(m[1].toLowerCase())) {
        // Postgres no-op semantics for CREATE TABLE IF NOT EXISTS.
        const result = { command: 'CREATE TABLE', rowCount: 0, rows: [] as unknown[] };
        if (typeof callback === 'function') {
          (callback as (e: null, r: typeof result) => void)(null, result);
          return null;
        }
        return Promise.resolve(result);
      }
    }
    return origQuery.call(this, query, valuesOrCallback, callback);
  };

  proto.__gatePatched = true;
  console.log(
    '[gate-mock] pg-mem patched: rowMode "array" emulated for drizzle; CREATE TABLE IF NOT EXISTS no-op on existing tables',
  );
}

function buildGateDb(): GateDbModule {
  // ------------------------------------------------------------------ DDL
  // GATE_DDL is the same statement list as ddl.sql, inlined by
  // scripts/gen-gate-ddl.mjs — fs reads are unreliable inside
  // webpack-bundled server modules (__dirname is the .next build dir).
  const DELIM = '-- @@GATE-STATEMENT@@';
  const ddl = GATE_DDL;
  const statements = ddl
    .split(new RegExp(`${DELIM}\\s*`))
    .map((s) => s.replace(/^(?:--[^\n]*\n)+/, '').trim())
    .filter(Boolean);

  const mem = newDb();
  // `impure: true` is REQUIRED: pg-mem otherwise treats the function as
  // pure/stable, and its planner CACHES column-default expressions — the
  // `DEFAULT gen_random_uuid()` would then hand every inserted row the SAME
  // id (PK collision on the second row of any table). Real Postgres'
  // gen_random_uuid() is VOLATILE, hence `impure`.
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    // 'uuid' is the real pg type name; pg-mem's DataType union (from
    // pgsql-ast-parser) does not list it, but it is accepted at runtime
    // (verified: 326/326 DDL + all gate journeys). Cast to the declared type.
    returns: 'uuid' as unknown as Parameters<typeof mem.public.registerFunction>[0]['returns'],
    impure: true,
    implementation: () => randomUUID(),
  });

  const failed: { head: string; error: string }[] = [];
  let ok = 0;
  // pg-mem's case-insensitive relation registry (tables + indexes), used
  // below to skip duplicate `CREATE TABLE IF NOT EXISTS` statements.
  const relMap = (
    mem.public as unknown as { relsByNameCas?: Map<string, unknown> }
  ).relsByNameCas;

  for (const stmt of statements) {
    // pg-mem bug: `CREATE TABLE IF NOT EXISTS` re-evaluates constraints even
    // when the table already exists (duplicate DDL in migrations 0011/0012
    // and again in the /api/migrate runtime DDL).
    const ctine = stmt.match(/^CREATE TABLE IF NOT EXISTS\s+["']?(\w+)["']?/i);
    if (ctine && relMap?.has(ctine[1].toLowerCase())) {
      ok += 1;
      continue;
    }
    try {
      mem.public.none(stmt);
      ok += 1;
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      // Partial indexes are planner hints, unsupported by pg-mem — skip,
      // but record so the report can distinguish "known gap" from "real
      // breakage".
      const isKnownGap = /WHERE\b/i.test(stmt.match(/^CREATE [A-Z ]+ INDEX[\s\S]*$/im)?.[0] ?? '') &&
        /Not supported/i.test(msg);
      failed.push({
        head: stmt.slice(0, 100).replace(/\s+/g, ' '),
        error: msg.slice(0, 240),
        ...(isKnownGap ? { knownGap: true } : {}),
      } as { head: string; error: string; knownGap?: boolean });
    }
  }

  // ---------------------------------------------------------------- Pool
  // pg-mem exposes a `pg`-compatible client layer; the drizzle node-postgres
  // driver consumes its Pool exactly like a real one.
  const pgAdapter = mem.adapters.createPg() as unknown as {
    Pool: new () => import('pg').Pool;
  };
  patchPgmemCompat(pgAdapter.Pool, mem);
  const pool = new pgAdapter.Pool();

  // ---------------------------------------------------------------- DO $$
  // pg-mem cannot execute plpgsql, so `DO $$ ... $$` blocks throw
  // "Unknown language plpgsql". The only DO blocks in this schema are
  // drizzle-kit's FK idiom — and since PR #36 they are shipped VERBATIM in
  // lib/db/base-ddl.ts and applied at RUNTIME by GET /api/migrate (which
  // the gate executes for real via the neon mock):
  //
  //   DO $$ BEGIN
  //     ALTER TABLE "x" ADD CONSTRAINT "c" FOREIGN KEY ...;
  //   EXCEPTION
  //     WHEN duplicate_object THEN null;
  //   END $$;
  //
  // That block means exactly "add the constraint if it is not there yet",
  // so executing the inner ALTER TABLE directly is a faithful emulation —
  // not a weakening: (a) all 20 blocks in base-ddl.ts match this strict
  // shape (verified), (b) pg-mem is already idempotent for ADD CONSTRAINT
  // (verified: duplicate constraint add is a no-op), and (c) the catch
  // below replicates the duplicate_object swallow should the engine ever
  // stop being so. Non-matching SQL is passed through completely untouched.
  const DO_BLOCK = /^DO\s+\$\$\s*BEGIN\s*([\s\S]*?)(?:EXCEPTION\s+WHEN\s+duplicate_object\s+THEN\s+null\s*;)?\s*END\s+\$\$;?\s*$/i;
  const doBlockInner = (sqlText: string): string | null => {
    const m = sqlText.match(DO_BLOCK);
    if (!m) return null;
    const inner = m[1].match(/^\s*ALTER\s+TABLE[\s\S]*?;\s*$/i);
    return inner ? inner[0].trim() : null;
  };
  const rawPoolQuery = pool.query.bind(pool);
  pool.query = (async (
    text: string | { text: string; values?: unknown[] },
    values?: unknown[],
  ) => {
    const sqlText = typeof text === 'string' ? text : text?.text;
    if (typeof sqlText === 'string') {
      const inner = doBlockInner(sqlText.trim());
      if (inner) {
        try {
          return await rawPoolQuery(inner, []);
        } catch (err) {
          // The DO block's EXCEPTION WHEN duplicate_object branch.
          const msg = String(err instanceof Error ? err.message : err);
          if (/already exists|duplicate/i.test(msg)) return { command: 'DO', rowCount: 0, rows: [] };
          throw err;
        }
      }
    }
    return rawPoolQuery(text as string, values as unknown[]);
  }) as unknown as typeof pool.query;

  const db = drizzlePg(pool, { schema });

  // ----------------------------------------------------------------- Seed
  // IMPORTANT: pg-mem mutates its store SYNCHRONOUSLY when a query is
  // invoked (the returned promise settles later, but the state change is
  // immediate — verified during harness build). We therefore fire the seed
  // inserts WITHOUT awaits, in FK dependency order: by the time module
  // evaluation returns, every seed row already exists, so the first request
  // the dev server handles can never race a half-seeded database.
  // (The globalThis singleton above guarantees the seed runs once per boot;
  // a fresh boot gets a fresh, empty DB, so no existence check is needed.)
  let seeded = false;
  const seedErrors: string[] = [];
  const now = Date.now();
  const trialEndsAt = new Date(now + 14 * 24 * 60 * 60 * 1000);

  const seededInserts: Promise<unknown>[] = [];
  const track = <T>(p: Promise<T>): Promise<T> =>
    p.catch((err: unknown) => {
      seedErrors.push(String(err instanceof Error ? err.message : err).slice(0, 200));
      throw err;
    });

  // system_settings — master kill switch STARTS ON (J7 flips it OFF).
  seededInserts.push(
    track(
      db.insert(schema.systemSettings).values({
        id: GATE_IDS.systemSettings,
        masterAiSwitch: true,
        maintenanceMode: false,
        demoSeedActive: false,
      }),
    ),
  );

  // Tenants A & B — both live trialing tenants, AI enabled.
  seededInserts.push(
    track(
      db.insert(schema.tenants).values({
        id: GATE_IDS.tenantA,
        name: 'The Copper Pot',
        slug: 'copper-pot',
        ownerEmail: GATE_PERSONAS.tenantAOwner.email,
        ownerUserId: GATE_PERSONAS.tenantAOwner.userId,
        tenantMode: 'live',
        aiEnabled: true,
        manualMode: false,
        planStatus: 'trialing',
        trialEndsAt,
        onboardingComplete: true,
      }),
    ),
    track(
      db.insert(schema.tenants).values({
        id: GATE_IDS.tenantB,
        name: 'Harbor Fish House',
        slug: 'harbor-fish-house',
        ownerEmail: GATE_PERSONAS.tenantBOwner.email,
        ownerUserId: GATE_PERSONAS.tenantBOwner.userId,
        tenantMode: 'live',
        aiEnabled: true,
        manualMode: false,
        planStatus: 'trialing',
        trialEndsAt,
        onboardingComplete: true,
      }),
    ),
    // UI-3R — Tenant C: the disconnected, EMPTY live tenant (the exact state
    // the owner's screenshots were taken in). Connected once (so the Overview
    // renders rather than redirecting to the QR page) but now disconnected,
    // with no data rows at all: every widget must show honest zeros.
    track(
      db.insert(schema.tenants).values({
        id: GATE_IDS.tenantC,
        name: 'Rosebank Corner Bistro',
        slug: 'rosebank-corner-bistro',
        ownerEmail: GATE_PERSONAS.tenantCOwner.email,
        ownerUserId: GATE_PERSONAS.tenantCOwner.userId,
        tenantMode: 'live',
        aiEnabled: true,
        manualMode: false,
        planStatus: 'trialing',
        trialEndsAt,
        onboardingComplete: true,
      }),
    ),
  );

  // Staff — the super admin row (isSuperAdmin() path 1). The ADMIN_EMAIL
  // env (path 2) is configured independently by the harness env file;
  // together they mirror the production allowlist.
  seededInserts.push(
    track(
      db.insert(schema.staffMembers).values({
        id: GATE_IDS.staffSuperAdmin,
        clerkUserId: GATE_PERSONAS.superAdmin.userId,
        email: GATE_PERSONAS.superAdmin.email,
        name: GATE_PERSONAS.superAdmin.name,
        role: 'super_admin',
      }),
    ),
  );

  // Ownership memberships (tenant resolver path 3).
  seededInserts.push(
    track(
      db.insert(schema.memberships).values({
        id: GATE_IDS.membershipA,
        userId: GATE_PERSONAS.tenantAOwner.userId,
        tenantId: GATE_IDS.tenantA,
        role: 'owner',
      }),
    ),
    track(
      db.insert(schema.memberships).values({
        id: GATE_IDS.membershipB,
        userId: GATE_PERSONAS.tenantBOwner.userId,
        tenantId: GATE_IDS.tenantB,
        role: 'owner',
      }),
    ),
    track(
      db.insert(schema.memberships).values({
        id: GATE_IDS.membershipC,
        userId: GATE_PERSONAS.tenantCOwner.userId,
        tenantId: GATE_IDS.tenantC,
        role: 'owner',
      }),
    ),
  );

  // WhatsApp accounts (connected, so dispatch is not blocked on linkage).
  seededInserts.push(
    track(
      db.insert(schema.waAccounts).values({
        id: GATE_IDS.waAccountA,
        tenantId: GATE_IDS.tenantA,
        phoneNumber: '+27821110001',
        isConnected: true,
        status: 'connected',
        lastConnectedAt: new Date(now),
      }),
    ),
    track(
      db.insert(schema.waAccounts).values({
        id: GATE_IDS.waAccountB,
        tenantId: GATE_IDS.tenantB,
        phoneNumber: '+27821110002',
        isConnected: true,
        status: 'connected',
        lastConnectedAt: new Date(now),
      }),
    ),
    // UI-3R — Tenant C's account: connected once (lastConnectedAt set, so the
    // Overview renders rather than redirecting to onboarding) but now
    // disconnected — the honest-banner + honest-zeros state.
    track(
      db.insert(schema.waAccounts).values({
        id: GATE_IDS.waAccountC,
        tenantId: GATE_IDS.tenantC,
        phoneNumber: '+27821110003',
        isConnected: false,
        status: 'disconnected',
        lastConnectedAt: new Date(now - 3 * 24 * 3600_000),
      }),
    ),
  );

  // Tenant A — two customers, two conversations.
  seededInserts.push(
    track(
      db.insert(schema.contacts).values({
        id: GATE_IDS.contactA1,
        tenantId: GATE_IDS.tenantA,
        phone: '+27825550001',
        name: 'Thabo Mokoena',
      }),
    ),
    track(
      db.insert(schema.contacts).values({
        id: GATE_IDS.contactA2,
        tenantId: GATE_IDS.tenantA,
        phone: '+27825550002',
        name: 'Lerato Khumalo',
      }),
    ),
    track(
      db.insert(schema.conversations).values({
        id: GATE_IDS.conversationA1,
        tenantId: GATE_IDS.tenantA,
        contactId: GATE_IDS.contactA1,
        waAccountId: GATE_IDS.waAccountA,
        manualTakeover: false,
        isResolved: false,
        lastMessageAt: new Date(now - 3600_000),
      }),
    ),
    track(
      db.insert(schema.conversations).values({
        id: GATE_IDS.conversationA2,
        tenantId: GATE_IDS.tenantA,
        contactId: GATE_IDS.contactA2,
        waAccountId: GATE_IDS.waAccountA,
        manualTakeover: false,
        isResolved: false,
        lastMessageAt: new Date(now - 7200_000),
      }),
    ),
  );

  // Conversation 1 — one outbound message per delivery state (J6), plus
  // conversation 2's legacy rows (NULL delivery status = pre-tracking).
  const base = now - 3600_000;
  seededInserts.push(
    track(
      db.insert(schema.messages).values([
        {
          id: GATE_IDS.msgA1Inbound,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA1,
          direction: 'inbound',
          content: 'Hi! Do you have vegan options? Table for 2 tomorrow 7pm?',
          isAIGenerated: false,
          createdAt: new Date(base + 60_000),
        },
        {
          id: GATE_IDS.msgA1AiDelivered,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA1,
          direction: 'outbound',
          content:
            'Yes! We have several vegan dishes — see our full menu. And a table for 2 at 19:00 tomorrow: would you like to book? 🌿',
          isAIGenerated: true,
          deliveryStatus: 'delivered',
          createdAt: new Date(base + 120_000),
        },
        {
          id: GATE_IDS.msgA1StaffSent,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA1,
          direction: 'outbound',
          content: 'Booked! Table for 2, tomorrow 19:00. See you then!',
          isAIGenerated: false,
          deliveryStatus: 'sent',
          createdAt: new Date(base + 240_000),
        },
        {
          id: GATE_IDS.msgA1StaffQueued,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA1,
          direction: 'outbound',
          content: 'Reminder: your table for 2 is set for 19:00 tomorrow. 🕗',
          isAIGenerated: false,
          deliveryStatus: 'queued',
          createdAt: new Date(base + 300_000),
        },
        {
          id: GATE_IDS.msgA1StaffFailed,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA1,
          direction: 'outbound',
          content: 'Our menu just updated — try the new vegan biryani!',
          isAIGenerated: false,
          deliveryStatus: 'failed',
          deliveryError: 'WhatsApp session disconnected; retries exhausted after 5 attempts',
          createdAt: new Date(base + 320_000),
        },
        {
          id: GATE_IDS.msgA1StaffUnknown,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA1,
          direction: 'outbound',
          content: 'We accept card and cash at the counter.',
          isAIGenerated: false,
          deliveryStatus: 'unknown',
          createdAt: new Date(base + 340_000),
        },
        // Conversation 2 — legacy rows predating delivery tracking (NULL
        // status must render with NO tick at all — not a fake green one).
        {
          id: GATE_IDS.msgA2Inbound,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA2,
          direction: 'inbound',
          content: 'Booking for Saturday, 6 people possible?',
          isAIGenerated: false,
          createdAt: new Date(base + 360_000),
        },
        {
          id: GATE_IDS.msgA2Legacy,
          tenantId: GATE_IDS.tenantA,
          conversationId: GATE_IDS.conversationA2,
          direction: 'outbound',
          content: 'Yes, 6 is no problem! What time works best for you?',
          isAIGenerated: false,
          deliveryStatus: null,
          createdAt: new Date(base + 400_000),
        },
      ]),
    ),
  );

  // All insert mutations above have already happened synchronously at call
  // time; the promise chain is only for surfacing errors in the report.
  Promise.allSettled(seededInserts).then((results) => {
    const bad = results.filter((r) => r.status === 'rejected').length;
    seeded = bad === 0;
    if (bad > 0) {
      console.error(`[gate-mock] SEED INCOMPLETE: ${bad} insert(s) failed:`, seedErrors);
    }
  });

  const gateModule: GateDbModule = { mem, pool, db, ddlReport: { ok, failed }, seeded };
  console.log(
    `[gate-mock] pg-mem ready: DDL ${ok}/${ok + failed.length} statements OK` +
      (failed.length ? ` — ${failed.length} skipped/failed (see gateDdlReport)` : ''),
  );
  for (const f of failed) {
    console.warn(`[gate-mock]   DDL issue: ${f.head} :: ${f.error.slice(0, 120)}`);
  }
  return gateModule;
}

function gateDbInstance(): GateDbModule {
  if (!g.__gatePgmem) {
    g.__gatePgmem = buildGateDb();
  }
  return g.__gatePgmem;
}

/** Synchronous db export — mirrors `@/lib/db`'s `export const db`. */
export const db = gateDbInstance().db;

/** The pg-mem instance + reports, for diagnostics (harness warm-up). */
export const gateDb = {
  instance: gateDbInstance,
  report: () => gateDbInstance().ddlReport,
  isSeeded: () => gateDbInstance().seeded,
};

export { schema };
