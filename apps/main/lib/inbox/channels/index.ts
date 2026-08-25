import { type ChannelAdapter, type ChannelName } from './types.ts';
import { whatsappAdapter } from './whatsapp-adapter.ts';
import { emailAdapter } from './email-adapter.ts';
import { instagramAdapter } from './instagram-adapter.ts';
import { facebookAdapter } from './facebook-adapter.ts';

/**
 * Registry of every channel adapter, keyed by channel name. The aggregator
 * looks adapters up here by the `channel_configs.channel` value, so adding a
 * new channel is a one-line addition: implement the adapter and register it.
 */
export const channelAdapters: Record<ChannelName, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  email: emailAdapter,
  instagram: instagramAdapter,
  facebook: facebookAdapter,
  web: {
    channel: 'web',
    async fetchMessages() {
      return [];
    },
    async sendMessage() {
      return { ok: false, error: 'Web widget channel has no outbound send path.' };
    },
    async markAsRead() {
      return { ok: true };
    },
  },
};

export function getChannelAdapter(channel: string): ChannelAdapter | null {
  if ((channel as ChannelName) in channelAdapters) {
    return channelAdapters[channel as ChannelName];
  }
  return null;
}

export * from './types.ts';
