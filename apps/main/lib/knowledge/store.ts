import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type KnowledgeChunk = { id: string; content: string; name: string; chunkIndex: number };

function chunks(text: string, size = 1200, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length && out.length < 200) {
    const end = Math.min(clean.length, start + size);
    out.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return out;
}

function terms(text: string): string {
  return [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 80).join(' ');
}

export async function createKnowledgeDocument(input: {
  tenantId: string; name: string; mimeType: string; content: string; sourceType?: string; sourceUrl?: string | null;
}) {
  const result = await db.execute(sql`\n    INSERT INTO knowledge_documents (tenant_id,name,mime_type,source_type,content,source_url)\n    VALUES (${input.tenantId},${input.name},${input.mimeType},${input.sourceType ?? 'upload'},${input.content},${input.sourceUrl ?? null})\n    RETURNING id,name,mime_type,created_at\n  `);
  const doc = ((result as any).rows?.[0] ?? (result as any)[0]);
  for (const [index, chunk] of chunks(input.content).entries()) {
    await db.execute(sql`\n      INSERT INTO knowledge_chunks (document_id,tenant_id,chunk_index,content,keywords)\n      VALUES (${doc.id},${input.tenantId},${index},${chunk},${terms(chunk)})\n    `);
  }
  return doc;
}

export async function listKnowledgeDocuments(tenantId: string) {
  const result = await db.execute(sql`\n    SELECT id,name,mime_type,source_type,source_url,enabled,created_at,updated_at\n    FROM knowledge_documents WHERE tenant_id=${tenantId} ORDER BY created_at DESC\n  `);
  return (result as any).rows ?? result as any[];
}

export async function deleteKnowledgeDocument(tenantId: string, id: string) {
  await db.execute(sql`DELETE FROM knowledge_documents WHERE tenant_id=${tenantId} AND id=${id}`);
}

export async function retrieveKnowledge(tenantId: string, query: string, limit = 5): Promise<KnowledgeChunk[]> {
  const words = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 20);
  if (!words.length) return [];
  const result = await db.execute(sql`\n    SELECT kc.id,kc.content,kc.chunk_index AS "chunkIndex",kd.name\n    FROM knowledge_chunks kc\n    JOIN knowledge_documents kd ON kd.id=kc.document_id\n    WHERE kc.tenant_id=${tenantId} AND kd.enabled=true\n      AND (${words.map((word) => sql`kc.keywords ILIKE ${'%' + word + '%'}`).reduce((a,b)=>sql`${a} OR ${b}`)})\n    ORDER BY kc.chunk_index ASC LIMIT ${limit}\n  `);
  return ((result as any).rows ?? result as any[]).map((row:any)=>({id:String(row.id),content:String(row.content),name:String(row.name),chunkIndex:Number(row.chunkIndex ?? 0)}));
}
