import { NextRequest, NextResponse } from 'next/server';

/**
 * Guards the cron-triggered routes (/api/cron/*).
 *
 * This deployment's cron jobs run via an external scheduler hitting these
 * URLs directly (not Vercel's native `crons` config in vercel.json, which
 * would auto-attach a Bearer token) — so this check is deliberately
 * "soft-fail-open, hard-fail-on-mismatch":
 *
 *   - CRON_SECRET unset  -> request is ALLOWED through (logs a warning).
 *     Breaking the outbox/waitlist/daily-brief crons in production because
 *     an optional secret wasn't configured would be worse than the current
 *     exposure — these routes are idempotent reads/queue-drains, not
 *     destructive actions.
 *   - CRON_SECRET set    -> the `Authorization: Bearer <secret>` header
 *     MUST match, or the request is rejected. Once you add CRON_SECRET
 *     as a Vercel env var, also add a matching custom header in your
 *     cron-job.org job settings (Advanced -> Custom Headers ->
 *     Authorization: Bearer <secret>) so real cron calls keep working.
 */
export function assertCronAuthorized(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      `[cron-auth] CRON_SECRET is not set — ${req.nextUrl.pathname} is running without auth. ` +
        'Set CRON_SECRET in Vercel and a matching Authorization header in your scheduler to lock this down.'
    );
    return null;
  }

  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
