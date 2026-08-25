import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { aggregateAllTenants } from '@/lib/inbox/aggregator';

export const dynamic = 'force-dynamic';

/**
 * Aggregate inbound messages from every enabled channel into the unified
 * inbox. Triggered every 5 minutes by the external scheduler; protected by
 * the shared cron guard (fails closed).
 */
export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const results = await aggregateAllTenants().catch((err: any) => {
    console.error('[aggregate-messages] aggregation failed', err);
    return [];
  });

  const totalIngested = results.reduce(
    (sum, t) => sum + t.channels.reduce((s, c) => s + c.ingested, 0),
    0
  );

  return NextResponse.json({ ok: true, tenants: results.length, ingested: totalIngested, results });
}
