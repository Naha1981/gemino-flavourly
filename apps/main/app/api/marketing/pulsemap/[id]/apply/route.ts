import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveTenant } from '@/lib/tenant-resolver';
import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { marketingCampaigns } from '@/lib/db/schema';
import { getSimulationForTenant, markSimulationApplied } from '@/lib/pulsemap/store';
import { FORECAST_DISCLAIMER } from '@/lib/pulsemap/types';
import { updateMarketingCampaign } from '@/lib/marketing/campaign-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GATE PM-1 — POST /api/marketing/pulsemap/[id]/apply
 *
 * Accept the simulation's improved copy: copies improvedCopy onto the
 * DRAFT campaign's message and stamps applied_at. The owner keeps full
 * control — nothing is sent, the campaign stays a draft until they
 * explicitly launch via the existing launch route.
 *
 * Tenant isolation: the simulation is fetched WHERE tenant_id = caller's
 * tenant AND the campaign is re-verified against the same tenant — a
 * foreign simulation id resolves to 404 and can never rewrite another
 * restaurant's campaign.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const resolved = await resolveActiveTenant();
  if (!resolved) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = resolved.tenant.id;

  const simulation = await getSimulationForTenant(tenantId, params.id);
  if (!simulation) {
    return NextResponse.json({ error: 'Simulation not found' }, { status: 404 });
  }
  if (simulation.status !== 'complete' || !simulation.improvedCopy) {
    return NextResponse.json(
      { error: 'This simulation has no improved copy to apply' },
      { status: 400 },
    );
  }
  if (!simulation.campaignId) {
    return NextResponse.json({ error: 'This simulation is not linked to a campaign' }, { status: 400 });
  }

  const campaign = await db.query.marketingCampaigns.findFirst({
    where: and(eq(marketingCampaigns.id, simulation.campaignId), eq(marketingCampaigns.tenantId, tenantId)),
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: `Only draft campaigns can be updated — this campaign is ${campaign.status}` },
      { status: 409 },
    );
  }

  const updated = await updateMarketingCampaign(tenantId, campaign.id, {
    message: simulation.improvedCopy,
  });
  if (!updated) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  await markSimulationApplied(tenantId, simulation.id, campaign.id);

  return NextResponse.json({
    ok: true,
    campaign: updated,
    appliedFrom: simulation.id,
    disclaimer: FORECAST_DISCLAIMER,
  });
}
