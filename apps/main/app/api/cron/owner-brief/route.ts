import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron/auth';
import { db } from '@/lib/db';
import { sendResendEmail } from '@/lib/email/resend';
import { sql } from 'drizzle-orm';

export const runtime='nodejs'; export const dynamic='force-dynamic'; export const maxDuration=60;

export async function GET(req:NextRequest){
 const authError=assertCronAuthorized(req); if(authError) return authError;
 const tenantsResult=await db.execute(sql`SELECT id,name,owner_email FROM tenants WHERE owner_email IS NOT NULL AND plan_status IN ('trialing','active') LIMIT 200`);
 const tenants=(tenantsResult as any).rows??tenantsResult as any[];
 let sent=0,skipped=0;
 for(const tenant of tenants){
  const stats=await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM reservations WHERE tenant_id=${tenant.id} AND status='confirmed' AND date::date=CURRENT_DATE) AS bookings_today,
      (SELECT count(*)::int FROM conversations WHERE tenant_id=${tenant.id} AND last_message_at >= NOW()-interval '24 hours' AND is_resolved=false) AS open_conversations
  `);
  const s=((stats as any).rows?.[0]??(stats as any)[0]);
  const email=await sendResendEmail({
   to:tenant.owner_email,
   subject:`${tenant.name} — Orderly daily brief`,
   html:`<h2>${tenant.name}</h2><p><strong>${s?.bookings_today??0}</strong> bookings today.</p><p><strong>${s?.open_conversations??0}</strong> conversations need attention.</p><p>Open Orderly to see revenue intelligence, VIPs, campaigns and today's actions.</p>`,
  });
  if(email.ok)sent++;else skipped++;
 }
 return NextResponse.json({ok:true,sent,skipped});
}
