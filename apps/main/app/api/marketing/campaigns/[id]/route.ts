import { NextRequest, NextResponse } from 'next/server';
import { resolveActiveTenant } from '@/lib/tenant-resolver';
import { db } from '@/lib/db';
import { and, eq } from 'drizzle-orm';
import { marketingCampaigns } from '@/lib/db/schema';
import { updateMarketingCampaign } from '@/lib/marketing/campaign-store';

export const dynamic = 'force-dynamic';

/**
 * GATE PM-1 — PATCH /api/marketing/campaigns/[id]
 *
 * Edits a DRAFT campaign (the "Improve Message" step of the builder: the
 * owner can refine the draft, re-simulate, then decide). Tenant-scoped:
 * the campaign is loaded WHERE tenant_id = caller's tenant, so a foreign
 * campaign id is a 404, and only drafts are editable — a sent campaign is
 * immutable history.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const resolved = await resolveActiveTenant();
  if (!resolved) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = resolved.tenant.id;

  const campaign = await db.query.marketingCampaigns.findFirst({
    where: and(eq(marketingCampaigns.id, params.id), eq(marketingCampaigns.tenantId, tenantId)),
  });
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }
  if (campaign.status !== 'draft') {
    return NextResponse.json(
      { error: `Only draft campaigns can be edited — this campaign is ${campaign.status}` },
      { status: 409 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const allowedTypes = ['promotion', 'event', 'seasonal', 'announcement', 'custom'];
  const allowedSegments = ['vip', 'regular', 'at_risk', 'dormant', 'new', 'all', null];

  const input: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return NextResponse.json({ error: 'name cannot be empty' }, { status: 400 });
    input.name = name;
  }
  if (body.message !== undefined) {
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return NextResponse.json({ error: 'message cannot be empty' }, { status: 400 });
    input.message = message;
  }
  if (body.type !== undefined) {
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    if (!allowedTypes.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${allowedTypes.join(', ')}` }, { status: 400 });
    }
    input.type = type;
  }
  if (body.description !== undefined) {
    input.description = typeof body.description === 'string' ? body.description.trim() || null : null;
  }
  if (body.target_segment !== undefined) {
    const segment = typeof body.target_segment === 'string' ? body.target_segment.trim() : null;
    if (!allowedSegments.includes(segment)) {
      return NextResponse.json({ error: 'target_segment must be one of vip, regular, at_risk, dormant, new, all' }, { status: 400 });
    }
    input.targetSegment = segment === '' ? null : segment;
  }
  if (body.offer !== undefined) {
    input.offer = typeof body.offer === 'string' ? body.offer.trim() || null : null;
  }
  if (body.start_date !== undefined) {
    if (body.start_date === null) {
      input.startDate = null;
    } else {
      const date = new Date(String(body.start_date));
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: 'start_date must be a valid ISO date' }, { status: 400 });
      }
      input.startDate = date;
    }
  }
  if (body.end_date !== undefined) {
    if (body.end_date === null) {
      input.endDate = null;
    } else {
      const date = new Date(String(body.end_date));
      if (Number.isNaN(date.getTime())) {
        return NextResponse.json({ error: 'end_date must be a valid ISO date' }, { status: 400 });
      }
      input.endDate = date;
    }
  }

  if (Object.keys(input).length === 0) {
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
  }

  const updated = await updateMarketingCampaign(tenantId, campaign.id, input);
  if (!updated) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, campaign: updated });
}
