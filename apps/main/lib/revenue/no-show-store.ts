import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, conversations, jobs, reservations, tenants, waAccounts } from '@/lib/db/schema';
import type {
  NoShowCandidate,
  NoShowFollowupCandidate,
  NoShowRecipient,
  NoShowStore,
} from './no-show.ts';

/**
 * Drizzle adapter for the no-show monitoring in ./no-show.ts — the only
 * module that reads or writes these rows. Imported by the cron route;
 * nothing in `lib/**.test.ts` may import it, because `@/lib/db` throws at
 * import time without DATABASE_URL.
 *
 * Schedule: every 30 minutes (cron-job.org, added manually — the same
 * place the daily brief and outbox jobs are scheduled). Auth is the shared
 * CRON_SECRET bearer guard every other cron uses.
 *
 * Both scans exclude, in SQL rather than in the app, every audience that
 * must never see an automated message: contacts who opted out with "STOP"
 * (POPIA — see lib/opt-in-out.ts), tenants whose AI is switched off or who
 * are in manual mode, and conversations under manual takeover — staff are
 * already talking to that customer, and an automated "we missed you"
 * landing mid-conversation reads as surveillance. A LEFT JOIN keeps
 * reservations whose contact or conversation row is gone (both are
 * `ON DELETE SET NULL`); they fall back to the phone number stored on the
 * reservation itself.
 */
export const drizzleNoShowStore: NoShowStore = {
  /**
   * Confirmed bookings past the detection cutoff that have not been
   * flagged yet. Oldest booking first, so a backlog drains in the order
   * the tables were missed rather than in whatever order Postgres returns
   * rows.
   */
  async findNoShowCandidates({ cutoff, limit }): Promise<NoShowCandidate[]> {
    const rows = await db
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        customerName: reservations.customerName,
        customerPhone: reservations.customerPhone,
        contactId: reservations.contactId,
        conversationId: reservations.conversationId,
        status: reservations.status,
        reservationDate: reservations.date,
        partySize: reservations.partySize,
        noShowDetected: reservations.noShowDetected,
      })
      .from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .leftJoin(conversations, eq(conversations.id, reservations.conversationId))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          eq(reservations.noShowDetected, false),
          lt(reservations.date, cutoff),
          eq(tenants.aiEnabled, true),
          eq(tenants.manualMode, false),
          or(isNull(contacts.id), eq(contacts.blocklisted, false)),
          or(isNull(conversations.id), eq(conversations.manualTakeover, false))
        )
      )
      .orderBy(reservations.date)
      .limit(limit);

    return rows;
  },

  async markNoShowDetected(reservationId, detectedAt): Promise<void> {
    await db
      .update(reservations)
      .set({ noShowDetected: true, noShowDetectedAt: detectedAt })
      .where(eq(reservations.id, reservationId));
  },

  /**
   * Flagged no-shows whose 2-hour follow-up delay has elapsed. Status is
   * re-required here, not just at detection time: a customer who walked
   * in 20 minutes late and was marked 'completed' during the gap must
   * never be told we missed them.
   */
  async findDueFollowups({ detectedBefore, limit }): Promise<NoShowFollowupCandidate[]> {
    const rows = await db
      .select({
        id: reservations.id,
        tenantId: reservations.tenantId,
        customerName: reservations.customerName,
        customerPhone: reservations.customerPhone,
        contactId: reservations.contactId,
        conversationId: reservations.conversationId,
        status: reservations.status,
        reservationDate: reservations.date,
        partySize: reservations.partySize,
        noShowDetected: reservations.noShowDetected,
        noShowDetectedAt: reservations.noShowDetectedAt,
        noShowFollowupSent: reservations.noShowFollowupSent,
      })
      .from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .leftJoin(conversations, eq(conversations.id, reservations.conversationId))
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          eq(reservations.noShowDetected, true),
          isNotNull(reservations.noShowDetectedAt),
          eq(reservations.noShowFollowupSent, false),
          lt(reservations.noShowDetectedAt, detectedBefore),
          eq(tenants.aiEnabled, true),
          eq(tenants.manualMode, false),
          or(isNull(contacts.id), eq(contacts.blocklisted, false)),
          or(isNull(conversations.id), eq(conversations.manualTakeover, false))
        )
      )
      // Oldest detection first, so customers who have been waiting the
      // longest for their rebooking offer get it first.
      .orderBy(reservations.noShowDetectedAt)
      .limit(limit);

    return rows;
  },

  /**
   * Where to send, and who to greet. Same resolution order as Gate #3:
   * the contact the conversation happened with, else the contact linked on
   * the reservation, else the phone number captured on the reservation;
   * the WhatsApp account that owned the conversation, else the tenant's
   * connected account — always THIS reservation's tenant, so one
   * restaurant's offer can never be routed through another's number.
   *
   * Returns null for a conversation under manual takeover (staff own that
   * thread) or when there is no route to the customer; either way the row
   * stays unmarked and the next run retries, so ending the takeover lets
   * the offer catch up.
   */
  async findRecipient(reservation): Promise<NoShowRecipient | null> {
    const conversation = reservation.conversationId
      ? await db.query.conversations.findFirst({
          where: eq(conversations.id, reservation.conversationId),
          with: { contact: true },
        })
      : null;

    // Bow out of manual-takeover threads: no automated message goes into a
    // conversation a human is handling.
    if (conversation?.manualTakeover) return null;

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
      .set({ noShowFollowupSent: true, noShowFollowupSentAt: sentAt })
      .where(eq(reservations.id, reservationId));
  },
};
