import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { listProspects, countProspectsByStatus } from '@/lib/brand-intelligence/prospect-store';
import { ProspectsConsole } from './prospects-console';
import type { ProspectStatus } from '@/lib/brand-intelligence/prospects';

export const dynamic = 'force-dynamic';

/**
 * Super Admin — /admin/prospects.
 *
 * The sales-pitch console: import prospects by CSV, build a pre-configured
 * demo tenant from each, generate a magic-link claim token, and open the
 * public /claim/[token] page for the owner to claim it.
 *
 * Gate: identical to the rest of /admin — isSuperAdmin() fails closed on any
 * missing/unresolvable identity, so no signed-in user sneaks into the
 * cross-tenant console.
 */
export default async function AdminProspectsPage() {
  const { userId } = await auth();
  const authorized = await isSuperAdmin();

  if (!userId || !authorized) {
    redirect('/sign-in');
  }

  const [prospects, counts] = await Promise.all([listProspects(), countProspectsByStatus()]).catch(
    () => [ [], {} ] as unknown as [Awaited<ReturnType<typeof listProspects>>, Partial<Record<ProspectStatus, number>>]
  );

  const serialized = prospects.map((p) => ({
    id: p.id,
    name: p.name,
    website: p.website,
    ownerEmail: p.ownerEmail,
    ownerPhone: p.ownerPhone,
    city: p.city,
    status: p.status as ProspectStatus,
    error: p.error,
    retries: p.retries,
    tenantId: p.tenantId,
    claimToken: p.claimToken,
    createdAt: p.createdAt.toISOString(),
  }));

  return <ProspectsConsole initialProspects={serialized} counts={counts ?? {}} />;
}
