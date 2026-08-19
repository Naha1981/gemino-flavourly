import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);
  return NextResponse.json({ tenant: t });
}

export async function POST(req: Request) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, description, openingHours, aiPersonality, systemPrompt, aiEnabled, manualMode } = body;

    const [updated] = await db
      .update(tenants)
      .set({
        name: name !== undefined ? name : tenant.name,
        description: description !== undefined ? description : tenant.description,
        openingHours: openingHours !== undefined ? openingHours : tenant.openingHours,
        aiPersonality: aiPersonality !== undefined ? aiPersonality : tenant.aiPersonality,
        systemPrompt: systemPrompt !== undefined ? systemPrompt : tenant.systemPrompt,
        aiEnabled: aiEnabled !== undefined ? aiEnabled : tenant.aiEnabled,
        manualMode: manualMode !== undefined ? manualMode : tenant.manualMode,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id))
      .returning();

    return NextResponse.json({ ok: true, tenant: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update settings' }, { status: 500 });
  }
}
