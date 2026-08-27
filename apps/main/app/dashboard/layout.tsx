import { redirect } from 'next/navigation';
import { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { brandProfiles, systemSettings } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { resolveActiveTenant, listManagedTenants } from '@/lib/tenant-resolver';
import { auth } from '@clerk/nextjs/server';
import { ThemeProvider } from '@/components/theme-provider';
import { DashboardChrome } from './dashboard-chrome';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // S4 — resolve the active tenant through the tenant resolver
  // (?tenant= -> cookie -> owned/membership -> super-admin default). Only
  // when nothing resolves (brand-new user) fall back to getOrCreateTenant.
  const resolved = await resolveActiveTenant();
  let tenant = resolved?.tenant ?? null;
  if (!tenant) tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  // Managed tenants for the sidebar switcher (server-side list; the switch
  // endpoint re-checks grants, so this list alone authorises nothing).
  const { userId } = await auth();
  const managed = userId ? await listManagedTenants(userId) : [];
  const switcherTenants =
    managed.length > 0
      ? managed.map((t) => ({ id: t.id, name: t.name }))
      : [{ id: tenant.id, name: tenant.name }];

  const brand = await db.query.brandProfiles
    .findFirst({ where: eq(brandProfiles.tenantId, tenant.id) })
    .catch(() => null);

  // Demo mode chip: visible while the deadbeef seed dataset is loaded.
  const settings = await db.query.systemSettings.findFirst().catch(() => null);
  const demoActive = Boolean(settings?.demoSeedActive);

  // Pass only the plain serialisable branding fields to the client Provider.
  const themeBrand = brand
    ? {
        brandName: brand.brandName,
        logoUrl: brand.logoUrl,
        logoPath: brand.logoPath,
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        backgroundColor: brand.backgroundColor,
        fontFamily: brand.fontFamily,
      }
    : null;

  return (
    <ThemeProvider brand={themeBrand}>
      <DashboardChrome
        switcherTenants={switcherTenants}
        activeTenantId={tenant.id}
        demoActive={demoActive}
      >
        {children}
      </DashboardChrome>
    </ThemeProvider>
  );
}
