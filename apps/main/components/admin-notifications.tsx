import Link from 'next/link';
import { BellRing, CheckCheck, ExternalLink } from 'lucide-react';
import { markNotificationsReadAction } from '@/app/(app)/admin/actions';
import type { AdminNotificationRow } from '@/lib/qa/alerts';

/**
 * GATE QA-2 — the Super Admin notification inbox.
 *
 * Renders the admin_notifications rows written by the alert pipeline
 * (10-minute QA sweep + 6-hourly/PR Playwright persona runs): severity
 * colour, check name, message, evidence link and age. The unread badge
 * (read_at IS NULL) rides in the portal header via the `unread` count.
 *
 * Server component by design: the rows are read by the page (which is
 * already super-admin-gated and fail-closed), and "Mark all read" is a
 * server action that re-checks isSuperAdmin() before writing.
 */

const SEVERITY_STYLES: Record<AdminNotificationRow['severity'], { dot: string; label: string; chip: string }> = {
  critical: {
    dot: 'bg-rose-500',
    label: 'CRITICAL',
    chip: 'bg-rose-950/60 text-rose-300 border border-rose-900/60',
  },
  warning: {
    dot: 'bg-amber-400',
    label: 'WARNING',
    chip: 'bg-amber-950/60 text-amber-300 border border-amber-900/60',
  },
  info: {
    dot: 'bg-sky-400',
    label: 'INFO',
    chip: 'bg-sky-950/60 text-sky-300 border border-sky-900/60',
  },
};

function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AdminNotifications({
  notifications,
  unreadCount,
}: {
  notifications: AdminNotificationRow[];
  unreadCount: number;
}) {
  return (
    <section
      data-testid="qa-notifications-panel"
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950 text-zinc-200">
            <BellRing className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-zinc-50">QA Failure Alerts</h2>
            <p className="mt-0.5 text-xs text-zinc-400">
              Self-test failures from the 10-minute sweep and the scheduled Playwright runs —
              emailed to the owner, deduped to once per 6h per check.
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <form action={markNotificationsReadAction}>
            <button
              type="submit"
              data-testid="qa-notifications-mark-read"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read ({unreadCount})
            </button>
          </form>
        )}
      </div>

      <div className="mt-4 space-y-2.5">
        {notifications.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-xs text-zinc-500">
            No alerts. Every self-test is green — the sweep runs every 10 minutes, the persona
            suite every 6 hours.
          </p>
        ) : (
          notifications.map((n) => {
            const style = SEVERITY_STYLES[n.severity] ?? SEVERITY_STYLES.info;
            return (
              <article
                key={n.id}
                data-testid="qa-notification-row"
                data-severity={n.severity}
                data-unread={n.readAt ? 'false' : 'true'}
                className={`rounded-lg border p-4 ${
                  n.readAt
                    ? 'border-zinc-800/70 bg-zinc-950/40'
                    : 'border-zinc-700 bg-zinc-900'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${style.chip}`}>
                    {style.label}
                  </span>
                  <code className="text-xs font-medium text-zinc-200">{n.check}</code>
                  {n.reportUrl && (
                    <Link
                      href={n.reportUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-zinc-400 underline decoration-zinc-700 underline-offset-2 hover:text-zinc-200"
                    >
                      report <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                  <span className="ml-auto text-[11px] text-zinc-500">{timeAgo(n.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-zinc-300">{n.message}</p>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
