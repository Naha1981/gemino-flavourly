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
   * Health check to ensure operator is running and healthy.
   *
   * `timeoutMs` (default 2.5s): this is called from the WhatsApp linking
   * page's status poll while the user waits on "Starting the WhatsApp
   * engine…". Render's free tier spins the operator down after idle —
   * a cold wake takes ~50s — and WITHOUT a timeout this fetch would
   * hang the whole status response until Vercel kills the route at
   * maxDuration, turning "engine waking up" into an opaque 500.
   * Bounded = the page can say "engine offline, retrying" honestly.
   */
  async checkHealth(timeoutMs: number = 2_500): Promise<boolean> {
    try {
      const res = await fetch(`${OPERATOR_URL}/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
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
   * Send outbound WhatsApp message directly via operator socket.
   * tenantId is required and verified operator-side against the
   * account's actual owner, so a bug or forged request elsewhere in the
   * app can't send a message through a WhatsApp number belonging to a
   * different tenant.
   */
  async sendMessage(tenantId: string, waAccountId: string, to: string, text: string): Promise<SendMessageResponse> {
    try {
      const res = await fetch(`${OPERATOR_URL}/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': OPERATOR_API_KEY,
        },
        body: JSON.stringify({ tenantId, waAccountId, to, text }),
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
