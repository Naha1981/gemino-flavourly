/**
 * Demo Mode — deterministic fake identifiers.
 *
 * SAFETY CONTRACT: every seeded row carries a UUID that starts with the
 * obvious hex marker 'deadbeef'. Wipe deletes ONLY rows whose id matches
 * `deadbeef-%`, so real data can never be modified or deleted by the demo
 * system. Ids are deterministic per (namespace, index) so seeding is
 * reproducible and running seed twice (wipe-then-seed) yields identical
 * datasets.
 */

export const DEADBEEF_PREFIX = 'deadbeef';

/** Two-hex-char namespaces keep entity types identifiable at a glance. */
const NAMESPACES: Record<string, string> = {
  tenant: '0100',
  contact: 'c001',
  profile: 'c002',
  booking: 'b001',
  conversation: 'd001',
  message: 'd002',
  approval: 'd003',
  review: 'e001',
  campaign: 'f001',
  brief: 'f002',
  event: 'f003',
  competitor: 'a001',
  snapshot: 'a002',
  promo: 'a003',
  opportunity: 'a004',
  revenue: '9001',
  brand: '7001',
  wa: '8001',
  pulsemap: 'f004',
  pulseseg: 'f005',
};

function hex(n: number, width: number): string {
  const h = Math.abs(Math.floor(n)).toString(16);
  return h.slice(-width).padStart(width, '0');
}

/** Build a valid 8-4-4-4-12 UUID prefixed with deadbeef. */
export function deadId(namespace: keyof typeof NAMESPACES | string, index: number): string {
  const ns = NAMESPACES[namespace] ?? 'dddd';
  return `deadbeef-${ns}-4${hex(index, 3)}-8${hex(index >> 12, 3)}-${hex(index, 12)}`;
}

/** SQL predicate used by wipe — only ever matches demo rows. */
export function deadbeefPredicate(column = 'id'): string {
  return `${column}::text LIKE '${DEADBEEF_PREFIX}-%'`;
}

/** True when a uuid-ish value belongs to the demo namespace. */
export function isDeadbeefId(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${DEADBEEF_PREFIX}-`);
}
