import { db } from '@/lib/db';
import { systemSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptSecret, resolveCronJobApiKey, type CronKeyResolution } from './key-store.ts';

/**
 * Server-side bridge for the cron key store: reads/writes the encrypted
 * cron-job.org API key on system_settings. The crypto + resolution policy
 * live framework-free in ./key-store.ts (unit-tested there).
 */

async function getSettingsRow() {
  return db.query.systemSettings.findFirst().catch((err) => {
    console.error('[cron-key] failed to read system_settings', err);
    return null;
  });
}

/** Save (encrypt-at-rest) the cron-job.org API key. Super-admin callers only. */
export async function saveCronJobApiKey(plaintext: string): Promise<void> {
  const cipher = encryptSecret(plaintext.trim(), process.env.CRON_SECRET);
  const row = await db.query.systemSettings.findFirst();
  if (row) {
    await db
      .update(systemSettings)
      .set({ cronjobApiKey: cipher, updatedAt: new Date() })
      .where(eq(systemSettings.id, row.id));
  } else {
    await db.insert(systemSettings).values({ cronjobApiKey: cipher });
  }
}

/** Is a cron-job.org key configured (DB or env)? Never reveals the value. */
export async function cronKeyConfigured(): Promise<{ configured: boolean; source: 'database' | 'environment' | 'none' }> {
  const resolution = await resolveStoredCronJobApiKey();
  return { configured: resolution.key !== null, source: resolution.source };
}

/** Resolve the key: database first, environment fallback. */
export async function resolveStoredCronJobApiKey(): Promise<CronKeyResolution> {
  const row = await getSettingsRow();
  return resolveCronJobApiKey({
    storedCipher: row?.cronjobApiKey ?? null,
    cronSecret: process.env.CRON_SECRET,
    envKey: process.env.CRONJOB_API_KEY,
  });
}
