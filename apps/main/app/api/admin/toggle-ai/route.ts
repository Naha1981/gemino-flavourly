import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { systemSettings, tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { userId, sessionClaims } = await auth();
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@yourdomain.com';

    // Verify admin access
    const userEmail = (sessionClaims as any)?.email || (sessionClaims as any)?.primary_email;
    if (!userId || (userEmail && userEmail !== adminEmail && process.env.NODE_ENV === 'production')) {
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
