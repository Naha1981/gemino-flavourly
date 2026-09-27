import { NextRequest,NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { deleteKnowledgeDocument } from '@/lib/knowledge/store';

export async function DELETE(_req:NextRequest,ctx:{params:Promise<{id:string}>}){
 const tenant=await getOrCreateTenant(); if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
 try{await requireTenantRole(tenant.id,'manager')}catch{return NextResponse.json({error:'Manager or owner role required'},{status:403})}
 const {id}=await ctx.params; await deleteKnowledgeDocument(tenant.id,id); return NextResponse.json({ok:true});
}
