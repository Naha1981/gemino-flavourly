import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import {
  tenants,
  waAccounts,
  contacts,
  reservations,
  googleReviews,
  marketingCampaigns,
  revenueEvents,
  brandProfiles,
} from '@/lib/db/schema';
import { scrapeUrl, type BrandProfile } from './scraper.ts';
import { fetchGooglePlacesData, type GooglePlacesData } from './google-places.ts';
import {
  generateSeedBookings,
  generateSeedReviews,
  generateSeedCampaigns,
  estimateKpi,
} from './seed-data.ts';
import { createClaimToken, claimLinkFor } from './prospect-store.ts';

export interface DemoTenantInput {
  name: string;
  website: string;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  city?: string | null;
}

export interface CreateDemoTenantResult {
  tenantId: string;
  claimToken: string;
  claimLink: string;
  brand: BrandProfile | null;
  places: GooglePlacesData;
}

/**
 * Build a fully pre-configured demo tenant for a prospect:
 *   1. Create the tenant (plan='signature', plan_status='trialing', tenant
 *      mode='demo') + its linked WhatsApp account row.
 *   2. Run the Brand Intelligence Engine (scrape branding).
 *   3. Enrich with Google Places (reviews, rating, hours).
 *   4. Pre-seed bookings, reviews, campaigns and a revenue KPI.
 *   5. Generate an unclaimed magic-link claim token.
 *
 * Never throws: every enrichment/seed step is guarded so a failing scrape or
 * missing Google key still produces a live-looking tenant the owner can
 * complete later. Returns the tenant, token and link.
 */
export async function createDemoTenant(input: DemoTenantInput): Promise<CreateDemoTenantResult> {
  const now = new Date();

  // 1. Tenant + linked WhatsApp account.
  const slug = `demo-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: input.name,
      slug,
      ownerEmail: input.ownerEmail ?? null,
      description: null,
      plan: 'signature',
      planStatus: 'trialing',
      trialEndsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      tenantMode: 'demo',
      menuText: null,
      onboardingComplete: false,
    })
    .returning();

  if (!tenant) throw new Error('Failed to create demo tenant');
  const tenantId = tenant.id;

  await db
    .insert(waAccounts)
    .values({ tenantId, isConnected: false, status: 'unlinked' })
    .catch((err) => console.error('[demo] failed to create wa_account', err));

  // 2. Brand Intelligence Engine.
  let brand: BrandProfile | null = null;
  try {
    const scraped = await scrapeUrl(input.website);
    brand = truncateBrand(scraped);
  } catch (err) {
    console.error('[demo] brand scrape failed', err);
  }

  // 3. Google Places enrichment.
  let places: GooglePlacesData = {
    placeId: '',
    name: input.name,
    rating: null,
    reviewCount: null,
    address: null,
    hoursJson: null,
    reviews: [],
  };
  try {
    places = await fetchGooglePlacesData(input.name, input.city ?? '');
  } catch (err) {
    console.error('[demo] google places failed', err);
  }

  // Brand profile row (falls back gracefully when nothing was scraped).
  if (brand) {
    await db
      .insert(brandProfiles)
      .values({
        tenantId,
        sourceUrl: input.website,
        logoUrl: brand.logoUrl,
        logoPath: brand.logoUrl ? `/brands/${tenantId}/logo.png` : null,
        primaryColor: brand.primaryColor,
        secondaryColor: brand.secondaryColor,
        backgroundColor: brand.backgroundColor,
        fontFamily: brand.fontFamily,
        brandName: brand.brandName || input.name,
        tagline: brand.tagline,
        menuJson: brand.menuJson as Record<string, unknown>,
        hoursJson: brand.hoursJson as Record<string, unknown>,
        googlePlacesId: places.placeId || null,
        confidence: brand.confidence,
        extractedAt: new Date(),
      })
      .catch((err) => console.error('[demo] failed to save brand profile', err));
  }

  // 4. Pre-seed sample data.
  await seedDemoData(tenantId, input.name, brand, places, now);

  // 5. Magic-link claim token.
  const tokenRow = await createClaimToken(tenantId);

  return {
    tenantId,
    claimToken: tokenRow.token,
    claimLink: claimLinkFor(tokenRow),
    brand,
    places,
  };
}

async function seedDemoData(
  tenantId: string,
  restaurantName: string,
  brand: BrandProfile | null,
  places: GooglePlacesData,
  now: Date
): Promise<void> {
  // Reviews (real Google authors when available).
  const reviews = generateSeedReviews(places, 5, now);
  const googlePlaceId = places.placeId || `demo-${tenantId}`;
  const reviewRows = reviews.map((r, i) => ({
    tenantId,
    googlePlaceId,
    reviewId: `${googlePlaceId}-${i}-${randomUUID().slice(0, 6)}`,
    authorName: r.authorName,
    rating: r.rating,
    text: r.text,
    time: r.time,
    sentiment: r.sentiment,
  }));
  if (reviewRows.length > 0) {
    await db
      .insert(googleReviews)
      .values(reviewRows)
      .catch((err) => console.error('[demo] failed to seed reviews', err));
  }

  // Contacts (one per reviewer) so the venue has a customer base.
  for (const r of reviews) {
    const phone = `+27${Math.floor(71 + Math.random() * 14)}${Math.floor(1000000 + Math.random() * 9000000)}`;
    await db
      .insert(contacts)
      .values({
        tenantId,
        phone,
        name: r.authorName,
        vip: r.rating >= 5,
        // Give ~half the seeded contacts a birthday in the next 7 days so the
        // demo surfaces a live birthday-reward campaign on the pitch.
        birthday: birthdayInWindow(),
      })
      .catch((err) => console.error('[demo] failed to seed contact', err));
  }

  // Bookings (future dates, real reviewer names).
  const bookings = generateSeedBookings(places, 8, now);
  const reservationRows = bookings.map((b) => ({
    tenantId,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    date: b.date,
    partySize: b.partySize,
    status: b.status,
    notes: b.notes,
  }));
  if (reservationRows.length > 0) {
    await db
      .insert(reservations)
      .values(reservationRows)
      .catch((err) => console.error('[demo] failed to seed bookings', err));
  }

  // Marketing campaigns (slow-day detection + menu).
  const campaigns = generateSeedCampaigns(
    brand ?? ({ brandName: restaurantName, menuJson: [] } as BrandProfile),
    3,
    now
  );
  const campaignRows = campaigns.map((c) => ({
    tenantId,
    name: c.name,
    description: c.description,
    type: c.type,
    targetSegment: c.targetSegment,
    offer: c.offer,
    message: c.message,
    startDate: c.startDate,
    status: c.status,
    estimatedReach: Math.floor(50 + Math.random() * 400),
  }));
  if (campaignRows.length > 0) {
    await db
      .insert(marketingCampaigns)
      .values(campaignRows)
      .catch((err) => console.error('[demo] failed to seed campaigns', err));
  }

  // Revenue KPI (avg check × review volume × 0.1).
  const kpi = estimateKpi(places, brand ?? ({ brandName: restaurantName, menuJson: [] } as BrandProfile));
  const eventRows = bookings.map((b) => ({
    tenantId,
    eventType: 'booking' as const,
    estimatedValueCents: kpi.avgCheckCents,
    realizedCents: b.status === 'completed' ? kpi.avgCheckCents : 0,
    occurredAt: b.date,
  }));
  if (eventRows.length > 0) {
    await db
      .insert(revenueEvents)
      .values(eventRows)
      .catch((err) => console.error('[demo] failed to seed revenue events', err));
  }
}

/** A random MM-DD within the next 7 days, used to seed demo birthday rewards. */
function birthdayInWindow(): string | null {
  if (Math.random() < 0.5) return null;
  const now = new Date();
  const future = new Date(now.getTime() + Math.floor(Math.random() * 7) * 24 * 60 * 60 * 1000);
  const mm = String(future.getMonth() + 1).padStart(2, '0');
  const dd = String(future.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

/** Guard against oversized scraped strings landing in the JSONB columns. */
function truncateBrand(b: BrandProfile): BrandProfile {
  return {
    ...b,
    brandName: b.brandName?.slice(0, 120) ?? 'Flavourly',
    tagline: b.tagline?.slice(0, 300) ?? null,
    logoUrl: b.logoUrl?.slice(0, 500) ?? null,
    fontFamily: b.fontFamily?.slice(0, 120) ?? null,
  };
}
