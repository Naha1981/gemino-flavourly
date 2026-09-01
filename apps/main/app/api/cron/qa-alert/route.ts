import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { dispatchQaAlert, type QaAlertSeverity } from '@/lib/qa/alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SEVERITIES: QaAlertSeverity[] = ['info', 'warning', 'critical'];

/**
 * GATE QA-2 — POST /api/cron/qa-alert (CRON_SECRET bearer).
 *
 * The ingestion point for self-test failures raised OUTSIDE the app —
 * primarily the GitHub Actions persona runs (on every PR + every 6h),
 * whose workflow posts here on failure with the run URL as the report
 * link. The 10-minute sweep reports failures internally through the same
 * lib/qa/alerts.ts pipeline.
 *
 * Body: { severity, check, message, reportUrl? }
 * Pipeline behaviour (dedupe / notification row / Resend email) is owned
 * by lib/qa/alerts.ts and pinned by its tests.
 */
export async function POST(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  let body: { severity?: string; check?: string; message?: string; reportUrl?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const severity = (body.severity ?? 'critical') as QaAlertSeverity;
  const check = typeof body.check === 'string' ? body.check.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const reportUrl = typeof body.reportUrl === 'string' && body.reportUrl.trim() ? body.reportUrl.trim() : null;

  if (!check || !message) {
    return NextResponse.json({ error: 'Both "check" and "message" are required' }, { status: 400 });
  }
  if (!SEVERITIES.includes(severity)) {
    return NextResponse.json(
      { error: `severity must be one of ${SEVERITIES.join(', ')}` },
      { status: 400 }
    );
  }

  const result = await dispatchQaAlert({ severity, check, message, reportUrl });
  return NextResponse.json({ received: true, ...result });
}
