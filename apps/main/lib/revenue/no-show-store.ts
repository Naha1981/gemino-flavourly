import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, conversations, jobs, reservations, tenants, waAccounts } from '@/lib/db/schema';
import type { NoShowFollowupRecipient, NoShowReservation, NoShowStore } from './no-show.ts';

/**
 * Drizzle adapter for the no-show monitoring in ./no-show.ts — the only
 * module that reads or writes these rows. Imported by the cron route;
 * nothing in `lib/**.test.ts` may import it, because `@/lib/db` throws at
 * import time without DATABASE_URL.
 *
 * Schedule: every 30 minutes (cron-job.org, added manually after merge —
 * the same place the daily brief and outbox jobs are scheduled). Auth is
 * the shared CRON_SECRET bearer guard every other cron uses.
 */
export const drizzleNoShowStore: NoShowStore = {
  /**
   * Phase 1 — confirmed reservations past the detection cutoff, not yet
   * stamped.
   *
   * Deliberately NOT filtered by tenant AI / manual mode / opt-out:
   * detection is a factual record ("the table passed, the customer did
   * not show") that costs the customer nothing. Those safety filters
   * belong to the follow-up scan, the only phase that messages anyone.
   *
   * Oldest booking first, so a backlog drains in the order tables passed.
   */
  async findDetectable({ cutoff, limit }): Promise<NoShowReservation[]> {
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
        status: reservations.status,
        noShowDetected: reservations.noShowDetected,
        noShowDetectedAt: reservations.noShowDetectedAt,
        noShowFollowupSent: reservations.noShowFollowupSent,
        noShowFollowupSentAt: reservations.noShowFollowupSentAt,
      })
      .from(reservations)
      .where(
        and(
          eq(reservations.status, 'confirmed'),
          eq(reservations.noShowDetected, false),
          lt(reservations.date, cutoff)
        )
      )
      .orderBy(reservations.date)
      .limit(limit);

    // No conversation join in this phase, so there is no manual-takeover
    // information here — false, not null, keeps the row shape uniform.
    return rows.map((row) => ({ ...row, manualTakeover: false }));
  },

  /**
   * Phase 2 — detected no-shows whose 2-hour follow-up delay has elapsed
   * and whose offer has not gone out yet.
   *
   * Also excludes, in SQL rather than in the app, the audiences that must
   * never receive an automated message: contacts who opted out with
   * "STOP" (POPIA — see lib/opt-in-out.ts), tenants whose AI is switched
   * off or who are in manual mode (matching the inbound webhook's rules),
   * and conversations in MANUAL TAKEOVER — staff is running that thread
   * and an automated rebook offer would step on them. LEFT JOINs keep
   * reservations whose contact/conversation rows are gone
   * (`ON DELETE SET NULL`); they fall back to the phone number stored on
   * the reservation itself.
   */
  async findFollowupDue({ detectedBefore, limit }): Promise<NoShowReservation[]> {
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
        status: reservations.status,
        noShowDetected: reservations.noShowDetected,
        noShowDetectedAt: reservations.noShowDetectedAt,
        noShowFollowupSent: reservations.noShowFollowupSent,
        noShowFollowupSentAt: reservations.noShowFollowupSentAt,
        manualTakeover: conversations.manualTakeover,
      })
      .from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .leftJoin(conversations, eq(conversations.id, reservations.conversationId))
      .where(
        and(
          eq(reservations.noShowFollowupSent, false),
          isNotNull(reservations.noShowDetectedAt),
          lt(reservations.noShowDetectedAt, detectedBefore),
          eq(tenants.aiEnabled, true),
          eq(tenants.manualMode, false),
          or(isNull(contacts.id), eq(contacts.blocklisted, false)),
          or(isNull(conversations.id), eq(conversations.manualTakeover, false))
        )
      )
      // Oldest detection first, so a backlog offers rebooks in the order
      // customers were missed rather than in whatever order Postgres
      // returns rows.
      .orderBy(reservations.noShowDetectedAt)
      .limit(limit);

    // `no_show_detected_at IS NOT NULL` is in the WHERE clause, but the
    // column is nullable in the schema, so narrow it here rather than
    // casting. No conversation (LEFT JOIN miss) means no takeover.
    return rows.map((row) => ({
      ...row,
      noShowDetectedAt: row.noShowDetectedAt as Date,
      manualTakeover: row.manualTakeover ?? false,
    }));
  },

  /**
   * Where to send, and who to greet.
   *
   * Number: the contact the conversation happened with, else the phone
   * number captured on the reservation. Account: the WhatsApp account that
   * owned the conversation, else the reservation's OWN tenant's connected
   * account — per-reservation tenant scoping, never a neighbouring
   * tenant's. Name: the contact's name, else the name on the reservation.
   */
  async findRecipient(reservation): Promise<NoShowFollowupRecipient | null> {
    const conversation = reservation.conversationId
      ? await db.query.conversations.findFirst({
          where: eq(conversations.id, reservation.conversationId),
          with: { contact: true },
        })
      : null;

    // Defense in depth: staff may have taken over the thread after the
    // scan ran. An automated offer must not land in a thread a human is
    // running, so bow out rather than message.
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

  async markDetected(reservationId, detectedAt): Promise<void> {
    await db
      .update(reservations)
      .set({ noShowDetected: true, noShowDetectedAt: detectedAt })
      .where(eq(reservations.id, reservationId));
  },

  async markFollowupSent(reservationId, sentAt): Promise<void> {
    await db
      .update(reservations)
      .set({ noShowFollowupSent: true, noShowFollowupSentAt: sentAt })
      .where(eq(reservations.id, reservationId));
  },
};
