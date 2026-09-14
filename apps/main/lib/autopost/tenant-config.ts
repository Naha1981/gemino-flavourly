import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { channelConfigs } from '@/lib/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/reputation/secret-box';

const AUTOPOST_CHANNEL = 'autopost' as 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web';

export type TenantAutoPostConfig = {
  workspaceId: string;
  socialAccountIds: string[];
  updatedAt?: string;
};

export async function getTenantAutoPostConfig(tenantId: string): Promise<TenantAutoPostConfig | null> {
  const [row] = await db
    .select()
    .from(channelConfigs)
    .where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.channel, AUTOPOST_CHANNEL)))
    .limit(1);

  if (!row?.credentialsEncrypted || !row.enabled) return null;

  const plaintext = decryptSecret(row.credentialsEncrypted);
  if (!plaintext) return null;

  try {
    const parsed = JSON.parse(plaintext) as Partial<TenantAutoPostConfig>;
    const workspaceId = typeof parsed.workspaceId === 'string' ? parsed.workspaceId.trim() : '';
    const socialAccountIds = Array.isArray(parsed.socialAccountIds)
      ? parsed.socialAccountIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())
      : [];
    if (!workspaceId || socialAccountIds.length === 0) return null;
    return { workspaceId, socialAccountIds, updatedAt: row.updatedAt?.toISOString() };
  } catch {
    return null;
  }
}

export async function saveTenantAutoPostConfig(
  tenantId: string,
  input: { workspaceId: string; socialAccountIds: string[] },
) {
  const workspaceId = input.workspaceId.trim();
  const socialAccountIds = Array.from(new Set(input.socialAccountIds.map((id) => id.trim()).filter(Boolean)));
  if (!workspaceId || socialAccountIds.length === 0) throw new Error('Workspace ID and at least one social account ID are required.');

  const credentialsEncrypted = encryptSecret(JSON.stringify({ workspaceId, socialAccountIds }));
  const [existing] = await db
    .select({ id: channelConfigs.id })
    .from(channelConfigs)
    .where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.channel, AUTOPOST_CHANNEL)))
    .limit(1);

  if (existing) {
    await db
      .update(channelConfigs)
      .set({ credentialsEncrypted, enabled: true, updatedAt: new Date() })
      .where(eq(channelConfigs.id, existing.id));
  } else {
    await db.insert(channelConfigs).values({
      tenantId,
      channel: AUTOPOST_CHANNEL,
      credentialsEncrypted,
      enabled: true,
    });
  }

  return { workspaceId, socialAccountIds };
}

export async function clearTenantAutoPostConfig(tenantId: string) {
  await db
    .delete(channelConfigs)
    .where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.channel, AUTOPOST_CHANNEL)));
}
