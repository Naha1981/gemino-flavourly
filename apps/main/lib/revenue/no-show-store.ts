import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, conversations, jobs, reservations, tenants, waAccounts } from '@/lib/db/schema';
import type { NoShowCandidate, NoShowFollowupCandidate, NoShowRecipient, NoShowStore } from './no-show.ts';

export const drizzleNoShowStore: NoShowStore = {
  async findNoShowCandidates({ cutoff, limit }): Promise<NoShowCandidate[]> {
    return db.select({
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
    }).from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .leftJoin(conversations, eq(conversations.id, reservations.conversationId))
      .where(and(
        eq(reservations.status, 'confirmed'),
        eq(reservations.noShowDetected, false),
        lt(reservations.date, cutoff),
        eq(tenants.aiEnabled, true),
        eq(tenants.manualMode, false),
        or(isNull(contacts.id), eq(contacts.blocklisted, false)),
        or(isNull(conversations.id), eq(conversations.manualTakeover, false))
      ))
      .orderBy(reservations.date)
      .limit(limit);
  },

  async markNoShowDetected(reservationId, detectedAt): Promise<void> {
    await db.update(reservations).set({ noShowDetected: true, noShowDetectedAt: detectedAt }).where(eq(reservations.id, reservationId));
  },

  async findDueFollowups({ detectedBefore, limit }): Promise<NoShowFollowupCandidate[]> {
    return db.select({
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
    }).from(reservations)
      .innerJoin(tenants, eq(tenants.id, reservations.tenantId))
      .leftJoin(contacts, eq(contacts.id, reservations.contactId))
      .leftJoin(conversations, eq(conversations.id, reservations.conversationId))
      .where(and(
        eq(reservations.status, 'confirmed'),
        eq(reservations.noShowDetected, true),
        isNotNull(reservations.noShowDetectedAt),
        eq(reservations.noShowFollowupSent, false),
        lt(reservations.noShowDetectedAt, detectedBefore),
        eq(tenants.aiEnabled, true),
        eq(tenants.manualMode, false),
        or(isNull(contacts.id), eq(contacts.blocklisted, false)),
        or(isNull(conversations.id), eq(conversations.manualTakeover, false))
      ))
      .orderBy(reservations.noShowDetectedAt)
      .limit(limit);
  },

  async findRecipient(reservation): Promise<NoShowRecipient | null> {
    const conversation = reservation.conversationId
      ? await db.query.conversations.findFirst({ where: eq(conversations.id, reservation.conversationId), with: { contact: true } })
      : null;
    if (conversation?.manualTakeover) return null;

    const contact = reservation.contactId
      ? await db.query.contacts.findFirst({ where: and(eq(contacts.id, reservation.contactId), eq(contacts.blocklisted, false)) })
      : conversation?.contact && !conversation.contact.blocklisted
        ? conversation.contact
        : null;

    const to = contact?.phone || reservation.customerPhone;
    if (!to) return null;

    let waAccountId = conversation?.waAccountId;
    if (!waAccountId) {
      const account = await db.query.waAccounts.findFirst({ where: and(eq(waAccounts.tenantId, reservation.tenantId), eq(waAccounts.isConnected, true)) });
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
    await db.update(reservations).set({ noShowFollowupSent: true, noShowFollowupSentAt: sentAt }).where(eq(reservations.id, reservationId));
  },
};
