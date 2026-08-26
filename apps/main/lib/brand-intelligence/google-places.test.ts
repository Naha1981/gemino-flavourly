import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSearchResponse,
  parseDetailsResponse,
  mergePlaceData,
  classifyPlaceRating,
} from './google-places.ts';

const SEARCH_FIXTURE = {
  places: [
    {
      id: 'ChIJ-aabbcc',
      displayName: { text: 'Marble Johannesburg' },
      formattedAddress: '56 Central St, Rosebank, Johannesburg',
      rating: 4.6,
      userRatingCount: 320,
      websiteUri: 'https://marble.restaurant',
      regularOpeningHours: { weekdayDescriptions: ['Monday: 12:00 PM – 10:00 PM'] },
      photos: [{ name: 'places/ChIJ-aabbcc/photos/1' }],
      reviews: [
        { authorAttribution: { displayName: 'Thandi Mokoena' }, rating: 5, text: { text: 'Incredible.' }, relativePublishTimeDescription: '1 week ago' },
      ],
    },
  ],
};

const DETAILS_FIXTURE = {
  id: 'ChIJ-aabbcc',
  displayName: { text: 'Marble Johannesburg' },
  formattedAddress: '56 Central St, Rosebank, Johannesburg',
  rating: 4.9,
  userRatingCount: 410,
  regularOpeningHours: { weekdayDescriptions: ['Monday: 12:00 – 22:00'] },
  reviews: [
    { authorAttribution: { displayName: 'Sipho Ndlovu' }, rating: 5, text: { text: 'Best fillet.' }, relativePublishTimeDescription: '2 weeks ago' },
    { authorAttribution: { displayName: 'Annelie Botha' }, rating: 4, text: { text: 'Great vibe.' }, relativePublishTimeDescription: '1 month ago' },
  ],
};

describe('google-places — parsing', () => {
  test('parseSearchResponse extracts the first place and its review snapshot', () => {
    const r = parseSearchResponse(SEARCH_FIXTURE)!;
    assert.equal(r.placeId, 'ChIJ-aabbcc');
    assert.equal(r.displayName, 'Marble Johannesburg');
    assert.equal(r.rating, 4.6);
    assert.equal(r.reviewCount, 320);
    assert.equal(r.reviews.length, 1);
    assert.equal(r.reviews[0].authorName, 'Thandi Mokoena');
  });

  test('parseSearchResponse returns null for an empty result', () => {
    assert.equal(parseSearchResponse({ places: [] }), null);
    assert.equal(parseSearchResponse({}), null);
  });

  test('parseDetailsResponse extracts hours and a fuller review list', () => {
    const d = parseDetailsResponse(DETAILS_FIXTURE)!;
    assert.equal(d.placeId, 'ChIJ-aabbcc');
    assert.equal(d.rating, 4.9);
    assert.deepEqual(d.hoursJson, ['Monday: 12:00 – 22:00']);
    assert.equal(d.reviews.length, 2);
  });

  test('mergePlaceData prefers detail fields but falls back to the summary', () => {
    const summary = parseSearchResponse(SEARCH_FIXTURE)!;
    // A detail lacking reviews/rating should not clobber the summary's rating.
    const merged = mergePlaceData(summary, { id: 'ChIJ-aabbcc', displayName: { text: 'Marble Johannesburg' } });
    assert.equal(merged.rating, 4.6); // from summary
    assert.equal(merged.reviewCount, 320); // from summary
    assert.equal(merged.reviews.length, 1); // from summary
  });

  test('classifies ratings into sentiment buckets', () => {
    assert.equal(classifyPlaceRating(5), 'positive');
    assert.equal(classifyPlaceRating(4), 'positive');
    assert.equal(classifyPlaceRating(3), 'neutral');
    assert.equal(classifyPlaceRating(2), 'negative');
    assert.equal(classifyPlaceRating(1), 'negative');
  });
});
