import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { getProfile, listVisitHistory } from '@/lib/customer/profile-store';

export const dynamic = 'force-dynamic';

function formatCents(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export default async function CustomerProfilePage({
  params,
}: {
  params: { customer_phone: string };
}) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const customerPhone = decodeURIComponent(params.customer_phone);
  const profile = await getProfile(tenant.id, customerPhone);
  if (!profile) notFound();

  const visits = await listVisitHistory(tenant.id, customerPhone, profile.contactId);
  const prefs = (profile.preferences ?? {}) as {
    dietary?: string[];
    occasions?: string[];
    favorites?: string[];
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-app-border pb-4">
        <Link
          href="/dashboard/customers"
          className="rounded-md border border-app-border bg-app-surface-0 p-2 text-app-muted hover:bg-app-surface-1 hover:text-app-fg"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-app-fg">
            {profile.customerName || 'Guest'}
          </h1>
          <p className="font-mono text-xs text-app-muted">{profile.customerPhone}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Visits" value={String(profile.totalVisits)} />
        <Stat label="Spend" value={formatCents(profile.totalSpendCents)} />
        <Stat label="Avg party" value={String(profile.avgPartySize)} />
        <Stat label="Last visit" value={formatDate(profile.lastVisitAt)} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-lg border border-app-border bg-app-surface-0/70 p-5">
          <h2 className="mb-3 text-sm font-semibold text-app-fg">Preferences</h2>
          <PrefList title="Dietary" items={prefs.dietary} />
          <PrefList title="Occasions" items={prefs.occasions} />
          <PrefList title="Favorites" items={prefs.favorites} />
        </section>

        <section className="rounded-lg border border-app-border bg-app-surface-0/70 p-5">
          <h2 className="mb-3 text-sm font-semibold text-app-fg">Visit history</h2>
          {visits.length === 0 ? (
            <p className="text-xs text-app-faint">No visits in the last 365 days.</p>
          ) : (
            <ul className="divide-y divide-app-border/80">
              {visits.map((visit) => (
                <li key={visit.id} className="flex items-center justify-between py-2 text-xs">
                  <span className="text-app-fg">{formatDate(visit.date)}</span>
                  <span className="text-app-muted">party {visit.partySize}</span>
                  <span className="font-mono text-app-faint">{visit.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-app-border bg-app-surface-0/70 p-4">
      <p className="text-[11px] uppercase tracking-wide text-app-faint">{label}</p>
      <p className="mt-1 text-lg font-semibold text-app-fg">{value}</p>
    </div>
  );
}

function PrefList({ title, items }: { title: string; items?: string[] }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] uppercase tracking-wide text-app-faint">{title}</p>
      {items && items.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-emerald-800 bg-emerald-950/60 px-2 py-0.5 text-[11px] text-emerald-300"
            >
              {item}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs text-app-faint">None recorded</p>
      )}
    </div>
  );
}
