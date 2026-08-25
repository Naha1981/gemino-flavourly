import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { createCompetitor, listCompetitors } from '@/lib/reputation/competitor-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ competitors: await listCompetitors(tenant.id) });
}

export async function POST(req: Request) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { name, placeId } = await req.json();
  if (!name || !placeId) return NextResponse.json({ error: 'name and placeId are required' }, { status: 400 });
  return NextResponse.json({ competitor: (await createCompetitor(tenant.id, name, placeId))[0] }, { status: 201 });
}
