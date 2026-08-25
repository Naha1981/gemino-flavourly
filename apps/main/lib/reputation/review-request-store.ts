import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contacts, reservations, googlePlacesConfig } from '@/lib/db/schema';
import { isEligibleForReviewRequest } from './review-request';

export async function getEligibleReservations(tenantId: string, now = new Date()) {
  const rows = await db.select({ reservation: reservations, contact: contacts })
    .from(reservations)
    .leftJoin(contacts, eq(reservations.contactId, contacts.id))
    .where(and(
      eq(reservations.tenantId, tenantId),
      eq(reservations.status, 'confirmed'),
      eq(reservations.reviewRequestSent, false),
      lt(reservations.date, new Date(now.getTime() - 2 * 60 * 60 * 1000)),
      gte(reservations.date, new Date(now.getTime() - 48 * 60 * 60 * 1000)),
    ));
  return rows.filter(({ reservation, contact }) => isEligibleForReviewRequest(reservation, now) && !contact?.blocklisted);
}

export function markRequestSent(reservationId: string) {
  return db.update(reservations).set({ reviewRequestSent: true, reviewRequestSentAt: new Date() }).where(eq(reservations.id, reservationId));
}

export async function getGoogleReviewLink(tenantId: string) {
  const config = await db.query.googlePlacesConfig.findFirst({ where: eq(googlePlacesConfig.tenantId, tenantId) });
  return config ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(config.placeId)}` : null;
}
