import { desc, eq, and, or, lt, gt, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { prospects, tenantClaimTokens, type ProspectStatus } from '@/lib/db/schema';
import { generateClaimToken, tokenExpiry, buildClaimLink } from './magic-link.ts';

export type ProspectRow = typeof prospects.$inferSelect;
export type ClaimTokenRow = typeof tenantClaimTokens.$inferSelect;

export interface CreateProspectInput {
  name: string;
  website: string;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
  city?: string | null;
}

export async function createProspect(input: CreateProspectInput): Promise<ProspectRow> {
  const [row] = await db
    .insert(prospects)
    .values({
      name: input.name,
      website: input.website,
      ownerEmail: input.ownerEmail ?? null,
      ownerPhone: input.ownerPhone ?? null,
      city: input.city ?? null,
      status: 'queued',
    })
    .returning();
  return row;
}

export async function createProspectsBulk(inputs: CreateProspectInput[]): Promise<ProspectRow[]> {
  if (inputs.length === 0) return [];
  return db.insert(prospects).values(inputs.map((i) => ({
    name: i.name,
    website: i.website,
    ownerEmail: i.ownerEmail ?? null,
    ownerPhone: i.ownerPhone ?? null,
    city: i.city ?? null,
  }))).returning();
}

export async function listProspects(): Promise<ProspectRow[]> {
  return db.select().from(prospects).orderBy(desc(prospects.createdAt)).limit(200);
}

export async function getProspect(id: string): Promise<ProspectRow | null> {
  const [row] = await db.select().from(prospects).where(eq(prospects.id, id)).limit(1);
  return row ?? null;
}

export async function getProspectByTenant(tenantId: string): Promise<ProspectRow | null> {
  const [row] = await db.select().from(prospects).where(eq(prospects.tenantId, tenantId)).limit(1);
  return row ?? null;
}

export async function updateProspect(
  id: string,
  patch: Partial<Pick<ProspectRow, 'status' | 'error' | 'retries' | 'tenantId' | 'claimToken' | 'claimedAt'>>
): Promise<ProspectRow | null> {
  const [row] = await db
    .update(prospects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(prospects.id, id))
    .returning();
  return row ?? null;
}

export async function deleteProspect(id: string): Promise<void> {
  await db.delete(prospects).where(eq(prospects.id, id));
}

export async function countProspectsByStatus(): Promise<Partial<Record<ProspectStatus, number>>> {
  const rows = await db
    .select({ status: prospects.status, count: sql<number>`count(*)::int` })
    .from(prospects)
    .groupBy(prospects.status);
  const out: Partial<Record<ProspectStatus, number>> = {};
  for (const r of rows) out[r.status as ProspectStatus] = Number(r.count);
  return out;
}

/**
 * Up to `limit` prospects that need building: either still 'queued', or
 * 'failed' with attempts left (retries < 3). Excludes ready/claimed/enriching.
 */
export async function findBuildableProspects(limit = 5): Promise<ProspectRow[]> {
  return db
    .select()
    .from(prospects)
    .where(and(
      or(
        eq(prospects.status, 'queued'),
        and(eq(prospects.status, 'failed'), lt(prospects.retries, 3))
      )
    ))
    .orderBy(desc(prospects.createdAt))
    .limit(limit);
}

// ── Magic link / claim tokens ───────────────────────────────────────────────

/** Create a claim token for a tenant, expiring 30 days from now. */
export async function createClaimToken(tenantId: string): Promise<ClaimTokenRow> {
  const token = generateClaimToken();
  const now = new Date();
  const [row] = await db
    .insert(tenantClaimTokens)
    .values({
      tenantId,
      token,
      createdAt: now,
      expiresAt: tokenExpiry(now),
    })
    .returning();
  return row;
}

/** Find an unused, unexpired token for a tenant (for re-display without churn). */
export async function findLiveClaimTokenForTenant(tenantId: string): Promise<ClaimTokenRow | null> {
  const [row] = await db
    .select()
    .from(tenantClaimTokens)
    .where(and(
      eq(tenantClaimTokens.tenantId, tenantId),
      isNull(tenantClaimTokens.claimedAt),
      gt(tenantClaimTokens.expiresAt, new Date())
    ))
    .limit(1);
  return row ?? null;
}

export async function findClaimToken(token: string): Promise<ClaimTokenRow | null> {
  const [row] = await db.select().from(tenantClaimTokens).where(eq(tenantClaimTokens.token, token)).limit(1);
  return row ?? null;
}

export async function markTokenClaimed(token: string, claimedByUserId: string): Promise<ClaimTokenRow | null> {
  const [row] = await db
    .update(tenantClaimTokens)
    .set({ claimedAt: new Date(), claimedByUserId })
    .where(eq(tenantClaimTokens.token, token))
    .returning();
  return row ?? null;
}

export function claimLinkFor(tokenRow: ClaimTokenRow): string {
  return buildClaimLink(tokenRow.token);
}
