import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { consentRecords } from '@/lib/db/schema';
import { CONSENT_VERSION } from '@/lib/billing/consent-version';

export const dynamic = 'force-dynamic';

/**
 * POST /api/consent — record a POPIA consent record for the tenant.
 * Called at onboarding completion. Idempotent: stores one record per call;
 * the full audit trail is queryable from consent_records.
 */
export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    /* allow empty body */
  }

  const version = typeof body.version === 'string' ? body.version : CONSENT_VERSION;

  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
    const userAgent = req.headers.get('user-agent') || null;

    const [record] = await db
      .insert(consentRecords)
      .values({
        tenantId: tenant.id,
        consentVersion: version,
        ipAddress: ip,
        userAgent,
      })
      .returning();

    return NextResponse.json({ ok: true, id: record.id, version: record.consentVersion });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to record consent' }, { status: 500 });
  }
}
