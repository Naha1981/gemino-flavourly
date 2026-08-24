/**
 * Gate #9 — Reactivation response handling: the framework-free runner.
 *
 * Called by the inbound WhatsApp webhook (via the Drizzle adapter in
 * ./reactivation-store.ts) to decide whether an inbound customer message
 * counts as a response to a reactivation campaign, and to flip the
 * campaign's responded flag exactly once.
 *
 * Rules, in order:
 *   1. the message must carry booking intent (isReactivationReply —
 *      "book", "reserve", "table", …). A "no thanks" or a POPIA "STOP"
 *      never burns the flag.
 *   2. only a campaign actually dispatched within the reply window counts
 *      as the one being answered — a pending (unsent) row is not a
 *      campaign the customer could have seen.
 *   3. only the first unanswered campaign is flipped; later replies are
 *      no-ops (the webhook stays fully functional either way).
 *
 * Marking responded is bookkeeping only: the webhook's normal flow keeps
 * running, so "I'd like to book Saturday for 4" drops straight into the
 * regular AI booking flow.
 */

import { REACTIVATION_REPLY_WINDOW_DAYS, isReactivationReply } from './reactivation.ts';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SentCampaignRef {
  id: string;
  sentAt: Date | string | null;
  responded: boolean;
}

export interface ReactivationResponseStore {
  /**
   * Campaigns dispatched to this customer since `since`, newest first.
   * Implementations must scope by BOTH tenantId and customerPhone — the
   * same phone number in two restaurants is two different customers.
   */
  findRecentSentCampaigns(
    tenantId: string,
    customerPhone: string,
    since: Date
  ): Promise<SentCampaignRef[]>;
  markResponded(campaignId: string): Promise<boolean>;
}

export interface ReactivationResponseInput {
  tenantId: string;
  customerPhone: string;
  text: string;
  now?: Date;
}

/** Record one inbound message against the customer's reactivation history. */
export async function recordReactivationResponse(
  store: ReactivationResponseStore,
  input: ReactivationResponseInput
): Promise<SentCampaignRef | null> {
  if (!isReactivationReply(input.text)) return null;

  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - REACTIVATION_REPLY_WINDOW_DAYS * MS_PER_DAY);

  const campaigns = await store.findRecentSentCampaigns(input.tenantId, input.customerPhone, since);
  const campaign = campaigns.find((row) => !row.responded);
  if (!campaign) return null;

  await store.markResponded(campaign.id);
  return campaign;
}
