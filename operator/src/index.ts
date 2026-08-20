import express from 'express';
import { config } from 'dotenv';
config();

import { setupRoutes } from './routes/index.js';
import { resumeConnectedAccounts } from './whatsapp/index.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Render / synthetic monitoring
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Setup protected API routes
setupRoutes(app);

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Gemino WhatsApp Operator Engine listening on port ${PORT}`);
  logger.info(`🔗 Health check available at GET /health`);
});

// Reconnect any accounts that were live before this instance restarted.
resumeConnectedAccounts().catch((err) => {
  logger.error(`Failed to resume connected accounts on boot: ${err.message}`);
});
