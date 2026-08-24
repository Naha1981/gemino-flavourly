import crypto from 'node:crypto';

/**
 * Gate #11 — at-rest protection for the tenant's Google API key.
 *
 * `google_places_config.api_key_encrypted` stores the key that authorizes
 * review pulls for that tenant. A plaintext API key in the database would
 * be readable by anyone with SQL access (a leaked support dump, a careless
 * SELECT * in a debugging session) — and unlike a password it cannot be
 * meaningfully hashed, because the cron must present the ORIGINAL key to
 * Google on every fetch. So: authenticated encryption (AES-256-GCM), with
 * the master key held in the deployment environment, never in the DB.
 *
 * Format: "v1:<iv-b64>:<tag-b64>:<ciphertext-b64>"
 *
 * If REPUTATION_ENCRYPTION_KEY (or GOOGLE_PLACES_ENCRYPTION_KEY) is not
 * configured, the key is stored with a "plain:" prefix instead of throwing:
 * a tenant saving their config on a fresh deploy must not get a 500, and the
 * downgrade is explicit (and loud in the logs) rather than silent. Any
 * decrypt of a "plain:" value also warns once. Rotating the master key
 * leaves "v1:" rows undecryptable; decryptSecret then returns null and the
 * cron surfaces a per-tenant failure instead of guessing.
 */

const VERSION = 'v1';
const PLAIN_PREFIX = 'plain:';

let warnedAboutPlaintext = false;

function masterKey(): Buffer | null {
  const secret =
    process.env.REPUTATION_ENCRYPTION_KEY || process.env.GOOGLE_PLACES_ENCRYPTION_KEY || '';
  if (!secret) {
    if (!warnedAboutPlaintext) {
      warnedAboutPlaintext = true;
      console.error(
        '[reputation/secret-box] REPUTATION_ENCRYPTION_KEY is not set — Google API keys ' +
          'will be stored unencrypted. Set it in the deployment environment.'
      );
    }
    return null;
  }
  // Derive a fixed-length key from whatever secret shape the operator chose.
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const key = masterKey();
  if (!key) return PLAIN_PREFIX + plaintext;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/**
 * Returns the original secret, or null when the stored value cannot be
 * decrypted (wrong/rotated master key) — a null forces callers to surface
 * the failure instead of silently proceeding with garbage.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (typeof stored !== 'string' || !stored) return null;
  if (stored.startsWith(PLAIN_PREFIX)) return stored.slice(PLAIN_PREFIX.length);

  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  const key = masterKey();
  if (!key) {
    // Stored encrypted but no key configured in THIS environment: the value
    // is unrecoverable here. Surface it rather than falling back.
    return null;
  }

  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Round-trip helper for callers that just need "is this readable". */
export function isSecretReadable(stored: string | null | undefined): boolean {
  return decryptSecret(stored) !== null;
}
