import { NextResponse } from 'next/server';
import { authenticatePublicApi } from '@/lib/api/public-api';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
  try {
    const ctx = await authenticatePublicApi(req);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, ctx.tenantId), columns: { id: true, name: true, slug: true, plan: true, planStatus: true } });
    return NextResponse.json({ data: tenant });
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    return NextResponse.json({ error: 'API error' }, { status: 500 });
  }
}
