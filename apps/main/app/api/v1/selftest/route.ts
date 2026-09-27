import { NextResponse } from 'next/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function GET() {
  if (!(await isSuperAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const checks: Record<string, unknown> = {};
  try { await db.execute(sql`SELECT 1`); checks.database = 'ok'; } catch (e) { checks.database = String(e); }
  checks.webhookSecret = process.env.WEBHOOK_SECRET ? 'configured' : 'missing';
  checks.cronSecret = process.env.CRON_SECRET ? 'configured' : 'missing';
  checks.ai = process.env.GROQ_API_KEY || process.env.GOOGLE_GEMINI_API_KEY ? 'configured' : 'missing';
  checks.payfast = process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY ? 'configured' : 'missing';
  checks.resend = process.env.RESEND_API_KEY ? 'configured' : 'missing';
  checks.operator = process.env.OPERATOR_URL ? 'configured' : 'missing';
  const values = Object.values(checks);
  const ok = values.every((x) => x === 'ok' || x === 'configured');
  return NextResponse.json({ ok, checks, at: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
