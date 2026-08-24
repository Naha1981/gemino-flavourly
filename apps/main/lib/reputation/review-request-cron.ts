import {
  buildGoogleReviewLink,
  generateReviewRequestMessage,
  isEligibleForReviewRequest,
  type ReviewRequestReservation,
} from './review-request.ts';

/**
 * Gate #13 — review request cron runner, framework-free.
 *
 * One run, per tenant:
 *   1. skip tenants with AI off or in manual mode (no automated messaging)
 *   2. resolve the Google review link — no Places config means no link, and
 *      a review ask without a link is a dead end, so the whole tenant skips
 *   3. for each eligible reservation:
 *        - POPIA: never message a blocklisted contact (checked twice)
 *        - re-verify eligibility against THIS run's clock (the store query
 *          must never be the last line of defense)
 *        - respect manual takeover on the booking's conversation
 *        - queue via the outbox, THEN stamp review_request_sent
 *
 * The outbox owns delivery + retries; the stamp happens only after the job
 * is accepted, and if queueing throws the row stays unstamped so the next
 * hourly run retries it — a diner is asked at most once per booking.
 */

export interface ReviewRequestTenant {
  id: string;
  name: string | null;
  aiEnabled: boolean;
  manualMode: boolean;
}

export interface ReviewRequestStore {
  findTenants(): Promise<ReviewRequestTenant[]>;
  /** One tenant's Google place id, or null when unconfigured. */
  getPlaceId(tenantId: string): Promise<string | null>;
  getEligibleReservations(tenantId: string, now: Date): Promise<ReviewRequestReservation[]>;
  isManualTakeover(conversationId: string): Promise<boolean>;
  queueMessage(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void>;
  resolveSender(tenantId: string): Promise<{ waAccountId: string } | null>;
  markRequestSent(reservationId: string, tenantId: string, at: Date): Promise<boolean>;
}

export interface ReviewRequestCronOptions {
  now?: Date;
  /** Ceiling on messages queued per run, across all tenants. */
  limit?: number;
}

export interface ReviewRequestCronSummary {
  tenantsChecked: number;
  reservationsScanned: number;
  sent: number;
  skipped: {
    tenantDisabled: number;
    noPlaceConfig: number;
    noSender: number;
    optedOut: number;
    notEligible: number;
    manualTakeover: number;
    failed: number;
  };
  samples: Array<{ tenantId: string; customerPhone: string | null; messageText: string }>;
}

const DEFAULT_LIMIT = 200;

function positiveLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_LIMIT;
}

export async function runReviewRequestCron(
  store: ReviewRequestStore,
  options: ReviewRequestCronOptions = {}
): Promise<ReviewRequestCronSummary> {
  const now = options.now ?? new Date();
  const limit = positiveLimit(options.limit);

  const summary: ReviewRequestCronSummary = {
    tenantsChecked: 0,
    reservationsScanned: 0,
    sent: 0,
    skipped: { tenantDisabled: 0, noPlaceConfig: 0, noSender: 0, optedOut: 0, notEligible: 0, manualTakeover: 0, failed: 0 },
    samples: [],
  };

  let tenants: ReviewRequestTenant[] = [];
  try {
    tenants = await store.findTenants();
  } catch (err) {
    console.error('[ReviewRequest] Failed to list tenants', err);
    summary.skipped.failed += 1;
    return summary;
  }
  summary.tenantsChecked = tenants.length;

  for (const tenant of tenants) {
    // AI off or manual mode: no automated outbound, full stop.
    if (!tenant.aiEnabled || tenant.manualMode) {
      summary.skipped.tenantDisabled += 1;
      continue;
    }

    // No Google Places config -> no review link -> no point asking.
    let placeId: string | null = null;
    try {
      placeId = await store.getPlaceId(tenant.id);
    } catch (err) {
      console.error(`[ReviewRequest] Failed to load place config for tenant ${tenant.id}`, err);
    }
    if (!placeId) {
      summary.skipped.noPlaceConfig += 1;
      continue;
    }

    let candidates: ReviewRequestReservation[] = [];
    try {
      candidates = await store.getEligibleReservations(tenant.id, now);
    } catch (err) {
      console.error(`[ReviewRequest] Failed to load reservations for tenant ${tenant.id}`, err);
      summary.skipped.failed += 1;
      continue;
    }

    let sender: { waAccountId: string } | null = null;
    try {
      sender = await store.resolveSender(tenant.id);
    } catch (err) {
      console.error(`[ReviewRequest] Failed to resolve sender for tenant ${tenant.id}`, err);
    }
    if (!sender?.waAccountId) {
      summary.skipped.noSender += candidates.length;
      continue;
    }

    const reviewLink = buildGoogleReviewLink(placeId);

    for (const reservation of candidates) {
      if (summary.sent >= limit) return summary;
      summary.reservationsScanned += 1;

      // Defense in depth: rows returned for the wrong tenant are refused.
      if (reservation.tenantId !== tenant.id) {
        summary.skipped.failed += 1;
        console.error(
          `[ReviewRequest] Refusing reservation ${reservation.id} of tenant ${reservation.tenantId} while scanning ${tenant.id}`
        );
        continue;
      }

      // POPIA: opted-out contacts are never messaged, whatever the SQL said.
      if (reservation.blocklisted) {
        summary.skipped.optedOut += 1;
        continue;
      }

      // The store query narrows; THIS predicate decides.
      if (!isEligibleForReviewRequest(reservation, now)) {
        summary.skipped.notEligible += 1;
        continue;
      }

      if (!reservation.customerPhone) {
        summary.skipped.notEligible += 1;
        continue;
      }

      // Manual takeover on the booking's thread means a human owns that
      // customer relationship right now — no automated ask.
      if (reservation.conversationId) {
        try {
          if (await store.isManualTakeover(reservation.conversationId)) {
            summary.skipped.manualTakeover += 1;
            continue;
          }
        } catch (err) {
          console.error(`[ReviewRequest] Takeover check failed for reservation ${reservation.id}`, err);
          summary.skipped.failed += 1;
          continue;
        }
      }

      const messageText = generateReviewRequestMessage(reservation.customerName, reviewLink);
      try {
        await store.queueMessage({
          tenantId: tenant.id,
          waAccountId: sender.waAccountId,
          to: reservation.customerPhone,
          text: messageText,
        });
        const stamped = await store.markRequestSent(reservation.id, tenant.id, now);
        if (!stamped) {
          // Another run won the race between queue and stamp — the message
          // may have been double-queued; flag it loudly for inspection.
          console.error(`[ReviewRequest] Reservation ${reservation.id} was stamped concurrently`);
          summary.skipped.failed += 1;
          continue;
        }
        summary.sent += 1;
        if (summary.samples.length < 5) {
          summary.samples.push({ tenantId: tenant.id, customerPhone: reservation.customerPhone, messageText });
        }
      } catch (err) {
        // Unstamped on purpose: the next hourly run retries this booking.
        summary.skipped.failed += 1;
        console.error(`[ReviewRequest] Failed to request review for reservation ${reservation.id}`, err);
      }
    }
  }

  return summary;
}
