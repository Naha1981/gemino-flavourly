import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { systemSettings } from '@/lib/db/schema';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { seedDemoData } from '@/lib/demo/seed-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * QA-2 / owner spec — POST /api/admin/demo-view { enabled: boolean }.
 *
 * Called by the Super Admin portal's Demo/Live toggle before the view
 * flips ON. Super-admin only, fails closed. When enabling:
 *   - if the busy-restaurant seed dataset (The Grand Bistro + 6 platform
 *     tenants, all deadbeef-prefixed) is NOT loaded, it is loaded now —
 *     idempotent wipe-then-seed, exactly the /api/admin/seed-demo safety
 *     contract — so "toggle Demo ON" always means "I can see a busy
 *     restaurant", never "banner over my own empty live data".
 * When disabling, no server work is needed: the cookie is cleared
 * client-side and live queries resume on the next render.
 *
 * The view cookie itself (gemino_demo_mode) is still set client-side by
 * the toggle — the server-side demo gate re-verifies super admin on every
 * request anyway (fail closed), so a forged cookie gains nothing.
 */
export async function POST(req: NextRequest) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized: Super Admin access required' },
      { status: 403 }
    );
  }

  let enabled = true;
  try {
    const body = await req.json();
    enabled = body?.enabled !== false;
  } catch {
    // Empty/invalid body defaults to enabling (the toggle's primary path).
  }

  if (!enabled) {
    return NextResponse.json({ success: true, enabled: false, seeded: false });
  }

  try {
    const settings = await db.query.systemSettings.findFirst().catch(() => null);
    if (settings?.demoSeedActive) {
      return NextResponse.json({ success: true, enabled: true, seeded: false, alreadyLoaded: true });
    }
    const result = await seedDemoData();
    return NextResponse.json({
      success: true,
      enabled: true,
      seeded: true,
      tenantName: result.tenantName,
      counts: result.counts,
      ownerLinked: result.ownerLinked,
    });
  } catch (err: any) {
    console.error('[demo-view] ensure-seed failed', err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Demo seed failed' },
      { status: 500 }
    );
  }
}
