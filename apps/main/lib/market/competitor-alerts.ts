import type { MenuDiff } from './menu-scraper.ts';

/**
 * Gate #16 — alert formatting for competitor tracking, framework-free.
 *
 * Alert copy is the gate contract verbatim:
 *   menu change  -> "⚠️ {name} updated their menu. New items: … Price changes: …"
 *   promotion    -> "⚠️ {name} launched a promotion: {text}"
 *
 * Delivery (inbox system message) is wired by the cron's Drizzle store via
 * lib/reputation/competitor-store.ts's insertSystemAlert — the same
 * staff-facing channel the rating-drop alerts use.
 */

export const MENU_CHANGE_ALERT_MAX_ITEMS = 5;

function formatCents(cents: number): string {
  const rands = cents / 100;
  return `R${Number.isInteger(rands) ? rands : rands.toFixed(2)}`;
}

/** "⚠️ Market Alert: X updated their menu. New items: … Price changes: …" */
export function formatMenuChangeAlert(competitorName: string, diff: MenuDiff): string {
  const parts: string[] = [];

  if (diff.newItems.length > 0) {
    const names = diff.newItems.slice(0, MENU_CHANGE_ALERT_MAX_ITEMS).map((item) => item.name).join(', ');
    const more = diff.newItems.length > MENU_CHANGE_ALERT_MAX_ITEMS
      ? ` (+${diff.newItems.length - MENU_CHANGE_ALERT_MAX_ITEMS} more)`
      : '';
    parts.push(`New items: ${names}${more}`);
  }

  if (diff.removedItems.length > 0) {
    const names = diff.removedItems.slice(0, MENU_CHANGE_ALERT_MAX_ITEMS).map((item) => item.name).join(', ');
    const more = diff.removedItems.length > MENU_CHANGE_ALERT_MAX_ITEMS
      ? ` (+${diff.removedItems.length - MENU_CHANGE_ALERT_MAX_ITEMS} more)`
      : '';
    parts.push(`Removed: ${names}${more}`);
  }

  if (diff.priceChanges.length > 0) {
    const changes = diff.priceChanges
      .slice(0, MENU_CHANGE_ALERT_MAX_ITEMS)
      .map((change) => `${change.name} ${formatCents(change.fromCents)}→${formatCents(change.toCents)}`)
      .join(', ');
    const more = diff.priceChanges.length > MENU_CHANGE_ALERT_MAX_ITEMS
      ? ` (+${diff.priceChanges.length - MENU_CHANGE_ALERT_MAX_ITEMS} more)`
      : '';
    parts.push(`Price changes: ${changes}${more}`);
  }

  return `⚠️ Market Alert: ${competitorName} updated their menu. ${parts.join('. ')}.`;
}

/** "⚠️ Market Alert: X launched a promotion: {text}" */
export function formatPromotionAlert(competitorName: string, promotionText: string): string {
  return `⚠️ Market Alert: ${competitorName} launched a promotion: ${promotionText}`;
}
