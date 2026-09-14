import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

let tableReady = false;

async function ensureAttributionTable(): Promise<void> {
  if (tableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS campaign_attributions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
      contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
      phone text NOT NULL,
      channel text NOT NULL DEFAULT 'whatsapp',
      sent_at timestamp NOT NULL,
      responded_at timestamp,
      booked_at timestamp,
      estimated_value_cents integer NOT NULL DEFAULT 0,
      realized_value_cents integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, campaign_id, phone, channel)
    );
    CREATE INDEX IF NOT EXISTS campaign_attributions_tenant_campaign_idx
      ON campaign_attributions (tenant_id, campaign_id);
    CREATE INDEX IF NOT EXISTS campaign_attributions_tenant_phone_idx
      ON campaign_attributions (tenant_id, phone);
  `);
  tableReady = true;
}

export type CampaignAttributionSummary = {
  campaignId: string;
  sent: number;
  responded: number;
  booked: number;
  estimatedRevenueCents: number;
  realizedRevenueCents: number;
};

export async function reconcileCampaignAttribution(tenantId: string): Promise<CampaignAttributionSummary[]> {
  await ensureAttributionTable();

  // Materialise campaign sends from the existing WhatsApp outbox history.
  // This is intentionally derived from completed jobs, so the attribution
  // ledger never claims a message was sent merely because a campaign was created.
  await db.execute(sql`
    INSERT INTO campaign_attributions (tenant_id, campaign_id, contact_id, phone, channel, sent_at)
    SELECT
      j.tenant_id,
      (j.payload ->> 'campaignId')::uuid,
      c.id,
      j.payload ->> 'to',
      'whatsapp',
      j.updated_at
    FROM jobs j
    LEFT JOIN contacts c
      ON c.tenant_id = j.tenant_id
     AND c.phone = j.payload ->> 'to'
    WHERE j.tenant_id = ${tenantId}
      AND j.type = 'send_whatsapp'
      AND j.status = 'done'
      AND j.payload ->> 'campaignId' IS NOT NULL
    ON CONFLICT (tenant_id, campaign_id, phone, channel) DO UPDATE
      SET contact_id = COALESCE(campaign_attributions.contact_id, EXCLUDED.contact_id),
          sent_at = LEAST(campaign_attributions.sent_at, EXCLUDED.sent_at);
  `);

  // Attribute the first inbound WhatsApp response after each campaign send.
  await db.execute(sql`
    UPDATE campaign_attributions a
    SET responded_at = x.responded_at
    FROM (
      SELECT a2.id, MIN(m.created_at) AS responded_at
      FROM campaign_attributions a2
      JOIN contacts c
        ON c.tenant_id = a2.tenant_id
       AND c.phone = a2.phone
      JOIN conversations conv
        ON conv.tenant_id = a2.tenant_id
       AND conv.contact_id = c.id
      JOIN messages m
        ON m.conversation_id = conv.id
       AND m.tenant_id = a2.tenant_id
       AND m.direction = 'inbound'
       AND m.created_at >= a2.sent_at
      WHERE a2.tenant_id = ${tenantId}
        AND a2.responded_at IS NULL
      GROUP BY a2.id
    ) x
    WHERE a.id = x.id;
  `);

  // Attribute the first non-cancelled booking after the send. Exact realised
  // revenue is copied only when the revenue engine has a realised amount for
  // the same WhatsApp conversation; otherwise the booking contributes a
  // transparent estimated value based on party size.
  const averageCheckCents = (() => {
    const value = Number(process.env.REVENUE_AVG_CHECK_CENTS || process.env.DEFAULT_AVG_CHECK_CENTS);
    return Number.isFinite(value) && value > 0 ? Math.round(value) : 35_000;
  })();

  await db.execute(sql`
    UPDATE campaign_attributions a
    SET
      booked_at = x.booked_at,
      estimated_value_cents = x.estimated_value_cents,
      realized_value_cents = x.realized_value_cents
    FROM (
      SELECT DISTINCT ON (a2.id)
        a2.id,
        r.created_at AS booked_at,
        (GREATEST(COALESCE(r.party_size, 1), 1) * ${averageCheckCents})::integer AS estimated_value_cents,
        COALESCE((
          SELECT SUM(re.realized_cents)::integer
          FROM revenue_events re
          WHERE re.tenant_id = a2.tenant_id
            AND re.conversation_id = r.conversation_id
        ), 0) AS realized_value_cents
      FROM campaign_attributions a2
      JOIN reservations r
        ON r.tenant_id = a2.tenant_id
       AND (r.customer_phone = a2.phone OR r.contact_id = a2.contact_id)
       AND r.created_at >= a2.sent_at
       AND r.status <> 'cancelled'
      WHERE a2.tenant_id = ${tenantId}
        AND a2.booked_at IS NULL
      ORDER BY a2.id, r.created_at ASC
    ) x
    WHERE a.id = x.id;
  `);

  const rows = await db.execute(sql`
    SELECT
      campaign_id AS "campaignId",
      COUNT(*)::integer AS sent,
      COUNT(responded_at)::integer AS responded,
      COUNT(booked_at)::integer AS booked,
      COALESCE(SUM(estimated_value_cents), 0)::integer AS "estimatedRevenueCents",
      COALESCE(SUM(realized_value_cents), 0)::integer AS "realizedRevenueCents"
    FROM campaign_attributions
    WHERE tenant_id = ${tenantId}
    GROUP BY campaign_id
    ORDER BY MAX(sent_at) DESC
  `);

  return rows.rows as CampaignAttributionSummary[];
}

export async function getCampaignAttributionSummary(tenantId: string, campaignId: string): Promise<CampaignAttributionSummary> {
  await ensureAttributionTable();
  const rows = await db.execute(sql`
    SELECT
      ${campaignId}::uuid AS "campaignId",
      COUNT(*)::integer AS sent,
      COUNT(responded_at)::integer AS responded,
      COUNT(booked_at)::integer AS booked,
      COALESCE(SUM(estimated_value_cents), 0)::integer AS "estimatedRevenueCents",
      COALESCE(SUM(realized_value_cents), 0)::integer AS "realizedRevenueCents"
    FROM campaign_attributions
    WHERE tenant_id = ${tenantId} AND campaign_id = ${campaignId}::uuid
  `);
  return rows.rows[0] as CampaignAttributionSummary;
}
