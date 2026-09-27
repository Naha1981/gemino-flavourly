import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export const dynamic='force-dynamic';
export async function POST(req:NextRequest){
 if(!(await isSuperAdmin())) return NextResponse.json({error:'Forbidden'},{status:403});
 const {userId}=await auth(); const body=await req.json().catch(()=>({}));
 const message=typeof body.message==='string'?body.message.trim():'';
 if(!message) return NextResponse.json({error:'Message required'},{status:400});
 const result=await db.execute(sql`INSERT INTO ops_broadcasts (message,scope,status,created_by) VALUES (${message},'all_tenants','queued',${userId??'unknown'}) RETURNING id`);
 const id=((result as any).rows?.[0]??(result as any)[0]).id;
 try{
  await db.execute(sql`
    INSERT INTO jobs (id,tenant_id,type,payload,status,next_run_at,created_at,updated_at)
    SELECT gen_random_uuid(), t.id, 'send_whatsapp',
      jsonb_build_object('waAccountId',wa.id,'to',c.phone,'text',${message},'automated',true,'broadcastId',${id}),
      'pending',NOW(),NOW(),NOW()
    FROM tenants t
    JOIN wa_accounts wa ON wa.tenant_id=t.id AND wa.is_connected=true
    JOIN contacts c ON c.tenant_id=t.id AND c.blocklisted=false
    WHERE t.plan_status IN ('trialing','active')
  `);
  await db.execute(sql`UPDATE ops_broadcasts SET status='queued' WHERE id=${id}`);
  return NextResponse.json({ok:true,broadcastId:id});
 }catch(error){
  await db.execute(sql`UPDATE ops_broadcasts SET status='failed',completed_at=NOW() WHERE id=${id}`);
  console.error('[Broadcast] failed',error);
  return NextResponse.json({error:'Broadcast queue failed'},{status:500});
 }
}
