import { Request, Response } from 'express';
import { startWhatsAppSocket } from '../whatsapp/index.js';
import { getWaAccount } from '../db/client.js';

export async function startHandler(req: Request, res: Response) {
  // express.json() only parses requests with a JSON content-type — anything
  // else (text/plain, no content-type, multipart) leaves req.body undefined,
  // and destructuring undefined throws inside this async handler, which
  // Express 4 does NOT catch: it becomes an unhandled rejection that kills
  // the whole operator process and every tenant's live socket.
  const { waAccountId, tenantId } = req.body ?? {};

  if (!waAccountId || !tenantId) {
    return res.status(400).json({ error: 'waAccountId and tenantId are required' });
  }

  // Verify the requested waAccountId actually belongs to the tenant
  // making the request, mirroring the same check in send.ts. tenantId is
  // REQUIRED (not just checked when present) — an optional check is a
  // fail-open check: any caller holding the shared OPERATOR_API_KEY could
  // bypass tenant isolation entirely just by omitting tenantId from the
  // request body, which defeats the point of the check.
  //
  // The lookup itself is inside the try: a Postgres blip during getWaAccount
  // used to reject OUTSIDE any handler and crash the process (same unhandled
  // -rejection path as above).
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
    const result = await startWhatsAppSocket(waAccountId);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to start socket' });
  }
}
