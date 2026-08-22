import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { and, eq, lte, lt } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';
import { assertCronAuthorized } from '@/lib/cron/auth';

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
    try {
      // Mark as processing
      await db.update(jobs).set({ status: 'processing', updatedAt: new Date() }).where(eq(jobs.id, job.id));

      if (job.type === 'send_whatsapp') {
        const payload = job.payload as { waAccountId: string; to: string; text: string };
        const result = await operatorClient.sendMessage(payload.waAccountId, payload.to, payload.text);

        if (result.success) {
          await db
            .update(jobs)
            .set({ status: 'done', attempts: job.attempts + 1, updatedAt: new Date() })
            .where(eq(jobs.id, job.id));
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

      // Exponential backoff: 10s, 30s, 90s, 270s...
      const delayMs = Math.pow(3, nextAttempt) * 10000;
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

