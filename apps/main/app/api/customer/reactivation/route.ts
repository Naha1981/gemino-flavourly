import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  createPendingCampaign,
  findLatestCampaign,
  findReactivationTargetProfile,
  listCampaigns,
  countCampaigns,
  markSent,
  queueCampaignMessage,
  resolveReactivationSender,
  serializeReactivationCampaign,
} from '@/lib/customer/reactivation-store';
import {
  generateReactivationMessage,
  isWithinCampaignCooldown,
  resolveReactivationTarget,
} from '@/lib/customer/reactivation';

export const dynamic = 'force-dynamic';

/**
 * Gate #9 — reactivation campaigns for the current tenant.
 *
 * GET: the campaign list (paginated, newest first).
 * POST: manually create + send one campaign for a specific customer. The
 *       manual path skips the automation gates (AI off / manual mode — a
 *       human clicked the button), but never the compliance ones: opted-out
 *       contacts are refused outright, and the 90-day cooldown requires an
 *       explicit `force` override.
 */
export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0);

  const [campaigns, total] = await Promise.all([
    listCampaigns(tenant.id, limit, offset),
    countCampaigns(tenant.id),
  ]);

  return NextResponse.json({
    campaigns: campaigns.map(serializeReactivationCampaign),
    pagination: { limit, offset, total },
  });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { customerPhone?: unknown; force?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const customerPhone = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : '';
  const force = body.force === true;
  if (!customerPhone) {
    return NextResponse.json({ error: 'customerPhone is required' }, { status: 400 });
  }

  // 1. Resolve the profile, tenant-scoped.
  const profile = await findReactivationTargetProfile(tenant.id, customerPhone);
  if (!profile) {
    return NextResponse.json(
      { error: 'No customer profile found for that phone number' },
      { status: 404 }
    );
  }

  // 2. POPIA: an opted-out contact is never messaged, not even manually.
  if (profile.blocklisted) {
    return NextResponse.json(
      { error: 'Customer has opted out (POPIA) — reactivation messages are blocked' },
      { status: 403 }
    );
  }

  // 3. Eligibility from the FRESH visit date, stored label only as fallback.
  const target = resolveReactivationTarget(profile);
  if (!target) {
    return NextResponse.json(
      { error: 'Customer is not eligible for a reactivation campaign (visited recently or no win-back segment)' },
      { status: 400 }
    );
  }

  // 4. Cooldown: one campaign per customer per 90 days unless forced.
  const latest = await findLatestCampaign(tenant.id, customerPhone);
  if (latest?.sentAt && isWithinCampaignCooldown(latest.sentAt) && !force) {
    return NextResponse.json(
      {
        error: 'Customer received a campaign in the last 90 days. Send again only if you really mean it.',
        code: 'cooldown',
        lastSentAt: latest.sentAt,
      },
      { status: 409 }
    );
  }

  // 5. A WhatsApp account to send through.
  const sender = await resolveReactivationSender(tenant.id);
  if (!sender) {
    return NextResponse.json(
      { error: 'No connected WhatsApp account for this restaurant. Connect one under Dashboard → WhatsApp first.' },
      { status: 503 }
    );
  }

  // 6. Generate, queue, stamp — the same sequence the cron uses. A pending
  // row the cron never managed to dispatch is resumed, not duplicated.
  try {
    let campaign;
    let text: string;
    if (latest && !latest.sentAt) {
      campaign = latest;
      text = latest.messageText;
    } else {
      const message = generateReactivationMessage({
        segment: target.segment,
        customerName: profile.customerName,
        restaurantName: tenant.name,
        preferences: profile.preferences,
      });
      campaign = await createPendingCampaign(tenant.id, customerPhone, target.segment, message.messageText);
      text = message.messageText;
    }

    await queueCampaignMessage({
      tenantId: tenant.id,
      waAccountId: sender.waAccountId,
      to: customerPhone,
      text,
    });
    await markSent(campaign.id);
    return NextResponse.json({ ok: true, campaign: serializeReactivationCampaign(campaign) }, { status: 201 });
  } catch (err: any) {
    console.error('[Reactivation] Manual campaign failed', err);
    return NextResponse.json({ error: err?.message || 'Failed to send campaign' }, { status: 500 });
  }
}
