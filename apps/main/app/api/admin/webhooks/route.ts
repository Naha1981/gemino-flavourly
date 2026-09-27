import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic='force-dynamic';

export async function GET(req: Request) {
  if (!(await isSuperAdmin())) return NextResponse.json({ error:'Forbidden' },{status:403});
  const url=new URL(req.url); const limit=Math.min(200,Math.max(1,Number(url.searchParams.get('limit')??100)));
  const result=await db.execute(sql`
    SELECT id, tenant_id, source, event_type, signature_valid, payload, processed_at, created_at
    FROM webhook_events ORDER BY created_at DESC LIMIT ${limit}
  `);
  return NextResponse.json({events:(result as any).rows??result as any[]});
}
