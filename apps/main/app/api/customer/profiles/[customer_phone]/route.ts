import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getProfile, listVisitHistory } from '@/lib/customer/profile-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { customer_phone: string } }
) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const customerPhone = decodeURIComponent(params.customer_phone);
  const profile = await getProfile(tenant.id, customerPhone);
  if (!profile) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const visits = await listVisitHistory(tenant.id, customerPhone, profile.contactId);
  return NextResponse.json({ profile, visits });
}
