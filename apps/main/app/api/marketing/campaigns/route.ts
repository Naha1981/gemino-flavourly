import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countMarketingCampaigns,
  createMarketingCampaign,
  deleteMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  updateMarketingCampaign,
} from '@/lib/marketing/campaign-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const campaigns = await listMarketingCampaigns(tenant.id);
  return NextResponse.json({ campaigns });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const type = typeof body.type === 'string' ? body.type.trim() : '';

  if (!name || !message || !type) {
    return NextResponse.json({ error: 'name, message, and type are required' }, { status: 400 });
  }

  const allowed = ['promotion', 'event', 'seasonal', 'announcement', 'custom'];
  if (!allowed.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${allowed.join(', ')}` }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const targetSegment = typeof body.target_segment === 'string' ? body.target_segment.trim() : null;
  const offer = typeof body.offer === 'string' ? body.offer.trim() : null;
  const startDate = typeof body.start_date === 'string' ? new Date(body.start_date) : null;
  const endDate = typeof body.end_date === 'string' ? new Date(body.end_date) : null;
  const estimatedReach = typeof body.estimated_reach === 'number' ? body.estimated_reach : null;
  const estimatedRevenueCents = typeof body.estimated_revenue_cents === 'number' ? body.estimated_revenue_cents : null;

  if (startDate && Number.isNaN(startDate.getTime())) {
    return NextResponse.json({ error: 'start_date must be a valid ISO date' }, { status: 400 });
  }
  if (endDate && Number.isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'end_date must be a valid ISO date' }, { status: 400 });
  }

  const campaign = await createMarketingCampaign({
    tenantId: tenant.id,
    name,
    description,
    type,
    targetSegment,
    offer,
    message,
    startDate,
    endDate,
    estimatedReach,
    estimatedRevenueCents,
  });

  return NextResponse.json({ ok: true, campaign }, { status: 201 });
}
