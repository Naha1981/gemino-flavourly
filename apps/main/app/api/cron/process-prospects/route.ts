import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import {
  findBuildableProspects,
  updateProspect,
  createClaimToken,
  claimLinkFor,
} from '@/lib/brand-intelligence/prospect-store';
import { createDemoTenant } from '@/lib/brand-intelligence/create-demo-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Ceiling on prospects built per run; the queue is oldest-first. */
const PROSPECTS_PER_RUN = 5;
/** Brief pause between backend builds to avoid hammering upstream sites. */
const BUILD_DELAY_MS = 1000;

/**
 * Background processor — builds demo tenants for queued/re-tryable prospects.
 *
 * Scheduled via cron-job.org every 5 minutes with
 *   Authorization: Bearer <CRON_SECRET>
 *
 * For each buildable prospect it flips status to 'enriching', runs the Brand
 * Intelligence Engine + Google Places enrichment, pre-seeds the sample data,
 * generates a magic-link claim token and marks the prospect 'ready'. On
 * failure it records the error and bumps retries (a prospect is retried at
 * most 3 times, after which it is left 'failed' for manual attention).
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const prospects = await findBuildableProspects(PROSPECTS_PER_RUN);

  const built: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const prospect of prospects) {
    await updateProspect(prospect.id, { status: 'enriching', error: null });
    try {
      const result = await createDemoTenant({
        name: prospect.name,
        website: prospect.website,
        ownerEmail: prospect.ownerEmail,
        ownerPhone: prospect.ownerPhone,
        city: prospect.city,
      });

      const tokenRow = await createClaimToken(result.tenantId);
      await updateProspect(prospect.id, {
        status: 'ready',
        tenantId: result.tenantId,
        claimToken: tokenRow.token,
        error: null,
      });
      built.push(prospect.id);
    } catch (err: any) {
      const retries = (prospect.retries ?? 0) + 1;
      await updateProspect(prospect.id, {
        status: retries >= 3 ? 'failed' : 'failed',
        error: err?.message ?? 'build failed',
        retries,
      });
      failed.push({ id: prospect.id, error: err?.message ?? 'build failed' });
    }

    // Rate-limit: leave a short gap between upstream scrapes.
    if (BUILD_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, BUILD_DELAY_MS));
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: prospects.length,
    built,
    failed,
    pending: prospects.length - built.length,
  });
}
