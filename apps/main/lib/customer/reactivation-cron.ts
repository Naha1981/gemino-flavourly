/**
 * Gate #9 — Reactivation Campaign cron runner.
 *
 * Framework-free, like ./segmentation-cron.ts: the Drizzle adapter is wired
 * in by the route (from ./reactivation-store.ts), so this loop can be
 * exercised end-to-end with an in-memory store in tests.
 *
 * One run, per tenant:
 *   1. skip tenants with AI off or in manual takeover mode
 *   2. load profiles whose stored segment is dormant / at_risk
 *   3. re-verify eligibility against the FRESH last-visit date
 *      (a stale stored label must never beat a fresh visit)
 *   4. skip anyone campaigned in the last 90 days (anti-spam)
 *   5. generate the personalized message, create the pending campaign,
 *      hand it to the outbox (the operator owns delivery + retries),
 *      then stamp sent_at
 *
 * Compliance (POPIA): opted-out contacts (contacts.blocklisted, set by the
 * STOP path) are never messaged — checked here for every store and, in the
 * Drizzle adapter, again in SQL before the rows are even loaded.
 */

import {
  generateReactivationMessage,
  isWithinCampaignCooldown,
  resolveReactivationTarget,
  type ReactivationSegment,
} from './reactivation.ts';

/** How many candidates one run may message, across all tenants. */
export const DEFAULT_REACTIVATION_LIMIT = 200;

export interface ReactivationTenant {
  id: string;
  name: string | null;
  /** Tenants with AI off or in manual mode get no automated campaigns. */
  aiEnabled: boolean;
  manualMode: boolean;
}

export interface ReactivationCandidate {
  profileId: string;
  tenantId: string;
  customerPhone: string;
  customerName: string | null;
  totalVisits: number;
  lastVisitAt: Date | null;
  /** Segment stored on the profile by the Gate #8 cron — may be stale. */
  storedSegment: string | null;
  /** jsonb preferences: { dietary: string[], occasions: string[] }. */
  preferences: unknown;
  /** POPIA: true when the contact opted out with STOP. Must never be messaged. */
  blocklisted: boolean;
}

/** The campaign fields the runner needs; a superset row is fine to return. */
export interface ReactivationCampaignRecord {
  id: string;
  segment: ReactivationSegment;
  messageText: string;
  sentAt: Date | null;
  createdAt: Date;
  responded: boolean;
}

export interface ReactivationCampaignStore {
  /** All tenants with their automation flags; the runner enforces them. */
  findTenants(): Promise<ReactivationTenant[]>;
  /**
   * Profiles stored as dormant/at_risk for one tenant. Implementations
   * should exclude opted-out contacts in SQL; the runner re-checks.
   */
  fetchCampaignCandidates(tenantId: string): Promise<ReactivationCandidate[]>;
  findLatestCampaign(tenantId: string, customerPhone: string): Promise<ReactivationCampaignRecord | null>;
  createPendingCampaign(
    tenantId: string,
    customerPhone: string,
    segment: ReactivationSegment,
    messageText: string
  ): Promise<ReactivationCampaignRecord>;
  markSent(campaignId: string, sentAt: Date): Promise<boolean>;
  /** Hand the message to the outbox (jobs table) — the operator delivers it. */
  queueCampaignMessage(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void>;
  /** The tenant's connected WhatsApp account, or null when none is linked. */
  resolveSender(tenantId: string): Promise<{ waAccountId: string } | null>;
}

export interface ReactivationCronOptions {
  /** Reference "now"; injected so tests can move time. */
  now?: Date;
  /** Ceiling on messages queued per run, across all tenants. */
  limit?: number;
  /**
   * Billing gate predicate. When provided, tenants it rejects are skipped
   * (no automated campaign). Defaults to allowing all — the production route
   * wires the real billing gate; tests leave it unset.
   */
  isSendable?: (tenantId: string) => Promise<boolean> | boolean;
}

export interface ReactivationCronSummary {
  tenantsChecked: number;
  candidatesScanned: number;
  /** New pending campaign rows created. */
  created: number;
  /** Previously-pending rows resumed (queued on a later run). */
  resumed: number;
  /** Messages handed to the outbox and stamped sent. */
  sent: number;
  skipped: {
    optedOut: number;
    tenantDisabled: number;
    notEligible: number;
    cooldown: number;
    noSender: number;
    failed: number;
  };
  samples: Array<{
    tenantId: string;
    customerPhone: string;
    segment: ReactivationSegment;
    messageText: string;
  }>;
}

function positiveLimit(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_REACTIVATION_LIMIT;
}

/**
 * Run the reactivation campaign sweep once.
 *
 * A candidate whose pending campaign failed to queue on an earlier run is
 * RESUMED (the stored message text is queued again and stamped sent) rather
 * than duplicated — the cooldown only counts campaigns that were actually
 * dispatched, so an undelivered row never silently eats the customer's
 * quarterly slot.
 */
export async function runReactivationCampaignCron(
  store: ReactivationCampaignStore,
  options: ReactivationCronOptions = {}
): Promise<ReactivationCronSummary> {
  const now = options.now ?? new Date();
  const limit = positiveLimit(options.limit);

  const summary: ReactivationCronSummary = {
    tenantsChecked: 0,
    candidatesScanned: 0,
    created: 0,
    resumed: 0,
    sent: 0,
    skipped: { optedOut: 0, tenantDisabled: 0, notEligible: 0, cooldown: 0, noSender: 0, failed: 0 },
    samples: [],
  };

  let tenants: ReactivationTenant[] = [];
  try {
    tenants = await store.findTenants();
  } catch (err) {
    summary.skipped.failed += 1;
    console.error('[Reactivation] Failed to list tenants', err);
    return summary;
  }
  summary.tenantsChecked = tenants.length;

  for (const tenant of tenants) {
    // Manual takeover or AI disabled means no automated messaging at all.
    if (!tenant.aiEnabled || tenant.manualMode) {
      summary.skipped.tenantDisabled += 1;
      continue;
    }

    // Billing gate: past-due / canceled tenants lose automated sending.
    if (options.isSendable) {
      try {
        if (!(await options.isSendable(tenant.id))) {
          summary.skipped.tenantDisabled += 1;
          continue;
        }
      } catch (err) {
        summary.skipped.failed += 1;
        console.error(`[Reactivation] Billing gate check failed for tenant ${tenant.id}`, err);
        continue;
      }
    }

    let candidates: ReactivationCandidate[] = [];
    try {
      candidates = await store.fetchCampaignCandidates(tenant.id);
    } catch (err) {
      summary.skipped.failed += 1;
      console.error(`[Reactivation] Failed to fetch candidates for tenant ${tenant.id}`, err);
      continue;
    }

    // Resolve the sender once per tenant: with no connected WhatsApp
    // account there is nothing to send through, and every candidate would
    // otherwise fail identically further down the loop.
    let sender: { waAccountId: string } | null = null;
    try {
      sender = await store.resolveSender(tenant.id);
    } catch (err) {
      console.error(`[Reactivation] Failed to resolve sender for tenant ${tenant.id}`, err);
    }
    if (!sender?.waAccountId) {
      summary.skipped.noSender += candidates.length;
      continue;
    }

    for (const candidate of candidates) {
      if (summary.sent >= limit) return summary;
      summary.candidatesScanned += 1;

      // Defense in depth for in-memory/ad hoc stores: identical phone
      // numbers in two restaurants are independent customers.
      if (candidate.tenantId && candidate.tenantId !== tenant.id) {
        summary.skipped.failed += 1;
        console.error(
          `[Reactivation] Refusing profile ${candidate.profileId} returned for tenant ${candidate.tenantId} while scanning ${tenant.id}`
        );
        continue;
      }

      // POPIA: an opted-out contact is never messaged, whatever its segment.
      if (candidate.blocklisted) {
        summary.skipped.optedOut += 1;
        continue;
      }

      // The fresh visit date decides; a stale stored label cannot override it.
      const target = resolveReactivationTarget(candidate, { now });
      if (!target) {
        summary.skipped.notEligible += 1;
        continue;
      }

      let latest: ReactivationCampaignRecord | null = null;
      try {
        latest = await store.findLatestCampaign(tenant.id, candidate.customerPhone);
      } catch (err) {
        summary.skipped.failed += 1;
        console.error(`[Reactivation] Failed to check history for ${candidate.customerPhone}`, err);
        continue;
      }

      // 90-day anti-spam cooldown — only DISPATCHED campaigns count.
      if (latest?.sentAt && isWithinCampaignCooldown(latest.sentAt, now)) {
        summary.skipped.cooldown += 1;
        continue;
      }

      let campaign: ReactivationCampaignRecord;
      let text: string;
      try {
        if (latest && !latest.sentAt) {
          // Resume the pending row left by an earlier failed dispatch.
          campaign = latest;
          text = latest.messageText;
          summary.resumed += 1;
        } else {
          const message = generateReactivationMessage({
            segment: target.segment,
            customerName: candidate.customerName,
            restaurantName: tenant.name,
            preferences: candidate.preferences,
          });
          campaign = await store.createPendingCampaign(
            tenant.id,
            candidate.customerPhone,
            target.segment,
            message.messageText
          );
          text = message.messageText;
          summary.created += 1;
        }

        await store.queueCampaignMessage({
          tenantId: tenant.id,
          waAccountId: sender.waAccountId,
          to: candidate.customerPhone,
          text,
        });
        await store.markSent(campaign.id, now);
        summary.sent += 1;
        if (summary.samples.length < 5) {
          summary.samples.push({
            tenantId: tenant.id,
            customerPhone: candidate.customerPhone,
            segment: campaign.segment,
            messageText: text,
          });
        }
      } catch (err) {
        // The row (if one was created) stays pending: the next run resumes
        // it instead of creating a duplicate, and the cooldown never counts
        // a message the customer did not actually receive.
        summary.skipped.failed += 1;
        console.error(`[Reactivation] Failed to campaign ${candidate.customerPhone}`, err);
      }
    }
  }

  return summary;
}
