import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';

export type BookingDraft = {
  id: string;
  tenantId: string;
  contactId: string;
  conversationId: string;
  status: 'collecting' | 'ready' | 'confirmed' | 'expired';
  dateText: string | null;
  timeText: string | null;
  partySize: number | null;
  notes: string | null;
  expiresAt: Date;
};

const TTL_MS = 30 * 60 * 1000;

function rowToDraft(row: any): BookingDraft | null {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    status: row.status,
    dateText: row.date_text,
    timeText: row.time_text,
    partySize: row.party_size == null ? null : Number(row.party_size),
    notes: row.notes,
    expiresAt: new Date(row.expires_at),
  };
}

export async function getActiveBookingDraft(conversationId: string): Promise<BookingDraft | null> {
  const result = await db.execute(sql`
    SELECT *
    FROM booking_drafts
    WHERE conversation_id = ${conversationId}
      AND status IN ('collecting', 'ready')
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return rowToDraft((result as any).rows?.[0] ?? (result as any)[0]);
}

export function extractBookingSlots(text: string): {
  dateText?: string;
  timeText?: string;
  partySize?: number;
  notes?: string;
} {
  const lower = text.toLowerCase();
  const out: { dateText?: string; timeText?: string; partySize?: number; notes?: string } = {};

  const party = lower.match(/\b(?:for|party of|table for)\s*(\d{1,2})\b/) ?? lower.match(/\b(\d{1,2})\s*(?:guests|people|pax)\b/);
  if (party) out.partySize = Math.max(1, Math.min(30, Number(party[1])));

  const time = lower.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (time) {
    const hour = Number(time[1]);
    const minute = time[2] ?? '00';
    const meridiem = time[3].toUpperCase();
    if (hour >= 1 && hour <= 12) out.timeText = `${hour}:${minute} ${meridiem}`;
  }

  if (/\btomorrow\b/.test(lower)) out.dateText = 'tomorrow';
  else if (/\btonight\b/.test(lower)) out.dateText = 'today';
  else if (/\btoday\b/.test(lower)) out.dateText = 'today';
  else {
    const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso) out.dateText = iso[1];
    else {
      const weekday = lower.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
      if (weekday) out.dateText = weekday[1];
    }
  }

  const noteMatch = text.match(/\b(?:for|with)\b.*?\b(?:birthday|anniversary|vegan|vegetarian|gluten|wheelchair|baby|child|window|outside|quiet)\b.*$/i);
  if (noteMatch) out.notes = noteMatch[0].trim();

  return out;
}

function parseDate(dateText: string, now = new Date()): Date | null {
  const lower = dateText.toLowerCase();
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);
  if (lower === 'today' || lower === 'tonight') return base;
  if (lower === 'tomorrow') {
    base.setDate(base.getDate() + 1);
    return base;
  }
  if (/^20\d{2}-\d{2}-\d{2}$/.test(lower)) {
    const d = new Date(`${lower}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const target = weekdays.indexOf(lower);
  if (target >= 0) {
    for (let i = 1; i <= 7; i += 1) {
      const candidate = new Date(base);
      candidate.setDate(base.getDate() + i);
      if (candidate.getDay() === target) return candidate;
    }
  }
  return null;
}

function parseTime(timeText: string): { hours: number; minutes: number } | null {
  const m = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (m[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
  if (m[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
  return { hours, minutes };
}

export function draftMissingFields(draft: Pick<BookingDraft, 'dateText' | 'timeText' | 'partySize'>): string[] {
  const missing: string[] = [];
  if (!draft.dateText) missing.push('date');
  if (!draft.timeText) missing.push('time');
  if (!draft.partySize) missing.push('number of guests');
  return missing;
}

export async function upsertBookingDraft(input: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  text: string;
}): Promise<BookingDraft> {
  const current = await getActiveBookingDraft(input.conversationId);
  const slots = extractBookingSlots(input.text);
  const values = {
    dateText: slots.dateText ?? current?.dateText ?? null,
    timeText: slots.timeText ?? current?.timeText ?? null,
    partySize: slots.partySize ?? current?.partySize ?? null,
    notes: slots.notes ?? current?.notes ?? null,
  };
  const status = draftMissingFields(values).length === 0 ? 'ready' : 'collecting';
  const expiresAt = new Date(Date.now() + TTL_MS);

  if (current) {
    const result = await db.execute(sql`
      UPDATE booking_drafts
      SET date_text = ${values.dateText},
          time_text = ${values.timeText},
          party_size = ${values.partySize},
          notes = ${values.notes},
          status = ${status},
          expires_at = ${expiresAt},
          updated_at = NOW()
      WHERE id = ${current.id}
      RETURNING *
    `);
    return rowToDraft((result as any).rows?.[0] ?? (result as any)[0])!;
  }

  const id = randomUUID();
  const result = await db.execute(sql`
    INSERT INTO booking_drafts
      (id, tenant_id, contact_id, conversation_id, status, date_text, time_text, party_size, notes, expires_at)
    VALUES
      (${id}, ${input.tenantId}, ${input.contactId}, ${input.conversationId}, ${status},
       ${values.dateText}, ${values.timeText}, ${values.partySize}, ${values.notes}, ${expiresAt})
    RETURNING *
  `);
  return rowToDraft((result as any).rows?.[0] ?? (result as any)[0])!;
}

export async function confirmReadyDraft(draft: BookingDraft): Promise<{ reservationId: string; reservationDate: Date }> {
  const date = draft.dateText ? parseDate(draft.dateText) : null;
  const time = draft.timeText ? parseTime(draft.timeText) : null;
  if (!date || !time || !draft.partySize) {
    throw new Error('BOOKING_DRAFT_INCOMPLETE');
  }
  date.setHours(time.hours, time.minutes, 0, 0);

  const result = await db.execute(sql`
    INSERT INTO reservations
      (tenant_id, contact_id, conversation_id, customer_name, date, party_size, status, notes)
    SELECT
      ${draft.tenantId}, ${draft.contactId}, ${draft.conversationId},
      COALESCE(c.name, 'Guest'), ${date}, ${draft.partySize}, 'confirmed', ${draft.notes}
    FROM contacts c
    WHERE c.id = ${draft.contactId}
    RETURNING id, date
  `);

  const row = (result as any).rows?.[0] ?? (result as any)[0];
  if (!row) throw new Error('BOOKING_DRAFT_RESERVATION_FAILED');

  await db.execute(sql`
    UPDATE booking_drafts
    SET status = 'confirmed', updated_at = NOW()
    WHERE id = ${draft.id}
  `);

  return { reservationId: String(row.id), reservationDate: new Date(row.date) };
}

export async function expireBookingDrafts(): Promise<number> {
  const result = await db.execute(sql`
    UPDATE booking_drafts
    SET status = 'expired', updated_at = NOW()
    WHERE status IN ('collecting', 'ready')
      AND expires_at <= NOW()
    RETURNING id
  `);
  return Number((result as any).rowCount ?? (result as any).rows?.length ?? 0);
}
