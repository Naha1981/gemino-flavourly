import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { getProspect, updateProspect } from '@/lib/brand-intelligence/prospect-store';
import { createDemoTenant } from '@/lib/brand-intelligence/create-demo-tenant';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Super Admin — build a demo tenant for one prospect.
 *
 * Runs the Brand Intelligence Engine + Google Places enrichment, pre-seeds
 * the sample data, then generates a magic-link claim token. The prospect is
 * marked 'ready' on success, or 'failed' (retries++) on a hard failure. A
 * caller may re-trigger a failed prospect (manual "Retry").
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const prospect = await getProspect(params.id);
  if (!prospect) {
    return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  }
  if (prospect.status === 'claimed') {
    return NextResponse.json({ error: 'Prospect already claimed — cannot rebuild' }, { status: 409 });
  }

  try {
    // Flip to 'enriching' so the console shows it as in progress.
    await updateProspect(prospect.id, { status: 'enriching', error: null });

    const result = await createDemoTenant({
      name: prospect.name,
      website: prospect.website,
      ownerEmail: prospect.ownerEmail,
      ownerPhone: prospect.ownerPhone,
      city: prospect.city,
    });

    await updateProspect(prospect.id, {
      status: 'ready',
      tenantId: result.tenantId,
      claimToken: result.claimToken,
      error: null,
    });

    return NextResponse.json({
      ok: true,
      prospectId: prospect.id,
      tenantId: result.tenantId,
      claimToken: result.claimToken,
      claimLink: result.claimLink,
      confidence: result.brand?.confidence ?? null,
    });
  } catch (err: any) {
    const retries = (prospect.retries ?? 0) + 1;
    await updateProspect(prospect.id, { status: 'failed', error: err?.message ?? 'build failed', retries });
    return NextResponse.json({ error: err?.message ?? 'Failed to build demo tenant' }, { status: 502 });
  }
}
