import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { getOpenPostClient } from '@/lib/autopost/openpost';
import { clearTenantAutoPostConfig, getTenantAutoPostConfig, saveTenantAutoPostConfig } from '@/lib/autopost/tenant-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const config = await getTenantAutoPostConfig(tenant.id);
  return NextResponse.json({
    configured: Boolean(config),
    workspaceId: config?.workspaceId ?? null,
    socialAccountIds: config?.socialAccountIds ?? [],
    updatedAt: config?.updatedAt ?? null,
    openPostConfigured: Boolean(getOpenPostClient()),
  });
}

export async function POST(req: Request) {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
    const socialAccountIds = Array.isArray(body.socialAccountIds)
      ? body.socialAccountIds.filter((id: unknown): id is string => typeof id === 'string')
      : [];

    if (!process.env.OPENPOST_BASE_URL?.trim() || !process.env.OPENPOST_API_TOKEN?.trim()) {
      return NextResponse.json({ error: 'OpenPost service credentials are not configured on Flavourly.' }, { status: 503 });
    }

    const client = getOpenPostClient();
    if (!client) return NextResponse.json({ error: 'OpenPost client is unavailable.' }, { status: 503 });

    try {
      await client.health();
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'OpenPost is unavailable.' }, { status: 502 });
    }

    const config = await saveTenantAutoPostConfig(tenant.id, { workspaceId, socialAccountIds });
    return NextResponse.json({ ok: true, configured: true, ...config });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save AutoPost connection.' }, { status: 422 });
  }
}

export async function DELETE() {
  const tenant = await getOrCreateTenant();
  if (!tenant) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await clearTenantAutoPostConfig(tenant.id);
  return NextResponse.json({ ok: true, configured: false });
}
