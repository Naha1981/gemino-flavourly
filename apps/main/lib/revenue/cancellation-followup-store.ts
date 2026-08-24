import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, conversations, jobs, reservations, tenants, waAccounts } from '@/lib/db/schema';
import type { CancellationFollowupStore, CancelledReservation, FollowupRecipient } from './cancellation-followup.ts';

/**
 * Drizzle adapter for the cancellation follow-up in
 * ./cancellation-followup.ts — the only module that reads or writes these
 * rows. Imported by the cron route; nothing in `lib/**.test.ts` may import
 * it, because `@/lib/db` throws at import time without DATABASE_URL.
 *
 * Schedule: every 6 hours (cron-job.org, added manually — the same place the
 * daily brief and outbox jobs are scheduled). Auth is the shared CRON_SECRET
 * bearer guard every other cron uses.
 */
export const drizzleCancellationFollowupStore: CancellationFollowupStore = {
  /**
   * Cancelled reservations whose 24h follow-up is due.
   *
   * Also excludes, in SQL rather than in the app, the two audiences that
   * must never receive an automated message: contacts who opted out with
   * "STOP" (POPIA — see lib/opt-in-out.ts) and tenants whose AI is switched
   * off or who are in manual takeover. A LEFT JOIN keeps reservations whose
   * contact row is gone (`contact_id` is `ON DELETE SET NULL`); they fall
   * back to the phone number stored on the reservation itself.
   */
  async findDueCancellations({ cancelledBefore, cancelledAfter, limit }): Promise<CancelledReservation[]> {
    const rows = await db
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        customerName: reservations.customerName,
        customerPhone: reservations.customerPhone,
        contactId: reservations.contactId,
        conversationId: reservations.conversationId,
        reservationDate: reservations.date,
        partySize: reservations.partySize,
        cancelledAt: reservations.cancelledAt,
      })
      .from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .where(
        and(
          eq(reservations.status, 'cancelled'),
          isNotNull(reservations.cancelledAt),
          eq(reservations.cancellationFollowupSent, false),
          lt(reservations.cancelledAt, cancelledBefore),
          gt(reservations.cancelledAt, cancelledAfter),
          eq(tenants.aiEnabled, true),
          eq(tenants.manualMode, false),
          or(isNull(contacts.id), eq(contacts.blocklisted, false))
        )
      )
      // Oldest cancellation first, so a backlog drains in the order customers
      // are waiting rather than in whatever order Postgres returns rows.
      .orderBy(reservations.cancelledAt)
      .limit(limit);

    // `cancelled_at IS NOT NULL` is in the WHERE clause, but the column is
    // nullable in the schema, so narrow it here rather than casting.
    return rows.flatMap((row) => {
      if (!row.cancelledAt) return [];
      return [
        {
          id: row.id,
          tenantId: row.tenantId,
          customerName: row.customerName,
          customerPhone: row.customerPhone,
          contactId: row.contactId,
          conversationId: row.conversationId,
          reservationDate: row.reservationDate,
          partySize: row.partySize,
          cancelledAt: row.cancelledAt,
        },
      ];
    });
  },

  /**
   * Where to send, and who to greet.
   *
   * Number: the contact the conversation happened with, else the phone
   * number captured on the reservation. Account: the WhatsApp account that
   * owned the conversation, else the tenant's connected account (a booking
   * taken over the phone or in person has no conversation). Name: the
   * contact's name, else the name on the reservation.
   */
  async findRecipient(reservation): Promise<FollowupRecipient | null> {
    const conversation = reservation.conversationId
      ? await db.query.conversations.findFirst({
          where: eq(conversations.id, reservation.conversationId),
          with: { contact: true },
        })
      : null;

    const contact = reservation.contactId
      ? await db.query.contacts.findFirst({
          where: and(eq(contacts.id, reservation.contactId), eq(contacts.blocklisted, false)),
        })
      : conversation?.contact && !conversation.contact.blocklisted
        ? conversation.contact
        : null;

    const to = contact?.phone || reservation.customerPhone;
    if (!to) return null;

    let waAccountId = conversation?.waAccountId;
    if (!waAccountId) {
      const account = await db.query.waAccounts.findFirst({
        where: and(eq(waAccounts.tenantId, reservation.tenantId), eq(waAccounts.isConnected, true)),
      });
      waAccountId = account?.id;
    }
    if (!waAccountId) return null;

    return { to, waAccountId, name: contact?.name || reservation.customerName };
  },

  /**
   * Hand the message to the outbox rather than calling the operator
   * directly: the outbox owns retries, stuck-job recovery and delivery
   * state, and a follow-up that dies on a transient operator error should
   * be retried, not lost.
   */
  async queueFollowup({ tenantId, waAccountId, to, text }): Promise<void> {
    await db.insert(jobs).values({
      tenantId,
      type: 'send_whatsapp',
      payload: { waAccountId, to, text },
      status: 'pending',
      nextRunAt: new Date(),
    });
  },

  async markFollowupSent(reservationId, sentAt): Promise<void> {
    await db
      .update(reservations)
      .set({ cancellationFollowupSent: true, cancellationFollowupSentAt: sentAt })
      .where(eq(reservations.id, reservationId));
  },

  async cancelReservation(reservationId, cancelledAt): Promise<void> {
    await db.update(reservations).set({ status: 'cancelled', cancelledAt }).where(eq(reservations.id, reservationId));
  },
};
