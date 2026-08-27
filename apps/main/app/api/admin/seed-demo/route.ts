import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { seedDemoData } from '@/lib/demo/seed-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Demo Mode — POST /api/admin/seed-demo
 *
 * Super-admin only. Loads the busy-restaurant demo dataset (The Grand
 * Bistro + 6 platform tenants). Explicitly triggered from /admin — never on
 * deploy, never on login. Idempotent: wipe-then-seed internally.
 *
 * SAFETY: every seeded row id starts with 'deadbeef-'; real rows are never
 * modified or deleted.
 */
export async function POST() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }
  try {
    const result = await seedDemoData();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[demo] seed failed', err);
    return NextResponse.json({ success: false, error: err?.message ?? 'Seed failed' }, { status: 500 });
  }
}
