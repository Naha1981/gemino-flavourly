import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import {
  deleteChannelConfig,
  getChannelConfig,
  listChannelConfigs,
  upsertChannelConfig,
} from '@/lib/operations/channel-config-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await listChannelConfigs(tenant.id);
  return NextResponse.json({ channelConfigs: rows });
}

export async function POST(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { channel?: unknown; credentials_encrypted?: unknown; enabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const channel = typeof body.channel === 'string' ? body.channel.trim() : '';
  if (!channel) {
    return NextResponse.json({ error: 'channel is required' }, { status: 400 });
  }

  const allowed = ['whatsapp', 'email', 'instagram', 'facebook', 'web'];
  if (!allowed.includes(channel)) {
    return NextResponse.json({ error: `channel must be one of ${allowed.join(', ')}` }, { status: 400 });
  }

  const credentialsEncrypted = typeof body.credentials_encrypted === 'string' ? body.credentials_encrypted : null;
  const enabled = body.enabled === true;

  const row = await upsertChannelConfig({ tenantId: tenant.id, channel, credentialsEncrypted, enabled });
  return NextResponse.json({ ok: true, channelConfig: row }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const channel = url.searchParams.get('channel')?.trim() ?? '';
  if (!channel) {
    return NextResponse.json({ error: 'channel query parameter is required' }, { status: 400 });
  }

  const removed = await deleteChannelConfig(tenant.id, channel);
  if (!removed) {
    return NextResponse.json({ error: 'Channel config not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
