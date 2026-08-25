import {
  type ChannelAdapter,
  type ChannelContext,
  type ChannelResult,
  type NormalizedMessage,
  errResult,
  okResult,
} from './types.ts';

/**
 * Instagram DM channel.
 *
 * Safe stub (see email-adapter.ts for the rationale): no provider polling is
 * wired yet, and outbound is reported as unconfigured rather than faked.
 */
export const instagramAdapter: ChannelAdapter = {
  channel: 'instagram',

  async fetchMessages(_ctx: ChannelContext): Promise<NormalizedMessage[]> {
    return [];
  },

  async sendMessage(_ctx: ChannelContext, _to: string, _text: string): Promise<ChannelResult> {
    return errResult('Instagram channel send is not yet wired. Connect an Instagram account first.');
  },

  async markAsRead(_ctx: ChannelContext, _externalId: string): Promise<ChannelResult> {
    return okResult();
  },
};
