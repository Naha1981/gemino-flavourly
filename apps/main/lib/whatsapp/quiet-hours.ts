/**
 * Automated WhatsApp send window for customer-facing scheduled messages.
 *
 * 07:00–20:00 Africa/Johannesburg. Manual staff replies and inbound AI
 * conversations are intentionally not gated by this helper; callers mark
 * only scheduled outbound jobs with `automated: true`.
 */

export const AUTOMATED_SEND_TIMEZONE = 'Africa/Johannesburg';
export const AUTOMATED_SEND_START_MINUTE = 7 * 60;
export const AUTOMATED_SEND_END_MINUTE = 20 * 60;

function parts(now: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatted = new Intl.DateTimeFormat('en-GB', {
    timeZone: AUTOMATED_SEND_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);

  const read = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? 0);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') };
}

export function automatedSendMinute(now: Date = new Date()): number {
  const local = parts(now);
  return local.hour * 60 + local.minute;
}

export function isWithinAutomatedSendWindow(now: Date = new Date()): boolean {
  const minute = automatedSendMinute(now);
  return minute >= AUTOMATED_SEND_START_MINUTE && minute < AUTOMATED_SEND_END_MINUTE;
}

/** Return the next 07:00 SAST instant when automated sending is blocked. */
export function nextAutomatedSendWindow(now: Date = new Date()): Date {
  const local = parts(now);
  const minute = local.hour * 60 + local.minute;
  const addDay = minute >= AUTOMATED_SEND_END_MINUTE ? 1 : 0;
  // South Africa Standard Time is UTC+02:00 year-round, so 07:00 SAST is
  // 05:00 UTC. Using UTC construction avoids server-local timezone drift.
  return new Date(Date.UTC(local.year, local.month - 1, local.day + addDay, 5, 0, 0, 0));
}
