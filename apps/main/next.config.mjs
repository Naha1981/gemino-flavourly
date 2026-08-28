import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * GATE V4/V5 — local gate-harness mode.
 *
 * When GATE_MOCK=1 the webpack build swaps three modules for the mock
 * implementations in lib/gate-mock:
 *
 *   @clerk/nextjs/server -> gate-mock/clerk-server.mock.ts   (mock IdP: who is signed in)
 *   @clerk/nextjs$       -> gate-mock/clerk-client.mock.tsx  (mock IdP UI + presence components)
 *   @/lib/db$            -> gate-mock/pgmem-db.ts            (pg-mem in-memory Postgres,
 *                                                             schema generated from the
 *                                                             project's own migrations)
 *
 * The swap is an EXACT-match alias (the `$` suffix): `@/lib/db/schema`,
 * `@clerk/nextjs/server` subpath imports etc. resolve as usual unless the
 * exact target is mocked.
 *
 * WITHOUT GATE_MOCK=1 this configuration is byte-for-byte the previous
 * config — production, Vercel previews and `next build` are unaffected.
 * (next.config is only read at server start/build time; env gating here is
 * deterministic per process, exactly what a test harness wants.)
 */
const GATE_MOCK = process.env.GATE_MOCK === '1';

if (GATE_MOCK) {
  console.warn('[next.config] GATE_MOCK=1 — Clerk + Neon are REPLACED by the gate harness mocks.');
  console.warn('[next.config]   This must never run on a production deployment.');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  ...(GATE_MOCK
    ? {
        webpack: (config) => {
          // Gate aliases FIRST: webpack resolves alias keys in object order,
          // and Next.js has already registered a tsconfig `@/` prefix alias
          // which would otherwise shadow our exact-match `@/lib/db$` entry.
          config.resolve.alias = {
            // `@/lib/db` — the raw tsconfig-path specifier.
            '@/lib/db$': resolve(here, 'lib/gate-mock/pgmem-db.ts'),
            // Same target via the ABSOLUTE path: Next's JsConfigPathsPlugin
            // (tsconfig `@/*`) re-enters the resolve hook with the
            // absolute path, which the alias above never sees.
            [resolve(here, 'lib/db') + '$']: resolve(here, 'lib/gate-mock/pgmem-db.ts'),
            '@clerk/nextjs/server': resolve(here, 'lib/gate-mock/clerk-server.mock.ts'),
            '@clerk/nextjs$': resolve(here, 'lib/gate-mock/clerk-client.mock.tsx'),
            // The super-admin-gated `GET /api/migrate` endpoint imports the
            // Neon HTTP driver directly; route it at the SAME pg-mem
            // singleton so the app's real runtime-migration DDL runs
            // against the gate database (idempotent by design).
            '@neondatabase/serverless$': resolve(here, 'lib/gate-mock/neon-serverless.mock.ts'),
            ...(config.resolve.alias ?? {}),
          };
          return config;
        },
      }
    : {}),
};

export default nextConfig;
