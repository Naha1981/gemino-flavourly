import { db } from '@/lib/db';
import {
  tenants,
  memberships,
  brandProfiles,
  contacts,
  customerProfiles,
  reservations,
  conversations,
  messages,
  approvalRequests,
  googleReviews,
  marketingCampaigns,
  marketingBriefs,
  marketingEvents,
  competitors,
  competitorMenuSnapshots,
  competitorPromotions,
  marketOpportunities,
  revenueEvents,
  systemSettings,
  waAccounts,
  campaignSimulations,
  campaignSimulationSegments,
} from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { deadId, DEADBEEF_PREFIX } from './deadbeef.ts';
import {
  makeRng,
  generateCustomers,
  generateRevenueEvents,
  generateBookings,
  generateConversations,
  generateReviews,
  generateCampaigns,
  generateBriefs,
  generateCalendar,
  generateCompetitors,
  generateMarketAlerts,
  generateOpportunities,
  generatePulsemapSimulations,
  DEMO_SEGMENT_SUMMARIES,
} from './seed-generators.ts';

/**
 * Demo Mode — DB orchestration.
 *
 * SAFETY CONTRACT:
 *   - every seeded row id starts with 'deadbeef-';
 *   - wipe deletes ONLY rows whose id (or tenant_id, for grants) matches
 *     'deadbeef-%' — real rows are never modified or deleted;
 *   - seeding is wipe-then-seed, so running it twice yields identical
 *     counts (idempotent);
 *   - nothing here ever runs on deploy or login — only the explicit
 *     super-admin routes /api/admin/seed-demo and /api/admin/wipe-demo.
 */

export const DEMO_TENANT_ID = deadId('tenant', 0);
export const DEMO_TENANT_NAME = 'The Grand Bistro';
export const OWNER_EMAIL = 'naha.thabiso@gmail.com';

const PLATFORM_TENANTS = [
  { name: 'Marble', plan: 'signature', planStatus: 'active' },
  { name: 'Gemelli', plan: 'premium', planStatus: 'active' },
  { name: 'SUD', plan: 'premium', planStatus: 'trialing' },
  { name: 'AURUM', plan: 'group', planStatus: 'active' },
  { name: 'Saint', plan: 'premium', planStatus: 'past_due' },
  { name: 'Zioux', plan: 'signature', planStatus: 'trialing' },
] as const;

async function chunkedInsert<T extends object>(
  table: Parameters<typeof db.insert>[0],
  rows: T[],
  chunk = 200
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    if (slice.length === 0) continue;
    await db.insert(table as never).values(slice as never);
    inserted += slice.length;
  }
  return inserted;
}

/**
 * Section-resilient insert: on a driver-specific failure (the pg-mem gate
 * harness rejects some DEFAULT-heavy tables, e.g. reservations), LOG the
 * section and continue the seed rather than aborting the whole demo load.
 * A partial demo dataset with a visible error beats a 500 with nothing.
 */
async function safeCountedInsert<T extends object>(
  label: string,
  table: Parameters<typeof db.insert>[0],
  rows: T[]
): Promise<number> {
  try {
    return await chunkedInsert(table, rows);
  } catch (err) {
    console.error(`[demo] seed section "${label}" failed in this environment (${rows.length} rows skipped):`, err);
    return 0;
  }
}

/** Delete ONLY deadbeef-% demo rows (children first for FK safety). */
export async function wipeDemoRows(): Promise<number> {
  const like = `${DEADBEEF_PREFIX}-%`;
  const deletes: [string, () => Promise<unknown>][] = [
    ['approval_requests', () => db.delete(approvalRequests).where(sql`tenant_id::text like ${like}`)],
    ['messages', () => db.delete(messages).where(sql`tenant_id::text like ${like}`)],
    ['conversations', () => db.delete(conversations).where(sql`tenant_id::text like ${like}`)],
    ['reservations', () => db.delete(reservations).where(sql`tenant_id::text like ${like}`)],
    ['customer_profiles', () => db.delete(customerProfiles).where(sql`tenant_id::text like ${like}`)],
    ['contacts', () => db.delete(contacts).where(sql`tenant_id::text like ${like}`)],
    ['google_reviews', () => db.delete(googleReviews).where(sql`tenant_id::text like ${like}`)],
    ['marketing_campaigns', () => db.delete(marketingCampaigns).where(sql`tenant_id::text like ${like}`)],
    ['marketing_briefs', () => db.delete(marketingBriefs).where(sql`tenant_id::text like ${like}`)],
    ['marketing_events', () => db.delete(marketingEvents).where(sql`tenant_id::text like ${like}`)],
    // GATE PM-1 — simulation children first (their ids are deadbeef too).
    ['campaign_simulation_segments', () => db.delete(campaignSimulationSegments).where(sql`simulation_id::text like ${like}`)],
    ['campaign_simulations', () => db.delete(campaignSimulations).where(sql`tenant_id::text like ${like}`)],
    ['competitor_menu_snapshots', () => db.delete(competitorMenuSnapshots).where(sql`competitor_id::text like ${like}`)],
    ['competitor_promotions', () => db.delete(competitorPromotions).where(sql`competitor_id::text like ${like}`)],
    ['competitors', () => db.delete(competitors).where(sql`tenant_id::text like ${like}`)],
    ['market_opportunities', () => db.delete(marketOpportunities).where(sql`tenant_id::text like ${like}`)],
    ['revenue_events', () => db.delete(revenueEvents).where(sql`tenant_id::text like ${like}`)],
    ['memberships', () => db.delete(memberships).where(sql`tenant_id::text like ${like}`)],
    ['brand_profiles', () => db.delete(brandProfiles).where(sql`tenant_id::text like ${like}`)],
    ['tenants', () => db.delete(tenants).where(sql`id::text like ${like}`)],
  ];
  let removedTables = 0;
  for (const [, run] of deletes) {
    await run().catch((err) => console.error('[demo] wipe step failed', err));
    removedTables += 1;
  }
  await setDemoFlag(false);
  return removedTables;
}

async function setDemoFlag(active: boolean) {
  const row = await db.query.systemSettings.findFirst().catch(() => null);
  if (row) {
    await db.update(systemSettings).set({ demoSeedActive: active, updatedAt: new Date() }).where(eq(systemSettings.id, row.id));
  } else {
    await db.insert(systemSettings).values({ demoSeedActive: active });
  }
}

/** Best-effort: resolve the owner's Clerk user id from their email. */
async function resolveOwnerClerkId(): Promise<string | null> {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) return null;
  try {
    const res = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(OWNER_EMAIL)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const user = Array.isArray(data) ? data[0] : (data as { data?: { id: string }[] }).data?.[0];
    return user?.id ?? null;
  } catch {
    return null;
  }
}

export interface SeedResult {
  ok: boolean;
  tenantId: string;
  tenantName: string;
  ownerLinked: boolean;
  counts: Record<string, number>;
}

/** Wipe-then-seed: idempotent by construction. */
export async function seedDemoData(): Promise<SeedResult> {
  const now = new Date();
  const rng = makeRng(20260826);
  const counts: Record<string, number> = {};

  await wipeDemoRows();

  // 1. Demo tenant: The Grand Bistro (premium, active) + gold/green brand.
  await db.insert(tenants).values({
    id: DEMO_TENANT_ID,
    name: DEMO_TENANT_NAME,
    slug: 'demo-grand-bistro',
    ownerEmail: OWNER_EMAIL,
    description: 'Fine-casual bistro in Johannesburg (demo dataset).',
    address: '12 Stanley Ave, Milpark, Johannesburg',
    plan: 'premium',
    planStatus: 'active',
    tenantMode: 'live',
    onboardingComplete: true,
  });
  await db.insert(brandProfiles).values({
    id: deadId('brand', 0),
    tenantId: DEMO_TENANT_ID,
    brandName: DEMO_TENANT_NAME,
    tagline: 'Modern European cooking, Johannesburg heart',
    primaryColor: '#D4AF37',
    secondaryColor: '#004225',
    backgroundColor: '#fff8f0',
    fontFamily: 'Playfair Display',
    // logoUrl stays null on purpose: the UI falls back to the Flavourly mark.
    logoUrl: null,
    confidence: 0.9,
    extractedAt: now,
  });

  // 1b. WhatsApp account — CONNECTED. Without this row the Overview's
  // one-time-onboarding redirect (neverConnected -> /dashboard/whatsapp)
  // bounced demo-mode viewers to the QR page instead of the dashboard, and
  // the demo tenant is supposed to be a fully-operational restaurant.
  await db.insert(waAccounts).values({
    id: deadId('wa', 0),
    tenantId: DEMO_TENANT_ID,
    phoneNumber: '+27821110099',
    isConnected: true,
    status: 'connected',
    lastConnectedAt: now,
  });

  // 2. Link the owner (super admin) so Grand Bistro resolves for them.
  const ownerClerkId = await resolveOwnerClerkId();
  let ownerLinked = false;
  if (ownerClerkId) {
    await db
      .update(tenants)
      .set({ ownerUserId: ownerClerkId, ownerId: ownerClerkId })
      .where(eq(tenants.id, DEMO_TENANT_ID));
    await db
      .insert(memberships)
      .values({ id: deadId('profile', 999990), userId: ownerClerkId, tenantId: DEMO_TENANT_ID, role: 'owner' })
      .onConflictDoNothing();
    ownerLinked = true;
  }

  // 3. Customers + profiles.
  const customers = generateCustomers(DEMO_TENANT_ID, now, rng);
  counts.contacts = await chunkedInsert(
    contacts,
    customers.map((c) => ({
      id: c.id,
      tenantId: DEMO_TENANT_ID,
      phone: c.phone,
      name: c.name,
      vip: c.vip,
      blocklisted: c.blocklisted,
      loyaltyPoints: c.loyaltyPoints,
      birthday: c.birthday,
    }))
  );
  counts.customerProfiles = await chunkedInsert(
    customerProfiles,
    customers.map((c, i) => ({
      id: deadId('profile', i),
      tenantId: DEMO_TENANT_ID,
      contactId: c.id,
      customerPhone: c.phone,
      customerName: c.name,
      totalVisits: c.totalVisits,
      totalSpendCents: c.totalSpendCents,
      avgPartySize: c.avgPartySize,
      lastVisitAt: c.lastVisitAt,
      firstVisitAt: c.firstVisitAt,
      segment: c.segment,
      preferences: {},
    }))
  );

  // Phone -> contact id map for conversation linkage.
  const contactByPhone = new Map(customers.map((c) => [c.phone, c.id]));

  // 4. Revenue (90 days + recovered).
  const revenue = generateRevenueEvents(DEMO_TENANT_ID, now, rng);
  counts.revenueEvents = await chunkedInsert(
    revenueEvents,
    revenue.map((r) => ({
      id: r.id,
      tenantId: DEMO_TENANT_ID,
      eventType: r.eventType,
      estimatedValueCents: r.estimatedValueCents,
      realizedCents: r.realizedCents,
      occurredAt: r.occurredAt,
    }))
  );

  // 5. Bookings. The pg-mem gate harness chokes on this table's DEFAULT
  // clauses (known, documented limitation — production Neon is unaffected):
  // a failing section now LOGS and lets the rest of the demo load, instead
  // of 500-ing the whole seed before campaigns/briefs/PulseMap ever land.
  const bookings = generateBookings(DEMO_TENANT_ID, now, customers, rng);
  counts.reservations = await safeCountedInsert(
    'reservations',
    reservations,
    bookings.map((b) => ({
      id: b.id,
      tenantId: DEMO_TENANT_ID,
      customerName: b.customerName,
      customerPhone: b.customerPhone,
      date: b.date,
      partySize: b.partySize,
      status: b.status,
      noShowDetected: b.noShowDetected,
      noShowDetectedAt: b.noShowDetected ? b.date : null,
      cancelledAt: b.cancelledAt,
    }))
  );

  // 6. Conversations + messages + approval drafts. Conversation outcomes map
  // onto the schema enum: booked/deposit -> 'converted', waitlisted -> 'handled'.
  const convos = generateConversations(DEMO_TENANT_ID, now, customers, rng);
  const outcomeMap = { booked: 'converted', deposit: 'converted', waitlisted: 'handled' } as const;
  counts.conversations = await chunkedInsert(
    conversations,
    convos.map((c) => ({
      id: c.id,
      tenantId: DEMO_TENANT_ID,
      contactId: contactByPhone.get(c.customerPhone) ?? null,
      outcome: c.outcome ? outcomeMap[c.outcome] : null,
      estimatedValueCents: c.estimatedValueCents,
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
      isResolved: c.outcome !== null,
    }))
  );
  counts.messages = await chunkedInsert(
    messages,
    convos.flatMap((c) =>
      c.messages.map((m) => ({
        id: m.id,
        tenantId: DEMO_TENANT_ID,
        conversationId: c.id,
        direction: m.direction,
        content: m.content,
        isAIGenerated: m.isAIGenerated,
        deliveryStatus: m.deliveryStatus,
        createdAt: m.createdAt,
      }))
    )
  );
  const approvals = convos.filter((c) => c.approval);
  counts.approvalRequests = await chunkedInsert(
    approvalRequests,
    approvals.map((c, k) => ({
      id: deadId('approval', k),
      tenantId: DEMO_TENANT_ID,
      conversationId: c.id,
      messageText: c.approval!.messageText,
      riskLevel: c.approval!.riskLevel,
      status: 'pending',
    }))
  );

  // 7. Reputation.
  const reviews = generateReviews(DEMO_TENANT_ID, now, rng);
  counts.googleReviews = await chunkedInsert(
    googleReviews,
    reviews.map((r) => ({
      id: r.id,
      tenantId: DEMO_TENANT_ID,
      googlePlaceId: 'demo-place-grand-bistro',
      reviewId: `demo-${r.id}`,
      authorName: r.authorName,
      rating: r.rating,
      text: r.text,
      time: r.time,
      sentiment: r.sentiment,
      responseText: r.responseSentAt ? r.responseText : null,
      responseSentAt: r.responseSentAt,
    }))
  );
  // AI drafts for the unanswered reviews live in the UI off review text;
  // keep them reachable as response drafts via a separate jsonb-free field.

  // 8. Marketing. Campaign statuses map onto the schema enum
  // (draft/scheduled/sent/failed): launched & completed both read 'sent'.
  const campaigns = generateCampaigns(DEMO_TENANT_ID, now);
  counts.marketingCampaigns = await chunkedInsert(
    marketingCampaigns,
    campaigns.map((c) => ({
      id: c.id,
      tenantId: DEMO_TENANT_ID,
      name: c.name,
      type: c.type,
      targetSegment: c.targetSegment,
      offer: c.offer,
      message: c.message,
      status: c.status === 'launched' || c.status === 'completed' ? 'sent' : c.status,
      launchedAt: c.launchedAt,
      estimatedReach: c.estimatedReach,
      estimatedRevenueCents: c.estimatedRevenueCents,
      sentCount: c.status === 'launched' || c.status === 'completed' ? c.estimatedReach : 0,
      sentAt: c.launchedAt,
    }))
  );
  const briefs = generateBriefs(DEMO_TENANT_ID, now);
  counts.marketingBriefs = await chunkedInsert(
    marketingBriefs,
    briefs.map((b) => ({ id: b.id, tenantId: DEMO_TENANT_ID, brief: b.brief, generatedAt: b.generatedAt }))
  );

  // 8b. GATE PM-1 — PulseMap simulations for two seeded campaigns (the
  // draft "Live Jazz Friday" and the applied "Kids Eat Free Sunday"), so
  // the campaigns list wears PulseMap chips in Demo Mode. Generated by the
  // same deterministic forecaster the Simulate button uses.
  const pulsemapSims = generatePulsemapSimulations(DEMO_TENANT_ID, now);
  counts.campaignSimulations = await chunkedInsert(
    campaignSimulations,
    pulsemapSims.map((s) => ({
      id: s.id,
      tenantId: DEMO_TENANT_ID,
      campaignId: s.campaignId,
      inputHash: s.inputHash,
      source: 'demo' as const,
      status: 'complete' as const,
      score: s.forecast.score,
      readiness: s.forecast.readiness,
      bestSegment: s.forecast.bestSegment,
      purchaseIntent: s.forecast.purchaseIntent,
      objections: s.forecast.objections,
      likelyReplies: s.forecast.likelyReplies,
      riskFlags: s.forecast.riskFlags,
      improvedCopy: s.forecast.improvedCopy,
      explanation: s.forecast.explanation,
      confidence: s.forecast.confidence,
      assumptions: s.forecast.assumptions,
      segmentSummaries: { source: 'demo-seed', segments: DEMO_SEGMENT_SUMMARIES },
      model: 'demo:deterministic',
      appliedAt: s.appliedAt,
      appliedToCampaignId: s.appliedAt ? s.campaignId : null,
    }))
  );
  const allSimSegments = pulsemapSims.flatMap((s) =>
    s.forecast.segmentReactions.map((r) => ({
      id: deadId('pulseseg', pulsemapSims.indexOf(s) * 10 + s.forecast.segmentReactions.indexOf(r)),
      simulationId: s.id,
      segment: r.segment,
      reaction: r.reaction,
      purchaseIntent: r.purchaseIntent,
      primaryObjection: r.primaryObjection,
    }))
  );
  counts.campaignSimulationSegments = await chunkedInsert(campaignSimulationSegments, allSimSegments);
  const calendar = generateCalendar(DEMO_TENANT_ID, now);
  counts.marketingEvents = await chunkedInsert(
    marketingEvents,
    calendar.map((e) => ({
      id: e.id,
      tenantId: DEMO_TENANT_ID,
      name: e.name,
      description: e.description,
      eventType: e.eventType,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      status: e.status,
    }))
  );

  // 9. Market intelligence.
  const comps = generateCompetitors(DEMO_TENANT_ID);
  counts.competitors = await chunkedInsert(
    competitors,
    comps.map((c) => ({
      id: c.id,
      tenantId: DEMO_TENANT_ID,
      name: c.name,
      distanceKm: c.distanceKm,
      currentRating: c.currentRating,
      reviewCount: c.reviewCount,
      placeData: c.placeData,
      lastCheckAt: now,
    }))
  );
  const alerts = generateMarketAlerts(now);
  counts.competitorMenuSnapshots = await chunkedInsert(
    competitorMenuSnapshots,
    alerts.snapshots.map((s) => ({
      id: s.id,
      competitorId: comps[s.competitorIndex].id,
      menuText: s.menuText,
      priceRange: s.priceRange,
      snapshotAt: s.snapshotAt,
    }))
  );
  counts.competitorPromotions = await chunkedInsert(
    competitorPromotions,
    alerts.promotions.map((p) => ({
      id: p.id,
      competitorId: comps[p.competitorIndex].id,
      promotionText: p.promotionText,
      source: p.source,
      detectedAt: p.detectedAt,
    }))
  );
  const opps = generateOpportunities(DEMO_TENANT_ID, now);
  counts.marketOpportunities = await chunkedInsert(
    marketOpportunities,
    opps.map((o) => ({
      id: o.id,
      tenantId: DEMO_TENANT_ID,
      key: o.key,
      opportunityType: o.opportunityType,
      title: o.title,
      description: o.description,
      confidence: o.confidence,
      evidence: [],
    }))
  );

  // 10. Super-admin platform tenants (living multi-tenant view).
  for (let t = 0; t < PLATFORM_TENANTS.length; t++) {
    const spec = PLATFORM_TENANTS[t];
    const tenantId = deadId('tenant', t + 1);
    await db.insert(tenants).values({
      id: tenantId,
      name: spec.name,
      slug: `demo-${spec.name.toLowerCase()}`,
      plan: spec.plan,
      planStatus: spec.planStatus,
      tenantMode: 'live',
      description: `${spec.name} (demo platform tenant).`,
    });
    const rngT = makeRng(700 + t);
    const tCustomers = generateCustomers(tenantId, now, rngT).slice(0, 5);
    await chunkedInsert(
      contacts,
      tCustomers.map((c, k) => ({
        id: deadId('contact', 10000 + t * 100 + k),
        tenantId,
        phone: c.phone,
        name: c.name,
        vip: c.vip,
      }))
    );
    const tConvos = generateConversations(tenantId, now, tCustomers, rngT).slice(0, 6);
    await chunkedInsert(
      conversations,
      tConvos.map((c, k) => ({
        id: deadId('conversation', 10000 + t * 100 + k),
        tenantId,
        // Link to the contact rows inserted just above (same deterministic
        // deadbeef ids) — this column is NOT NULL, and passing null here
        // killed the whole demo seed mid-load before the active flag could
        // ever be set (pre-existing bug surfaced by the PM-1 evidence pass).
        contactId: deadId('contact', 10000 + t * 100 + (k % 5)),
        outcome: c.outcome ? outcomeMap[c.outcome] : null,
        estimatedValueCents: c.estimatedValueCents,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
      }))
    );
    await chunkedInsert(
      messages,
      tConvos.flatMap((c, k) =>
        c.messages.slice(0, 2).map((m, j) => ({
          id: deadId('message', 100000 + t * 1000 + k * 10 + j),
          tenantId,
          conversationId: deadId('conversation', 10000 + t * 100 + k),
          direction: m.direction,
          content: m.content,
          isAIGenerated: m.isAIGenerated,
          deliveryStatus: m.deliveryStatus,
          createdAt: m.createdAt,
        }))
      )
    );
    const tBookings = generateBookings(tenantId, now, tCustomers, rngT).slice(0, 8);
    await safeCountedInsert(
      `reservations:${spec.name}`,
      reservations,
      tBookings.map((b, k) => ({
        id: deadId('booking', 10000 + t * 100 + k),
        tenantId,
        customerName: b.customerName,
        customerPhone: b.customerPhone,
        date: b.date,
        partySize: b.partySize,
        status: b.status,
      }))
    );
    const tRevenue = generateRevenueEvents(tenantId, now, rngT).slice(0, 30);
    await chunkedInsert(
      revenueEvents,
      tRevenue.map((r, k) => ({
        id: deadId('revenue', 10000 + t * 1000 + k),
        tenantId,
        eventType: r.eventType,
        estimatedValueCents: r.estimatedValueCents,
        realizedCents: r.realizedCents,
        occurredAt: r.occurredAt,
      }))
    );
  }

  await setDemoFlag(true);
  return { ok: true, tenantId: DEMO_TENANT_ID, tenantName: DEMO_TENANT_NAME, ownerLinked, counts };
}
