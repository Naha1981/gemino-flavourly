import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import { marketingCampaigns, contacts, jobs } from '@/lib/db/schema';
import { canSendAutomatedMessages } from '@/lib/billing/gate-evaluate';

export const dynamic = 'force-dynamic';

/**
 * POST /api/marketing/campaigns/[id]/launch — launch a draft campaign.
 *
 * ENFORCES the billing gate: past-due / canceled tenants cannot launch
 * campaigns. Super admin is never gated. On success the campaign is marked
 * launched and one outbox job is enqueued per target contact.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Billing gate — campaign launch is a sending path.
  if (!(await canSendAutomatedMessages(tenant.id))) {
    return NextResponse.json(
      { error: 'Billing inactive — renew to resume AI and campaigns' },
      { status: 402 }
    );
  }

  const campaign = await db.query.marketingCampaigns.findFirst({
    where: and(eq(marketingCampaigns.id, params.id), eq(marketingCampaigns.tenantId, tenant.id)),
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  if (campaign.status !== 'draft') {
    return NextResponse.json({ error: `Campaign already ${campaign.status}` }, { status: 409 });
  }

  // Resolve target contacts (tenant-scoped, not opted-out).
  const where = eq(contacts.tenantId, tenant.id);
  const targets = await db.select({ phone: contacts.phone }).from(contacts).where(where);

  let enqueued = 0;
  for (const t of targets) {
    if (!t.phone) continue;
    await db.insert(jobs).values({
      tenantId: tenant.id,
      type: 'send_whatsapp',
      payload: { to: t.phone, text: campaign.message, campaignId: campaign.id },
      status: 'pending',
      nextRunAt: new Date(),
    });
    enqueued++;
  }

  await db
    .update(marketingCampaigns)
    .set({ status: 'sent', launchedAt: new Date(), sentCount: enqueued, sentAt: new Date() })
    .where(eq(marketingCampaigns.id, campaign.id));

  return NextResponse.json({ ok: true, launched: true, enqueued });
}
