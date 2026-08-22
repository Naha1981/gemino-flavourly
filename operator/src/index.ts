import express from 'express';
import { config } from 'dotenv';
config();

import { setupRoutes } from './routes/index.js';
import { resumeConnectedAccounts } from './whatsapp/index.js';
import { pool } from './db/client.js';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint for Render / synthetic monitoring.
// Previously returned 200 unconditionally without touching anything —
// the synthetic monitor and Render's own healthcheck would report green
// even if Postgres (which every route depends on for session state,
// tenant lookups, everything) was completely unreachable. Now actually
// verifies the DB connection is alive.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).send('OK');
  } catch (err: any) {
    logger.error({ err }, 'Health check failed: database unreachable');
    res.status(503).json({ status: 'error', reason: 'database unreachable' });
  }
});

// Setup protected API routes
setupRoutes(app);

const PORT = Number(process.env.PORT) || 3001;

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Gemino WhatsApp Operator Engine listening on port ${PORT}`);
  logger.info(`🔗 Health check available at GET /health`);
});

// Reconnect any accounts that were live before this instance restarted.
resumeConnectedAccounts().catch((err) => {
  logger.error(`Failed to resume connected accounts on boot: ${err.message}`);
});

// Render redeploys/restarts send SIGTERM. Without handling it, the
// process is killed immediately — including mid-write of a session
// credential to Postgres — risking a corrupted WhatsApp session that
// then needs a full QR re-scan. This gives in-flight work a brief window
// to finish before the process actually exits.
function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    pool
      .end()
      .catch((err) => logger.error({ err }, 'Error closing DB pool'))
      .finally(() => process.exit(0));
  });
  // Hard exit if graceful shutdown hangs for any reason.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

