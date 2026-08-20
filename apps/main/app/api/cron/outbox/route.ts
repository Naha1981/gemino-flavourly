import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';
import { and, eq, lte, lt } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';
import { assertCronAuthorized } from '@/lib/cron/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  const now = new Date();

  // Fetch pending jobs ready to run
  const pendingJobs = await db.query.jobs.findMany({
    where: and(
      eq(jobs.status, 'pending'),
      lte(jobs.nextRunAt, now)
    ),
    limit: 50,
  });

  if (pendingJobs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let successCount = 0;
  let failCount = 0;

  for (const job of pendingJobs) {
    try {
      // Mark as processing
      await db.update(jobs).set({ status: 'processing' }).where(eq(jobs.id, job.id));

      if (job.type === 'send_whatsapp') {
        const payload = job.payload as { waAccountId: string; to: string; text: string };
        const result = await operatorClient.sendMessage(payload.waAccountId, payload.to, payload.text);

        if (result.success) {
          await db
            .update(jobs)
            .set({ status: 'done', attempts: job.attempts + 1 })
            .where(eq(jobs.id, job.id));
          successCount++;
        } else {
          throw new Error(result.error || 'Failed to dispatch via operator');
        }
      } else {
        await db.update(jobs).set({ status: 'done' }).where(eq(jobs.id, job.id));
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
        })
        .where(eq(jobs.id, job.id));
    }
  }

  return NextResponse.json({
    ok: true,
    processed: pendingJobs.length,
    succeeded: successCount,
    failed: failCount,
  });
}
