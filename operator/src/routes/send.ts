import { Request, Response } from 'express';
import { sendMessage } from '../whatsapp/index.js';

export async function sendHandler(req: Request, res: Response) {
  const { waAccountId, to, text } = req.body;

  if (!waAccountId || !to || !text) {
    return res.status(400).json({ error: 'Missing waAccountId, to, or text in payload' });
  }

  try {
    const result = await sendMessage(waAccountId, to, text);
    return res.json({ success: true, result });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to dispatch message' });
  }
}
