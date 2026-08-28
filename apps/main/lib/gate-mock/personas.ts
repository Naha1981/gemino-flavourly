/**
 * GATE V4/V5 — Mock-identity personas for the local gate harness.
 *
 * The gate harness runs the REAL app (Next.js + Drizzle) against a mocked
 * identity provider and an in-memory Postgres (pg-mem). These constants are
 * the single source of truth for the mock identities: the pg-mem seed in
 * `pgmem-db.ts` provisions rows for exactly these users, and the Playwright
 * fixtures in `e2e/gate-fixtures.ts` present exactly these identities to the
 * app under test.
 *
 * SECURITY MODEL OF THE MOCK — what is mocked and what is NOT:
 *
 *   MOCKED (identity provider only):
 *     - "Is there a signed-in user, and who are they?" (Clerk session).
 *     - The user's email + public metadata, as Clerk would report them.
 *
 *   NOT MOCKED (real application code under test — the whole point of the
 *   gate):
 *     - isSuperAdmin()            — real staff_members lookup + ADMIN_EMAIL
 *                                   allowlist, fail-closed semantics.
 *     - resolveActiveTenant()     — real tenant resolution + isolation guard
 *                                   (guessed foreign tenant ids discarded).
 *     - Every route handler's     — real per-request authorization checks,
 *       authorization logic           tenant scoping (WHERE tenant_id = …),
 *                                   401/403/404 boundaries.
 *     - Webhook HMAC verification — real crypto.verifyWebhookSignature.
 *     - Kill-switch enforcement   — real masterAiSwitch / aiEnabled checks.
 *
 * Identity channel: the mock reads the `x-gate-user` request header first
 * (API calls from Playwright's request contexts), then the `__gate_user`
 * cookie (browser sessions set by the mock sign-in page). Unknown or absent
 * identities resolve to "not signed in" — the app's own fail-closed checks
 * then do the rest. The mock grants NO privilege of its own: a persona can
 * only ever have the privileges its seeded rows (staff_members /
 * memberships / tenants.owner_user_id) grant.
 */

export interface GatePersona {
  /** Stable mock Clerk user id. */
  userId: string;
  /** The email Clerk would report for this user. */
  email: string;
  name: string;
}

export const GATE_PERSONAS = {
  /** Platform operator. Privileged ONLY via seeded staff_members row +
   *  ADMIN_EMAIL env — not by virtue of the mock itself. */
  superAdmin: {
    userId: 'user_gate_superadmin',
    email: 'naha.thabiso@gmail.com',
    name: 'Naha Thabiso',
  },
  /** Owner of Tenant A (The Copper Pot). */
  tenantAOwner: {
    userId: 'user_gate_tenanta',
    email: 'tenanta.owner@flavourly.test',
    name: 'Ama Kgosong',
  },
  /** Owner of Tenant B (Harbor Fish House) — the negative-isolation actor. */
  tenantBOwner: {
    userId: 'user_gate_tenantb',
    email: 'tenantb.owner@flavourly.test',
    name: 'Ben Okafor',
  },
  /** A would-be claimant arriving through the magic link (J4). */
  prospectClaimer: {
    userId: 'user_gate_prospect',
    email: 'prospect.claimer@flavourly.test',
    name: 'Prospect Claimer',
  },
} as const satisfies Record<string, GatePersona>;

export type GatePersonaKey = keyof typeof GATE_PERSONAS;

/** Header carrying the mock identity for API calls (Playwright request fixture). */
export const GATE_USER_HEADER = 'x-gate-user';
/** Cookie carrying the mock identity for browser sessions (mock sign-in page). */
export const GATE_USER_COOKIE = '__gate_user';

// ---------------------------------------------------------------------------
// Deterministic database ids seeded by pgmem-db.ts. Fixed (not random) so
// test specs can reference them without a discovery round-trip.
// ---------------------------------------------------------------------------

export const GATE_IDS = {
  systemSettings: '11111111-1111-4111-8111-111111111111',
  staffSuperAdmin: '22222222-2222-4222-8222-222222222222',

  tenantA: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  tenantB: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb',

  membershipA: '33333333-3333-4333-8333-333333333301',
  membershipB: '33333333-3333-4333-8333-333333333302',

  waAccountA: 'aaaaaa01-0001-4001-8001-000000000001',
  waAccountB: 'bbbbbb01-0001-4001-8001-000000000001',

  contactA1: '44444444-4444-4444-8444-444444444401',
  contactA2: '44444444-4444-4444-8444-444444444402',

  conversationA1: '55555555-5555-4555-8555-555555555501',
  conversationA2: '55555555-5555-4555-8555-555555555502',

  // Tenant A, conversation 1 — one outbound message per delivery state so
  // J6 can assert the inbox renders each state truthfully.
  msgA1Inbound: '66666666-6666-4666-8666-666666666601',
  msgA1AiDelivered: '66666666-6666-4666-8666-666666666602',
  msgA1StaffSent: '66666666-6666-4666-8666-666666666603',
  msgA1StaffQueued: '66666666-6666-4666-8666-666666666604',
  msgA1StaffFailed: '66666666-6666-4666-8666-666666666605',
  msgA1StaffUnknown: '66666666-6666-4666-8666-666666666606',
  // Conversation 2 — legacy message written before delivery tracking
  // existed (NULL status must render with NO tick at all).
  msgA2Inbound: '66666666-6666-4666-8666-666666666607',
  msgA2Legacy: '66666666-6666-4666-8666-666666666608',
} as const;
