/**
 * Safe, type-safe HTTP client to communicate with the persistent WhatsApp Operator service.
 */

const OPERATOR_URL = process.env.OPERATOR_URL || 'http://localhost:3001';
const OPERATOR_API_KEY = process.env.OPERATOR_API_KEY || '';

interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface StartSocketResponse {
  success: boolean;
  qrCode?: string;
  isConnected?: boolean;
  phoneNumber?: string;
  error?: string;
}

interface SocketStatusResponse {
  isConnected: boolean;
  phoneNumber?: string;
  qrCode?: string | null;
  status: 'unlinked' | 'connecting' | 'connected' | 'disconnected';
}

export const operatorClient = {
  /**
   * Health check to ensure operator is running and healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${OPERATOR_URL}/health`, {
        method: 'GET',
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * Instruct operator to spin up a socket for a WhatsApp account and produce a QR code or resume session
   */
  async startSocket(waAccountId: string): Promise<StartSocketResponse> {
    try {
      const res = await fetch(`${OPERATOR_URL}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': OPERATOR_API_KEY,
        },
        body: JSON.stringify({ waAccountId }),
        cache: 'no-store',
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to start socket' };
      }
      return data;
    } catch (err: any) {
      return { success: false, error: err.message || 'Operator unreachable' };
    }
  },

  /**
   * Send outbound WhatsApp message directly via operator socket
   */
  async sendMessage(
    waAccountId: string,
    to: string,
    text: string,
    tenantId?: string
  ): Promise<SendMessageResponse> {
    try {
      const res = await fetch(`${OPERATOR_URL}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': OPERATOR_API_KEY,
        },
        body: JSON.stringify({ waAccountId, to, text, tenantId }),
        cache: 'no-store',
      });

      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || 'Failed to send WhatsApp message' };
      }
      return { success: true, messageId: data.result?.key?.id };
    } catch (err: any) {
      return { success: false, error: err.message || 'Operator unreachable' };
    }
  },

  /**
   * Check connection status of a WhatsApp account
   */
  async getStatus(waAccountId: string): Promise<SocketStatusResponse | null> {
    try {
      const res = await fetch(`${OPERATOR_URL}/status?waAccountId=${waAccountId}`, {
        method: 'GET',
        headers: {
          'x-api-key': OPERATOR_API_KEY,
        },
        cache: 'no-store',
      });

      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
};
