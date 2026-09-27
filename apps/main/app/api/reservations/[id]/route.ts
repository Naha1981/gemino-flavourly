import { NextRequest,NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { reservations } from '@/lib/db/schema';
import { and,eq } from 'drizzle-orm';
import { completeVisitAndEarn } from '@/lib/customer/reward-claim-store';
import { markReservationCancelled } from '@/lib/revenue/cancellation-followup';
import { emitWebhookEvent } from '@/lib/webhooks/outbound';

export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const tenant=await getOrCreateTenant();
 if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await requireTenantRole(tenant.id,'staff')}catch{return NextResponse.json({error:'Staff access required'},{status:403})}
 const {id}=await ctx.params; const body=await req.json().catch(()=>({}));
 const reservation=await db.query.reservations.findFirst({where:and(eq(reservations.id,id),eq(reservations.tenantId,tenant.id))});
 if(!reservation)return NextResponse.json({error:'Not found'},{status:404});
 const status=typeof body.status==='string'?body.status:null;
 if(status==='cancelled' && reservation.status!=='cancelled'){
   await markReservationCancelled({cancelReservation:async(reservationId,at)=>{await db.update(reservations).set({status:'cancelled',cancelledAt:at}).where(and(eq(reservations.id,reservationId),eq(reservations.tenantId,tenant.id)))}},id,new Date());
   await emitWebhookEvent(tenant.id,'booking.cancelled',{reservationId:id,customerPhone:reservation.customerPhone});
 }else if(status==='completed'){
   await completeVisitAndEarn({tenantId:tenant.id,reservationId:id});
   await emitWebhookEvent(tenant.id,'booking.completed',{reservationId:id});
 }else if(status==='no_show'){
   await db.update(reservations).set({status:'no_show'}).where(and(eq(reservations.id,id),eq(reservations.tenantId,tenant.id)));
   await emitWebhookEvent(tenant.id,'booking.no_show',{reservationId:id});
 }else if(status==='confirmed'){
   await db.update(reservations).set({status:'confirmed'}).where(and(eq(reservations.id,id),eq(reservations.tenantId,tenant.id)));
 }
 return NextResponse.json({ok:true});
}
