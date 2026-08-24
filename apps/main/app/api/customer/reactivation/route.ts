import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { getProfile } from '@/lib/customer/profile-store';
import {
  REACTIVATION_COOLDOWN_DAYS,
  isReactivationSegment,
  resolveReactivationTarget,
  buildReactivationMessage,
  type ReactivationPreferences,
} from '@/lib/customer/reactivation';
import {
  createPendingCampaign,
  dispatchWhatsApp,
  findWhatsAppAccount,
  getCampaignHistory,
  listCampaigns,
  markSent,
  countCampaigns,
  serializeReactivationCampaign,
} from '@/lib/customer/reactivation-store';

export const dynamic = 'force-dynamic';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Gate #9 — reactivation campaigns for the signed-in tenant.
 *
 * GET  lists the tenant's campaigns (paginated, newest first).
 * POST manually creates and dispatches a campaign for one customer — the
 *      same generator and dispatch path as the cron, but with the 90-day
 *      cooldown still enforced: "manual" must not become a spam button.
 *      POPIA is absolute here: an opted-out contact is refused regardless
 *      of who clicks send.
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

  let body: { customerPhone?: unknown; segment?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const customerPhone = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : '';
  if (!customerPhone) {
    return NextResponse.json({ error: 'customerPhone is required' }, { status: 400 });
  }

  // POPIA first: an opted-out contact is never messaged, manually or not.
  const [contact] = await db
    .select({ blocklisted: contacts.blocklisted })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenant.id), eq(contacts.phone, customerPhone)))
    .limit(1);
  if (contact?.blocklisted) {
    return NextResponse.json(
      { error: 'Customer has opted out of WhatsApp messages (POPIA)' },
      { status: 403 }
    );
  }

  const profile = await getProfile(tenant.id, customerPhone);
  if (!profile) {
    return NextResponse.json(
      { error: 'No customer profile found for this phone number' },
      { status: 404 }
    );
  }

  // Segment: explicit and valid, else derived from the profile's lifecycle.
  let segment: 'dormant' | 'at_risk' | null = null;
  if (body.segment !== undefined && body.segment !== null) {
    if (typeof body.segment !== 'string' || !isReactivationSegment(body.segment)) {
      return NextResponse.json({ error: 'Invalid segment — must be dormant or at_risk' }, { status: 400 });
    }
    segment = body.segment;
  } else {
    segment = resolveReactivationTarget(profile)?.segment ?? null;
  }
  if (!segment) {
    return NextResponse.json(
      { error: 'Customer is not dormant or at-risk — nothing to reactivate' },
      { status: 422 }
    );
  }

  // Same anti-spam rule as the cron: nothing within the 90-day cooldown.
  const now = new Date();
  const history = await getCampaignHistory(tenant.id, customerPhone);
  const lastAt = history[0]?.sentAt ?? history[0]?.createdAt ?? null;
  if (lastAt && now.getTime() - new Date(lastAt).getTime() < REACTIVATION_COOLDOWN_DAYS * MS_PER_DAY) {
    return NextResponse.json(
      { error: `Customer already received a campaign in the last ${REACTIVATION_COOLDOWN_DAYS} days` },
      { status: 409 }
    );
  }

  const message = buildReactivationMessage({
    segment,
    customerName: profile.customerName,
    restaurantName: tenant.name,
    preferences: (profile.preferences ?? null) as ReactivationPreferences | null,
  });

  const campaign = await createPendingCampaign(tenant.id, customerPhone, segment, message.text);

  const waAccountId = await findWhatsAppAccount(tenant.id);
  if (!waAccountId) {
    return NextResponse.json(
      {
        campaign: serializeReactivationCampaign(campaign),
        warning: 'No connected WhatsApp account — campaign created and left pending',
      },
      { status: 201 }
    );
  }

  const dispatch = await dispatchWhatsApp({
    tenantId: tenant.id,
    waAccountId,
    to: customerPhone,
    text: message.text,
  });
  if (dispatch.ok) {
    await markSent(campaign.id, now);
  }

  return NextResponse.json(
    {
      campaign: serializeReactivationCampaign(campaign),
      sent: dispatch.ok,
      warning: dispatch.ok ? null : dispatch.error ?? 'Send failed — campaign left pending',
    },
    { status: 201 }
  );
}
