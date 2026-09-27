import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const dynamic='force-dynamic';

export async function GET(){
  const tenant=await getOrCreateTenant();
  if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
  const rows=await db.select({
    id:reservations.id, customerName:reservations.customerName, customerPhone:reservations.customerPhone,
    date:reservations.date, partySize:reservations.partySize, status:reservations.status,
    deposit:reservations.deposit, notes:reservations.notes, customerConfirmedAt:reservations.customerConfirmedAt,
  }).from(reservations).where(eq(reservations.tenantId,tenant.id)).orderBy(desc(reservations.date)).limit(200);
  return NextResponse.json({reservations:rows});
}
