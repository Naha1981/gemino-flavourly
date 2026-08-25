/**
 * Multi-channel inbox: shared adapter contract.
 *
 * The aggregator (lib/inbox/aggregator.ts) pulls inbound messages from every
 * channel a tenant has enabled in `channel_configs`, normalises them into one
 * shape, and folds them into the unified `conversations` / `messages` tables.
 * Every channel — including WhatsApp, which is already driven by the Baileys
 * webhook — implements this same interface so the aggregator has exactly one
 * code path regardless of source.
 *
 * Implementations are intentionally safe: a channel with no credentials
 * configured returns an empty message list rather than throwing, and stubs
 * never perform a network call that could leak a tenant secret.
 */

export type ChannelName = 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web';

export const CHANNEL_NAMES: ChannelName[] = ['whatsapp', 'email', 'instagram', 'facebook', 'web'];

/** A message as every provider is reduced to before it touches our schema. */
export interface NormalizedMessage {
  channel: ChannelName;
  /** Customer-side identifier: phone, email address, or social handle. */
  from: string;
  /** Tenant-side identifier the provider delivered to. */
  to: string;
  text: string;
  /** ISO-8601 timestamp from the provider. */
  timestamp: string;
  /** Provider message id — the idempotency key for ingestion. */
  externalId: string;
}

/** Decrypted, provider-specific credentials for a single tenant+channel. */
export interface ChannelContext {
  tenantId: string;
  channel: ChannelName;
  secrets: Record<string, string>;
}

export interface ChannelResult {
  ok: boolean;
  externalId?: string;
  error?: string;
}

/**
 * One behaviour per channel. `fetchMessages` must be idempotent: the same
 * provider message re-fetched on the next run returns the same `externalId`,
 * and the aggregator deduplicates on it.
 */
export interface ChannelAdapter {
  readonly channel: ChannelName;
  fetchMessages(ctx: ChannelContext): Promise<NormalizedMessage[]>;
  sendMessage(ctx: ChannelContext, to: string, text: string): Promise<ChannelResult>;
  markAsRead(ctx: ChannelContext, externalId: string): Promise<ChannelResult>;
}

/** Shared empty-result helper so no adapter invents its own shape. */
export function okResult(externalId?: string): ChannelResult {
  return externalId ? { ok: true, externalId } : { ok: true };
}

export function errResult(error: string): ChannelResult {
  return { ok: false, error };
}
