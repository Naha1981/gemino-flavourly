import { NextResponse } from 'next/server';
import { authenticatePublicApi } from '@/lib/api/public-api';
import { db } from '@/lib/db';
import { contacts, reservations, tenants } from '@/lib/db/schema';
import { and, eq, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const TOOLS = [
  { name: 'restaurant.get', description: 'Get the connected restaurant workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'contacts.list', description: 'List customer contacts.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'reservations.list', description: 'List restaurant reservations.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'loyalty.get', description: 'Get a customer loyalty balance.', inputSchema: { type: 'object', properties: { contactId: { type: 'string' } }, required: ['contactId'] } },
];

export async function POST(req: Request) {
  const ctx = await authenticatePublicApi(req);
  if (!ctx) return NextResponse.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body?.id ?? null;
  try {
    if (body?.method === 'initialize') {
      return NextResponse.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'NahaLabs Flavourly MCP', version: '1.0.0' } } });
    }
    if (body?.method === 'notifications/initialized') return NextResponse.json({ jsonrpc: '2.0', id, result: {} });
    if (body?.method === 'tools/list') return NextResponse.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (body?.method !== 'tools/call') return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, { status: 404 });

    const name = body?.params?.name;
    const args = body?.params?.arguments ?? {};
    if (name === 'restaurant.get') {
      const [tenant] = await db.select({ id: tenants.id, name: tenants.name, slug: tenants.slug }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1);
      return NextResponse.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(tenant) }] } });
    }
    if (name === 'contacts.list') {
      const rows = await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, vip: contacts.vip, loyaltyPoints: contacts.loyaltyPoints }).from(contacts).where(eq(contacts.tenantId, ctx.tenantId)).orderBy(desc(contacts.createdAt)).limit(Math.min(100, Number(args.limit ?? 20)));
      return NextResponse.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(rows) }] } });
    }
    if (name === 'reservations.list') {
      const rows = await db.select({ id: reservations.id, customerName: reservations.customerName, date: reservations.date, partySize: reservations.partySize, status: reservations.status }).from(reservations).where(eq(reservations.tenantId, ctx.tenantId)).orderBy(desc(reservations.date)).limit(Math.min(100, Number(args.limit ?? 20)));
      return NextResponse.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(rows) }] } });
    }
    if (name === 'loyalty.get') {
      const [contact] = await db.select({ id: contacts.id, name: contacts.name, points: contacts.loyaltyPoints }).from(contacts).where(and(eq(contacts.id, String(args.contactId)), eq(contacts.tenantId, ctx.tenantId))).limit(1);
      if (!contact) return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32004, message: 'Contact not found' } }, { status: 404 });
      return NextResponse.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(contact) }] } });
    }
    return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'RATE_LIMITED') return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32005, message: 'Rate limit exceeded' } }, { status: 429 });
    console.error('[MCP] request failed', error);
    return NextResponse.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Internal error' } }, { status: 500 });
  }
}
