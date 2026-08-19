import { Request, Response } from 'express';
import { getWaAccount } from '../db/client.js';
import { getSocketStatus } from '../whatsapp/index.js';

export async function statusHandler(req: Request, res: Response) {
  const waAccountId = (req.query.waAccountId as string) || (req.body?.waAccountId as string);

  if (!waAccountId) {
    return res.status(400).json({ error: 'waAccountId query parameter is required' });
  }

  try {
    const account = await getWaAccount(waAccountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const inMemory = getSocketStatus(waAccountId);

    return res.json({
      isConnected: account.is_connected,
      phoneNumber: account.phone_number,
      qrCode: account.qr_code,
      status: account.status || (account.is_connected ? 'connected' : 'unlinked'),
      inMemoryActive: inMemory.inMemory,
      lastConnectedAt: account.last_connected_at,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
