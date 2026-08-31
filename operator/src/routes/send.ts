import { Request, Response } from 'express';
import { sendMessage } from '../whatsapp/index.js';
import { getWaAccount } from '../db/client.js';

export async function sendHandler(req: Request, res: Response) {
  // See start.ts for why req.body is guarded: a non-JSON content-type leaves
  // it undefined, and destructuring undefined throws inside an async
  // handler — an unhandled rejection that Express 4 does not catch, which
  // killed the whole operator process.
  const { tenantId, waAccountId, to, text } = req.body ?? {};

  if (!tenantId || !waAccountId || !to || !text) {
    return res.status(400).json({ error: 'Missing tenantId, waAccountId, to, or text in payload' });
  }

  // Verify the requested waAccountId actually belongs to the tenant
  // making the request, rather than trusting the caller's word for it.
  // Every current caller in apps/main already only ever fetches a
  // waAccountId scoped to the authenticated tenant, so this shouldn't
  // change any legitimate request's outcome — it closes off a bug or a
  // forged request elsewhere in the app from being able to send a
  // WhatsApp message through a number that belongs to a different
  // tenant. The lookup is inside the try so a DB blip returns a 500
  // instead of rejecting unhandled and crashing the process.
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
    const result = await sendMessage(waAccountId, to, text);
    return res.json({ success: true, result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to dispatch message' });
  }
}
