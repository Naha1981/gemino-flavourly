import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, marketingCampaigns, tenants, waAccounts, jobs } from '@/lib/db/schema';
import { selectBirthdayRewards, type BirthdayContactLike } from './birthday-rewards';

export interface BirthdayCronResult {
  candidates: number;
  rewarded: number;
  skippedBlocked: number;
  samples: Array<{ tenantId: string; customerName: string; daysUntilBirthday: number }>;
}

/**
 * Birthday reward processor.
 *
 * For each tenant, load contacts with a birthday in the next 7 days, generate
 * a personalised offer, and hand it to the outbox via a `send_whatsapp` job
 * (same path as everything else) so delivery is honest and retried. POPIA:
 * blocklisted contacts are never messaged.
 */
export async function runBirthdayRewards(now = new Date()): Promise<BirthdayCronResult> {
  const allTenants = await db.select({ id: tenants.id, name: tenants.name }).from(tenants);
  const result: BirthdayCronResult = { candidates: 0, rewarded: 0, skippedBlocked: 0, samples: [] };

  for (const tenant of allTenants) {
    const rows = await db
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenant.id), isNull(contacts.blocklisted)));

    const like: BirthdayContactLike[] = rows.map((c) => ({
      id: c.id,
      customerPhone: c.phone,
      customerName: c.name ?? 'friend',
      birthday: c.birthday,
      blocklisted: c.blocklisted,
    }));

    const rewards = selectBirthdayRewards(like, now);
    if (rewards.length === 0) continue;
    result.candidates += rewards.length;

    const sender = await db
      .select({ id: waAccounts.id, phoneNumber: waAccounts.phoneNumber })
      .from(waAccounts)
      .where(and(eq(waAccounts.tenantId, tenant.id), eq(waAccounts.isConnected, true)))
      .limit(1);
    if (!sender?.id) {
      // No connected WhatsApp to send from — record but don't queue.
      result.skippedBlocked += rewards.length;
      continue;
    }

    for (const reward of rewards) {
      const [campaign] = await db
        .insert(marketingCampaigns)
        .values({
          tenantId: tenant.id,
          name: `Birthday reward — ${reward.customerName}`,
          description: `Auto-generated birthday reward (${reward.daysUntilBirthday} day(s) out).`,
          type: 'promotion',
          targetSegment: 'vip',
          offer: reward.offer,
          message: reward.message,
          startDate: now,
          status: 'scheduled',
        })
        .returning();

      // Hand the offer to the outbox (guaranteed, retried delivery).
      await db
        .insert(jobs)
        .values({
          tenantId: tenant.id,
          type: 'send_whatsapp',
          payload: {
            waAccountId: sender.id,
            to: reward.customerPhone,
            text: reward.message,
            campaignId: campaign.id,
          },
          status: 'pending',
          maxAttempts: 5,
          nextRunAt: new Date(),
        })
        .catch((err) => console.error('[birthday] failed to queue reward message', err));

      result.rewarded++;
      result.samples.push({ tenantId: tenant.id, customerName: reward.customerName, daysUntilBirthday: reward.daysUntilBirthday });
    }
  }

  return result;
}
