import { db, initDb } from '@/lib/db';
import { staffMembers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getSessionUser } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/config';

export async function isSuperAdmin(): Promise<boolean> {
  const session = await getSessionUser();
  if (!session) return false;
  if (isDemoMode()) return true;

  await initDb();

  const staffRow = await db.query.staffMembers
    .findFirst({
      where: and(eq(staffMembers.clerkUserId, session.userId), eq(staffMembers.role, 'super_admin')),
    })
    .catch(() => null);
  if (staffRow) return true;

  const allowlist = `${process.env.SUPER_ADMIN_EMAILS ?? ''},${process.env.ADMIN_EMAIL ?? ''}`
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) return false;

  return allowlist.includes(session.email.toLowerCase());
}
