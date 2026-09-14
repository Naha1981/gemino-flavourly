import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { marketOpportunities } from '@/lib/db/schema';
import { createMarketingCampaign } from '@/lib/marketing/campaign-store';

export const dynamic = 'force-dynamic';

/**
 * Turns a detected revenue/market opportunity into a safe DRAFT campaign.
 * It never sends WhatsApp or publishes socially; the existing campaign
 * approval/launch flow remains the only dispatch path.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = params;
  const [opportunity] = await db
    .select()
    .from(marketOpportunities)
    .where(and(eq(marketOpportunities.id, id), eq(marketOpportunities.tenantId, tenant.id)))
    .limit(1);

  if (!opportunity) return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  if (opportunity.addressed) return NextResponse.json({ error: 'Opportunity already addressed' }, { status: 409 });

  const campaign = await createMarketingCampaign({
    tenantId: tenant.id,
    name: opportunity.title,
    description: opportunity.description,
    type: 'promotion',
    targetSegment: null,
    offer: null,
    message: `${opportunity.title}\n\n${opportunity.description}\n\nReply BOOK to reserve your table.`,
    startDate: null,
    endDate: null,
    estimatedReach: null,
    estimatedRevenueCents: null,
  });

  return NextResponse.json({ ok: true, campaign, opportunityId: opportunity.id }, { status: 201 });
}
