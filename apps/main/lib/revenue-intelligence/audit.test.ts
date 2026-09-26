import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRestaurantAudit, isSafePublicAuditUrl } from './audit';
import type { BrandProfile } from '@/lib/brand-intelligence/scraper';

const profile: BrandProfile = {
  logoUrl: null, primaryColor: '#1F6F5C', secondaryColor: '#C9A25A', backgroundColor: '#0B1210', fontFamily: null,
  brandName: 'Test Kitchen', tagline: 'Modern South African food',
  menuJson: [
    { name: 'Burger', price: 'R120', description: null },
    { name: 'Pizza', price: 'R145', description: 'Tomato, mozzarella, basil' },
    { name: 'Salad', price: null, description: null },
  ],
  hoursJson: [], confidence: 0.5,
};

test('restaurant audit is evidence-first and produces menu findings', () => {
  const result = buildRestaurantAudit(profile, { rating: 3.7, reviewCount: 42, competitorCount: 4, competitorAverageRating: 4.2 });
  assert.ok(result.findings.length >= 3);
  assert.equal(result.profile.menuItems, 3);
  assert.equal(result.profile.pricedItems, 2);
  assert.equal(result.readinessLabel, 'Significant leakage candidates');
});

test('public audit URL guard rejects localhost/private targets', () => {
  assert.equal(isSafePublicAuditUrl('http://localhost:3000'), false);
  assert.equal(isSafePublicAuditUrl('http://127.0.0.1:3000'), false);
  assert.equal(isSafePublicAuditUrl('http://192.168.1.20'), false);
  assert.equal(isSafePublicAuditUrl('https://restaurant.co.za'), true);
  assert.equal(isSafePublicAuditUrl('ftp://restaurant.co.za'), false);
});
