import { createHash, randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type PublicApiContext = { tenantId: string; keyId: string };

export async function createApiKey(tenantId: string, name: string) {
  const secret = `flv_live_${randomBytes(24).toString('base64url')}`;
  const hash = createHash('sha256').update(secret).digest('hex');
  const prefix = secret.slice(0, 16);
  const result = await db.execute(sql`
    INSERT INTO api_keys (tenant_id, name, key_prefix, key_hash)
    VALUES (${tenantId}, ${name.trim() || 'API key'}, ${prefix}, ${hash})
    RETURNING id, name, key_prefix, created_at
  `);
  const row = ((result as any).rows?.[0] ?? (result as any)[0]);
  return { ...row, secret };
}

function hashKey(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export async function authenticatePublicApi(request: Request): Promise<PublicApiContext | null> {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  const secret = auth.slice(7).trim();
  if (!secret) return null;
  const keyHash = hashKey(secret);

  const result = await db.execute(sql`
    SELECT id, tenant_id, disabled, request_count, rate_limit_reset_at
    FROM api_keys
    WHERE key_hash = ${keyHash}
    LIMIT 1
  `);
  const row = ((result as any).rows?.[0] ?? (result as any)[0]);
  if (!row || row.disabled) return null;

  const now = new Date();
  const reset = row.rate_limit_reset_at ? new Date(row.rate_limit_reset_at) : null;
  const resetActive = reset && reset.getTime() > now.getTime();
  const count = Number(row.request_count ?? 0);
  if (resetActive && count >= 120) throw new Error('RATE_LIMITED');

  if (!resetActive) {
    await db.execute(sql`
      UPDATE api_keys
      SET request_count = 1, rate_limit_reset_at = ${new Date(now.getTime() + 60_000)}, last_used_at = NOW()
      WHERE id = ${row.id}
    `);
  } else {
    await db.execute(sql`
      UPDATE api_keys
      SET request_count = request_count + 1, last_used_at = NOW()
      WHERE id = ${row.id}
    `);
  }
  return { tenantId: String(row.tenant_id), keyId: String(row.id) };
}
