import crypto from 'crypto';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { decryptSecret } from '@/lib/reputation/secret-box';

export async function emitWebhookEvent(tenantId: string, eventType: string, payload: Record<string, unknown>) {
  const result = await db.execute(sql`
    SELECT id, events, enabled
    FROM webhook_endpoints
    WHERE tenant_id = ${tenantId} AND enabled = true
  `);
  const endpoints = (result as any).rows ?? result as any[];
  for (const endpoint of endpoints) {
    const events = Array.isArray(endpoint.events) ? endpoint.events : ['*'];
    if (!events.includes('*') && !events.includes(eventType)) continue;
    await db.execute(sql`
      INSERT INTO webhook_deliveries (endpoint_id, event_type, payload, status, attempts, next_run_at)
      VALUES (${endpoint.id}, ${eventType}, ${JSON.stringify(payload)}::jsonb, 'pending', 0, NOW())
    `);
  }
}

export async function deliverWebhookBatch(limit = 25) {
  const result = await db.execute(sql`
    SELECT d.id, d.endpoint_id, d.event_type, d.payload, d.attempts,
           e.url, e.secret_encrypted
    FROM webhook_deliveries d
    JOIN webhook_endpoints e ON e.id = d.endpoint_id
    WHERE d.status = 'pending' AND d.next_run_at <= NOW() AND e.enabled = true
    ORDER BY d.created_at
    LIMIT ${limit}
  `);
  const rows = (result as any).rows ?? result as any[];
  let delivered = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const secret = decryptSecret(row.secret_encrypted) ?? '';
      const body = JSON.stringify(row.payload);
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
      const response = await fetch(row.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nahalabs-webhook-signature': signature },
        body,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await db.execute(sql`
        UPDATE webhook_deliveries
        SET status='delivered', attempts=attempts+1, response_code=${response.status}, delivered_at=NOW()
        WHERE id=${row.id}
      `);
      delivered += 1;
    } catch (error) {
      const attempts = Number(row.attempts ?? 0) + 1;
      const delayMs = Math.min(60 * 60 * 1000, 2 ** Math.min(attempts, 8) * 1000);
      await db.execute(sql`
        UPDATE webhook_deliveries
        SET attempts=${attempts},
            status=${attempts >= 8 ? 'dead' : 'pending'},
            last_error=${error instanceof Error ? error.message : String(error)},
            next_run_at=${new Date(Date.now() + delayMs)}
        WHERE id=${row.id}
      `);
      failed += 1;
    }
  }
  return { delivered, failed, scanned: rows.length };
}
