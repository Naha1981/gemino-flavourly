import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contacts,
  conversations,
  customerProfiles,
  messages,
  reservations,
} from '@/lib/db/schema';
import {
  AVG_CHECK_CENTS,
  buildProfileSnapshot,
  lookbackStart,
} from './profile-builder';
import type { CustomerSegment } from './segmentation';

export type CustomerProfileRow = typeof customerProfiles.$inferSelect;

/**
 * Keep the established Drizzle camelCase shape while exposing the explicit
 * snake_case API name used by the segmentation contract. Numeric columns are
 * normalized to JSON numbers so clients do not have to parse Postgres
 * decimals themselves.
 */
export function serializeCustomerProfile(profile: CustomerProfileRow) {
  const confidence = Number(profile.segmentConfidence ?? 0);
  return {
    ...profile,
    segmentConfidence: confidence,
    segment_confidence: confidence,
    segment_updated_at: profile.segmentUpdatedAt,
  };
}

export async function findOrCreateProfile(
  tenantId: string,
  contactId: string | null,
  customerPhone: string,
  customerName?: string | null
): Promise<CustomerProfileRow> {
  const existing = await db
    .select()
    .from(customerProfiles)
    .where(and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.customerPhone, customerPhone)))
    .limit(1);

  if (existing[0]) {
    if (contactId && !existing[0].contactId) {
      const [updated] = await db
        .update(customerProfiles)
        .set({
          contactId,
          customerName: customerName ?? existing[0].customerName,
          updatedAt: new Date(),
        })
        .where(eq(customerProfiles.id, existing[0].id))
        .returning();
      return updated ?? existing[0];
    }
    return existing[0];
  }

  const [created] = await db
    .insert(customerProfiles)
    .values({
      tenantId,
      contactId: contactId ?? undefined,
      customerPhone,
      customerName: customerName ?? undefined,
    })
    .returning();

  return created;
}

async function loadReservationsForCustomer(tenantId: string, contactId: string | null, customerPhone: string) {
  const since = lookbackStart();
  const rows = await db
    .select()
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        gte(reservations.date, since),
        contactId
          ? or(eq(reservations.contactId, contactId), eq(reservations.customerPhone, customerPhone))
          : eq(reservations.customerPhone, customerPhone)
      )
    );

  return rows;
}

async function loadMessagesForCustomer(tenantId: string, contactId: string | null, customerPhone: string) {
  if (contactId) {
    const rows = await db
      .select({ content: messages.content, direction: messages.direction })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(and(eq(messages.tenantId, tenantId), eq(conversations.contactId, contactId)));
    return rows;
  }

  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, customerPhone)))
    .limit(1);
  if (!contact) return [];

  return db
    .select({ content: messages.content, direction: messages.direction })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(messages.tenantId, tenantId), eq(conversations.contactId, contact.id)));
}

export async function rebuildProfileFromHistory(
  tenantId: string,
  contactId: string | null,
  customerPhone: string,
  customerName?: string | null
): Promise<CustomerProfileRow> {
  const profile = await findOrCreateProfile(tenantId, contactId, customerPhone, customerName);
  const [reservationRows, messageRows] = await Promise.all([
    loadReservationsForCustomer(tenantId, contactId ?? profile.contactId, customerPhone),
    loadMessagesForCustomer(tenantId, contactId ?? profile.contactId, customerPhone),
  ]);

  const snapshot = buildProfileSnapshot(
    reservationRows.map((row) => ({ date: row.date, partySize: row.partySize, status: row.status })),
    messageRows
  );

  const [updated] = await db
    .update(customerProfiles)
    .set({
      customerName: customerName ?? profile.customerName,
      contactId: contactId ?? profile.contactId,
      totalVisits: snapshot.totalVisits,
      totalSpendCents: snapshot.totalSpendCents,
      avgPartySize: String(snapshot.avgPartySize),
      lastVisitAt: snapshot.lastVisitAt,
      firstVisitAt: snapshot.firstVisitAt,
      preferences: snapshot.preferences,
      updatedAt: new Date(),
    })
    .where(and(eq(customerProfiles.id, profile.id), eq(customerProfiles.tenantId, tenantId)))
    .returning();

  return updated ?? profile;
}

export async function updateProfileAfterReservation(reservationId: string): Promise<CustomerProfileRow | null> {
  const [reservation] = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);
  if (!reservation?.customerPhone && !reservation?.contactId) return null;

  let phone = reservation.customerPhone;
  if (!phone && reservation.contactId) {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, reservation.contactId)).limit(1);
    phone = contact?.phone ?? null;
  }
  if (!phone) return null;

  return rebuildProfileFromHistory(
    reservation.tenantId,
    reservation.contactId,
    phone,
    reservation.customerName
  );
}

export async function createReservationAndSyncProfile(input: {
  tenantId: string;
  contactId?: string | null;
  conversationId?: string | null;
  customerName?: string | null;
  customerPhone: string;
  date: Date;
  partySize: number;
  status?: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string | null;
}): Promise<{ reservation: typeof reservations.$inferSelect; profile: CustomerProfileRow }> {
  const [reservation] = await db
    .insert(reservations)
    .values({
      tenantId: input.tenantId,
      contactId: input.contactId ?? undefined,
      conversationId: input.conversationId ?? undefined,
      customerName: input.customerName ?? undefined,
      customerPhone: input.customerPhone,
      date: input.date,
      partySize: input.partySize,
      status: input.status ?? 'confirmed',
      notes: input.notes ?? undefined,
    })
    .returning();

  const profile = (await updateProfileAfterReservation(reservation.id))!;
  return { reservation, profile };
}

export async function getProfile(tenantId: string, customerPhone: string): Promise<CustomerProfileRow | null> {
  const [row] = await db
    .select()
    .from(customerProfiles)
    .where(and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.customerPhone, customerPhone)))
    .limit(1);
  return row ?? null;
}

export async function listProfiles(
  tenantId: string,
  limit = 50,
  offset = 0,
  segment?: CustomerSegment
): Promise<CustomerProfileRow[]> {
  return db
    .select()
    .from(customerProfiles)
    .where(
      segment
        ? and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.segment, segment))
        : eq(customerProfiles.tenantId, tenantId)
    )
    .orderBy(desc(customerProfiles.lastVisitAt), desc(customerProfiles.updatedAt))
    .limit(limit)
    .offset(offset);
}

export async function countProfiles(tenantId: string, segment?: CustomerSegment): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customerProfiles)
    .where(
      segment
        ? and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.segment, segment))
        : eq(customerProfiles.tenantId, tenantId)
    );
  return row?.n ?? 0;
}

export async function listVisitHistory(tenantId: string, customerPhone: string, contactId?: string | null) {
  const since = lookbackStart();
  return db
    .select({
      id: reservations.id,
      date: reservations.date,
      partySize: reservations.partySize,
      status: reservations.status,
      customerName: reservations.customerName,
    })
    .from(reservations)
    .where(
      and(
        eq(reservations.tenantId, tenantId),
        gte(reservations.date, since),
        contactId
          ? or(eq(reservations.contactId, contactId), eq(reservations.customerPhone, customerPhone))
          : eq(reservations.customerPhone, customerPhone)
      )
    )
    .orderBy(desc(reservations.date));
}

export { AVG_CHECK_CENTS };
