import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import {
  listProspects,
  countProspectsByStatus,
  createProspect,
  type CreateProspectInput,
} from '@/lib/brand-intelligence/prospect-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Super Admin prospects console.
 *
 * GET  — list all prospects + per-status counts (drives the console table
 *        and the status chips).
 * POST — add a single prospect from the "Add Prospect" form.
 *
 * Both are gated by isSuperAdmin() (staff role OR email allowlist, live
 * Clerk API call) — the same gate as the rest of /admin.
 */
export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  const [prospects, counts] = await Promise.all([listProspects(), countProspectsByStatus()]);
  return NextResponse.json({ prospects, counts });
}

export async function POST(req: NextRequest) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  let body: Partial<CreateProspectInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const website = typeof body.website === 'string' ? body.website.trim() : '';
  if (!name || !website) {
    return NextResponse.json({ error: 'name and website are required' }, { status: 400 });
  }

  const row = await createProspect({
    name,
    website,
    ownerEmail: typeof body.ownerEmail === 'string' ? body.ownerEmail.trim() : null,
    ownerPhone: typeof body.ownerPhone === 'string' ? body.ownerPhone.trim() : null,
    city: typeof body.city === 'string' ? body.city.trim() : null,
  });

  return NextResponse.json({ ok: true, prospect: row }, { status: 201 });
}
