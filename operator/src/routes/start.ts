import { Request, Response } from 'express';
import { startWhatsAppSocket } from '../whatsapp/index.js';
import { getWaAccount } from '../db/client.js';

export async function startHandler(req: Request, res: Response) {
  const { waAccountId, tenantId } = req.body;

  if (!waAccountId) {
    return res.status(400).json({ error: 'waAccountId is required' });
  }

  // Verify the requested waAccountId actually belongs to the tenant
  // making the request, mirroring the same check in send.ts. Without
  // this, any caller holding the shared OPERATOR_API_KEY could start
  // (and take over reconnect duty for) a socket belonging to a
  // different tenant just by passing the wrong waAccountId.
  if (tenantId) {
    const account = await getWaAccount(waAccountId);
    if (!account) {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }
    if (account.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'waAccountId does not belong to the given tenantId' });
    }
  }

  try {
    const result = await startWhatsAppSocket(waAccountId);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to start socket' });
  }
}
