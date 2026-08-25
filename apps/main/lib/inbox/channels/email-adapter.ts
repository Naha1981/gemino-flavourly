import {
  type ChannelAdapter,
  type ChannelContext,
  type ChannelResult,
  type NormalizedMessage,
  errResult,
  okResult,
} from './types.ts';

/**
 * Email channel (IMAP/API polling).
 *
 * This is a safe stub: `fetchMessages` returns an empty list until a polling
 * integration is wired, and `sendMessage` reports (never fakes) that it is
 * unconfigured. Returning `ok: false` instead of silently succeeding is the
 * same contract the dispatch layer uses — a dropped message must be visible,
 * not reported as delivered.
 */
export const emailAdapter: ChannelAdapter = {
  channel: 'email',

  async fetchMessages(_ctx: ChannelContext): Promise<NormalizedMessage[]> {
    // Stub: no provider polling wired yet. Returns [] so the aggregator
    // simply has nothing to ingest for email rather than erroring.
    return [];
  },

  async sendMessage(_ctx: ChannelContext, _to: string, _text: string): Promise<ChannelResult> {
    return errResult('Email channel send is not yet wired. Configure an SMTP/API provider first.');
  },

  async markAsRead(_ctx: ChannelContext, _externalId: string): Promise<ChannelResult> {
    return okResult();
  },
};
