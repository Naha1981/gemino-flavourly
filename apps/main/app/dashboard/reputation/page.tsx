import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { competitors, googleReviews } from '@/lib/db/schema';
import { getOrCreateTenant } from '@/lib/tenant';
import { countByRating, getAverageRating } from '@/lib/reputation/review-store';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ReputationPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');
  const [reviews, average, ratings, trackedCompetitors] = await Promise.all([
    db.select().from(googleReviews).where(eq(googleReviews.tenantId, tenant.id)).orderBy(desc(googleReviews.time)).limit(50),
    getAverageRating(tenant.id),
    countByRating(tenant.id),
    db.select().from(competitors).where(eq(competitors.tenantId, tenant.id)),
  ]);

  return <div className="mx-auto max-w-6xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
      <div><p className="text-xs uppercase tracking-widest text-emerald-400">Reputation</p><h1 className="mt-2 text-2xl font-semibold">Google review monitor</h1></div>
      <Link href="/dashboard/reputation/review-requests" className="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-800">Review requests</Link>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      <Metric label="Total reviews" value={reviews.length} />
      <Metric label="Average rating" value={`${average.toFixed(1)} / 5`} />
      <Metric label="Competitors monitored" value={trackedCompetitors.length} />
    </div>
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-5">
      <h2 className="mb-4 text-sm font-semibold">Rating distribution</h2>
      <div className="flex gap-3 text-xs text-zinc-400">{[5, 4, 3, 2, 1].map((rating) => <span key={rating}>{rating} stars: <b className="text-zinc-100">{ratings[rating]}</b></span>)}</div>
    </section>
    <section className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/70">
      <div className="border-b border-zinc-800 p-5"><h2 className="text-sm font-semibold">Recent reviews</h2></div>
      {reviews.length === 0 ? <p className="p-8 text-center text-sm text-zinc-500">No reviews have been fetched yet.</p> : <div className="divide-y divide-zinc-800">{reviews.map((review) => <article key={review.id} className="p-5"><div className="flex justify-between gap-4"><div><h3 className="text-sm font-medium">{review.authorName}</h3><p className="text-xs text-amber-400">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</p></div><span className="text-xs text-zinc-500">{review.time.toLocaleDateString()}</span></div><p className="mt-3 text-sm text-zinc-300">{review.text || 'No written comment.'}</p>{review.responseText && <p className="mt-3 border-l-2 border-emerald-500 pl-3 text-xs text-zinc-400">Draft: {review.responseText}</p>}</article>)}</div>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-5"><p className="text-xs text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
}