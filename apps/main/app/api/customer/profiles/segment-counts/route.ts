import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { countBySegment } from '@/lib/customer/segmentation-store';

export const dynamic = 'force-dynamic';

/** Return the signed-in tenant's customer segment totals. */
export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const counts = await countBySegment(tenant.id);
  return NextResponse.json({ counts });
}
