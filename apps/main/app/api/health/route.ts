import { NextResponse } from 'next/server';
import { initDb, isDbReady } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await initDb();
    return NextResponse.json({ ok: true, db: isDbReady() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 503 });
  }
}
