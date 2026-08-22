import { NextRequest, NextResponse } from 'next/server';
import { db, initDb } from '@/lib/db';
import { jobs, waAccounts } from '@/lib/db/schema';
import { and, eq, lte, lt } from 'drizzle-orm';
import { operatorClient } from '@/lib/operator-client';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { isDemoMode } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STUCK_PROCESSING_MINUTES = 5;
const BACKOFF_MS = [10_000, 30_000, 90_000, 270_000];

export async function GET(req: NextRequest) {
  const authError = assertCronAuthorized(req);
  if (authError) return authError;

  await initDb();
  const now = new Date();

  const stuckCutoff = new Date(now.getTime() - STUCK_PROCESSING_MINUTES * 60_000);
  const reaped = await db
    .update(jobs)
    .set({ status: 'pending', nextRunAt: now, updatedAt: now })
    .where(and(eq(jobs.status, 'processing'), lt(jobs.updatedAt, stuckCutoff)))
    .returning({ id: jobs.id });

  const pendingJobs = await db.query.jobs.findMany({
    where: and(eq(jobs.status, 'pending'), lte(jobs.nextRunAt, now)),
    limit: 50,
  });

  if (pendingJobs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, reaped: reaped.length });
  }

  let successCount = 0;
  let failCount = 0;
  let skipped = 0;

  for (const job of pendingJobs) {
    try {
      const claimed = await db
        .update(jobs)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(and(eq(jobs.id, job.id), eq(jobs.status, 'pending')))
        .returning({ id: jobs.id });

      if (claimed.length === 0) {
        skipped++;
        continue;
      }

      if (job.type === 'send_whatsapp') {
        const payload = job.payload as { waAccountId: string; to: string; text: string };

        const account = await db.query.waAccounts.findFirst({
          where: and(eq(waAccounts.id, payload.waAccountId), eq(waAccounts.tenantId, job.tenantId)),
        });
        if (!account) {
          throw new Error(`waAccount ${payload.waAccountId} does not belong to tenant ${job.tenantId}`);
        }

        if (isDemoMode() && !process.env.OPERATOR_URL) {
          await db
            .update(jobs)
            .set({ status: 'done', attempts: job.attempts + 1, updatedAt: new Date() })
            .where(eq(jobs.id, job.id));
          successCount++;
          continue;
        }

        const result = await operatorClient.sendMessage(
          payload.waAccountId,
          payload.to,
          payload.text,
          job.tenantId
        );

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
      const delayMs = BACKOFF_MS[Math.min(nextAttempt - 1, BACKOFF_MS.length - 1)];
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
    skipped,
    reaped: reaped.length,
  });
}
