/**
 * Brand Intelligence Engine — demo seed data generator.
 *
 * Pure, framework-free functions that turn real enrichment (Google Places
 * reviews + scraped menu) into the pre-seeded rows a demo tenant needs to
 * look live: bookings, reviews, marketing campaigns and a revenue KPI
 * estimate. Keeping this free of DB imports means the sample-data logic is
 * unit-testable and deterministic (injected `now` / `avgCheck`).
 */

import type { GooglePlacesData } from './google-places.ts';
import type { BrandProfile } from './scraper.ts';

export interface SeedBooking {
  customerName: string;
  customerPhone: string;
  date: Date;
  partySize: number;
  status: 'confirmed' | 'completed';
  notes: string | null;
}

export interface SeedReview {
  authorName: string;
  rating: number;
  text: string | null;
  time: Date;
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface SeedCampaign {
  name: string;
  description: string;
  type: 'promotion' | 'event' | 'seasonal' | 'announcement' | 'custom';
  targetSegment: string;
  offer: string;
  message: string;
  startDate: Date;
  status: 'draft' | 'scheduled';
}

export interface SeedKpi {
  estimatedMonthlyRevenueCents: number;
  avgCheckCents: number;
  reviewVolume: number;
  expectedRecoveryCents: number;
}

/** ZAR-friendly fallback review texts when Google returns none. */
const FALLBACK_REVIEW_TEXTS: Record<number, string> = {
  5: 'Outstanding food and service. The staff remembered our names and the recommendations were spot on. Will be back!',
  4: 'Really good spot. Great menu, lively atmosphere and quick service on a busy night.',
  3: 'Decent food but the service was slow and the table wasn\u2019t ready on time.',
  2: 'Disappointing. Long wait and the order came out wrong.',
  1: 'Poor experience. Won\u2019t be returning.',
};

const FALLBACK_NAMES = [
  'Thandi Mokoena',
  'Sipho Ndlovu',
  'Annelie Botha',
  'Lerato Kgosi',
  'Pieter van der Merwe',
  'Priya Naidoo',
  'Johan Fourie',
  'Naledi Dlamini',
  'Chloe Jacobs',
  'Mandla Khumalo',
  'Emma Swanepoel',
  'Thabo Mabaso',
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

function jitter(minDays: number, maxDays: number, now: Date, opts: { future?: boolean } = {}): Date {
  const days = randInt(minDays, maxDays);
  const dir = opts.future ? 1 : -1;
  return new Date(now.getTime() + dir * days * 24 * 60 * 60 * 1000);
}

/** Build 5–10 sample bookings using real reviewer names and future dates. */
export function generateSeedBookings(places: GooglePlacesData, count = 8, now = new Date()): SeedBooking[] {
  const names = [...new Set(places.reviews.map((r) => r.authorName).filter(Boolean))];
  while (names.length < count) names.push(pick(FALLBACK_NAMES));

  const slots = ['12:30', '13:00', '18:00', '18:30', '19:00', '19:30', '20:00'];
  return names.slice(0, count).map((name, i) => {
    const date = jitter(1, 14, now, { future: true });
    date.setHours(Number(slots[i % slots.length].split(':')[0]), Number(slots[i % slots.length].split(':')[1]), 0, 0);
    return {
      customerName: name,
      customerPhone: `+27${randInt(71, 84)}${randInt(1000000, 9999999)}`,
      date,
      partySize: randInt(1, 8),
      status: i % 3 === 0 ? 'completed' : 'confirmed',
      notes: i % 4 === 0 ? 'Anniversary — bring a dessert plate' : null,
    };
  });
}

/** Build 3–5 reviews from the Google Places snapshot (real authors), seeded with time. */
export function generateSeedReviews(places: GooglePlacesData, count = 4, now = new Date()): SeedReview[] {
  if (places.reviews.length > 0) {
    return places.reviews.slice(0, count).map((r) => {
      const rating = r.rating >= 1 && r.rating <= 5 ? r.rating : randInt(3, 5);
      const text = r.text ?? FALLBACK_REVIEW_TEXTS[rating];
      return {
        authorName: r.authorName,
        rating,
        text,
        time: jitter(2, 120, now),
        sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
      };
    });
  }

  return FALLBACK_NAMES.slice(0, count).map((authorName) => {
    const rating = randInt(3, 5);
    return {
      authorName,
      rating,
      text: FALLBACK_REVIEW_TEXTS[rating],
      time: jitter(2, 120, now),
      sentiment: rating >= 4 ? 'positive' : rating <= 2 ? 'negative' : 'neutral',
    };
  });
}

/**
 * Generate 2–3 marketing campaigns driven by slow-day detection + the menu. If
 * the profile has priced dishes we craft a focused offer; otherwise we use a
 * generic but realistic promotion.
 */
export function generateSeedCampaigns(profile: BrandProfile, count = 3, now = new Date()): SeedCampaign[] {
  const menu = Array.isArray(profile.menuJson) ? (profile.menuJson as { name: string; price: string | null }[]) : [];
  const hero = menu.find((m) => m.price) ?? menu[0];

  const brand = profile.brandName || 'your next favourite restaurant';
  const slowDayCampaign: SeedCampaign = {
    name: 'Midweek Fill-Up',
    description: 'Slow-day recovery offer to lift Tuesday/Wednesday covers.',
    type: 'promotion',
    targetSegment: 'regulars',
    offer: hero && hero.price ? `${hero.name} at ${hero.price}` : '2-for-1 on mains',
    message: `${brand} here! ${hero ? `Our ${hero.name} is a midweek highlight` : 'Your next dinner is on us-ish'} — book a table this Tuesday or Wednesday and we\u2019ll sweeten the deal. Reply BOOK to reserve.`,
    startDate: jitter(1, 3, now, { future: true }),
    status: 'scheduled',
  };

  const weekendCampaign: SeedCampaign = {
    name: 'Weekend Feast',
    description: 'Capitalise on weekend demand with a signature-dish push.',
    type: 'event',
    targetSegment: 'all',
    offer: 'Complimentary bread & butter',
    message: `This weekend ${profile.brandName || 'we'} are pouring it on — book a table and get our famous bread & butter on the house.`,
    startDate: jitter(4, 7, now, { future: true }),
    status: 'scheduled',
  };

  const reactivationCampaign: SeedCampaign = {
    name: 'Come Back, We Miss You',
    description: 'Dormant-customer reactivation offer.',
    type: 'seasonal',
    targetSegment: 'dormant',
    offer: '10% off your next visit',
    message: `${brand} here — it\u2019s been a while! Here\u2019s 10% off your next meal, and we\u2019ve saved your favourite table.`,
    startDate: jitter(2, 5, now, { future: true }),
    status: 'scheduled',
  };

  return [slowDayCampaign, weekendCampaign, reactivationCampaign].slice(0, count);
}

/**
 * Sample KPI: estimated monthly revenue = avg check × review volume × 0.1
 * (the PRD formula, generous enough to look impressive in a demo but honest
 * in magnitude: a venue with 300 reviews and an R250 average check lands
 * around R7 500/month).
 */
export function estimateKpi(places: GooglePlacesData, profile: BrandProfile, avgCheckCents = 25000): SeedKpi {
  const avgCheck = avgCheckCents;
  const reviewVolume = places.reviewCount ?? 0;
  const base = Math.round((avgCheck * reviewVolume * 0.1) / 100) * 100;
  return {
    estimatedMonthlyRevenueCents: base,
    avgCheckCents: avgCheck,
    reviewVolume,
    expectedRecoveryCents: Math.round(base * 0.15),
  };
}
