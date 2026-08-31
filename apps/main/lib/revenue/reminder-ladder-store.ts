import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contacts,
  conversations,
  reservations,
  tenants,
  waAccounts,
  jobs,
} from '@/lib/db/schema';
import type {
  ReminderCandidate,
  ReminderRecipient,
  ReminderStore,
} from './reminder-ladder';
import { rungSentField, type ReminderRung } from './reminder-ladder';

/**
 * Drizzle adapter for the 48/24/6h reminder ladder — the only module that
 * reads or writes these rows. Imported by the cron route; test files may
 * not import it (`@/lib/db` throws without DATABASE_URL), same contract as
 * every other store adapter in this repo.
 *
 * Every audience that must never see an automated reminder is excluded in
 * SQL, not in the app: opted-out contacts (POPIA), AI-off / manual-mode
 * tenants, conversations under manual takeover, and anything that is not a
 * confirmed future booking. A LEFT JOIN keeps reservations whose contact or
 * conversation row is gone (both `ON DELETE SET NULL`); those fall back to
 * the phone number stored on the reservation itself.
 */
export const drizzleReminderStore: ReminderStore = {
  async findReminderCandidates({ from, to, limit }): Promise<ReminderCandidate[]> {
    const rows = await db
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        restaurantName: tenants.name,
        customerName: reservations.customerName,
        customerPhone: reservations.customerPhone,
        contactId: reservations.contactId,
        conversationId: reservations.conversationId,
        reservationDate: reservations.date,
        partySize: reservations.partySize,
        reminder48SentAt: reservations.reminder48SentAt,
        reminder24SentAt: reservations.reminder24SentAt,
        reminder6SentAt: reservations.reminder6SentAt,
      })
      .from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .leftJoin(conversations, eq(conversations.id, reservations.conversationId))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          gt(reservations.date, from),
          lt(reservations.date, to),
          eq(tenants.aiEnabled, true),
          eq(tenants.manualMode, false),
          or(isNull(contacts.id), eq(contacts.blocklisted, false)),
          or(isNull(conversations.id), eq(conversations.manualTakeover, false))
        )
      )
      .orderBy(asc(reservations.date))
      .limit(limit);

    return rows;
  },

  /**
   * Atomic rung claim: only the call that flips NULL→timestamp wins.
   * Overlapping cron runs (15-minute schedule, serverless overlap) see
   * zero rows updated and skip — no guest is ever double-reminded.
   */
  async claimReminderRung(reservationId, rung: ReminderRung, sentAt): Promise<boolean> {
    const field = rungSentField(rung);
    const claimed = await db
      .update(reservations)
      .set({ [field]: sentAt })
      .where(and(eq(reservations.id, reservationId), isNull(reservations[field])))
      .returning({ id: reservations.id });
    return claimed.length > 0;
  },

  /**
   * Where to send: same resolution order as the no-show store — the
   * conversation's WhatsApp account, else the tenant's connected account;
   * the contact's phone, else the phone captured on the reservation.
   * Always THIS reservation's tenant, so one restaurant's reminder can
   * never be routed through another's number. Manual-takeover threads and
   * opted-out contacts return null (the rung stays claimable).
   */
  async findRecipient(candidate): Promise<ReminderRecipient | null> {
    const conversation = candidate.conversationId
      ? await db.query.conversations.findFirst({
          where: eq(conversations.id, candidate.conversationId),
          with: { contact: true },
        })
      : null;

    if (conversation?.manualTakeover) return null;

    const contact = candidate.contactId
      ? await db.query.contacts.findFirst({
          where: and(eq(contacts.id, candidate.contactId), eq(contacts.blocklisted, false)),
        })
      : conversation?.contact && !conversation.contact.blocklisted
        ? conversation.contact
        : null;

    const to = contact?.phone || candidate.customerPhone;
    if (!to) return null;

    let waAccountId = conversation?.waAccountId;
    if (!waAccountId) {
      const account = await db.query.waAccounts.findFirst({
        where: and(eq(waAccounts.tenantId, candidate.tenantId), eq(waAccounts.isConnected, true)),
      });
      waAccountId = account?.id;
    }
    if (!waAccountId) return null;

    return { to, waAccountId, name: contact?.name || candidate.customerName };
  },

  /** Outbox delivery: retries, backoff and delivery state are its job. */
  async queueReminder({ tenantId, waAccountId, to, text }): Promise<void> {
    await db.insert(jobs).values({
      tenantId,
      type: 'send_whatsapp',
      payload: { waAccountId, to, text },
      status: 'pending',
      nextRunAt: sql`NOW()`,
    });
  },
};
