import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { adminNotifications } from '@/lib/db/schema';
import { isNull } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

export const dynamic = 'force-dynamic';

export async function POST() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  try {
    const updated = await db
      .update(adminNotifications)
      .set({ readAt: new Date() })
      .where(isNull(adminNotifications.readAt))
      .returning({ id: adminNotifications.id });

    return NextResponse.json({ ok: true, updated: updated.length });
  } catch (error) {
    console.error('[admin-notifications] mark-read failed:', error);
    return NextResponse.json({ error: 'Could not mark notifications read' }, { status: 500 });
  }
}
