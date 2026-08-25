import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { channelConfigs, tenants } from '@/lib/db/schema';

export type ChannelConfigRow = typeof channelConfigs.$inferSelect;

export async function listChannelConfigs(tenantId: string): Promise<ChannelConfigRow[]> {
  return db.select().from(channelConfigs).where(eq(channelConfigs.tenantId, tenantId)).orderBy(channelConfigs.channel);
}

export async function getChannelConfig(tenantId: string, channel: string): Promise<ChannelConfigRow | null> {
  const [row] = await db.select().from(channelConfigs).where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.channel, channel as 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web'))).limit(1);
  return row ?? null;
}

export async function upsertChannelConfig(input: {
  tenantId: string;
  channel: string;
  credentialsEncrypted?: string | null;
  enabled?: boolean;
}): Promise<ChannelConfigRow> {
  const existing = await getChannelConfig(input.tenantId, input.channel);
  if (existing) {
    const [row] = await db.update(channelConfigs).set({
      credentialsEncrypted: input.credentialsEncrypted ?? existing.credentialsEncrypted,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: new Date(),
    }).where(and(eq(channelConfigs.tenantId, input.tenantId), eq(channelConfigs.channel, input.channel as 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web'))).returning();
    return row;
  }
  const [row] = await db.insert(channelConfigs).values({
    tenantId: input.tenantId,
    channel: input.channel as 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web',
    credentialsEncrypted: input.credentialsEncrypted ?? null,
    enabled: input.enabled ?? false,
  }).returning();
  return row;
}

export async function deleteChannelConfig(tenantId: string, channel: string): Promise<boolean> {
  const rows = await db.delete(channelConfigs).where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.channel, channel as 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web'))).returning({ id: channelConfigs.id });
  return rows.length > 0;
}
