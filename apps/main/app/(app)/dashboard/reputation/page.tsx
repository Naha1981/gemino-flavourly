import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Star, TrendingUp } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  countByRating,
  countReviews,
  getAverageRating,
  getReviews,
  sentimentBreakdown,
} from '@/lib/reputation/review-store';
import type { ReviewSentiment } from '@/lib/reputation/google-places-client';
import { ReviewCard } from './review-card';

export const dynamic = 'force-dynamic';

type ReputationPageProps = {
  searchParams?: { rating?: string | string[]; sentiment?: string | string[] };
};

const SENTIMENT_FILTERS: Array<{ value: '' | ReviewSentiment; label: string }> = [
  { value: '', label: 'All sentiments' },
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

const SENTIMENT_BADGES: Record<string, { label: string; classes: string }> = {
  positive: { label: 'Positive', classes: 'border-emerald-800/70 bg-emerald-950/60 text-emerald-300' },
  neutral: { label: 'Neutral', classes: 'border-blue-800/70 bg-blue-950/60 text-blue-300' },
  negative: { label: 'Negative', classes: 'border-red-800/70 bg-red-950/60 text-red-300' },
};

function stars(rating: number): string {
  return '★'.repeat(Math.max(0, Math.min(5, rating))) + '☆'.repeat(Math.max(0, 5 - rating));
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

export default async function ReputationPage({ searchParams }: ReputationPageProps) {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const rawRating = Array.isArray(searchParams?.rating) ? searchParams.rating[0] : searchParams?.rating;
  const rawSentiment = Array.isArray(searchParams?.sentiment) ? searchParams.sentiment[0] : searchParams?.sentiment;
  const rating = Number.isInteger(Number(rawRating)) && Number(rawRating) >= 1 && Number(rawRating) <= 5
    ? Number(rawRating)
    : undefined;
  const sentiment =
    rawSentiment === 'positive' || rawSentiment === 'neutral' || rawSentiment === 'negative'
      ? (rawSentiment as ReviewSentiment)
      : undefined;

  const [reviews, total, average, byRating, bySentiment] = await Promise.all([
    getReviews(tenant.id, 50, 0, { rating, sentiment }),
    countReviews(tenant.id, { rating, sentiment }),
    getAverageRating(tenant.id),
    countByRating(tenant.id),
    sentimentBreakdown(tenant.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-app-border pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-app-fg">
            <Star className="h-5 w-5 text-emerald-400" />
            Reputation
          </h1>
          <p className="text-xs text-app-muted">
            Google reviews, AI-drafted responses (you approve before anything is posted) and{' '}
            <Link href="/dashboard/reputation/competitors" className="text-emerald-400 hover:text-emerald-300">
              competitor ratings
            </Link>
            .
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href="/dashboard/reputation/review-requests"
            className="rounded-md border border-app-border bg-app-surface-0 px-3 py-2 text-app-muted hover:bg-app-surface-1"
          >
            Review requests
          </Link>
          <Link
            href="/dashboard/reputation/competitors"
            className="rounded-md border border-app-border bg-app-surface-0 px-3 py-2 text-app-muted hover:bg-app-surface-1"
          >
            Competitors
          </Link>
        </div>
      </div>

      {/* Metrics header: "Total: 127 | Avg: 4.3★ | Positive: 89 | Negative: 12" */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-app-faint">Total reviews</p>
          <p className="mt-1 text-2xl font-semibold text-app-fg">{total}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-app-faint">Average</p>
          <p className="mt-1 text-2xl font-semibold text-amber-300">
            {average > 0 ? `${Math.round(average * 10) / 10}★` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-app-faint">Positive</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">{bySentiment.positive}</p>
        </div>
        <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
          <p className="text-[11px] uppercase tracking-wide text-app-faint">Negative</p>
          <p className="mt-1 text-2xl font-semibold text-red-300">{bySentiment.negative}</p>
        </div>
      </div>

      {/* Rating distribution */}
      <div className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium text-app-muted">
          <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> Rating distribution
        </p>
        <div className="space-y-1.5">
          {[5, 4, 3, 2, 1].map((star) => {
            const count = byRating[star as keyof typeof byRating];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={star} className="flex items-center gap-3 text-xs text-app-muted">
                <span className="w-8 text-right text-amber-300">{star}★</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-app-surface-1">
                  <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right">{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="rating-filter" className="mb-1 block text-[11px] uppercase tracking-wide text-app-faint">
            Rating
          </label>
          <select
            id="rating-filter"
            name="rating"
            defaultValue={rating ? String(rating) : ''}
            className="rounded-md border border-app-border-strong bg-app-surface-0 px-3 py-2 text-xs text-app-fg outline-none focus:border-emerald-600"
          >
            <option value="">All ratings</option>
            {[5, 4, 3, 2, 1].map((star) => (
              <option key={star} value={star}>
                {star} stars
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sentiment-filter" className="mb-1 block text-[11px] uppercase tracking-wide text-app-faint">
            Sentiment
          </label>
          <select
            id="sentiment-filter"
            name="sentiment"
            defaultValue={sentiment ?? ''}
            className="rounded-md border border-app-border-strong bg-app-surface-0 px-3 py-2 text-xs text-app-fg outline-none focus:border-emerald-600"
          >
            {SENTIMENT_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
        >
          Apply filters
        </button>
      </form>

      {/* Review list */}
      <div className="space-y-3">
        {reviews.length === 0 ? (
          <div className="rounded-lg border border-dashed border-app-border bg-app-surface-0/30 p-8 text-center text-sm text-app-muted">
            No reviews match this filter yet. Configure your Google Place ID in{' '}
            <Link href="/dashboard/settings" className="text-emerald-400 hover:text-emerald-300">
              Settings
            </Link>{' '}
            and the daily 6am pull will populate this page.
          </div>
        ) : (
          reviews.map((review) => (
            <div key={review.id} className="rounded-lg border border-app-border bg-app-surface-0/50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-app-fg">{review.authorName}</span>
                <span className="text-sm text-amber-300">{stars(review.rating)}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    SENTIMENT_BADGES[review.sentiment]?.classes ?? SENTIMENT_BADGES.neutral.classes
                  }`}
                >
                  {SENTIMENT_BADGES[review.sentiment]?.label ?? review.sentiment}
                </span>
                {review.responseSentAt && (
                  <span className="rounded-full border border-app-border-strong bg-app-surface-1 px-2 py-0.5 text-[10px] text-app-muted">
                    Sent {formatDate(review.responseSentAt)}
                  </span>
                )}
                <span className="ml-auto text-xs text-app-faint">{formatDate(review.time)}</span>
              </div>
              {review.text && <p className="mt-2 text-sm leading-relaxed text-app-muted">{review.text}</p>}
              <ReviewCard
                reviewId={review.reviewId}
                initialDraft={review.responseText ?? ''}
                sentAt={review.responseSentAt ? review.responseSentAt.toISOString() : null}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
