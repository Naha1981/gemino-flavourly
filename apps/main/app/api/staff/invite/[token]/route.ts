import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { memberships, staffMembers } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const { token } = await ctx.params;
  const hash = await import('crypto').then(({ createHash }) => createHash('sha256').update(token).digest('hex'));

  const result = await db.execute(sql`SELECT * FROM staff_invites WHERE token_hash = ${hash} AND accepted_at IS NULL AND expires_at > NOW() LIMIT 1`);
  const invite = ((result as any).rows?.[0] ?? (result as any)[0]);
  if (!invite) return NextResponse.json({ error: 'Invite is invalid or expired' }, { status: 410 });

  const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId);
  const emails = (user.emailAddresses ?? []).map((e: any) => String(e.emailAddress).toLowerCase());
  if (!emails.includes(String(invite.email).toLowerCase())) return NextResponse.json({ error: 'Signed-in email does not match the invitation' }, { status: 403 });

  await db.insert(staffMembers).values({ tenantId: invite.tenant_id, clerkUserId: userId, email: invite.email, name: [user.firstName,user.lastName].filter(Boolean).join(' ') || invite.email, role: invite.role }).onConflictDoNothing().catch(()=>undefined);
  await db.insert(memberships).values({ userId, tenantId: invite.tenant_id, role: 'staff' }).onConflictDoNothing();
  await db.execute(sql`UPDATE staff_invites SET accepted_at = NOW() WHERE id = ${invite.id}`);
  return NextResponse.json({ ok: true, tenantId: invite.tenant_id });
}
