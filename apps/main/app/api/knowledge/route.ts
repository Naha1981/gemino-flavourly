import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { requireTenantRole } from '@/lib/auth/tenant-role';
import { createKnowledgeDocument, listKnowledgeDocuments } from '@/lib/knowledge/store';

export const runtime='nodejs';
export const dynamic='force-dynamic';

async function extractPdf(buffer: Buffer): Promise<string> {
  // @ts-ignore pdf-parse does not ship a reliable declaration in this repo.
  const mod = await import('pdf-parse');
  const parser = (mod as any).default ?? mod;
  const parsed = await parser(buffer);
  return String(parsed.text ?? '').trim();
}

export async function GET() {
  const tenant=await getOrCreateTenant();
  if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
  return NextResponse.json({documents:await listKnowledgeDocuments(tenant.id)});
}

export async function POST(req:NextRequest) {
  const tenant=await getOrCreateTenant();
  if(!tenant)return NextResponse.json({error:'Unauthorized'},{status:401});
  try{await requireTenantRole(tenant.id,'manager')}catch{return NextResponse.json({error:'Manager or owner role required'},{status:403})}
  const form=await req.formData();
  const file=form.get('file');
  if(!(file instanceof File))return NextResponse.json({error:'Upload a file'},{status:400});
  if(file.size>2*1024*1024)return NextResponse.json({error:'Maximum file size is 2MB'},{status:413});
  const name=file.name||'knowledge';
  const ext=name.toLowerCase().split('.').pop();
  let content='';
  if(ext==='pdf'||file.type==='application/pdf') content=await extractPdf(Buffer.from(await file.arrayBuffer()));
  else {
    if(!['txt','md','csv','json'].includes(ext??'')) return NextResponse.json({error:'Supported formats: PDF, TXT, MD, CSV, JSON'},{status:415});
    content=await file.text();
  }
  content=content.replace(/\0/g,'').trim();
  if(!content)return NextResponse.json({error:'No readable text was found in the file'},{status:422});
  const doc=await createKnowledgeDocument({tenantId:tenant.id,name,mimeType:file.type||'application/octet-stream',content});
  return NextResponse.json({ok:true,document:doc},{status:201});
}
