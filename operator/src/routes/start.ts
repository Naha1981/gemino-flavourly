import { Request, Response } from 'express';
import { startWhatsAppSocket } from '../whatsapp/index.js';

export async function startHandler(req: Request, res: Response) {
  const { waAccountId } = req.body;

  if (!waAccountId) {
    return res.status(400).json({ error: 'waAccountId is required' });
  }

  try {
    const result = await startWhatsAppSocket(waAccountId);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to start socket' });
  }
}
