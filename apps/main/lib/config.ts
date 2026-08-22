/**
 * Runtime mode. Production (Vercel + Clerk + Neon) never enters demo.
 * Arena / local previews without secrets still render a working restaurant.
 */
export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY
  );
}

export function isDemoMode(): boolean {
  if (process.env.GEMINO_DEMO === '1') return true;
  if (process.env.GEMINO_DEMO === '0') return false;
  return !isClerkConfigured();
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export const DEMO_USER = {
  userId: 'demo-owner',
  email: 'amara@themarularoom.za',
  firstName: 'Amara',
  lastName: 'Ndlovu',
} as const;

export const DEMO_TENANT_SLUG = 'the-marula-room';
