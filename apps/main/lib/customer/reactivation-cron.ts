/**
 * Gate #9 — Reactivation Campaigns: the daily cron runner.
 *
 * Framework-free, like ./segmentation-cron.ts: the whole run is expressed
 * against a ReactivationCronStore interface so the decision rules (who is
 * eligible, the 90-day anti-spam cooldown, create-pending -> dispatch ->
 * mark-sent) are unit-testable with an in-memory store. The Drizzle
 * adapter lives in ./reactivation-store.ts and is injected by the route.
 *
 * Order of operations per tenant:
 *
 *   1. candidates          dormant/at-risk profiles (store already excludes
 *                          opted-out contacts and AI-off / manual-mode
 *                          tenants in SQL; the runner re-checks as defense
 *                          in depth)
 *   2. cooldown            phones that received a campaign in the last 90
 *                          days are skipped — win-back spam burns the
 *                          channel for every other automated message
 *   3. account             one connected WhatsApp account lookup per tenant;
 *                          without one nothing is created, so no pending
 *                          rows pile up for a restaurant that cannot send
 *   4. per customer        re-derive the segment from the profile, generate
 *                          the personalised message, create the pending
 *                          campaign, dispatch via the operator, mark sent
 *
 * A dispatch failure leaves the campaign pending (not sent, not cooldown-
 * freeing), which is the honest state: the dashboard shows it, and the
 * pending scan keeps it visible for a retry.
 */

import {
  DORMANT_THRESHOLD_DAYS,
  REACTIVATION_COOLDOWN_DAYS,
  buildReactivationMessage,
  resolveReactivationTarget,
  type ReactivationPreferences,
} from './reactivation.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A dormant/at-risk customer as read by the scan. */
export interface ReactivationCandidate {
  profileId: string;
  /** Must match the tenant being scanned; mismatched rows are refused. */
  tenantId: string;
  customerPhone: string;
  customerName: string | null;
  segment: string;
  lastVisitAt: Date | string | null;
  preferences: ReactivationPreferences | null;
  /** POPIA: true when the contact opted out — never message. */
  optedOut?: boolean;
  tenantName: string;
  tenantAiEnabled?: boolean;
  tenantManualMode?: boolean;
}

export interface ReactivationCronStore {
  /** Return only tenant ids the caller is allowed to scan. */
  findTenantIds(): Promise<string[]>;
  fetchReactivationCandidates(tenantId: string, dormantCutoff: Date): Promise<ReactivationCandidate[]>;
  /** Phones already messaged since `since` (the 90-day cooldown set). */
  fetchRecentCampaignRecipients(tenantId: string, since: Date): Promise<Set<string>>;
  /** The tenant's connected WhatsApp account, or null when none. */
  findWhatsAppAccount(tenantId: string): Promise<string | null>;
  createPendingCampaign(
    tenantId: string,
    customerPhone: string,
    segment: 'dormant' | 'at_risk',
    messageText: string
  ): Promise<{ id: string }>;
  markSent(campaignId: string, sentAt: Date): Promise<boolean>;
  dispatchWhatsApp(input: {
    tenantId: string;
    waAccountId: string;
    to: string;
    text: string;
  }): Promise<{ ok: boolean; error?: string }>;
}

export interface ReactivationCronOptions {
  /** Reference "now"; injected so tests can move time. */
  now?: Date;
  /** Per-tenant cap on campaigns created in one run. */
  limit?: number;
}

export interface ReactivationCronSummary {
  tenantsChecked: number;
  candidatesScanned: number;
  campaignsCreated: number;
  sent: number;
  skipped: {
    optedOut: number;
    tenantMessagingDisabled: number;
    recentCampaign: number;
    notEligible: number;
    noWhatsAppAccount: number;
    failed: number;
  };
  samples: Array<{ tenantId: string; to: string; segment: 'dormant' | 'at_risk'; text: string }>;
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** The cutoff dates for one run, derived once so all tenants agree. */
export function reactivationCutoffs(now: Date = new Date()) {
  return {
    dormantCutoff: new Date(now.getTime() - DORMANT_THRESHOLD_DAYS * MS_PER_DAY),
    cooldownSince: new Date(now.getTime() - REACTIVATION_COOLDOWN_DAYS * MS_PER_DAY),
  };
}

/** One daily run: scan every tenant, message each eligible customer once. */
export async function runReactivationCampaignCron(
  store: ReactivationCronStore,
  options: ReactivationCronOptions = {}
): Promise<ReactivationCronSummary> {
  const now = options.now ?? new Date();
  const limit = positive(options.limit, 200);
  const { dormantCutoff, cooldownSince } = reactivationCutoffs(now);

  const summary: ReactivationCronSummary = {
    tenantsChecked: 0,
    candidatesScanned: 0,
    campaignsCreated: 0,
    sent: 0,
    skipped: {
      optedOut: 0,
      tenantMessagingDisabled: 0,
      recentCampaign: 0,
      notEligible: 0,
      noWhatsAppAccount: 0,
      failed: 0,
    },
    samples: [],
  };

  const tenantIds = await store.findTenantIds();
  summary.tenantsChecked = tenantIds.length;

  for (const tenantId of tenantIds) {
    let candidates: ReactivationCandidate[];
    try {
      candidates = await store.fetchReactivationCandidates(tenantId, dormantCutoff);
    } catch (err) {
      summary.skipped.failed += 1;
      console.error(`[Reactivation] Failed to fetch candidates for tenant ${tenantId}`, err);
      continue;
    }
    summary.candidatesScanned += candidates.length;

    let recent: Set<string>;
    try {
      recent = await store.fetchRecentCampaignRecipients(tenantId, cooldownSince);
    } catch (err) {
      summary.skipped.failed += 1;
      console.error(`[Reactivation] Failed to fetch cooldown set for tenant ${tenantId}`, err);
      continue;
    }

    let waAccountId: string | null = null;
    try {
      waAccountId = await store.findWhatsAppAccount(tenantId);
    } catch (err) {
      console.error(`[Reactivation] Failed to resolve WhatsApp account for tenant ${tenantId}`, err);
    }

    let created = 0;
    for (const candidate of candidates) {
      // A store implementation must return candidates for the tenant it
      // was asked for. Refusing mismatched rows keeps identical phone
      // numbers in two restaurants independent customers.
      if (candidate.tenantId !== tenantId) {
        summary.skipped.failed += 1;
        console.error(
          `[Reactivation] Refusing candidate ${candidate.profileId} returned for tenant ` +
            `${candidate.tenantId} while scanning ${tenantId}`
        );
        continue;
      }

      // POPIA + tenant flags: enforced in the store's SQL; re-checked here
      // so a hand-rolled adapter or test double cannot smuggle a
      // opted-out contact or a manual-mode tenant past the cron.
      if (candidate.optedOut) {
        summary.skipped.optedOut += 1;
        continue;
      }
      if (candidate.tenantAiEnabled === false || candidate.tenantManualMode === true) {
        summary.skipped.tenantMessagingDisabled += 1;
        continue;
      }

      const target = resolveReactivationTarget(candidate, now);
      if (!target) {
        summary.skipped.notEligible += 1;
        continue;
      }

      if (recent.has(candidate.customerPhone)) {
        summary.skipped.recentCampaign += 1;
        continue;
      }

      if (!waAccountId) {
        summary.skipped.noWhatsAppAccount += 1;
        continue;
      }

      if (created >= limit) break;

      const message = buildReactivationMessage({
        segment: target.segment,
        customerName: candidate.customerName,
        restaurantName: candidate.tenantName,
        preferences: candidate.preferences,
        daysSinceLastVisit: target.daysSinceLastVisit,
      });

      let campaign: { id: string };
      try {
        campaign = await store.createPendingCampaign(
          tenantId,
          candidate.customerPhone,
          target.segment,
          message.text
        );
      } catch (err) {
        summary.skipped.failed += 1;
        console.error(
          `[Reactivation] Failed to create campaign for ${candidate.customerPhone} (tenant ${tenantId})`,
          err
        );
        continue;
      }
      summary.campaignsCreated += 1;
      created += 1;

      try {
        const dispatch = await store.dispatchWhatsApp({
          tenantId,
          waAccountId,
          to: candidate.customerPhone,
          text: message.text,
        });
        if (dispatch.ok) {
          await store.markSent(campaign.id, now);
          summary.sent += 1;
          if (summary.samples.length < 5) {
            summary.samples.push({
              tenantId,
              to: candidate.customerPhone,
              segment: target.segment,
              text: message.text,
            });
          }
        } else {
          // Pending, not failed-and-forgotten: the dashboard lists it and
          // the pending scan keeps it visible for a manual retry.
          summary.skipped.failed += 1;
          console.error(
            `[Reactivation] Dispatch failed for ${candidate.customerPhone} (tenant ${tenantId}): ` +
              `${dispatch.error ?? 'unknown error'} — campaign ${campaign.id} left pending`
          );
        }
      } catch (err) {
        summary.skipped.failed += 1;
        console.error(
          `[Reactivation] Dispatch threw for ${candidate.customerPhone} (tenant ${tenantId})`,
          err
        );
      }
    }
  }

  return summary;
}
