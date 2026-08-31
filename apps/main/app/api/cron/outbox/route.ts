import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { jobs, messages } from '@/lib/db/schema';
import { and, eq, lte, lt } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { evaluateTierLimit } from '@/lib/billing/tier-limits-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// None of the cron routes declared this, capping them at Vercel's default
// function timeout — 10 seconds on the Hobby plan. This route processes
// up to 50 jobs sequentially, each round-tripping to the Render operator
// plus 2-3 DB writes; at even 300-500ms per job that's 15-25+ seconds,
// already past the default limit at moderate load. A killed-mid-batch
// run is exactly what leaves jobs stuck in 'processing' (see the reaper
// above) — this and the reaper are two sides of the same problem: one
// prevents it, the other cleans up when it happens anyway.
export const maxDuration = 60;

// If a job has been sitting in 'processing' for longer than this, assume
// the function that was handling it timed out or crashed mid-dispatch
// (nothing ever flips it back), and reclaim it.
const STUCK_PROCESSING_MINUTES = 5;

/**
 * Mirror a job's outcome onto the message row it came from.
 *
 * Jobs created by the AI responder have no originating message row, so
 * messageId is optional and a missing id is simply a no-op. Failures here
 * are logged and swallowed on purpose: the job itself has already been
 * settled correctly, and losing the UI hint must never abort the run or
 * cause the message to be dispatched twice.
 */
function tierLimitMessage(reason: 'monthly_quota_exceeded' | 'hourly_rate_exceeded'): string {
  return reason === 'monthly_quota_exceeded'
    ? 'Monthly message allowance exhausted — renew to resume automated sending.'
    : 'Hourly message rate limit exceeded.';
}

async function markMessageDelivery(
  messageId: string | undefined,
  status: 'sent' | 'failed',
  error?: string
): Promise<void> {
  if (!messageId) return;
  try {
    await db
      .update(messages)
      .set({ deliveryStatus: status, deliveryError: error ?? null })
      .where(eq(messages.id, messageId));
  } catch (err) {
    console.error(`[cron/outbox] Failed to update delivery status for message ${messageId}`, err);
  }
}

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const now = new Date();

  // Reap stuck jobs first: previously, once a job flipped to
  // 'processing', nothing ever reset it if the request died mid-flight
  // (serverless timeout, crash). It would sit there forever — no retry,
  // no alert, the message just silently never gets delivered. Reclaim
  // anything that's been "processing" for longer than a function could
  // plausibly still legitimately be running.
  const stuckCutoff = new Date(now.getTime() - STUCK_PROCESSING_MINUTES * 60_000);
  const reaped = await db
    .update(jobs)
    .set({ status: 'pending', nextRunAt: now, updatedAt: now })
    .where(and(eq(jobs.status, 'processing'), lt(jobs.updatedAt, stuckCutoff)))
    .returning({ id: jobs.id });

  // Fetch pending jobs ready to run
  const pendingJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'pending'),
      lte(jobs.nextRunAt, now)
    ),
    limit: 50,
  });

  if (pendingJobs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reaped: reaped.length });
  }

  let successCount = 0;
  let failCount = 0;

  for (const job of pendingJobs) {
    // Atomically claim the job: only proceed if it's still 'pending' AND
    // still due at the moment of this UPDATE. Previously this was fetch-then-write
    // as two separate steps (findMany above, then an unconditional
    // UPDATE ... WHERE id = job.id) — if two cron invocations
    // overlapped (a manual retrigger during a scheduled run, a slow
    // previous run still finishing when the next one starts), both
    // could see the same job as 'pending' in their own findMany call
    // and both would then send it, giving the customer the same
    // message twice. Gating the UPDATE on status = 'pending' makes the
    // claim atomic at the database level: only one concurrent caller's
    // UPDATE actually matches a row and gets it back from RETURNING;
    // the other gets nothing and skips it.
    //
    // The nextRunAt condition matters for the same reason: a run whose
    // snapshot predates a deferral (hourly tier limit → +10 min) or a
    // failure-backoff reset would otherwise claim a job that is 'pending'
    // but NOT due yet, collapsing the backoff and defeating the rate-limit
    // deferral under overlapping runs. Re-checking "due" at claim time is
    // what makes the defer actually stick.
    const [claimed] = await db
      .update(jobs)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, 'pending'), lte(jobs.nextRunAt, now)))
      .returning();
    if (!claimed) continue;

    try {
      if (job.type === 'send_whatsapp') {
        // Tier gate (per-tenant message quota + hourly rate). If the tenant
        // has hit its hourly rate, defer the job so it retries on a later run
        // rather than failing — the message is still pending, not lost. If the
        // monthly allowance is exhausted, fail the job visibly so the dashboard
        // can surface "renew to resume".
        const limit = await evaluateTierLimit(job.tenantId);
        if (!limit.allowed) {
          if (limit.reason === 'hourly_rate_exceeded') {
            // Defer ~10 min and keep the message queued.
            await db
              .update(jobs)
              .set({ status: 'pending', nextRunAt: new Date(Date.now() + 10 * 60_000), updatedAt: new Date() })
              .where(eq(jobs.id, job.id));
            console.warn(`[outbox] Tenant ${job.tenantId} rate-limited (${limit.limit}/hr) — deferring job ${job.id}.`);
            continue;
          }
          // Monthly quota exhausted: fail the job (it cannot be sent this cycle).
          throw new Error(tierLimitMessage(limit.reason));
        }

        const payload = job.payload as {
          waAccountId: string;
          to: string;
          text: string;
          messageId?: string;
        };
        const result = await operatorClient.sendMessage(job.tenantId, payload.waAccountId, payload.to, payload.text);

        if (result.success) {
          await db
            .update(jobs)
            .set({ status: 'done', attempts: job.attempts + 1, updatedAt: new Date() })
            .where(eq(jobs.id, job.id));
          // Reconcile the originating message row. Callers have always
          // written payload.messageId, but nothing ever read it back, so
          // a message that was queued and later delivered stayed marked
          // 'queued' forever.
          await markMessageDelivery(payload.messageId, 'sent');
          successCount++;
        } else {
          throw new Error(result.error || 'Failed to dispatch via operator');
        }
      } else {
        await db.update(jobs).set({ status: 'done', updatedAt: new Date() }).where(eq(jobs.id, job.id));
        successCount++;
      }
    } catch (err: any) {
      failCount++;
      const nextAttempt = job.attempts + 1;
      const isExhausted = nextAttempt >= job.maxAttempts;

      // Exponential backoff: 10s, 30s, 90s, 270s... (3^attempts × 10s,
      // starting from the CURRENT attempt count, so the first retry after
      // attempts=0 is the documented 10s — not 30s).
      const delayMs = Math.pow(3, job.attempts) * 10000;
      const nextRunAt = new Date(Date.now() + delayMs);

      await db
        .update(jobs)
        .set({
          status: isExhausted ? 'failed' : 'pending',
          attempts: nextAttempt,
          nextRunAt,
          lastError: err.message || 'Unknown error',
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));

      // Only mark the message failed once every retry is spent. While
      // attempts remain the message is still legitimately 'queued', and
      // flagging it failed early would show staff a delivery failure for
      // a message that then arrives moments later.
      if (isExhausted) {
        const payload = job.payload as { messageId?: string };
        await markMessageDelivery(payload.messageId, 'failed', err.message || 'Unknown error');
      }
    }
  }

  return NextResponse.json({
    ok: true,
    processed: pendingJobs.length,
    succeeded: successCount,
    failed: failCount,
    reaped: reaped.length,
  });
}

