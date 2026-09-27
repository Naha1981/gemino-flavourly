import { NextRequest,NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { db } from '@/lib/db';
import { loyaltyRewards } from '@/lib/db/schema';
import { eq,and,desc } from 'drizzle-orm';

export const dynamic='force-dynamic';

export async function GET(){
 const tenant=await getOrCreateTenant();if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
 const rewards=await db.select().from(loyaltyRewards).where(eq(loyaltyRewards.tenantId,tenant.id)).orderBy(desc(loyaltyRewards.pointsCost));
 return NextResponse.json({rewards});
}

export async function POST(req:NextRequest){
 const tenant=await getOrCreateTenant();if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await requireTenantRole(tenant.id,'manager')}catch{return NextResponse.json({error:'Manager or owner role required'},{status:403})}
 const body=await req.json().catch(()=>({}));const name=typeof body.name==='string'?body.name.trim():'';const points=Number(body.pointsCost);
 if(!name||!Number.isInteger(points)||points<=0)return NextResponse.json({error:'Name and positive whole-number pointsCost required'},{status:400});
 const [reward]=await db.insert(loyaltyRewards).values({tenantId:tenant.id,name,pointsCost:points,isActive:true}).returning();
 return NextResponse.json({reward},{status:201});
}
