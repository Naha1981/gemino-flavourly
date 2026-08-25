import { operatorClient } from '../../operator-client.ts';
import {
  type ChannelAdapter,
  type ChannelContext,
  type ChannelResult,
  type NormalizedMessage,
  errResult,
  okResult,
} from './types.ts';

/**
 * WhatsApp channel.
 *
 * Inbound messages are delivered by the Baileys webhook (lib/webhook), which
 * writes them straight into `messages`, so `fetchMessages` returns nothing —
 * re-polling would only duplicate what the webhook already ingested. Outbound
 * goes through the persistent Operator exactly like the rest of the platform,
 * so `sendMessage` forwards to operatorClient using the account id the
 * tenant enabled this channel with.
 */
export const whatsappAdapter: ChannelAdapter = {
  channel: 'whatsapp',

  async fetchMessages(): Promise<NormalizedMessage[]> {
    // The webhook owns WhatsApp ingestion; nothing to poll here.
    return [];
  },

  async sendMessage(ctx: ChannelContext, to: string, text: string): Promise<ChannelResult> {
    const waAccountId = ctx.secrets.waAccountId;
    if (!waAccountId) {
      return errResult('WhatsApp channel has no linked account; reconnect in Settings.');
    }
    const res = await operatorClient.sendMessage(ctx.tenantId, waAccountId, to, text);
    if (!res.success) {
      return errResult(res.error ?? 'WhatsApp send failed');
    }
    return okResult(res.messageId);
  },

  async markAsRead(): Promise<ChannelResult> {
    // Baileys read receipts are handled operator-side; nothing to ack here.
    return okResult();
  },
};
