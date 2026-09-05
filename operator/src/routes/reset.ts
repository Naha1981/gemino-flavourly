import { Request, Response } from 'express';
import { getWaAccount, purgeAuthState, updateWaAccount } from '../db/client.js';
import { stopWhatsAppSocket } from '../whatsapp/index.js';

/**
 * POST /reset — "Reset WhatsApp Connection".
 *
 * Kills any in-memory socket, purges ALL persisted session material for the
 * account (Signal keys + creds blob), and flips the account back to a
 * pristine unlinked state. The next /start (which the dashboard issues when
 * the owner clicks Connect) then generates a fresh QR code for re-pairing.
 *
 * Use cases:
 *  - an account stuck in a 401/badSession loop on an engine version deployed
 *    before the self-healing purge existed (this endpoint is the manual
 *    equivalent of what handleConnectionUpdate now does automatically);
 *  - an owner who wants to deliberately re-link to a different phone;
 *  - support tooling, without ever needing direct database access.
 *
 * Same auth as every mutating route: x-api-key header (apiKeyAuth in
 * routes/index.ts) plus tenant ownership of the waAccountId — one tenant can
 * never reset another tenant's WhatsApp session.
 */
export async function resetHandler(req: Request, res: Response) {
  // express.json() leaves req.body undefined for non-JSON content types, and
  // destructuring undefined throws — same guard as /start.
  const { waAccountId, tenantId } = req.body ?? {};

  if (!waAccountId || !tenantId) {
    return res.status(400).json({ error: 'waAccountId and tenantId are required' });
  }

  try {
    const account = await getWaAccount(waAccountId);
    if (!account) {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }
    if (account.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'waAccountId does not belong to the given tenantId' });
    }
  } catch (err: any) {
    return res.status(500).json({ error: `Failed to verify WhatsApp account: ${err.message}` });
  }

  try {
    // Order matters: evict the socket FIRST so no in-flight event handler can
    // re-persist the old credentials after the purge lands.
    stopWhatsAppSocket(waAccountId);
    await purgeAuthState(waAccountId);
    await updateWaAccount(waAccountId, {
      isConnected: false,
      qrCode: null,
      phoneNumber: null,
      status: 'unlinked',
    });
    return res.json({
      success: true,
      waAccountId,
      message: 'Session credentials purged. Call POST /start to begin fresh QR pairing.',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to reset WhatsApp session' });
  }
}
