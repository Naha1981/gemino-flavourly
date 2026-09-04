import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Star, ArrowLeft } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { listVipAlertsToday } from '@/lib/customer/vip-store';
import VipTodayClient from './vip-today-client';

export const dynamic = 'force-dynamic';

/**
 * Gate #10 — VIP walk-ins today.
 *
 * Server-rendered list of every VIP alert raised since midnight for this
 * tenant, with quick actions ("Mark as served", "Add note") handled by the
 * client component. The customer never sees this page — it is staff-only.
 */
export default async function VipTodayPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const alerts = await listVipAlertsToday(tenant.id, 200);

  const serialized = alerts.map((alert) => ({
    id: alert.id,
    customerName: alert.customerName,
    customerPhone: alert.customerPhone,
    totalVisits: alert.totalVisits,
    totalSpendCents: alert.totalSpendCents,
    preferences: (alert.preferences ?? {}) as Record<string, string[]>,
    lastVisitAt: alert.lastVisitAt ? new Date(alert.lastVisitAt).toISOString() : null,
    sentAt: alert.sentAt ? new Date(alert.sentAt).toISOString() : null,
    servedAt: alert.servedAt ? new Date(alert.servedAt).toISOString() : null,
    note: alert.note,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-app-border pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-app-fg">
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            VIP Alerts Today
          </h1>
          <p className="text-xs text-app-muted">
            Who walked in today · staff-only alerts raised on a VIP&apos;s first message
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/customers"
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            ← All customers
          </Link>
          <Link
            href="/dashboard/inbox"
            className="rounded-md border border-app-border bg-app-surface-0 p-2 text-app-muted hover:bg-app-surface-1 hover:text-app-fg"
            title="Back to inbox"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {serialized.length === 0 ? (
        <div className="rounded-lg border border-app-border bg-app-surface-0/70 px-4 py-12 text-center text-xs text-app-faint">
          No VIP walk-ins yet today. When a recognised VIP sends their first message, an alert appears here.
        </div>
      ) : (
        <VipTodayClient alerts={serialized} />
      )}
    </div>
  );
}
