import { NextResponse } from 'next/server';
import { scrapeUrl } from '@/lib/brand-intelligence/scraper';
import { buildRestaurantAudit, isSafePublicAuditUrl } from '@/lib/revenue-intelligence/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const url = typeof body?.url === 'string' ? body.url.trim() : '';

    if (!url || url.length > 500 || !isSafePublicAuditUrl(url)) {
      return NextResponse.json({ error: 'Enter a public restaurant website using http or https.' }, { status: 400 });
    }

    const result = await scrapeUrl(url);
    if (!result.fetched) {
      return NextResponse.json(
        { error: 'We could not read that website. Try the restaurant homepage or menu page directly.', detail: result.error ?? null },
        { status: 422 },
      );
    }

    const audit = buildRestaurantAudit(result);
    return NextResponse.json({ sourceUrl: url, auditedAt: new Date().toISOString(), audit });
  } catch (error) {
    console.error('[public/restaurant-audit]', error);
    return NextResponse.json({ error: 'The audit could not be completed.' }, { status: 500 });
  }
}
