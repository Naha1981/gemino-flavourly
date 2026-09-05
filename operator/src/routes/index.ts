import { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { startHandler } from './start.js';
import { sendHandler } from './send.js';
import { statusHandler } from './status.js';
import { resetHandler } from './reset.js';

export function setupRoutes(app: Express) {
  // Authentication middleware using OPERATOR_API_KEY.
  //
  // Previously: `if (requiredKey && key !== requiredKey)` — if
  // OPERATOR_API_KEY was ever unset, EVERY request was authorized,
  // including POST /send (send an arbitrary WhatsApp message on behalf
  // of any connected tenant). It also accepted the key via a `?apiKey=`
  // query param, which lands in Render's access logs in plaintext, and
  // compared with `!==` rather than a timing-safe comparison.
  //
  // Fixed: fails closed if the env var is unset (the key IS already
  // configured in this deployment, so this doesn't break anything
  // currently working), header-only, constant-time comparison.
  const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
    const requiredKey = process.env.OPERATOR_API_KEY;
    if (!requiredKey) {
      res.status(500).json({ error: 'OPERATOR_API_KEY is not configured on the operator' });
      return;
    }

    const providedKey = req.headers['x-api-key'];
    if (typeof providedKey !== 'string') {
      res.status(401).json({ error: 'Unauthorized: missing x-api-key header' });
      return;
    }

    const requiredBuf = Buffer.from(requiredKey);
    const providedBuf = Buffer.from(providedKey);
    const matches =
      requiredBuf.length === providedBuf.length && crypto.timingSafeEqual(requiredBuf, providedBuf);

    if (!matches) {
      res.status(401).json({ error: 'Unauthorized: invalid x-api-key header' });
      return;
    }

    next();
  };

  // Protected Operator REST endpoints
  app.post('/start', apiKeyAuth, startHandler);
  app.post('/send', apiKeyAuth, sendHandler);
  app.get('/status', apiKeyAuth, statusHandler);
  app.post('/status', apiKeyAuth, statusHandler);
  app.post('/reset', apiKeyAuth, resetHandler);
}

