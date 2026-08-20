import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { staffMembers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * The one place that decides "is this signed-in user allowed to touch
 * platform-wide / cross-tenant operations" (Super Admin dashboard, the
 * global AI kill switch, running schema migrations).
 *
 * Two independent ways in, either is sufficient:
 *   1. `staff_members` row for this Clerk user with role = 'super_admin'
 *   2. Email matches ADMIN_EMAIL (comma-separated list supported)
 *
 * Important: this reads the email via a live Clerk API call
 * (`clerkClient().users.getUser`), NOT `sessionClaims.email`. Clerk does
 * not include email in the default session JWT, so `sessionClaims.email`
 * is `undefined` for most setups unless a custom session claim has been
 * configured — code that branches on it silently fails open (any signed-in
 * user passes) or fails closed by accident, neither of which is what you
 * want for an admin gate. A live API call is slightly slower but correct.
 *
 * Fails closed: any error, missing user, or unset ADMIN_EMAIL/no matching
 * staff row all resolve to `false`.
 */
export async function isSuperAdmin(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;

  // Path 1: explicit staff_members role, independent of email config.
  const staffRow = await db.query.staffMembers
    .findFirst({
      where: and(eq(staffMembers.clerkUserId, userId), eq(staffMembers.role, 'super_admin')),
    })
    .catch(() => null);
  if (staffRow) return true;

  // Path 2: ADMIN_EMAIL / SUPER_ADMIN_EMAILS allowlist, checked against the
  // user's real email via the Clerk API (not sessionClaims).
  const allowlist = `${process.env.SUPER_ADMIN_EMAILS ?? ''},${process.env.ADMIN_EMAIL ?? ''}`
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false;

  try {
    const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
    const user = await client.users.getUser(userId);
    const emails: string[] = (user.emailAddresses ?? []).map((e: any) => e.emailAddress.toLowerCase());
    return emails.some((email) => allowlist.includes(email));
  } catch {
    return false;
  }
}
