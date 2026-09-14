import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getOrCreateTenant } from '@/lib/tenant';
import { marketingCampaigns, contacts, customerProfiles, jobs } from '@/lib/db/schema';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketing/campaigns/[id]/launch — launch a WhatsApp campaign.
 *
 * Separate from social AutoPost approval. Enforces billing, tenant isolation,
 * blocklists and the selected customer segment before anything enters the
 * outbox.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  void _req;
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

  let targetContactIds: string[] | null = null;
  if (campaign.targetSegment) {
    const profiles = await db
      .select({ contactId: customerProfiles.contactId })
      .from(customerProfiles)
      .where(and(eq(customerProfiles.tenantId, tenant.id), eq(customerProfiles.segment, campaign.targetSegment)));
    targetContactIds = profiles.map((row) => row.contactId).filter((id): id is string => Boolean(id));
    if (targetContactIds.length === 0) {
      return NextResponse.json({ error: `No customers currently match the ${campaign.targetSegment} segment.` }, { status: 422 });
    }
  }

  const targets = targetContactIds
    ? await db
        .select({ phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenant.id), eq(contacts.blocklisted, false), inArray(contacts.id, targetContactIds)))
    : await db
        .select({ phone: contacts.phone })
        .from(contacts)
        .where(and(eq(contacts.tenantId, tenant.id), eq(contacts.blocklisted, false)));

  if (targets.length === 0) {
    return NextResponse.json({ error: 'No eligible customers are available for this campaign.' }, { status: 422 });
  }

  for (const target of targets) {
    await db.insert(jobs).values({
      tenantId: tenant.id,
      type: 'send_whatsapp',
      payload: { to: target.phone, text: campaign.message, campaignId: campaign.id },
      status: 'pending',
      nextRunAt: new Date(),
    });
  }

  await db
    .update(marketingCampaigns)
    .set({ status: 'sent', launchedAt: new Date(), sentCount: targets.length, sentAt: new Date() })
    .where(and(eq(marketingCampaigns.id, campaign.id), eq(marketingCampaigns.tenantId, tenant.id)));

  return NextResponse.json({ ok: true, launched: true, enqueued: targets.length });
}
