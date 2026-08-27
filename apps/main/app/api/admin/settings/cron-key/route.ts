import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { cronKeyConfigured, saveCronJobApiKey } from '@/lib/cron/key-store-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cron Fleet Manager — API key storage (UI-driven, no Vercel env needed).
 *
 * GET  -> { configured, source } (never reveals the key itself)
 * POST -> { key } encrypts at rest (AES-256-GCM) into system_settings.
 *
 * Both super-admin gated, same guard as the rest of /admin.
 */

export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }
  const state = await cronKeyConfigured();
  return NextResponse.json({ success: true, configured: state.configured, source: state.source });
}

export async function POST(req: NextRequest) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  let key: unknown = null;
  try {
    const body = await req.json();
    key = body?.key ?? null;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof key !== 'string' || key.trim().length < 8 || key.trim().length > 512) {
    return NextResponse.json({ success: false, error: 'Provide a valid cron-job.org API key' }, { status: 400 });
  }
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { success: false, error: 'CRON_SECRET is not configured — encryption is unavailable' },
      { status: 500 }
    );
  }

  try {
    await saveCronJobApiKey(key);
    return NextResponse.json({ success: true, message: 'API key saved (encrypted) to the database' });
  } catch (err: any) {
    console.error('[cron-key] failed to save key', err?.message);
    return NextResponse.json({ success: false, error: 'Failed to save the key' }, { status: 500 });
  }
}
