import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { wipeDemoRows } from '@/lib/demo/seed-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Demo Mode — POST /api/admin/wipe-demo
 *
 * Super-admin only. Removes ONLY rows whose ids start with 'deadbeef-'
 * (plus demo-tenant memberships) and clears the demo flag. Real data is
 * never touched — the delete predicates match nothing else.
 */
export async function POST() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ success: false, error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }
  try {
    const tables = await wipeDemoRows();
    return NextResponse.json({ success: true, wipedTables: tables });
  } catch (err: any) {
    console.error('[demo] wipe failed', err);
    return NextResponse.json({ success: false, error: err?.message ?? 'Wipe failed' }, { status: 500 });
  }
}
