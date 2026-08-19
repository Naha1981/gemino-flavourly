import { Express, Request, Response, NextFunction } from 'express';
import { startHandler } from './start.js';
import { sendHandler } from './send.js';
import { statusHandler } from './status.js';

export function setupRoutes(app: Express) {
  // Authentication middleware using OPERATOR_API_KEY
  const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['x-api-key'] || req.query.apiKey;
    const requiredKey = process.env.OPERATOR_API_KEY;

    if (requiredKey && key !== requiredKey) {
      return res.status(401).json({ error: 'Unauthorized: Invalid x-api-key header' });
    }
    next();
  };

  // Protected Operator REST endpoints
  app.post('/start', apiKeyAuth, startHandler);
  app.post('/send', apiKeyAuth, sendHandler);
  app.get('/status', apiKeyAuth, statusHandler);
  app.post('/status', apiKeyAuth, statusHandler);
}
