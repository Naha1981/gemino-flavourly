import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export async function recordWebhookEvent(input: {
  tenantId?: string | null;
  source: string;
  eventType: string;
  signatureValid: boolean;
  payload?: unknown;
}) {
  await db.execute(sql`
    INSERT INTO webhook_events (tenant_id, source, event_type, signature_valid, payload)
    VALUES (${input.tenantId ?? null}, ${input.source}, ${input.eventType}, ${input.signatureValid}, ${input.payload ? JSON.stringify(input.payload) : null}::jsonb)
  `).catch((error) => console.error('[Webhook Audit] failed to persist event', error));
}
