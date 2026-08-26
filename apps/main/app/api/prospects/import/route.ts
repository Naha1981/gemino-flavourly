import { NextRequest, NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { parseProspectsCsv } from '@/lib/brand-intelligence/prospects';
import { createProspectsBulk } from '@/lib/brand-intelligence/prospect-store';

export const runtime = 'nodejs';

/**
 * Super Admin prospects console — bulk CSV import.
 *
 * Accepts a multipart/form-data upload with a `file` field (or a plain JSON
 * `{ csv }` body), parses it server-side, and inserts every well-formed row
 * as a queued prospect. Malformed rows are reported, never silently dropped.
 */
export async function POST(req: NextRequest) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Unauthorized: Super Admin access required' }, { status: 403 });
  }

  let csv = '';
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const file = form.get('file');
      if (file instanceof File) {
        csv = await file.text();
      }
    } else {
      const body = await req.json();
      csv = typeof body.csv === 'string' ? body.csv : '';
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Could not read upload: ${err?.message ?? 'invalid'}` }, { status: 400 });
  }

  if (!csv.trim()) {
    return NextResponse.json({ error: 'No CSV content provided' }, { status: 400 });
  }

  const { rows, errors } = parseProspectsCsv(csv);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No valid prospects found', errors: errors.slice(0, 10) },
      { status: 400 }
    );
  }

  const created = await createProspectsBulk(rows);
  return NextResponse.json({
    ok: true,
    imported: created.length,
    failed: errors.length,
    errors: errors.slice(0, 20),
  });
}
