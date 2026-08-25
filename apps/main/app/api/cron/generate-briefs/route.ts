import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { db } from '@/lib/db';
import { tenants, googleReviews } from '@/lib/db/schema';
import { detectSlowDaysForTenant } from '@/lib/revenue/slow-days';
import { drizzleSlowDayStore } from '@/lib/revenue/slow-days-store';
import { getOpportunities } from '@/lib/market/opportunity-store';
import { generateDailyBrief } from '@/lib/marketing/brief-generator';
import { saveBrief } from '@/lib/marketing/brief-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;
  const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.aiEnabled, true));
  let generated = 0;
  for (const tenant of allTenants) {
    const slowDays = await detectSlowDaysForTenant(drizzleSlowDayStore, tenant.id);
    const [opportunities, reviews] = await Promise.all([
      getOpportunities(tenant.id),
      db.select({ text: googleReviews.text }).from(googleReviews).where(and(eq(googleReviews.tenantId, tenant.id), eq(googleReviews.sentiment, 'positive'))).limit(10),
    ]);
    await saveBrief(tenant.id, generateDailyBrief({
      restaurantName: tenant.name,
      slowDays: slowDays.slowDays,
      opportunities: opportunities.slice(0, 5).map((row) => ({ title: row.title, description: row.description })),
      reviewThemes: reviews.map((row) => row.text).filter((text): text is string => Boolean(text)),
    }));
    generated += 1;
  }
  return NextResponse.json({ ok: true, tenantsChecked: allTenants.length, briefsGenerated: generated });
}