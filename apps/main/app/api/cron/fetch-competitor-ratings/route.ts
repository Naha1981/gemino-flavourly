import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { runCompetitorRatingsCron } from '@/lib/reputation/competitor-ratings';
import { drizzleCompetitorRatingsStore } from '@/lib/reputation/competitor-store';
import { fetchPlaceRating } from '@/lib/reputation/google-places-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// One Places API call per tracked competitor platform-wide.
export const maxDuration = 60;

/**
 * Gate #14 — daily competitor rating sweep (07:00 SAST via cron-job.org).
 * Guarded like every cron route; the kill-switch is honoured for the same
 * reason as the review fetch (one switch stops all AI automation).
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const settings = await db.query.systemSettings.findFirst();
  if (settings && settings.masterAiSwitch === false) {
    return NextResponse.json({ ok: true, skipped: 'master_ai_switch_off', ratingsRecorded: 0 });
  }

  const summary = await runCompetitorRatingsCron(drizzleCompetitorRatingsStore, {
    now: new Date(),
    fetchPlaceRatingFn: fetchPlaceRating,
  });

  console.log(
    `[CompetitorRatings] checked=${summary.competitorsChecked} recorded=${summary.ratingsRecorded} ` +
      `alerts=${summary.alertsCreated} noRating=${summary.skipped.noRating} ` +
      `noPlaceId=${summary.skipped.noPlaceId} failed=${summary.skipped.fetchFailed}`
  );

  return NextResponse.json({ ok: true, ...summary });
}
