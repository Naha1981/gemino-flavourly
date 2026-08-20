import { auth, clerkClient } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { waAccounts, conversations, messages } from '@/lib/db/schema';
import { eq, count } from 'drizzle-orm';
import { Activity, MessageSquare, Users, QrCode, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

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

  // One-time onboarding redirect: send a brand-new tenant (created in the
  // last 2 minutes, i.e. this login) straight to the QR scanner instead of
  // an empty metrics page. Deliberately NOT "redirect whenever WhatsApp is
  // disconnected" — that would trap any returning owner who disconnects
  // for any reason in a permanent loop, unable to ever see their own
  // dashboard or settings again.
  const createdRecently = Date.now() - new Date(tenant.createdAt).getTime() < 2 * 60_000;
  if (createdRecently && !waAccount?.isConnected) {
    redirect('/dashboard/whatsapp');
  }

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
