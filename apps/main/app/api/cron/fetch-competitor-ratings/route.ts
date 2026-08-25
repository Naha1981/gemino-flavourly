import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { googlePlacesConfig } from '@/lib/db/schema';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { fetchPlaceSummary } from '@/lib/reputation/google-places-client';
import { detectRatingDrop, listCompetitors, updateRating } from '@/lib/reputation/competitor-store';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;
  const configs = await db.select().from(googlePlacesConfig);
  let checked = 0;
  let drops = 0;
  for (const config of configs) {
    if (!config.apiKeyEncrypted) continue;
    for (const competitor of await listCompetitors(config.tenantId)) {
      const summary = await fetchPlaceSummary(competitor.googlePlaceId, config.apiKeyEncrypted);
      await updateRating(competitor.id, summary.rating, summary.reviewCount);
      if (await detectRatingDrop(competitor.id)) drops++;
      checked++;
    }
  }
  return NextResponse.json({ ok: true, competitorsChecked: checked, ratingDrops: drops });
}