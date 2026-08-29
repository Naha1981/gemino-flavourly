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

/**
 * RC6 / F2 — the dashboard layout must degrade, not throw.
 *
 * Every one of the seventeen /dashboard routes renders inside this layout,
 * and it resolves the active tenant from the database before rendering
 * anything. `resolveActiveTenant()` and `getOrCreateTenant()` were called
 * bare, so a single DB hiccup (or a missing base table — see the S1 fix)
 * took the entire dashboard down with a 500 and no error boundary above it.
 *
 * Now each DB read is individually guarded. If nothing resolves *because the
 * database is unreachable*, we still render the shell with a "Reconnecting"
 * banner — the operator keeps the sidebar, the sign-out control and the
 * navigation, which is exactly what you need during an incident. A genuine
 * brand-new user (DB fine, no tenant yet) still redirects to /sign-in.
 */

/** Static banner: no data, no Clerk, no network. */
function ReconnectingBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
    >
      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500/40 border-t-amber-600" />
      <span>
        <strong className="font-semibold">Reconnecting&hellip;</strong> We can&apos;t reach the
        database right now, so this dashboard is showing limited data. Your WhatsApp conversations
        are unaffected. This page will recover on its own.
      </span>
    </div>
  );
}

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  // S4 — resolve the active tenant through the tenant resolver
  // (?tenant= -> cookie -> owned/membership -> super-admin default). Only
  // when nothing resolves (brand-new user) fall back to getOrCreateTenant.
  let tenant: { id: string; name: string } | null = null;
  let degraded = false;

  try {
    const resolved = await resolveActiveTenant();
    tenant = resolved?.tenant ?? null;
  } catch (err) {
    degraded = true;
    console.error('[dashboard-layout] resolveActiveTenant failed:', (err as Error)?.message);
  }

  if (!tenant) {
    try {
      tenant = await getOrCreateTenant();
    } catch (err) {
      degraded = true;
      console.error('[dashboard-layout] getOrCreateTenant failed:', (err as Error)?.message);
    }
  }

  if (!tenant) {
    if (degraded) {
      // Database unreachable. Do NOT redirect: the visitor is authenticated
      // (middleware already proved that), so bouncing them to /sign-in would
      // just loop. Render the shell with a banner instead.
      return (
        <ThemeProvider brand={null}>
          <DashboardChrome switcherTenants={[]} activeTenantId="" demoActive={false}>
            <ReconnectingBanner />
            {children}
          </DashboardChrome>
        </ThemeProvider>
      );
    }
    // Healthy database, no tenant yet: brand-new user.
    redirect('/sign-in');
  }

  // Managed tenants for the sidebar switcher (server-side list; the switch
  // endpoint re-checks grants, so this list alone authorises nothing).
  // Guarded with try/catch rather than .catch(): `auth()` resolves to an
  // `Auth` object here, not a Promise, so it has no .then/.catch.
  let userId: string | null = null;
  try {
    userId = (await auth()).userId;
  } catch (err) {
    console.error('[dashboard-layout] auth() failed:', (err as Error)?.message);
  }

  const managed = userId
    ? await listManagedTenants(userId).catch((err) => {
        console.error('[dashboard-layout] listManagedTenants failed:', (err as Error)?.message);
        return [];
      })
    : [];

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
        {degraded && <ReconnectingBanner />}
        {children}
      </DashboardChrome>
    </ThemeProvider>
  );
}
