import { centralWhatsApp } from '@/lib/whatsapp/central-operator';

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface StartSocketResponse {
  success: boolean;
  state?: 'waking' | 'ready';
  transient?: boolean;
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

/** Server-only compatibility facade. All WhatsApp transport belongs to the central NahaLabs Operator. */
export const operatorClient = {
  async checkHealth(timeoutMs: number = 2_500): Promise<boolean> {
    return centralWhatsApp.checkHealth(timeoutMs);
  },

  async startSocket(tenantId: string, waAccountId: string): Promise<StartSocketResponse> {
    // A sleeping Render service must be explicitly woken first. Do not turn a
    // cold-start timeout into a fake successful connect that leaves the UI
    // spinning forever without a QR code or a useful error.
    const operatorOnline = await centralWhatsApp.checkHealth(5_000);
    if (!operatorOnline) {
      return {
        success: false,
        state: 'waking',
        transient: true,
        error: 'The central WhatsApp Operator is waking from standby. Retrying automatically.',
      };
    }

    try {
      await centralWhatsApp.connect(tenantId, waAccountId);
      const status = await centralWhatsApp.status(tenantId, waAccountId);
      const qr = status.isConnected ? null : await centralWhatsApp.qr(tenantId, waAccountId);
      return {
        success: true,
        state: 'ready',
        isConnected: status.isConnected,
        phoneNumber: status.phoneNumber ?? null,
        qrCode: qr.qrCode ?? null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const transient = message.startsWith('NahaLabs WhatsApp Operator unavailable:');
      return {
        success: false,
        state: transient ? 'waking' : 'ready',
        transient,
        error: message,
      };
    }
  },

  async connect(tenantId: string, waAccountId: string): Promise<StartSocketResponse> {
    return this.startSocket(tenantId, waAccountId);
  },

  async sendMessage(tenantId: string, waAccountId: string, to: string, text: string): Promise<SendMessageResponse> {
    try {
      const result = await centralWhatsApp.sendText(tenantId, waAccountId, to, text) as Record<string, unknown>;
      const message = result.message;
      const key = message && typeof message === 'object' ? (message as Record<string, unknown>).key : undefined;
      const messageId = key && typeof key === 'object' ? (key as Record<string, unknown>).id : undefined;
      return { success: true, messageId: typeof messageId === 'string' ? messageId : undefined };
    } catch (err: any) {
      return { success: false, error: err?.message || 'WhatsApp Operator send failed' };
    }
  },

  async getStatus(tenantId: string, waAccountId: string, timeoutMs: number = 5_000): Promise<SocketStatusResponse> {
    const status = await centralWhatsApp.status(tenantId, waAccountId, timeoutMs);
    const qr = status.isConnected ? null : await centralWhatsApp.qr(tenantId, waAccountId);
    return {
      isConnected: status.isConnected,
      phoneNumber: status.phoneNumber ?? null,
      qrCode: qr.qrCode ?? null,
      status: status.status,
    };
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
