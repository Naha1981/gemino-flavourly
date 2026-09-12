import { centralWhatsApp } from '@/lib/whatsapp/central-operator';

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface StartSocketResponse {
  success: boolean;
  qrCode?: string;
  isConnected?: boolean;
  phoneNumber?: string | null;
  error?: string;
}

export interface SocketStatusResponse {
  isConnected: boolean;
  phoneNumber?: string | null;
  qrCode?: string | null;
  status: 'unlinked' | 'connecting' | 'connected' | 'disconnected' | string;
}

/** Server-only compatibility facade for Gemino's messaging/domain code. */
export const operatorClient = {
  async checkHealth(timeoutMs: number = 2_500): Promise<boolean> {
    return centralWhatsApp.checkHealth(timeoutMs);
  },

  async startSocket(tenantId: string, waAccountId: string): Promise<StartSocketResponse> {
    try {
      const result = await centralWhatsApp.connect(tenantId, waAccountId);
      const status = await centralWhatsApp.status(tenantId, waAccountId).catch(() => null);
      const qr = status?.isConnected ? null : await centralWhatsApp.qr(tenantId, waAccountId).catch(() => null);
      return {
        success: true,
        isConnected: Boolean(status?.isConnected),
        phoneNumber: status?.phoneNumber ?? null,
        qrCode: qr?.qrCode ?? null,
        ...(result.status ? {} : {}),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  },

  async connect(tenantId: string, waAccountId: string): Promise<StartSocketResponse> {
    return this.startSocket(tenantId, waAccountId);
  },

  async sendMessage(tenantId: string, waAccountId: string, to: string, text: string): Promise<SendMessageResponse> {
    try {
      const result = await centralWhatsApp.sendText(tenantId, waAccountId, to, text) as Record<string, unknown>;
      const message = result?.message;
      const messageId = typeof message === 'object' && message !== null && 'key' in message
        ? (message as Record<string, unknown>).key && typeof (message as Record<string, unknown>).key === 'object'
          ? ((message as Record<string, unknown>).key as Record<string, unknown>).id
          : undefined
        : undefined;
      return { success: true, messageId: typeof messageId === 'string' ? messageId : undefined };
    } catch (err: any) {
      return { success: false, error: err?.message || 'WhatsApp Operator send failed' };
    }
  },

  async getStatus(tenantId: string, waAccountId: string, timeoutMs: number = 5_000): Promise<SocketStatusResponse | null> {
    try {
      const status = await Promise.race([
        centralWhatsApp.status(tenantId, waAccountId),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('status timeout')), timeoutMs)),
      ]);
      const qr = status.isConnected ? null : await centralWhatsApp.qr(tenantId, waAccountId).catch(() => null);
      return {
        isConnected: status.isConnected,
        phoneNumber: status.phoneNumber ?? null,
        qrCode: qr?.qrCode ?? null,
        status: status.status,
      };
    } catch {
      return null;
    }
  },

  async getQr(tenantId: string, waAccountId: string) {
    return centralWhatsApp.qr(tenantId, waAccountId);
  },

  async requestPairingCode(tenantId: string, waAccountId: string, phoneNumber: string) {
    return centralWhatsApp.pairingCode(tenantId, waAccountId, phoneNumber);
  },

  async getPairingCode(tenantId: string, waAccountId: string) {
    return centralWhatsApp.currentPairingCode(tenantId, waAccountId);
  },

  async reset(tenantId: string, waAccountId: string) {
    return centralWhatsApp.reset(tenantId, waAccountId);
  },

  async disconnect(tenantId: string, waAccountId: string) {
    return centralWhatsApp.disconnect(tenantId, waAccountId);
  },
};
