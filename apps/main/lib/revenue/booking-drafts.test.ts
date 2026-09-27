import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBookingSlots, draftMissingFields } from './booking-drafts.ts';

describe('booking draft parsing',()=>{
 test('extracts common booking slots',()=>{
  const slots=extractBookingSlots('Saturday at 19:00 for 4');
  assert.equal(slots.dateText,'saturday'); assert.equal(slots.timeText,'7:00 PM'); assert.equal(slots.partySize,4);
 });
 test('reports missing fields',()=>{assert.deepEqual(draftMissingFields({dateText:null,timeText:'7:00 PM',partySize:null}),['date','number of guests'])});
});
