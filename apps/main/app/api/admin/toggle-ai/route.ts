import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { systemSettings, tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    // isSuperAdmin() fails closed on any missing/unresolvable identity —
    // unlike the previous check here, which trusted sessionClaims.email
    // (usually undefined) and silently let any signed-in user through
    // whenever that field was empty.
    if (!(await isSuperAdmin())) {
      return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
    }

    const { enabled, tenantId } = await req.json();

    if (tenantId) {
      // Toggle for specific tenant
      await db.update(tenants).set({ aiEnabled: !!enabled }).where(eq(tenants.id, tenantId));
      return NextResponse.json({ success: true, tenantId, aiEnabled: !!enabled });
    }

    // Global Master Switch
    let settings = await db.query.systemSettings.findFirst();
    if (!settings) {
      const [newSettings] = await db
        .insert(systemSettings)
        .values({
          masterAiSwitch: !!enabled,
        })
        .returning();
      settings = newSettings;
    } else {
      await db
        .update(systemSettings)
        .set({ masterAiSwitch: !!enabled, updatedAt: new Date() })
        .where(eq(systemSettings.id, settings.id));
    }

    return NextResponse.json({ success: true, globalAiEnabled: !!enabled });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
  }
}
