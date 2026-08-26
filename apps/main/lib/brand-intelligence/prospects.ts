/**
 * Brand Intelligence Engine — prospect utilities.
 *
 * Pure helpers for the super-admin /admin/prospects console and the
 * background processor: a tolerant CSV parser (name, website, owner email,
 * phone, city) and the status/retry transition rules. Framework free so both
 * the UI and the cron share exactly one definition of what a prospect can
 * become.
 */

export type ProspectStatus = 'queued' | 'enriching' | 'ready' | 'failed' | 'claimed';

export const PROSPECT_STATUSES: ProspectStatus[] = ['queued', 'enriching', 'ready', 'failed', 'claimed'];

export interface ProspectRow {
  name: string;
  website: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  city: string | null;
}

export interface ParsedCsv {
  rows: ProspectRow[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, keyof ProspectRow> = {
  name: 'name',
  restaurant: 'name',
  'restaurant name': 'name',
  website: 'website',
  url: 'website',
  'website url': 'website',
  'owner email': 'ownerEmail',
  email: 'ownerEmail',
  'owner phone': 'ownerPhone',
  phone: 'ownerPhone',
  city: 'city',
};

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Parse a CSV string into prospect rows. Tolerates a header row, quoted
 * fields/single quotes, and blank lines; rows missing a name or website are
 * captured as errors rather than silently dropped.
 */
export function parseProspectsCsv(csv: string): ParsedCsv {
  const rows: ProspectRow[] = [];
  const errors: string[] = [];

  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows, errors };

  const headers = splitCsvLine(lines[0]).map(normalizeHeader);
  const index: Partial<Record<keyof ProspectRow, number>> = {};
  headers.forEach((h, i) => {
    const field = HEADER_ALIASES[h];
    if (field) index[field] = i;
  });

  // If there's no recognisable header, fall back to positional
  // name, website, email, phone, city — matching the "Add Prospect" form.
  // In positional mode the whole file is data (there is no header line).
  const positional = headers.every((h) => !HEADER_ALIASES[h]);
  const start = positional ? 0 : 1;

  for (let ln = start; ln < lines.length; ln++) {
    const cols = splitCsvLine(lines[ln]);
    if (positional) {
      const [name, website, ownerEmail, ownerPhone, city] = cols;
      pushRow({ name, website, ownerEmail, ownerPhone, city }, ln + 1);
    } else {
      pushRow(
        {
          name: fieldAt(cols, index.name),
          website: fieldAt(cols, index.website),
          ownerEmail: fieldAt(cols, index.ownerEmail),
          ownerPhone: fieldAt(cols, index.ownerPhone),
          city: fieldAt(cols, index.city),
        },
        ln + 1
      );
    }
  }

  function pushRow(row: ProspectRow, lineNo: number) {
    if (!row.name || !row.name.trim()) {
      errors.push(`Line ${lineNo}: missing name`);
      return;
    }
    if (!row.website || !row.website.trim()) {
      errors.push(`Line ${lineNo}: missing website`);
      return;
    }
    rows.push({
      name: row.name.trim(),
      website: normalizeWebsite(row.website.trim()),
      ownerEmail: row.ownerEmail?.trim() || null,
      ownerPhone: row.ownerPhone?.trim() || null,
      city: row.city?.trim() || null,
    });
  }

  return { rows, errors };
}

function fieldAt(cols: string[], idx: number | undefined): string {
  if (idx === undefined || idx >= cols.length) return '';
  return cols[idx];
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim().replace(/^'|'$/g, ''));
}

function normalizeWebsite(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * The retry policy for a failed prospect: allow up to 3 attempts, but never
 * re-queue a prospect that already resolved to 'ready' or 'claimed'.
 */
export function canRetry(status: ProspectStatus, retries: number): boolean {
  if (status === 'ready' || status === 'claimed') return false;
  return retries < 3;
}

/** Decide the next status after a build attempt completes. */
export function nextProspectStatus(success: boolean): ProspectStatus {
  return success ? 'ready' : 'failed';
}
