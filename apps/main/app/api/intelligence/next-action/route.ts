import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await db.execute(sql`
    SELECT intent, score, next_action, evidence, created_at
    FROM intent_scores
    WHERE tenant_id = ${tenant.id}
    ORDER BY created_at DESC
    LIMIT 20
  `);
  return NextResponse.json({ actions: (result as any).rows ?? result as any[] });
}
