import { decryptSecret } from '../reputation/secret-box.ts';
import { type ChannelContext, type NormalizedMessage } from './channels/types.ts';

/**
 * Pure, database-free helpers for multi-channel ingestion.
 *
 * Kept separate from aggregator.ts so they can be unit-tested without a live
 * Neon connection (the aggregator imports `db`, which throws at import time
 * when DATABASE_URL is unset). Every function here is a pure transform over
 * its arguments.
 */

/** Decrypt a channel_configs row into a ChannelContext (pure). */
export function buildChannelContext(
  tenantId: string,
  channel: string,
  credentialsEncrypted: string | null
): ChannelContext {
  const raw = decryptSecret(credentialsEncrypted);
  let secrets: Record<string, string> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        secrets = parsed as Record<string, string>;
      }
    } catch {
      secrets = {};
    }
  }
  return { tenantId, channel: channel as ChannelContext['channel'], secrets };
}

/** Coerce a provider timestamp to a real Date, falling back to now. */
export function coerceTimestamp(value: string | undefined | null): Date {
  if (typeof value === 'string' && value.length > 0) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Build the message insert object for a normalized inbound message (pure).
 * `waMessageId` carries the provider's own id for all channels so the partial
 * unique index on (tenant_id, wa_message_id) gives idempotent ingestion.
 */
export function buildInboundMessage(
  msg: NormalizedMessage,
  args: { tenantId: string; contactId: string; conversationId: string; waAccountId: string | null }
) {
  return {
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    direction: 'inbound' as const,
    content: msg.text,
    isAIGenerated: false,
    waMessageId: msg.externalId,
    createdAt: coerceTimestamp(msg.timestamp),
  };
}
