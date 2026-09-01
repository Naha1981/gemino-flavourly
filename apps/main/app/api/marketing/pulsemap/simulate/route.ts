import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveTenant } from '@/lib/tenant-resolver';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { marketingCampaigns, systemSettings, tenants } from '@/lib/db/schema';
import { runSimulation, hashSimulationInput } from '@/lib/pulsemap/engine';
import { summarizeSegments } from '@/lib/pulsemap/aggregate';
import { FORECAST_DISCLAIMER, type CampaignDraft } from '@/lib/pulsemap/types';
import {
  fetchMarketSignalForPulseMap,
  fetchPastCampaignsForPulseMap,
  fetchProfileRowsForPulseMap,
  fetchRestaurantContext,
  fetchReviewSignalForPulseMap,
  insertSimulation,
  latestSimulationForCampaign,
} from '@/lib/pulsemap/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GATE PM-1 — POST /api/marketing/pulsemap/simulate
 *
 * Simulates customer reaction to a DRAFT campaign. READS aggregates,
 * WRITES only campaign_simulations rows — this route can never send a
 * campaign message: it does not touch jobs, messages, the outbox, or the
 * operator. (The only writer of send jobs is the launch route.)
 *
 * Tenant isolation: the campaign is loaded WHERE tenant_id = caller's
 * tenant — a foreign campaign id resolves to 404. Super admins may target
 * any tenant via ?tenant= (operator view), the same as every dashboard
 * page.
 *
 * AI rules: Demo Mode → deterministic sample-data forecast (no external
 * calls). Live mode → the approved Groq/Gemini chain behind the
 * masterAiSwitch + aiEnabled guards; ANY AI failure returns the honest
 * "Simulation unavailable" state with no scores.
 */
export async function POST(req: NextRequest) {
  const resolved = await resolveActiveTenant();
  if (!resolved) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = resolved.tenant.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const campaignId = typeof body.campaign_id === 'string' ? body.campaign_id.trim() : '';
  if (!campaignId) {
    return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
  }

  const campaign = await db.query.marketingCampaigns.findFirst({
    where: and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.tenantId, tenantId)),
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: `Only draft campaigns can be simulated — this campaign is ${campaign.status}` },
      { status: 409 },
    );
  }

  const demoMode = await isDemoModeActive();

  // -------------------------------------------------------------- guards
  // Live mode respects the tenant AI budget guard (master kill switch +
  // per-tenant aiEnabled / manualMode). Demo mode needs no AI at all.
  if (!demoMode) {
    const [settings] = await db.select().from(systemSettings).limit(1);
    if (settings && settings.masterAiSwitch === false) {
      return unavailableResponse('AI is switched off for the platform — simulation unavailable.');
    }
    const [tenantRow] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenantRow || tenantRow.aiEnabled === false || tenantRow.manualMode) {
      return unavailableResponse('AI is disabled for this account — simulation unavailable.');
    }
  }

  // ------------------------------------------------------ context inputs
  const scope = demoMode ? { includeDemoRows: true } : {};
  const [profileRows, pastCampaigns, reviewSignal, marketSignal, restaurant] = await Promise.all([
    fetchProfileRowsForPulseMap(tenantId, scope),
    fetchPastCampaignsForPulseMap(tenantId, scope),
    fetchReviewSignalForPulseMap(tenantId, scope),
    fetchMarketSignalForPulseMap(tenantId, scope),
    fetchRestaurantContext(tenantId),
  ]);

  const segmentSummaries = summarizeSegments(profileRows);
  const draft: CampaignDraft = {
    title: campaign.name,
    message: campaign.message,
    offer: campaign.offer,
    targetSegment: campaign.targetSegment,
    sendAt: campaign.startDate ? new Date(campaign.startDate).toISOString() : null,
  };

  const source = demoMode ? 'demo' : 'ai';
  const inputHash = hashSimulationInput({
    draft,
    segmentCounts: segmentSummaries.map((s) => ({ segment: s.segment, count: s.count })),
    source,
    pastCampaignCount: pastCampaigns.length,
    reviewTotal: reviewSignal?.totalReviews ?? 0,
    competitorCount: marketSignal?.competitorCount ?? 0,
  });

  // ------------------------------------------------------------ cache hit
  const cachedRow = await latestSimulationForCampaign(tenantId, campaign.id);
  if (cachedRow && cachedRow.inputHash === inputHash && cachedRow.status === 'complete') {
    return NextResponse.json({
      ok: true,
      cached: true,
      simulation: cachedRow,
      disclaimer: FORECAST_DISCLAIMER,
    });
  }

  // ---------------------------------------------------------------- run
  const outcome = await runSimulation(
    {
      draft,
      restaurant,
      segmentSummaries,
      pastCampaigns,
      reviewSignal,
      marketSignal,
    },
    { mode: demoMode ? 'demo' : 'live' },
  );

  if (outcome.status !== 'complete' || !outcome.forecast) {
    // Honest failure — NOT persisted, NOT scored, nothing sent.
    return NextResponse.json({
      ok: true,
      status: 'unavailable',
      reason: outcome.reason,
      disclaimer: FORECAST_DISCLAIMER,
      simulation: null,
    });
  }

  const simulation = await insertSimulation({
    tenantId,
    campaignId: campaign.id,
    inputHash,
    source: outcome.source,
    outcome,
    segmentSummaries,
  });

  return NextResponse.json({
    ok: true,
    cached: false,
    simulation,
    disclaimer: FORECAST_DISCLAIMER,
  });
}

function unavailableResponse(reason: string) {
  return NextResponse.json({
    ok: true,
    status: 'unavailable',
    reason,
    disclaimer: FORECAST_DISCLAIMER,
    simulation: null,
  });
}
