export type ReviewRequestReservation = {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  date: Date;
};

export function isEligibleForReviewRequest(
  reservation: { status: string; date: Date; reviewRequestSent: boolean },
  now = new Date(),
) {
  return reservation.status === 'confirmed'
    && !reservation.reviewRequestSent
    && reservation.date.getTime() <= now.getTime() - 2 * 60 * 60 * 1000;
}

export function buildReviewRequestMessage(name: string, reviewLink: string) {
  return `Hi ${name || 'there'}, thank you for dining with us tonight! We'd love to hear about your experience. Would you mind leaving us a Google review? ${reviewLink}`;
}
