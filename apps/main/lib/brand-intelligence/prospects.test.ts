import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProspectsCsv,
  canRetry,
  nextProspectStatus,
  PROSPECT_STATUSES,
} from './prospects.ts';

describe('prospects — CSV import', () => {
  test('parses a header-driven CSV into prospect rows', () => {
    const csv = [
      'name,website,owner email,owner phone,city',
      'Marble Johannesburg,marble.restaurant,chef@marble.co.za,+27115551111,Rosebank',
      'The Test Kitchen,thetestkitchen.com,info@ttk.co.za,,Cape Town',
    ].join('\n');
    const { rows, errors } = parseProspectsCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'Marble Johannesburg');
    assert.equal(rows[0].website, 'https://marble.restaurant');
    assert.equal(rows[0].ownerEmail, 'chef@marble.co.za');
    assert.equal(rows[0].ownerPhone, '+27115551111');
    assert.equal(rows[0].city, 'Rosebank');
  });

  test('normalises a missing scheme to https://', () => {
    const { rows } = parseProspectsCsv('name,website\nFoo,example.com');
    assert.equal(rows[0].website, 'https://example.com');
  });

  test('reports rows missing a name or website as errors', () => {
    const { rows, errors } = parseProspectsCsv('name,website\n,no-url.com\nMissing Website,\nGood,ok.co.za');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Good');
    assert.ok(errors.length >= 2);
  });

  test('handles quoted fields containing commas', () => {
    const { rows } = parseProspectsCsv('name,website,city\n"Le Petit, Bistro",lepetit.com,"Cape Town"');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Le Petit, Bistro');
    assert.equal(rows[0].city, 'Cape Town');
  });

  test('falls back to positional columns when there is no header', () => {
    const { rows } = parseProspectsCsv('My Place,myplace.co.za,owner@x.com,+27770000000,Durban');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'My Place');
    assert.equal(rows[0].website, 'https://myplace.co.za');
    assert.equal(rows[0].ownerPhone, '+27770000000');
  });

  test('recognises the documented status set', () => {
    assert.deepEqual(PROSPECT_STATUSES, ['queued', 'enriching', 'ready', 'failed', 'claimed']);
  });
});

describe('prospects — retry & status transitions', () => {
  test('a failed prospect can retry up to 3 times', () => {
    assert.equal(canRetry('failed', 0), true);
    assert.equal(canRetry('failed', 2), true);
    assert.equal(canRetry('failed', 3), false);
  });

  test('ready and claimed prospects are never re-queued', () => {
    assert.equal(canRetry('ready', 0), false);
    assert.equal(canRetry('claimed', 0), false);
  });

  test('a successful build flips to ready; a failure to failed', () => {
    assert.equal(nextProspectStatus(true), 'ready');
    assert.equal(nextProspectStatus(false), 'failed');
  });
});
