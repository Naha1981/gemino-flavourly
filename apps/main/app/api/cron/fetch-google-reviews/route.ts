import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { googlePlacesConfig, googleReviews } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { fetchReviews } from '@/lib/reputation/google-places-client';
import { markPlaceFetched, upsertReview } from '@/lib/reputation/review-store';
import { generateResponse } from '@/lib/reputation/response-generator';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;
  const configs = await db.select().from(googlePlacesConfig);
  let fetched = 0;
  for (const config of configs) {
    if (!config.apiKeyEncrypted) continue;
    const reviews = await fetchReviews(config.placeId, config.apiKeyEncrypted);
    for (const review of reviews) {
      const saved = await upsertReview({ ...review, tenantId: config.tenantId });
      if (!saved.responseText) await db.update(googleReviews)
        .set({ responseText: generateResponse(review) })
        .where(eq(googleReviews.id, saved.id));
      fetched++;
    }
    await markPlaceFetched(config.tenantId);
  }
  return NextResponse.json({ ok: true, configsChecked: configs.length, reviewsFetched: fetched });
}