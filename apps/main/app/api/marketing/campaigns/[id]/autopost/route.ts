import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { marketingCampaigns } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';
import { isDemoModeActive } from '@/lib/demo/demo-mode';
import { getOpenPostClient } from '@/lib/autopost/openpost';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketing/campaigns/[id]/autopost
 *
 * Explicit owner approval gate for social publishing.
 * - Drafts cannot publish without this action.
 * - Real mode requires OpenPost + a workspace + connected account ids.
 * - Demo mode may walk the approval flow without contacting a social network.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  void req;
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canSendAutomatedMessages(tenant.id))) {
    return NextResponse.json({ error: 'Billing inactive — renew to resume AI and campaigns' }, { status: 402 });
  }

  const campaign = await db.query.marketingCampaigns.findFirst({
    where: and(eq(marketingCampaigns.id, params.id), eq(marketingCampaigns.tenantId, tenant.id)),
  });
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (campaign.status !== 'draft') {
    return NextResponse.json({ error: `Campaign already ${campaign.status}` }, { status: 409 });
  }

  const demoMode = await isDemoModeActive();
  const client = getOpenPostClient();
  const workspaceId = process.env.OPENPOST_WORKSPACE_ID?.trim();
  const socialAccountIds = (process.env.OPENPOST_SOCIAL_ACCOUNT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (!client || !workspaceId || socialAccountIds.length === 0) {
    if (!demoMode) {
      return NextResponse.json(
        { error: 'AutoPost is not configured. Connect OpenPost and at least one social account before approving this campaign.' },
        { status: 503 },
      );
    }

    await db
      .update(marketingCampaigns)
      .set({ status: 'scheduled' })
      .where(and(eq(marketingCampaigns.id, campaign.id), eq(marketingCampaigns.tenantId, tenant.id)));

    return NextResponse.json({ ok: true, approved: true, mode: 'demo', published: false, message: 'Demo approval recorded. No social network was contacted.' });
  }

  try {
    const publication = await client.createPublication({
      workspaceId,
      title: campaign.name,
      sourceText: campaign.message,
      contentProfile: 'short_text',
      socialAccountIds,
    });

    const publicationId = typeof publication.id === 'string' ? publication.id : null;
    if (!publicationId) throw new Error('OpenPost returned no publication id');

    if (campaign.startDate && new Date(campaign.startDate).getTime() > Date.now() + 30_000) {
      await client.schedulePublication(publicationId, new Date(campaign.startDate).toISOString());
    }

    await db
      .update(marketingCampaigns)
      .set({ status: 'scheduled' })
      .where(and(eq(marketingCampaigns.id, campaign.id), eq(marketingCampaigns.tenantId, tenant.id)));

    return NextResponse.json({ ok: true, approved: true, mode: 'live', published: true, publicationId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'OpenPost could not publish this campaign' },
      { status: 502 },
    );
  }
}
