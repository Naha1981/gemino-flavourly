import { NextRequest,NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { loyaltyRewards } from '@/lib/db/schema';
import { and,eq } from 'drizzle-orm';

export async function PATCH(req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const tenant=await getOrCreateTenant();if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await requireTenantRole(tenant.id,'manager')}catch{return NextResponse.json({error:'Manager or owner role required'},{status:403})}
 const {id}=await ctx.params;const body=await req.json().catch(()=>({}));
 const updates:any={};
 if(typeof body.name==='string'&&body.name.trim())updates.name=body.name.trim();
 if(Number.isInteger(body.pointsCost)&&body.pointsCost>0)updates.pointsCost=body.pointsCost;
 if(typeof body.isActive==='boolean')updates.isActive=body.isActive;
 if(!Object.keys(updates).length)return NextResponse.json({error:'No valid changes'},{status:400});
 const [reward]=await db.update(loyaltyRewards).set(updates).where(and(eq(loyaltyRewards.id,id),eq(loyaltyRewards.tenantId,tenant.id))).returning();
 if(!reward)return NextResponse.json({error:'Not found'},{status:404});return NextResponse.json({reward});
}

export async function DELETE(_req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const tenant=await getOrCreateTenant();if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await requireTenantRole(tenant.id,'manager')}catch{return NextResponse.json({error:'Manager or owner role required'},{status:403})}
 const {id}=await ctx.params;await db.update(loyaltyRewards).set({isActive:false}).where(and(eq(loyaltyRewards.id,id),eq(loyaltyRewards.tenantId,tenant.id)));
 return NextResponse.json({ok:true});
}
