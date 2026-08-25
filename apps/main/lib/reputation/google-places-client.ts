export type GoogleReview = {
  googlePlaceId: string;
  reviewId: string;
  authorName: string;
  rating: number;
  text: string | null;
  time: Date;
  sentiment: 'positive' | 'neutral' | 'negative';
};

function classifySentiment(rating: number): GoogleReview['sentiment'] {
  if (rating >= 4) return 'positive';
  if (rating <= 2) return 'negative';
  return 'neutral';
}

export async function fetchReviews(placeId: string, apiKey: string, fetcher: typeof fetch = fetch): Promise<GoogleReview[]> {
  if (!placeId || !apiKey) throw new Error('Google Place ID and API key are required');

  const url = new URL('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId));
  const response = await fetcher(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'id,reviews',
    },
  });
  if (!response.ok) throw new Error(`Google Places request failed (${response.status})`);

  const payload = (await response.json()) as {
    id?: string;
    reviews?: Array<{
      name?: string;
      authorAttribution?: { displayName?: string };
      rating?: number;
      text?: { text?: string };
      originalText?: { text?: string };
      publishTime?: string;
    }>;
  };

  return (payload.reviews || []).flatMap((review) => {
    if (!review.name || !review.authorAttribution?.displayName || !review.rating || !review.publishTime) return [];
    const rating = Math.max(1, Math.min(5, Math.round(review.rating)));
    return [{
      googlePlaceId: placeId,
      reviewId: review.name,
      authorName: review.authorAttribution.displayName,
      rating,
      text: review.originalText?.text || review.text?.text || null,
      time: new Date(review.publishTime),
      sentiment: classifySentiment(rating),
    }];
  });
}

export function classifyReviewSentiment(rating: number): GoogleReview['sentiment'] {
  return classifySentiment(rating);
}

export async function fetchPlaceSummary(placeId: string, apiKey: string, fetcher: typeof fetch = fetch) {
  const url = new URL('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId));
  const response = await fetcher(url, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'rating,userRatingCount' },
  });
  if (!response.ok) throw new Error(`Google Places request failed (${response.status})`);
  const payload = await response.json() as { rating?: number; userRatingCount?: number };
  return { rating: payload.rating || 0, reviewCount: payload.userRatingCount || 0 };
}
