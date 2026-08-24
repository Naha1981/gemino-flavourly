import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, lte } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { conversations } from '@/lib/db/schema';
import { detectSlowDaysForTenant } from '@/lib/revenue/slow-days';
import { drizzleSlowDayStore } from '@/lib/revenue/slow-days-store';
import { buildTenantPriorities } from '@/lib/revenue/priorities';
import { drizzlePriorityStore } from '@/lib/revenue/priorities-store';
import { buildTenantOpportunity } from '@/lib/revenue/opportunity';
import { drizzleOpportunityStore } from '@/lib/revenue/opportunity-store';

export const dynamic = 'force-dynamic';

type RangeKey = '7d' | '30d' | 'custom';

function parseRange(req: NextRequest): { range: RangeKey; start: Date; end: Date } {
  const url = new URL(req.url);
  const rangeParam = url.searchParams.get('range') as RangeKey | null;
  const now = new Date();

  if (rangeParam === 'custom') {
    const startParam = url.searchParams.get('start');
    const endParam = url.searchParams.get('end');
    const start = startParam ? new Date(startParam) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const end = endParam ? new Date(endParam) : now;
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      return { range: 'custom', start, end };
    }
  }

  const days = rangeParam === '7d' ? 7 : 30;
  return {
    range: days === 7 ? '7d' : '30d',
    start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    end: now,
  };
}

export async function GET(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const range = parseRange(req);
  const rows = await db
    .select({
      outcome: conversations.outcome,
      estimatedValueCents: conversations.estimatedValueCents,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, tenant.id),
        gte(conversations.createdAt, range.start),
        lte(conversations.createdAt, range.end)
      )
    );

  const summary = rows.reduce(
    (acc, row) => {
      acc.total_enquiries += 1;
      if (row.outcome === 'converted') acc.converted_count += 1;
      if (row.outcome === 'missed') {
        acc.missed_count += 1;
        acc.missed_revenue_cents += row.estimatedValueCents ?? 0;
      }
      if (row.outcome === 'handled') acc.handled_count += 1;
      if (row.outcome === 'lost') acc.lost_count += 1;
      return acc;
    },
    {
      total_enquiries: 0,
      converted_count: 0,
      missed_count: 0,
      handled_count: 0,
      lost_count: 0,
      missed_revenue_cents: 0,
    }
  );

  const revenueDenominator = summary.converted_count + summary.missed_count + summary.lost_count;
  const conversionRate = revenueDenominator === 0 ? 0 : summary.converted_count / revenueDenominator;

  // Gate #2 — slow-day detection.
  //
  // Deliberately NOT driven by `range`: a slow day is defined against the
  // weekday's own 90-day history, so honouring ?range=7d here would mean
  // comparing one week against itself and reporting nothing. The window
  // the comparison actually used is in `slow_day_window` if a client ever
  // needs to show it.
  const slowDays = await detectSlowDaysForTenant(drizzleSlowDayStore, tenant.id);

  // Gate #5 — priority recommendations.
  //
  // The top 3 actions for today, ranked by probability-weighted value
  // across missed enquiries, critical slow days, pending cancellations and
  // pending no-shows. Reuses the slow-day report from the Gate #2 call
  // above (one reservation scan, two uses) and adds three more
  // tenant-scoped reads via the priority store — all bounded by the same
  // tenant.id, so the ranking can only ever see this tenant's data.
  const topPriorities = await buildTenantPriorities(drizzlePriorityStore, tenant.id, slowDays);

  // Gate #6 — revenue opportunity summary.
  //
  // Reuses the same Gate #2 report as the priorities above: the missed
  // enquiry, cancellation and no-show scans are read once here (three
  // tenant-scoped queries) and the slow-day value comes from `slowDays`,
  // so a tenant's reservation history is still scanned exactly once for
  // the slow-day analytics.
  const opportunity = await buildTenantOpportunity(drizzleOpportunityStore, tenant.id, slowDays);

  return NextResponse.json({
    ...summary,
    conversion_rate: conversionRate,
    slowDays: slowDays.slowDays,
    slow_day_window: slowDays.window,
    topPriorities,
    opportunity,
    range: {
      key: range.range,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    },
  });
}
