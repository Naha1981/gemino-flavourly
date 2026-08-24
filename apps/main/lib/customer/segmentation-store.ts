import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { customerProfiles } from '@/lib/db/schema';
import {
  CUSTOMER_SEGMENTS,
  isCustomerSegment,
  type CustomerSegment,
} from './segmentation';

/** Counts are always returned with every known segment, including zeroes. */
export type SegmentCounts = Record<CustomerSegment, number>;

export function emptySegmentCounts(): SegmentCounts {
  return {
    vip: 0,
    regular: 0,
    at_risk: 0,
    dormant: 0,
    new: 0,
  };
}

/**
 * Drizzle adapter for Gate #8. The tenant-scoped read is intentionally kept
 * separate from the platform-wide aggregate so the cron cannot accidentally
 * recalculate one restaurant's profiles with another restaurant's rows.
 *
 * This module is imported by route handlers only. Framework-free tests should
 * import ./segmentation.ts instead; importing this file initializes the live
 * database client and therefore requires DATABASE_URL.
 */
export async function fetchProfilesForSegmentation(tenantId: string) {
  return db
    .select()
    .from(customerProfiles)
    .where(eq(customerProfiles.tenantId, tenantId));
}

/**
 * Persist a calculated segment only when the segment actually changed.
 *
 * Confidence is a property of the segment assignment, so it is deliberately
 * not refreshed on every six-hour scan when the assignment is unchanged.
 * That keeps `segment_updated_at` meaningful and avoids a write per profile
 * on every cron invocation.
 */
export async function updateSegment(
  profileId: string,
  segment: CustomerSegment,
  confidence: number
): Promise<boolean> {
  const changed = await db
    .update(customerProfiles)
    .set({
      segment,
      segmentConfidence: String(Math.max(0, Math.min(1, confidence))),
      segmentUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(customerProfiles.id, profileId), ne(customerProfiles.segment, segment)))
    .returning({ id: customerProfiles.id });

  return changed.length > 0;
}

async function groupedSegmentCounts(tenantId?: string): Promise<SegmentCounts> {
  const rows = await db
    .select({
      segment: customerProfiles.segment,
      count: sql<number>`count(*)::int`,
    })
    .from(customerProfiles)
    .where(tenantId ? eq(customerProfiles.tenantId, tenantId) : undefined)
    .groupBy(customerProfiles.segment);

  const counts = emptySegmentCounts();
  for (const row of rows) {
    if (isCustomerSegment(row.segment)) counts[row.segment] = Number(row.count) || 0;
  }
  return counts;
}

export async function countBySegment(tenantId: string): Promise<SegmentCounts> {
  return groupedSegmentCounts(tenantId);
}

/** Platform-wide aggregation used only after the Super Admin gate. */
export async function fetchCrossTenantSegmentCounts(): Promise<SegmentCounts> {
  return groupedSegmentCounts();
}

/** Object form for callers that prefer an injectable store-shaped adapter. */
export const drizzleSegmentationStore = {
  fetchProfilesForSegmentation,
  updateSegment,
  countBySegment,
  fetchCrossTenantSegmentCounts,
};

export { CUSTOMER_SEGMENTS };
