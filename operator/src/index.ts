import express from 'express';
import { config } from 'dotenv';
config();

import pino from 'pino';
import { validateConfig } from './config.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Fail fast, before anything else is imported or any port is bound.
//
// This runs ahead of the ./db/client.js and ./whatsapp/index.js imports
// below on purpose: importing db/client.js constructs a pg Pool from
// DATABASE_URL as a side effect, so validating after it would mean
// building a connection pool from configuration already known to be
// broken. Static `import` statements are hoisted and evaluated before
// any top-level statement runs, so the remaining imports are deliberately
// dynamic (`await import(...)`) rather than declared at the top of the
// file — that is what allows them to run AFTER this check.
//
// Logs variable NAMES only — never a value.
const configCheck = validateConfig(process.env);
if (!configCheck.ok) {
  logger.fatal(configCheck.error);
  process.exit(1);
}

const { setupRoutes } = await import('./routes/index.js');
const { resumeConnectedAccounts } = await import('./whatsapp/index.js');
const { pool } = await import('./db/client.js');

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

