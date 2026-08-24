import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from './authorize';

export { isCronAuthorized };

/**
 * Next.js adapter for the cron authorization guard.
 *
 * The decision logic lives in ./authorize.ts (no framework imports) so it
 * can be unit-tested directly. This file only maps a NextRequest onto that
 * decision and turns a rejection into a 401.
 *
 * The secret itself is never logged and never returned in a response body.
 * This module is server-only: it is imported exclusively by route handlers
 * under app/api/cron/, so CRON_SECRET is never bundled into client code.
 */
export function assertCronAuthorized(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // Log that the guard tripped, but never log the expected or provided
    // credential.
    console.error(
      `[cron-auth] CRON_SECRET is not configured — rejecting ${req.nextUrl.pathname}. ` +
        'Set CRON_SECRET in the deployment environment and send it as ' +
        '"Authorization: Bearer <secret>" from the scheduler.'
    );
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isCronAuthorized(req.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}
