import { db } from '@/lib/db';
import { adminNotifications } from '@/lib/db/schema';
import { desc, eq, gt, and, isNull, sql } from 'drizzle-orm';
import {
  QA_ALERT_DEDUPE_WINDOW_MS,
  buildAlertSubject,
  buildAlertEmailText,
  sendQaAlertEmail,
  type QaAlertInput,
  type QaAlertSeverity,
  type EmailSendResult,
} from './alert-policy.ts';

/**
 * GATE QA-2 — the alert pipeline (database leg).
 *
 * ONE funnel for every failing self-test, whatever raised it:
 *   - the 10-minute smoke sweep (GET /api/cron/qa-sweep, cron-job.org);
 *   - the 6-hourly / per-PR Playwright persona run (GitHub Actions posts
 *     failures to POST /api/cron/qa-alert).
 *
 * What a dispatch does:
 *   1. DEDUPE — if the same `check` already alerted within the last 6h,
 *      nothing happens (row or email). A flapping check therefore alerts
 *      once per 6 hours, never once per 10-minute run.
 *   2. ROW — insert into admin_notifications (severity, check, message,
 *      report_url, created_at). This is what the Super Admin portal
 *      renders with its unread badge; it is the always-on channel that
 *      works even when email is unconfigured. The row lands BEFORE the
 *      email is attempted on purpose.
 *   3. EMAIL — Resend REST call to the owner (pure leg lives in
 *      ./alert-policy.ts, mockable via QA_ALERT_EMAIL_TRANSPORT=mock).
 *      Best-effort: a missing RESEND_API_KEY is recorded as
 *      `skipped_no_key`, never throws.
 *
 * DB writes here are ONLY notification rows (the sweep itself is strictly
 * read-only against business data).
 */

export {
  QA_ALERT_DEDUPE_WINDOW_MS,
  QA_ALERT_DEFAULT_TO,
  buildAlertSubject,
  buildAlertEmailText,
  shouldDedupeAlert,
  resolveEmailTransport,
  sendQaAlertEmail,
  __setEmailFetchForTests,
} from './alert-policy.ts';

export type { QaAlertInput, QaAlertSeverity, EmailSendResult } from './alert-policy.ts';

export interface QaAlertDispatch {
  dispatched: boolean;
  reason?: 'deduped' | 'insert-failed';
  dedupedUntil?: string;
  notificationId?: string;
  emailStatus: EmailSendResult['status'];
  email?: EmailSendResult;
}

/**
 * Dispatch one alert: dedupe -> insert row -> send email (best-effort).
 * Never throws — an alert pipeline that crashes on a broken DB would
 * silence the very alarm it exists to raise.
 */
export async function dispatchQaAlert(input: QaAlertInput): Promise<QaAlertDispatch> {
  try {
    const since = new Date(Date.now() - QA_ALERT_DEDUPE_WINDOW_MS);
    const recent = await db
      .select({ id: adminNotifications.id, createdAt: adminNotifications.createdAt })
      .from(adminNotifications)
      .where(and(eq(adminNotifications.check, input.check), gt(adminNotifications.createdAt, since)))
      .orderBy(desc(adminNotifications.createdAt))
      .limit(1)
      .catch(() => []);

    if (recent.length > 0) {
      const dedupedUntil = new Date(
        recent[0].createdAt.getTime() + QA_ALERT_DEDUPE_WINDOW_MS
      ).toISOString();
      return { dispatched: false, reason: 'deduped', dedupedUntil, emailStatus: 'skipped_no_key' };
    }

    const inserted = await db
      .insert(adminNotifications)
      .values({
        severity: input.severity,
        check: input.check,
        message: input.message,
        reportUrl: input.reportUrl ?? null,
      })
      .returning({ id: adminNotifications.id })
      .catch(() => [] as { id: string }[]);

    const notificationId = inserted[0]?.id;

    const email = await sendQaAlertEmail(buildAlertSubject(input.check), buildAlertEmailText(input));
    if (email.status === 'error') {
      console.error('[qa-alert] email leg failed:', email.error);
    }

    return {
      dispatched: true,
      notificationId,
      emailStatus: email.status,
      email,
    };
  } catch (err: any) {
    console.error('[qa-alert] dispatch failed:', err?.message ?? err);
    return { dispatched: false, reason: 'insert-failed', emailStatus: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Portal reads (rendered on /admin)
// ---------------------------------------------------------------------------

export interface AdminNotificationRow {
  id: string;
  severity: QaAlertSeverity;
  check: string;
  message: string;
  reportUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Latest notifications for the Super Admin portal panel. */
export async function listRecentAdminNotifications(limit = 15): Promise<AdminNotificationRow[]> {
  try {
    const rows = await db
      .select()
      .from(adminNotifications)
      .orderBy(desc(adminNotifications.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      severity: (r.severity as QaAlertSeverity) ?? 'info',
      check: r.check,
      message: r.message,
      reportUrl: r.reportUrl ?? null,
      readAt: r.readAt ?? null,
      createdAt: r.createdAt,
    }));
  } catch (err: any) {
    console.error('[qa-alert] list failed:', err?.message ?? err);
    return [];
  }
}

/** Unread count for the badge — degrades to 0, never blocks the portal. */
export async function countUnreadAdminNotifications(): Promise<number> {
  try {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(adminNotifications)
      .where(isNull(adminNotifications.readAt));
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

/** Mark every unread notification read (portal button; super-admin gated). */
export async function markAllAdminNotificationsRead(): Promise<number> {
  try {
    const updated = await db
      .update(adminNotifications)
      .set({ readAt: new Date() })
      .where(isNull(adminNotifications.readAt))
      .returning({ id: adminNotifications.id });
    return updated.length;
  } catch {
    return 0;
  }
}
