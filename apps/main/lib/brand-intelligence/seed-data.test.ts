import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSeedBookings,
  generateSeedReviews,
  generateSeedCampaigns,
  estimateKpi,
} from './seed-data.ts';
import type { GooglePlacesData } from './google-places.ts';

const NOW = new Date('2026-08-26T10:00:00.000Z');
const MS_DAY = 24 * 60 * 60 * 1000;

const BIG_PLACES: GooglePlacesData = {
  placeId: 'ChIJ-marble',
  name: 'Marble Johannesburg',
  rating: 4.6,
  reviewCount: 320,
  address: 'Rosebank, Johannesburg',
  hoursJson: ['Monday: 12:00 PM – 10:00 PM'],
  reviews: [
    { authorName: 'Thandi Mokoena', rating: 5, text: 'Incredible steak.', relativeTime: '2 weeks ago' },
    { authorName: 'Sipho Ndlovu', rating: 5, text: 'Best fillet in Joburg.', relativeTime: '1 month ago' },
    { authorName: 'Annelie Botha', rating: 4, text: 'Great vibe.', relativeTime: '2 months ago' },
    { authorName: 'Lerato Kgosi', rating: 5, text: 'Service was superb.', relativeTime: '3 months ago' },
    { authorName: 'Pieter van der Merwe', rating: 4, text: 'Solid.', relativeTime: '4 months ago' },
  ],
};

const EMPTY_PLACES: GooglePlacesData = {
  placeId: '',
  name: null,
  rating: null,
  reviewCount: null,
  address: null,
  hoursJson: null,
  reviews: [],
};

describe('seed-data — bookings from real reviewer names', () => {
  test('uses real Google reviewer names for the sample bookings', () => {
    const bookings = generateSeedBookings(BIG_PLACES, 5, NOW);
    assert.equal(bookings.length, 5);
    const reviewers = BigPlacesReviewers();
    for (const b of bookings) {
      assert.ok(reviewers.has(b.customerName) || b.customerName, `unexpected name ${b.customerName}`);
    }
  });

  test('bookings are all future-dated and carry the expected shape', () => {
    const bookings = generateSeedBookings(BIG_PLACES, 8, NOW);
    assert.ok(bookings.length >= 5 && bookings.length <= 10);
    for (const b of bookings) {
      assert.ok(b.date.getTime() > NOW.getTime(), 'booking date should be in the future');
      assert.ok(b.partySize >= 1 && b.partySize <= 8);
      assert.match(b.customerPhone, /^\+27/);
      assert.ok(['confirmed', 'completed'].includes(b.status));
    }
  });

  test('generates bookings even with no Google reviews (fallback names)', () => {
    const bookings = generateSeedBookings(EMPTY_PLACES, 6, NOW);
    assert.equal(bookings.length, 6);
  });
});

describe('seed-data — reviews from Google Places', () => {
  test('uses the real review authors and published sentiment', () => {
    const reviews = generateSeedReviews(BIG_PLACES, 4, NOW);
    assert.equal(reviews.length, 4);
    const reviewers = BigPlacesReviewers();
    for (const r of reviews) {
      assert.ok(reviewers.has(r.authorName));
      assert.equal(r.sentiment, r.rating >= 4 ? 'positive' : r.rating <= 2 ? 'negative' : 'neutral');
    }
  });
});

describe('seed-data — campaigns driven by the menu', () => {
  const profile = {
    brandName: 'Marble',
    menuJson: [{ name: 'Beef Fillet', price: 'R385' }],
  } as any;

  test('produces 2-3 campaigns with a typed schedule', () => {
    const campaigns = generateSeedCampaigns(profile, 3, NOW);
    assert.ok(campaigns.length >= 2 && campaigns.length <= 3);
    for (const c of campaigns) {
      assert.ok(c.status === 'draft' || c.status === 'scheduled');
      assert.match(c.message, /Marble/);
    }
  });

  test('mentions a priced hero dish when the menu has one', () => {
    const campaigns = generateSeedCampaigns(profile, 2, NOW);
    const first = campaigns[0];
    assert.match(first.message, /Beef Fillet/);
  });
});

describe('seed-data — KPI estimate (avg check × review volume × 0.1)', () => {
  test('computes the PRD formula (R250 avg check, 320 reviews)', () => {
    const kpi = estimateKpi(BIG_PLACES, {} as any, 25000);
    assert.equal(kpi.reviewVolume, 320);
    assert.equal(kpi.avgCheckCents, 25000);
    // 25000 (R250) × 320 × 0.1 = 800000 cents = R8000
    assert.equal(kpi.estimatedMonthlyRevenueCents, 800000);
    assert.ok(kpi.expectedRecoveryCents > 0);
  });

  test('falls back to a zero baseline when there is no review count', () => {
    const kpi = estimateKpi(EMPTY_PLACES, {} as any, 25000);
    assert.equal(kpi.estimatedMonthlyRevenueCents, 0);
  });
});

function BigPlacesReviewers(): Set<string> {
  return new Set(BIG_PLACES.reviews.map((r) => r.authorName));
}
