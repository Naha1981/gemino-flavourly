import crypto from 'node:crypto';

/**
 * Cron fleet manager — secret storage.
 *
 * The cron-job.org API key is saved from the /admin UI into
 * system_settings.cronjob_api_key so fleet sync never depends on Vercel
 * env-var redeploy cycles. The key is encrypted at rest with AES-256-GCM;
 * the wrapping key is derived from CRON_SECRET (always configured in every
 * environment that runs cron routes). Framework-free so the crypto and the
 * resolution policy are unit-testable directly.
 */

const PREFIX = 'enc:v1:';

/** Derive a stable 32-byte AES key from the platform cron secret. */
export function deriveWrappingKey(cronSecret: string): Buffer {
  return crypto.createHash('sha256').update(`flavourly-cronkey:${cronSecret}`).digest();
}

/**
 * Encrypt a secret. Output format: enc:v1:<iv b64>:<tag b64>:<ciphertext b64>.
 * Throws if the wrapping secret is missing — we never store plaintext.
 */
export function encryptSecret(plaintext: string, cronSecret: string | undefined): string {
  if (!cronSecret) throw new Error('CRON_SECRET is not configured — cannot encrypt');
  if (!plaintext) throw new Error('refusing to encrypt an empty key');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveWrappingKey(cronSecret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a stored secret. Returns null on ANY failure (tampered payload,
 * wrong wrapping key, malformed shape) — callers fall back to the env var.
 */
export function decryptSecret(payload: string | null | undefined, cronSecret: string | undefined): string | null {
  if (!payload || !cronSecret) return null;
  if (!payload.startsWith(PREFIX)) return null;
  try {
    const parts = payload.split(':');
    // Format: enc : v1 : iv : tag : ciphertext
    if (parts.length !== 5) return null;
    const [, , ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      deriveWrappingKey(cronSecret),
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}

export interface CronKeyResolutionInput {
  /** Encrypted value stored in system_settings (may be null/empty). */
  storedCipher: string | null | undefined;
  /** CRON_SECRET used as the wrapping key. */
  cronSecret: string | undefined;
  /** process.env.CRONJOB_API_KEY fallback. */
  envKey: string | undefined;
}

export interface CronKeyResolution {
  key: string | null;
  source: 'database' | 'environment' | 'none';
}

/**
 * Pure resolution policy: DATABASE FIRST, environment fallback. A stored
 * value that fails to decrypt is treated as absent (fall back), never as an
 * error that blocks the sync.
 */
export function resolveCronJobApiKey(input: CronKeyResolutionInput): CronKeyResolution {
  const fromDb = decryptSecret(input.storedCipher, input.cronSecret);
  if (fromDb) return { key: fromDb, source: 'database' };
  if (input.envKey && input.envKey.trim()) return { key: input.envKey.trim(), source: 'environment' };
  return { key: null, source: 'none' };
}
