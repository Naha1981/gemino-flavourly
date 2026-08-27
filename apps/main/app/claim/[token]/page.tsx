import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { db } from '@/lib/db';
import {
  tenants,
  brandProfiles,
  googleReviews,
  reservations,
  marketingCampaigns,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { findClaimToken } from '@/lib/brand-intelligence/prospect-store';
import { assessClaimToken } from '@/lib/brand-intelligence/magic-link';
import { ThemeProvider } from '@/components/theme-provider';
import { ClaimButton } from './claim-button';
import { ClaimInvalid, ClaimAlreadyClaimed } from './claim-states';

export const dynamic = 'force-dynamic';

interface Props {
  params: { token: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tok = await findClaimToken(params.token);
  if (!tok) return { title: 'Claim your app | Flavourly' };
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, tok.tenantId))
    .limit(1);
  return { title: tenant?.name ? `${tenant.name} — Claim your app | Flavourly` : 'Claim your app | Flavourly' };
}

/**
 * Public magic-link page — /claim/[token].
 *
 * NO AUTH REQUIRED (added to the public-route matcher in middleware.ts): this
 * is the page a sales rep opens on a prospect owner's phone. It loads the
 * tenant's real branding + sample data so the pitch is "your dashboard is
 * already live", and offers a gold Claim button that kicks off the sign-up /
 * claim flow.
 *
 * If the token is already claimed it renders a friendly "sign in to access"
 * state instead of re-claiming.
 */
export default async function ClaimPage({ params }: Props) {
  const tokenRow = await findClaimToken(params.token);
  if (!tokenRow) {
    return (
      <ClaimShell>
        <ClaimInvalid />
      </ClaimShell>
    );
  }

  const assessment = assessClaimToken(tokenRow);
  if (assessment.kind === 'invalid') {
    return (
      <ClaimShell>
        <ClaimInvalid />
      </ClaimShell>
    );
  }

  const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, tokenRow.tenantId) });
  const brand = await db.query.brandProfiles.findFirst({ where: eq(brandProfiles.tenantId, tokenRow.tenantId) });

  if (!tenant) {
    notFound();
  }

  if (assessment.kind === 'claimed') {
    return (
      <ClaimShell>
        <ClaimAlreadyClaimed tenantName={tenant.name} tenantId={tenant.id} />
      </ClaimShell>
    );
  }

  if (assessment.kind === 'expired') {
    return (
      <ClaimShell>
        <ClaimInvalid reason="expired" />
      </ClaimShell>
    );
  }

  // Load the sample data the demo tenant was seeded with.
  const [reviews, bookings, campaigns] = await Promise.all([
    db
      .select()
      .from(googleReviews)
      .where(eq(googleReviews.tenantId, tenant.id))
      .orderBy(desc(googleReviews.time))
      .limit(5),
    db
      .select()
      .from(reservations)
      .where(eq(reservations.tenantId, tenant.id))
      .orderBy(desc(reservations.date))
      .limit(6),
    db
      .select()
      .from(marketingCampaigns)
      .where(eq(marketingCampaigns.tenantId, tenant.id))
      .limit(3),
  ]);

  const menu = (brand?.menuJson as { name: string; price: string | null }[] | null) ?? [];
  const hours = (brand?.hoursJson as { day: string; opens: string | null; closes: string | null }[] | null) ?? [];

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
      <div
        className="min-h-screen"
        style={{
          backgroundColor: 'var(--brand-background, #0b1210)',
          color: '#f5f1ea',
          fontFamily: 'var(--font-brand, inherit)',
        }}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <BrandMark logoUrl={brand?.logoUrl} brandName={brand?.brandName ?? tenant.name} />
          <ClaimButton token={params.token} />
        </header>

        <main className="mx-auto max-w-5xl px-6 py-10">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
            <p className="text-sm text-white/60">Your dashboard is already live</p>
            <h1 className="mt-2 text-3xl font-semibold">{tenant.name}</h1>
            {brand?.tagline && <p className="mt-2 text-white/70">{brand.tagline}</p>}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ClaimButton token={params.token} large />
            </div>
            <p className="mt-4 text-xs text-white/50">
              This is a pre-configured demo. Claim it to keep the dashboard and connect your WhatsApp in about 5 minutes.
            </p>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            <section className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-white/70">Bookings</h2>
                {/* S1 — bookings on the demo are seeded sample data; badge them
                    honestly instead of passing them off as real reservations. */}
                <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  Sample
                </span>
              </div>
              <ul className="mt-3 space-y-2 text-sm">
                {(bookings.length > 0 ? bookings : []).slice(0, 5).map((b) => (
                  <li key={b.id} className="flex items-center justify-between text-white/80">
                    <span>{b.customerName}</span>
                    <span className="text-white/50">{formatDate(b.date)} · {b.partySize}pax</span>
                  </li>
                ))}
                {bookings.length === 0 && <li className="text-white/50">Not confirmed yet</li>}
              </ul>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-white/70">Reviews</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {(reviews.length > 0 ? reviews : []).slice(0, 4).map((r) => (
                  <li key={r.id} className="text-white/80">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                      <span className="text-white/50">{r.authorName}</span>
                    </div>
                    {r.text ? <p className="mt-1 text-white/60 line-clamp-2">{r.text}</p> : null}
                  </li>
                ))}
                {reviews.length === 0 && <li className="text-white/50">Not confirmed yet</li>}
              </ul>
            </section>

            <section className="rounded-xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-sm font-medium text-white/70">On us tonight</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {(campaigns.length > 0 ? campaigns : []).map((c) => (
                  <li key={c.id} className="text-white/80">
                    <span className="text-white">{c.name}</span>
                    <span className="block text-white/50">{c.offer}</span>
                  </li>
                ))}
                {campaigns.length === 0 && <li className="text-white/50">Not confirmed yet</li>}
              </ul>
            </section>
          </div>

          {/* S1 — menu & hours always render. When the brand profile has no
              real data we say "Not confirmed yet" — empty state, never
              invented data. */}
          <section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5" data-testid="claim-menu">
            <h2 className="text-sm font-medium text-white/70">Menu</h2>
            {menu.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {menu.slice(0, 8).map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm text-white/80">
                    <span>{item.name}</span>
                    {item.price && <span className="text-white/50">{item.price}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/50">Not confirmed yet</p>
            )}
          </section>

          <section className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5" data-testid="claim-hours">
            <h2 className="text-sm font-medium text-white/70">Hours</h2>
            {hours.length > 0 ? (
              <div className="mt-3 grid gap-1 text-sm text-white/70 sm:grid-cols-2">
                {hours.slice(0, 7).map((h, i) => (
                  <span key={i}>{h.day}: {h.opens ?? '—'}–{h.closes ?? '—'}</span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-white/50">Not confirmed yet</p>
            )}
          </section>
        </main>
      </div>
    </ThemeProvider>
  );
}

function BrandMark({ logoUrl, brandName }: { logoUrl?: string | null; brandName: string }) {
  if (logoUrl) {
    return (
      <div className="flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl} alt={brandName} className="h-8 w-auto" />
        <span className="font-semibold text-white">{brandName}</span>
      </div>
    );
  }
  return <span className="font-semibold text-white">{brandName}</span>;
}

function ClaimShell({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider brand={null}>
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">{children}</div>
    </ThemeProvider>
  );
}

function formatDate(d: Date): string {
  return new Date(d).toISOString().slice(0, 10);
}
