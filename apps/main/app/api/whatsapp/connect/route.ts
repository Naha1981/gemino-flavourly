import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Strip credentials (never present on OPERATOR_URL, but cheap) and show
 *  the host so a misconfigured OPERATOR_URL diagnoses ITSELF in the error. */
function operatorHost(): string {
  try {
    return new URL(process.env.OPERATOR_URL ?? '').host;
  } catch {
    return '(invalid OPERATOR_URL)';
  }
}

export async function POST() {
  let tenant;
  try {
    tenant = await getOrCreateTenant();
  } catch (err) {
    return NextResponse.json(
      { error: `Could not resolve your account: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // Auto-provisions the row for tenants created before the row-per-tenant
  // invariant existed — /connect used to 404 for them, so linking could
  // never even start (2026-08-31 gate finding).
  let account;
  try {
    account = await ensureWaAccount(tenant.id);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the WhatsApp account row: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  if (!account) {
    return NextResponse.json({ error: 'Could not provision WhatsApp account row.' }, { status: 500 });
  }

  // Round 2 (2026-08-31): OPERATOR_URL unset used to become
  // fetch("undefined/start") → TypeError → opaque route 500. Fail LOUD
  // with the exact variable name instead.
  const operatorUrl = process.env.OPERATOR_URL;
  if (!operatorUrl || !operatorUrl.trim()) {
    return NextResponse.json(
      { error: 'OPERATOR_URL is not configured on the main app (Vercel environment variables).' },
      { status: 500 }
    );
  }

  let resp: Response;
  try {
    resp = await fetch(`${operatorUrl.replace(/\/+$/, '')}/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.OPERATOR_API_KEY!,
      },
      body: JSON.stringify({ waAccountId: account.id, tenantId: tenant.id }),
      cache: 'no-store',
      // Bounded: a Render cold start (free tier spins down after ~15 min
      // idle) can take ~50s. Without this the Vercel route dies at
      // maxDuration with a platform-level error instead of a readable one.
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          `WhatsApp engine unreachable (host: ${operatorHost()}) — ` +
          `${(err as Error).message}. If this persists, check OPERATOR_URL points at the Render service.`,
      },
      { status: 502 }
    );
  }

  const data = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    // Pass the operator's OWN error through (e.g. "Unauthorized: invalid
    // x-api-key header" when Vercel's OPERATOR_API_KEY doesn't match the
    // operator's). Round 1 flattened every failure to a generic
    // "WhatsApp engine unreachable." — the single most useful string in
    // the whole chain was thrown away here.
    return NextResponse.json(
      {
        error:
          (typeof data?.error === 'string' && data.error) ||
          `Engine responded ${resp.status} (host: ${operatorHost()}).`,
        engineStatus: resp.status,
      },
      { status: 502 }
    );
  }

  // Round 2: the operator's /start waits (up to ~3s) for the first QR to
  // land in the DB before responding — its snapshot lets the page render
  // the code immediately instead of waiting for the next 3s status poll.
  return NextResponse.json({
    ok: true,
    isConnected: data?.isConnected === true,
    qrCode: typeof data?.qrCode === 'string' ? data.qrCode : null,
    phoneNumber: typeof data?.phoneNumber === 'string' ? data.phoneNumber : null,
  });
}
