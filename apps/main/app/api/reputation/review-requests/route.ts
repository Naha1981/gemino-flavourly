import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { listRecentRequests, reviewRequestStats } from '@/lib/reputation/review-request-store';

export const dynamic = 'force-dynamic';

/**
 * Gate #13 — review requests sent in the last 30 days for the dashboard.
 * The customer phone is masked (last 4 digits) in this list view: staff
 * need to see WHO was asked, not harvest numbers.
 */
function maskPhone(phone: string | null): string | null {
  if (!phone || phone.length < 4) return phone;
  return '•••• ••' + phone.slice(-4);
}

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [requests, stats] = await Promise.all([
    listRecentRequests(tenant.id, 30),
    reviewRequestStats(tenant.id),
  ]);

  return NextResponse.json({
    requests: requests.map((row) => ({
      id: row.id,
      customer_name: row.customerName,
      customer_phone_masked: maskPhone(row.customerPhone),
      date: row.date,
      sent_at: row.sentAt,
    })),
    stats: {
      sent_last_30_days: stats.sentLast30Days,
      sent_total: stats.sentTotal,
    },
  });
}
