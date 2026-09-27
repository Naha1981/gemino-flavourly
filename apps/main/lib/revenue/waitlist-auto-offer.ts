import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type WaitlistOfferSummary = {
  expired: number;
  offered: number;
  skipped: number;
};

export async function runWaitlistAutoOffer(now = new Date()): Promise<WaitlistOfferSummary> {
  const expiredResult = await db.execute(sql`
    UPDATE waitlist_entries
    SET status = 'expired'
    WHERE status = 'offered'
      AND offer_expires_at IS NOT NULL
      AND offer_expires_at <= ${now}
    RETURNING id
  `);

  const cancelled = await db.execute(sql`
    SELECT r.id, r.tenant_id, r.party_size, r.cancelled_at,
           COALESCE(r.customer_name, c.name, 'Guest') AS customer_name
    FROM reservations r
    LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE r.status = 'cancelled'
      AND r.cancelled_at IS NOT NULL
      AND r.cancelled_at > (${now}::timestamp - interval '20 minutes')
      AND NOT EXISTS (
        SELECT 1 FROM waitlist_entries w
        WHERE w.offer_reservation_id = r.id
      )
    ORDER BY r.cancelled_at ASC
    LIMIT 50
  `);

  let offered = 0;
  let skipped = 0;

  for (const row of ((cancelled as any).rows ?? cancelled as any[])) {
    const candidate = await db.execute(sql`
      SELECT w.id, w.tenant_id, w.contact_id, w.customer_phone,
             c.blocklisted,
             wa.id AS wa_account_id
      FROM waitlist_entries w
      JOIN contacts c ON c.id = w.contact_id
      LEFT JOIN wa_accounts wa ON wa.tenant_id = w.tenant_id AND wa.is_connected = true
      WHERE w.tenant_id = ${row.tenant_id}
        AND w.status = 'waiting'
        AND w.party_size = ${Number(row.party_size)}
        AND COALESCE(c.blocklisted, false) = false
      ORDER BY w.created_at ASC
      LIMIT 1
    `);
    const entry = ((candidate as any).rows ?? candidate as any[])[0];
    if (!entry?.id || !entry.wa_account_id || !entry.customer_phone) {
      skipped += 1;
      continue;
    }

    const expires = new Date(now.getTime() + 15 * 60 * 1000);
    const updated = await db.execute(sql`
      UPDATE waitlist_entries
      SET status = 'offered',
          notified_at = ${now},
          offer_reservation_id = ${row.id},
          offer_expires_at = ${expires}
      WHERE id = ${entry.id}
        AND status = 'waiting'
      RETURNING id
    `);
    const claimed = ((updated as any).rows ?? updated as any[]).length > 0;
    if (!claimed) continue;

    const text = `Hi! A table has just opened at the restaurant for your party of ${Number(row.party_size)}. Reply YES within 15 minutes to claim it.`;
    await db.execute(sql`
      INSERT INTO jobs (id, tenant_id, type, payload, status, next_run_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(), ${row.tenant_id}, 'send_whatsapp',
        jsonb_build_object(
          'waAccountId', ${entry.wa_account_id},
          'to', ${entry.customer_phone},
          'text', ${text},
          'automated', true,
          'waitlistEntryId', ${entry.id},
          'offerReservationId', ${row.id}
        ),
        'pending', NOW(), NOW(), NOW()
      )
    `);
    offered += 1;
  }

  return {
    expired: Number((expiredResult as any).rowCount ?? (expiredResult as any).rows?.length ?? 0),
    offered,
    skipped,
  };
}

export async function acceptWaitlistOffer(tenantId: string, contactId: string): Promise<{ reservationId: string } | null> {
  const result = await db.execute(sql`
    SELECT w.offer_reservation_id AS reservation_id, w.id
    FROM waitlist_entries w
    WHERE w.tenant_id = ${tenantId}
      AND w.contact_id = ${contactId}
      AND w.status = 'offered'
      AND w.offer_expires_at > NOW()
    ORDER BY w.notified_at DESC
    LIMIT 1
  `);
  const row = ((result as any).rows ?? result as any[])[0];
  if (!row?.reservation_id) return null;

  await db.execute(sql`
    UPDATE waitlist_entries
    SET status = 'accepted'
    WHERE id = ${row.id}
  `);
  return { reservationId: String(row.reservation_id) };
}
