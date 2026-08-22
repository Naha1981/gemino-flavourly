import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { tenants } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';

// This route stays dynamically rendered: ClerkProvider in the root layout
// reads request headers, which opts the whole app out of static rendering, so
// a page-level `export const revalidate` here would be silently ignored.
// The caching is done at the data layer below instead, which works regardless
// of render mode.
export const dynamic = 'force-dynamic';

/**
 * Public menu page for a venue: /m/<slug>
 *
 * lib/ai/responder.ts sends customers to this URL when they ask for the menu,
 * but the route did not exist — every diner who texted "menu" received a link
 * that 404'd. This is deliberately public (no Clerk auth): it is opened from
 * WhatsApp by diners who have no account, so middleware.ts also lists
 * '/m/(.*)' as a public route.
 *
 * NOTE ON SCOPE: this reads only columns that exist in the current schema
 * (name, description, opening_hours). A dedicated `menu_text` column — so
 * owners can publish an actual dish list rather than relying on the
 * description field — is a deliberate follow-up: adding it requires a schema
 * change plus a settings-form field, and this change is scoped to stopping
 * the 404 without touching the database.
 */

interface Props {
  params: { slug: string };
}

// Two layers of caching, doing different jobs:
//
// 1. `unstable_cache` persists the row across REQUESTS for 5 minutes. This
//    page is linked from WhatsApp, so a single broadcast can produce a burst
//    of traffic for one venue; without this, every view is its own round trip
//    to Neon. Tagged per-slug so a future settings save can purge just the one
//    page.
// 2. React's `cache` dedupes within a SINGLE request, so generateMetadata and
//    the page body share one lookup instead of issuing two.
const getTenantUncached = (slug: string) =>
  db.query.tenants.findFirst({
    where: eq(tenants.slug, slug),
    columns: {
      name: true,
      description: true,
      openingHours: true,
    },
  });

const getTenant = cache((slug: string) =>
  unstable_cache(() => getTenantUncached(slug), ['menu-page', slug], {
    revalidate: 300,
    tags: [`menu:${slug}`],
  })()
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await getTenant(params.slug);
  if (!tenant) return { title: 'Menu not found' };

  return {
    title: `${tenant.name} — Menu`,
    description: tenant.description || `Menu and trading hours for ${tenant.name}.`,
  };
}

export default async function MenuPage({ params }: Props) {
  const tenant = await getTenant(params.slug);

  if (!tenant) {
    notFound();
  }

  const hours = tenant.openingHours || 'Mon – Sun: 11:30 AM – 10:00 PM';

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-10 text-zinc-100">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-8 border-b border-zinc-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">{tenant.name}</h1>
          {tenant.description && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{tenant.description}</p>
          )}
        </header>

        <section className="mb-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Menu
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5 text-sm leading-relaxed text-zinc-400">
            Message us on WhatsApp and we’ll gladly talk you through today’s dishes and chef
            specials.
          </div>
        </section>

        <section>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-400">
              Trading hours
            </h2>
            <p className="whitespace-pre-wrap text-sm text-zinc-300">{hours}</p>
          </div>
        </section>

        <footer className="mt-10 border-t border-zinc-800 pt-5 text-center text-xs text-zinc-600">
          Powered by Gemino AI
        </footer>
      </div>
    </main>
  );
}
