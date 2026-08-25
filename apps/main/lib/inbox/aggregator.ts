import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, conversations, messages, channelConfigs } from '@/lib/db/schema';
import { getChannelAdapter, type NormalizedMessage } from './channels';
import { buildChannelContext, buildInboundMessage, coerceTimestamp } from './normalize';

export interface ChannelAggregationReport {
  tenantId: string;
  channel: string;
  enabled: boolean;
  fetched: number;
  ingested: number;
  skipped: number;
  errors: string[];
}

export interface TenantAggregationReport {
  tenantId: string;
  channels: ChannelAggregationReport[];
}

/**
 * Inbound multi-channel aggregation.
 *
 * Every 5 minutes the cron (app/api/cron/aggregate-messages) calls
 * `aggregateAllTenants`, which walks each tenant's enabled `channel_configs`,
 * asks the matching adapter for its inbound messages, normalises them, and
 * folds them into the same `conversations` / `messages` tables WhatsApp uses.
 * One inbox, every channel, tenant-scoped end to end.
 */

async function getOrCreateContact(tenantId: string, identifier: string): Promise<string> {
  const existing = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, identifier)))
    .limit(1);
  if (existing.length > 0) return existing[0].id;

  const [row] = await db
    .insert(contacts)
    .values({ tenantId, phone: identifier, name: identifier })
    .returning({ id: contacts.id });
  return row.id;
}

async function getOrCreateConversation(args: {
  tenantId: string;
  contactId: string;
  channel: string;
  externalId: string | null;
  waAccountId: string | null;
}): Promise<string> {
  const matches = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.tenantId, args.tenantId),
        eq(conversations.contactId, args.contactId),
        eq(conversations.channel, args.channel as 'whatsapp')
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);

  if (matches.length > 0) return matches[0].id;

  const [row] = await db
    .insert(conversations)
    .values({
      tenantId: args.tenantId,
      contactId: args.contactId,
      channel: args.channel as 'whatsapp',
      externalId: args.externalId,
      waAccountId: args.waAccountId,
    })
    .returning({ id: conversations.id });
  return row.id;
}

async function aggregateChannel(
  tenantId: string,
  channel: string,
  credentialsEncrypted: string | null
): Promise<ChannelAggregationReport> {
  const report: ChannelAggregationReport = {
    tenantId,
    channel,
    enabled: true,
    fetched: 0,
    ingested: 0,
    skipped: 0,
    errors: [],
  };

  const adapter = getChannelAdapter(channel);
  if (!adapter) {
    report.errors.push(`No adapter registered for channel "${channel}"`);
    return report;
  }

  const ctx = buildChannelContext(tenantId, channel, credentialsEncrypted);

  let fetched: NormalizedMessage[];
  try {
    fetched = await adapter.fetchMessages(ctx);
  } catch (err: any) {
    report.errors.push(err?.message ?? 'fetchMessages failed');
    return report;
  }
  report.fetched = fetched.length;

  for (const msg of fetched) {
    try {
      const contactId = await getOrCreateContact(tenantId, msg.from);
      const conversationId = await getOrCreateConversation({
        tenantId,
        contactId,
        channel,
        externalId: msg.externalId,
        waAccountId: ctx.secrets.waAccountId ?? null,
      });

      // Idempotency: skip if this provider message id was already ingested.
      if (msg.externalId) {
        const prior = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.tenantId, tenantId), eq(messages.waMessageId, msg.externalId)))
          .limit(1);
        if (prior.length > 0) {
          report.skipped += 1;
          continue;
        }
      }

      await db.insert(messages).values(buildInboundMessage(msg, { tenantId, contactId, conversationId, waAccountId: ctx.secrets.waAccountId ?? null }));
      await db
        .update(conversations)
        .set({ lastMessageAt: coerceTimestamp(msg.timestamp) })
        .where(eq(conversations.id, conversationId));
      report.ingested += 1;
    } catch (err: any) {
      report.errors.push(err?.message ?? 'ingest failed');
    }
  }

  return report;
}

/** Aggregate every enabled channel for a single tenant. */
export async function aggregateTenant(tenantId: string): Promise<ChannelAggregationReport[]> {
  const configs = await db
    .select()
    .from(channelConfigs)
    .where(and(eq(channelConfigs.tenantId, tenantId), eq(channelConfigs.enabled, true)));

  const reports = await Promise.all(
    configs.map((cfg) => aggregateChannel(tenantId, cfg.channel, cfg.credentialsEncrypted))
  );
  return reports;
}

/** Aggregate every tenant with at least one enabled channel. */
export async function aggregateAllTenants(): Promise<TenantAggregationReport[]> {
  // Distinct tenant ids that have an enabled channel.
  const rows = await db
    .selectDistinct({ tenantId: channelConfigs.tenantId })
    .from(channelConfigs)
    .where(eq(channelConfigs.enabled, true));

  const reports = await Promise.all(rows.map((r) => aggregateTenant(r.tenantId)));
  return reports.map((channels, i) => ({ tenantId: rows[i].tenantId, channels }));
}
