import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { getSessionUser } from '@/lib/auth/session';
import { db, initDb } from '@/lib/db';
import { waAccounts, conversations, messages, waitlistEntries, reservations } from '@/lib/db/schema';
import { and, eq, count, gte } from 'drizzle-orm';
import { Activity, MessageSquare, Users, QrCode, AlertTriangle, CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { isDemoMode } from '@/lib/config';
import { sendDemoInbound } from './demo-inbound-action';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  await initDb();
  const session = await getSessionUser();
  if (!session) redirect('/sign-in');

  const tenant = await getOrCreateTenant();
  if (!tenant) return <SetupNeededFallback />;

  const [waAccount] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenant.id))
    .limit(1)
    .catch(() => [null]);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [convoCount] = await db
    .select({ count: count() })
    .from(conversations)
    .where(eq(conversations.tenantId, tenant.id))
    .catch(() => [{ count: 0 }]);

  const [msgCount] = await db
    .select({ count: count() })
    .from(messages)
    .where(and(eq(messages.tenantId, tenant.id), gte(messages.createdAt, since)))
    .catch(() => [{ count: 0 }]);

  const [waitCount] = await db
    .select({ count: count() })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.tenantId, tenant.id), eq(waitlistEntries.status, 'waiting')))
    .catch(() => [{ count: 0 }]);

  const [bookCount] = await db
    .select({ count: count() })
    .from(reservations)
    .where(and(eq(reservations.tenantId, tenant.id), gte(reservations.date, since)))
    .catch(() => [{ count: 0 }]);

  const neverConnected = !waAccount?.lastConnectedAt && !isDemoMode();
  if (neverConnected) {
    redirect('/dashboard/whatsapp');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-saffron">{tenant.name}</p>
        <h1 className="mt-1 font-display text-4xl text-cream">Good service, {session.firstName}.</h1>
        <p className="mt-2 text-sm text-cream-dim">The house in the last 24 hours — messages, covers, and the queue.</p>
      </div>

      {!waAccount?.isConnected && (
        <div className="rounded-2xl border border-saffron/30 bg-saffron/10 p-5">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-medium text-saffron">WhatsApp is not on the line</h3>
              <p className="mt-1 text-sm text-cream-dim">Scan the QR to put the concierge back on the floor.</p>
            </div>
            <Link
              href="/dashboard/whatsapp"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-ink"
            >
              <QrCode className="h-4 w-4" />
              Connect now
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Conversations" value={String(convoCount?.count ?? 0)} icon={MessageSquare} />
        <Stat title="Messages · 24h" value={String(msgCount?.count ?? 0)} icon={Activity} />
        <Stat title="Waitlist" value={String(waitCount?.count ?? 0)} icon={Users} href="/dashboard/waitlist" />
        <Stat title="Bookings · 24h" value={String(bookCount?.count ?? 0)} icon={CalendarDays} href="/dashboard/bookings" />
      </div>

      {isDemoMode() && (
        <div className="rounded-2xl border border-line bg-ink-2 p-6">
          <h2 className="font-display text-2xl">Try the concierge</h2>
          <p className="mt-1 text-sm text-cream-dim">
            No second phone needed in this preview. Send a guest line and watch the inbox, bookings, and waitlist move.
          </p>
          <DemoComposer />
        </div>
      )}
    </div>
  );
}

function SetupNeededFallback() {
  return (
    <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-saffron/30 bg-saffron/5 p-6 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-saffron" />
      <h2 className="mt-4 font-display text-2xl">Workspace is not ready</h2>
      <p className="mt-2 text-sm text-cream-dim">
        If you are the operator, open <code className="text-saffron">/api/migrate</code> once, then reload.
      </p>
    </div>
  );
}

function Stat({
  title,
  value,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  icon: any;
  href?: string;
}) {
  const inner = (
    <div className="rounded-2xl border border-line bg-ink-2 p-5">
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-ink p-2">
          <Icon className="h-4 w-4 text-saffron" />
        </div>
        <span className="text-xs uppercase tracking-wider text-cream-dim">{title}</span>
      </div>
      <p className="mt-4 font-display text-4xl text-cream">{value}</p>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function DemoComposer() {
  return (
    <form action={sendDemoInbound} className="mt-5 flex flex-col gap-3 sm:flex-row">
      <input
        name="text"
        defaultValue="Book a table for 2 tomorrow 7pm"
        className="flex-1 rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-cream outline-none focus:border-saffron"
      />
      <button type="submit" className="rounded-md bg-cream px-4 py-2.5 text-sm font-semibold text-ink">
        Send as guest
      </button>
    </form>
  );
}
