import type { GoogleReview } from './google-places-client';

function mentionedDetail(text: string | null) {
  if (!text) return null;
  const match = text.match(/\b(?:the )?(?:[A-Za-z][A-Za-z'-]* ){0,2}(?:steak|burger|pizza|pasta|service|staff|ambiance|atmosphere)\b/i);
  return match?.[0]?.trim() || null;
}

export function generateResponse(review: Pick<GoogleReview, 'authorName' | 'rating' | 'text' | 'sentiment'>, contact = 'our team') {
  const detail = mentionedDetail(review.text);
  if (review.sentiment === 'positive') {
    return `Thank you so much, ${review.authorName}! We're thrilled you enjoyed${detail ? ` ${detail}` : ' your experience'}. We look forward to welcoming you back soon!`;
  }
  if (review.sentiment === 'negative') {
    return `We're sorry to hear about your experience, ${review.authorName}. This isn't the standard we strive for. Please reach out to ${contact} directly so we can make it right.`;
  }
  return `Thank you for your feedback, ${review.authorName}. We appreciate you taking the time to share your experience. We're always looking to improve.`;
}
