import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { waAccounts, conversations, messages } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { Activity, MessageSquare, Users, QrCode, AlertTriangle, CheckSquare } from 'lucide-react';
import Link from 'next/link';
import { countPendingApprovals } from '@/lib/operations/approval-request-store';

export const dynamic = 'force-dynamic';

export default async function DashboardOverview() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  // getOrCreateTenant() no longer throws — it returns null on failure —
  // but wrapping the call site too means a fallback UI renders even if
  // something upstream (e.g. a Clerk API outage) throws in a way that
  // slips past that function's own guards.
  let tenant;
  try {
    tenant = await getOrCreateTenant();
  } catch (err) {
    console.error('[DashboardOverview] getOrCreateTenant threw unexpectedly:', err);
    tenant = null;
  }

  if (!tenant) {
    return <SetupNeededFallback />;
  }

  const [waAccount] = await db
    .select()
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenant.id))
    .limit(1)
    .catch(() => [null]);

  const activeConversations = await db
    .select({ count: count() })
    .from(conversations)
    .where(eq(conversations.tenantId, tenant.id))
    .catch(() => [{ count: 0 }]);

  const totalMessages = await db
    .select({ count: count() })
    .from(messages)
    .where(eq(messages.tenantId, tenant.id))
    .catch(() => [{ count: 0 }]);

  const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
  const user = await client.users.getUser(userId).catch(() => ({ firstName: 'Owner' }));

  // One-time onboarding redirect: a tenant that has never successfully
  // connected WhatsApp is sent straight to the QR scanner instead of an
  // empty metrics page. Uses waAccount.lastConnectedAt (set once, the
  // first time a connection succeeds, and never cleared) rather than
  // isConnected (the live/current state) or a "created in the last N
  // minutes" time window:
  //   - lastConnectedAt correctly catches true first-timers no matter
  //     how long they take to get through signup/onboarding — a 2-minute
  //     window missed anyone who took longer, which is exactly what was
  //     reported (real account, no onboarding screen, well past 2 min).
  //   - It does NOT trap a returning owner who later disconnects for any
  //     reason (Render restart, manual logout, etc.) — that owner has a
  //     non-null lastConnectedAt from their first successful connection,
  //     so they keep seeing their normal dashboard, not a forced redirect
  //     loop to the QR page every time they open the app.
  const neverConnected = !waAccount?.lastConnectedAt;
  if (neverConnected) {
    redirect('/dashboard/whatsapp');
  }

  // Engine 6 approval workflow: surface a pending-approvals banner so the
  // owner knows a YELLOW/RED AI reply is waiting for their sign-off.
  const pendingApprovals = await countPendingApprovals(tenant.id).catch(() => 0);

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-50">Welcome back, {user?.firstName || 'Owner'}</h1>
        <p className="mt-1 text-sm text-zinc-400">Here&apos;s what&apos;s happening with your restaurant today.</p>
      </div>

      {!waAccount?.isConnected && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-amber-300">Action Required: WhatsApp Not Connected</h3>
              <p className="text-sm text-zinc-400 mt-0.5">Your WhatsApp number is not connected. Connect it to start answering customer inquiries automatically.</p>
            </div>
            <Link
              href="/dashboard/whatsapp"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 transition-colors shadow-sm"
            >
              <QrCode className="h-4 w-4" />
              Connect Now
            </Link>
          </div>
        </div>
      )}

      {pendingApprovals > 0 && (
        <div className="rounded-lg border border-blue-900/60 bg-blue-950/40 p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-blue-300">
                <CheckSquare className="h-4 w-4" />
                {pendingApprovals} message{pendingApprovals === 1 ? '' : 's'} awaiting approval
              </h3>
              <p className="text-sm text-zinc-400 mt-0.5">
                An AI reply was held for your sign-off before sending. Review it to keep the conversation moving.
              </p>
            </div>
            <Link
              href="/dashboard/operations/approval-requests"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-blue-400 transition-colors shadow-sm"
            >
              Review Approvals
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <StatCard title="Active Conversations" value={activeConversations[0]?.count.toString() || '0'} icon={MessageSquare} />
        <StatCard title="Total Messages" value={totalMessages[0]?.count.toString() || '0'} icon={Activity} />
        <StatCard title="Waitlist Guests" value="0" icon={Users} />
      </div>
    </div>
  );
}

/**
 * Rendered instead of crashing when the tenant can't be resolved or
 * created — almost always because the Neon schema is behind the code
 * (the migration in /api/migrate hasn't been run yet). Gives whoever is
 * looking at this a concrete next step instead of a bare error digest.
 */
function SetupNeededFallback() {
  return (
    <div className="max-w-lg mx-auto mt-16 rounded-lg border border-amber-900/60 bg-amber-950/40 p-6 text-center shadow-sm">
      <AlertTriangle className="mx-auto h-8 w-8 text-amber-400" />
      <h2 className="mt-4 text-lg font-semibold text-amber-200">We couldn&apos;t set up your workspace</h2>
      <p className="mt-2 text-sm text-zinc-400">
        This usually means the database schema is out of date. If you&apos;re the site admin, sign in and open{' '}
        <code className="rounded bg-zinc-900 px-1.5 py-0.5 text-amber-300">/api/migrate</code> once to sync it, then
        reload this page.
      </p>
      <p className="mt-4 text-xs text-zinc-500">If this keeps happening, check the Vercel function logs for the exact error.</p>
    </div>
  );
}

function StatCard({ title, value, icon: Icon }: { title: string; value: string; icon: any }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-zinc-800 p-2.5">
          <Icon className="h-4 w-4 text-emerald-400" />
        </div>
        <span className="text-sm font-medium text-zinc-400">{title}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold text-zinc-50">{value}</p>
    </div>
  );
}
