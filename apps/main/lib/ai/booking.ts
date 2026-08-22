export type BookingDraft = {
  partySize: number | null;
  date: Date | null;
  notes: string | null;
  complete: boolean;
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function nextWeekday(target: number, from = new Date()): Date {
  const d = new Date(from);
  const diff = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function parseTime(text: string): { hours: number; minutes: number } | null {
  const m =
    text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/i) ||
    text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = m[2] && /^\d{2}$/.test(m[2]) ? parseInt(m[2], 10) : 0;
  const mer = (m[3] || m[2] || '').toLowerCase();
  if (mer === 'pm' && hours < 12) hours += 12;
  if (mer === 'am' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

function parseDate(text: string): Date | null {
  const lower = text.toLowerCase();
  const now = new Date();
  let day: Date | null = null;

  if (/\btoday\b/.test(lower)) {
    day = new Date(now);
  } else if (/\btomorrow\b/.test(lower)) {
    day = new Date(now);
    day.setDate(day.getDate() + 1);
  } else {
    for (let i = 0; i < WEEKDAYS.length; i++) {
      if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(lower)) {
        day = nextWeekday(i, now);
        break;
      }
    }
  }

  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    const parsed = new Date(`${iso[1]}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) day = parsed;
  }

  const time = parseTime(lower);
  if (!day && !time) return null;
  const result = day ?? new Date(now);
  if (time) {
    result.setHours(time.hours, time.minutes, 0, 0);
  } else {
    result.setHours(19, 0, 0, 0);
  }
  return result;
}

export function extractBooking(text: string): BookingDraft {
  const party =
    text.match(/\b(?:for|table(?:\s+for)?|party(?:\s+of)?)\s+(\d{1,2})\b/i) ||
    text.match(/\b(\d{1,2})\s+(?:people|guests|pax|of us)\b/i);

  const partySize = party ? parseInt(party[1], 10) : null;
  const date = parseDate(text);
  const complete = Boolean(partySize && partySize > 0 && partySize <= 20 && date);

  return {
    partySize: partySize && partySize > 0 && partySize <= 20 ? partySize : null,
    date,
    notes: text.trim(),
    complete,
  };
}

export function looksLikeBooking(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('book') ||
    lower.includes('reservation') ||
    /\btable\b/.test(lower) ||
    lower.startsWith('reserve')
  );
}
