import { and, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, conversations, jobs, reservations, tenants, waAccounts } from '@/lib/db/schema';
import type { CancellationFollowupStore, CancelledReservation, FollowupRecipient } from './cancellation-followup.ts';

export const drizzleCancellationFollowupStore: CancellationFollowupStore = {
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
      .where(and(
        eq(reservations.status, 'cancelled'),
        isNotNull(reservations.cancelledAt),
        eq(reservations.cancellationFollowupSent, false),
        lt(reservations.cancelledAt, cancelledBefore),
        gt(reservations.cancelledAt, cancelledAfter),
        eq(tenants.aiEnabled, true),
        eq(tenants.manualMode, false),
        or(isNull(contacts.id), eq(contacts.blocklisted, false))
      ))
      .orderBy(reservations.cancelledAt)
      .limit(limit);

    return rows.flatMap((row) => row.cancelledAt ? [{
      id: row.id,
      tenantId: row.tenantId,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      contactId: row.contactId,
      conversationId: row.conversationId,
      reservationDate: row.reservationDate,
      partySize: row.partySize,
      cancelledAt: row.cancelledAt,
    }] : []);
  },

  async findRecipient(reservation): Promise<FollowupRecipient | null> {
    const conversation = reservation.conversationId
      ? await db.query.conversations.findFirst({ where: eq(conversations.id, reservation.conversationId), with: { contact: true } })
      : null;

    const contact = reservation.contactId
      ? await db.query.contacts.findFirst({ where: and(eq(contacts.id, reservation.contactId), eq(contacts.blocklisted, false)) })
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

  async queueFollowup({ tenantId, waAccountId, to, text }): Promise<void> {
    await db.insert(jobs).values({
      tenantId,
      type: 'send_whatsapp',
      payload: { waAccountId, to, text, automated: true },
      status: 'pending',
      nextRunAt: new Date(),
    });
  },

  async markFollowupSent(reservationId, sentAt): Promise<void> {
    await db.update(reservations).set({ cancellationFollowupSent: true, cancellationFollowupSentAt: sentAt }).where(eq(reservations.id, reservationId));
  },

  async cancelReservation(reservationId, cancelledAt): Promise<void> {
    await db.update(reservations).set({ status: 'cancelled', cancelledAt }).where(eq(reservations.id, reservationId));
  },
};
