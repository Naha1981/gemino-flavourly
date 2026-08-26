/**
 * VIP alerts — daily 07:00 brief (Engine 2).
 *
 * The VIP-today page and the webhook already raise alerts when a recognised
 * VIP sends their first message. This module adds the scheduled summary the
 * PRD calls for: a morning brief of today's VIPs and a suggested action for
 * staff. Pure and framework-free so it is unit-testable; the cron wires it
 * with the existing vip-store.
 */

export interface VipAlertSummaryItem {
  customerName: string | null;
  customerPhone: string;
  totalVisits: number;
  totalSpendCents: number;
  servedAt: Date | null;
}

export interface VipAlertBriefInput {
  tenantName: string | null;
  today: VipAlertSummaryItem[];
  now: Date;
}

export interface VipAlertBrief {
  line: string;
  count: number;
}

/** Suggested staff action for a VIP (used in the brief copy). */
function suggestedAction(totalVisits: number, totalSpendCents: number): string {
  if (totalSpendCents >= 500_00) return 'Offer the tasting menu + a manager hello.';
  if (totalVisits >= 8) return 'Acknowledge by name & mention their favourite.';
  if (totalVisits >= 4) return 'Complimentary drink to thank a regular.';
  return 'Warm welcome & a table by the window.';
}

/** Build the morning VIP brief line for a tenant. */
export function buildVipDailyBrief(input: VipAlertBriefInput): VipAlertBrief {
  const { tenantName, today, now } = input;
  const time = new Date(now).toISOString().slice(11, 16);
  if (today.length === 0) {
    return {
      line: `${tenantName ?? 'Your venue'} — no VIP walk-ins confirmed yet today (as of ${time}).`,
      count: 0,
    };
  }

  const names = today.map((t) => t.customerName ?? 'A VIP').slice(0, 3).join(', ');
  const extra = today.length > 3 ? ` and ${today.length - 3} more` : '';
  const top = today[0];
  const line =
    `🌟 VIP brief for ${tenantName ?? 'your venue'} (${time}): ${today.length} VIP(s) today — ${names}${extra}. ` +
    `For ${top.customerName ?? 'the top VIP'}: ${suggestedAction(top.totalVisits, top.totalSpendCents)}`;

  return { line, count: today.length };
}
