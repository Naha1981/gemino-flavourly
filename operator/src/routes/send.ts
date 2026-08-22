import { Request, Response } from 'express';
import { sendMessage } from '../whatsapp/index.js';
import { getWaAccount } from '../db/client.js';

export async function sendHandler(req: Request, res: Response) {
  const { waAccountId, to, text, tenantId } = req.body;

  if (!waAccountId || !to || !text) {
    return res.status(400).json({ error: 'Missing waAccountId, to, or text in payload' });
  }

  try {
    const account = await getWaAccount(waAccountId);
    if (!account) {
      return res.status(404).json({ error: 'WhatsApp account not found' });
    }
    if (tenantId && account.tenant_id && account.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'waAccountId does not belong to tenantId' });
    }

    const result = await sendMessage(waAccountId, to, text);
    return res.json({ success: true, result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to dispatch message' });
  }
}
