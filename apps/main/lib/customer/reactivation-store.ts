import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  contacts,
  customerProfiles,
  jobs,
  reactivationCampaigns,
  tenants,
  waAccounts,
} from '@/lib/db/schema';
import { isWithinResponseWindow, type ReactivationSegment } from './reactivation.ts';
import type {
  ReactivationCampaignStore,
  ReactivationCandidate,
  ReactivationTenant,
} from './reactivation-cron.ts';

export type ReactivationCampaignRow = typeof reactivationCampaigns.$inferSelect;
export type ReactivationCampaignListRow = ReactivationCampaignRow & { customerName: string | null };

export function serializeReactivationCampaign(campaign: ReactivationCampaignRow) {
  return { ...campaign, segment: campaign.segment as ReactivationSegment, sent_at: campaign.sentAt, created_at: campaign.createdAt };
}

export async function createPendingCampaign(tenantId: string, customerPhone: string, segment: ReactivationSegment, messageText: string): Promise<ReactivationCampaignRow> {
  const [row] = await db.insert(reactivationCampaigns).values({ tenantId, customerPhone, segment, messageText }).returning();
  return row;
}

export async function markSent(campaignId: string, sentAt: Date = new Date()): Promise<boolean> {
  const rows = await db.update(reactivationCampaigns).set({ sentAt }).where(and(eq(reactivationCampaigns.id, campaignId), isNull(reactivationCampaigns.sentAt))).returning({ id: reactivationCampaigns.id });
  return rows.length > 0;
}

export async function markResponded(campaignId: string): Promise<boolean> {
  const rows = await db.update(reactivationCampaigns).set({ responded: true }).where(and(eq(reactivationCampaigns.id, campaignId), eq(reactivationCampaigns.responded, false))).returning({ id: reactivationCampaigns.id });
  return rows.length > 0;
}

export async function getPendingCampaigns(tenantId: string): Promise<ReactivationCampaignRow[]> {
  return db.select().from(reactivationCampaigns).where(and(eq(reactivationCampaigns.tenantId, tenantId), isNull(reactivationCampaigns.sentAt))).orderBy(reactivationCampaigns.createdAt);
}

export async function getCampaignHistory(tenantId: string, customerPhone: string): Promise<ReactivationCampaignRow[]> {
  return db.select().from(reactivationCampaigns).where(and(eq(reactivationCampaigns.tenantId, tenantId), eq(reactivationCampaigns.customerPhone, customerPhone))).orderBy(desc(reactivationCampaigns.createdAt));
}

export async function findLatestCampaign(tenantId: string, customerPhone: string): Promise<ReactivationCampaignRow | null> {
  const [row] = await db.select().from(reactivationCampaigns).where(and(eq(reactivationCampaigns.tenantId, tenantId), eq(reactivationCampaigns.customerPhone, customerPhone))).orderBy(desc(reactivationCampaigns.createdAt)).limit(1);
  return row ?? null;
}

export async function listCampaigns(tenantId: string, limit: number, offset: number): Promise<ReactivationCampaignListRow[]> {
  const rows = await db.select({ campaign: reactivationCampaigns, customerName: customerProfiles.customerName }).from(reactivationCampaigns).leftJoin(customerProfiles, and(eq(customerProfiles.tenantId, reactivationCampaigns.tenantId), eq(customerProfiles.customerPhone, reactivationCampaigns.customerPhone))).where(eq(reactivationCampaigns.tenantId, tenantId)).orderBy(desc(reactivationCampaigns.createdAt)).limit(limit).offset(offset);
  return rows.map((row) => ({ ...row.campaign, customerName: row.customerName }));
}

export async function countCampaigns(tenantId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(reactivationCampaigns).where(eq(reactivationCampaigns.tenantId, tenantId));
  return Number(row?.value ?? 0);
}

export interface ReactivationTargetProfile {
  profileId: string;
  customerPhone: string;
  customerName: string | null;
  totalVisits: number;
  lastVisitAt: Date | null;
  segment: string | null;
  preferences: unknown;
  blocklisted: boolean;
}

export async function findReactivationTargetProfile(tenantId: string, customerPhone: string): Promise<ReactivationTargetProfile | null> {
  const [profile] = await db.select().from(customerProfiles).where(and(eq(customerProfiles.tenantId, tenantId), eq(customerProfiles.customerPhone, customerPhone))).limit(1);
  if (!profile) return null;
  const [contact] = await db.select({ blocklisted: contacts.blocklisted }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.phone, customerPhone))).limit(1);
  return { profileId: profile.id, customerPhone: profile.customerPhone, customerName: profile.customerName, totalVisits: profile.totalVisits, lastVisitAt: profile.lastVisitAt, segment: profile.segment, preferences: profile.preferences, blocklisted: Boolean(contact?.blocklisted) };
}

export interface ReactivationCampaignStats {
  total: number;
  pending: number;
  sent: number;
  responded: number;
  responseRate: number;
}

export async function campaignStats(tenantId: string): Promise<ReactivationCampaignStats> {
  const [row] = await db.select({ total: sql<number>`count(*)::int`, pending: sql<number>`count(*) FILTER (WHERE ${reactivationCampaigns.sentAt} IS NULL)::int`, sent: sql<number>`count(*) FILTER (WHERE ${reactivationCampaigns.sentAt} IS NOT NULL)::int`, responded: sql<number>`count(*) FILTER (WHERE ${reactivationCampaigns.responded} AND ${reactivationCampaigns.sentAt} IS NOT NULL)::int` }).from(reactivationCampaigns).where(eq(reactivationCampaigns.tenantId, tenantId));
  const total = Number(row?.total ?? 0), pending = Number(row?.pending ?? 0), sent = Number(row?.sent ?? 0), responded = Number(row?.responded ?? 0);
  return { total, pending, sent, responded, responseRate: sent > 0 ? responded / sent : 0 };
}

export async function markLatestCampaignResponded(tenantId: string, customerPhone: string, now: Date = new Date()): Promise<ReactivationCampaignRow | null> {
  const [latest] = await db.select().from(reactivationCampaigns).where(and(eq(reactivationCampaigns.tenantId, tenantId), eq(reactivationCampaigns.customerPhone, customerPhone), isNotNull(reactivationCampaigns.sentAt), eq(reactivationCampaigns.responded, false))).orderBy(desc(reactivationCampaigns.sentAt)).limit(1);
  if (!latest?.sentAt || !isWithinResponseWindow(latest.sentAt, now)) return null;
  return (await markResponded(latest.id)) ? latest : null;
}

export const drizzleReactivationCampaignStore = { createPendingCampaign, markSent, markResponded, getPendingCampaigns, getCampaignHistory, findLatestCampaign, listCampaigns, countCampaigns, campaignStats, markLatestCampaignResponded };

export async function findReactivationTenants(): Promise<ReactivationTenant[]> {
  return db.select({ id: tenants.id, name: tenants.name, aiEnabled: tenants.aiEnabled, manualMode: tenants.manualMode }).from(tenants);
}

export async function fetchCampaignCandidates(tenantId: string): Promise<ReactivationCandidate[]> {
  const rows = await db.select({ profileId: customerProfiles.id, tenantId: customerProfiles.tenantId, customerPhone: customerProfiles.customerPhone, customerName: customerProfiles.customerName, totalVisits: customerProfiles.totalVisits, lastVisitAt: customerProfiles.lastVisitAt, storedSegment: customerProfiles.segment, preferences: customerProfiles.preferences, blocklisted: contacts.blocklisted }).from(customerProfiles).leftJoin(contacts, and(eq(contacts.tenantId, customerProfiles.tenantId), eq(contacts.phone, customerProfiles.customerPhone))).where(and(eq(customerProfiles.tenantId, tenantId), inArray(customerProfiles.segment, ['dormant', 'at_risk']), sql`COALESCE(${contacts.blocklisted}, false) = false`));
  return rows.map((row) => ({ ...row, blocklisted: Boolean(row.blocklisted) }));
}

export async function queueCampaignMessage(input: { tenantId: string; waAccountId: string; to: string; text: string }): Promise<void> {
  await db.insert(jobs).values({
    tenantId: input.tenantId,
    type: 'send_whatsapp',
    payload: { waAccountId: input.waAccountId, to: input.to, text: input.text, automated: true },
    status: 'pending',
    nextRunAt: new Date(),
  });
}

export async function resolveReactivationSender(tenantId: string): Promise<{ waAccountId: string } | null> {
  const [account] = await db.select({ id: waAccounts.id }).from(waAccounts).where(and(eq(waAccounts.tenantId, tenantId), eq(waAccounts.isConnected, true))).limit(1);
  return account ? { waAccountId: account.id } : null;
}

export const drizzleReactivationCronStore: ReactivationCampaignStore = { findTenants: findReactivationTenants, fetchCampaignCandidates, findLatestCampaign, createPendingCampaign, markSent, queueCampaignMessage, resolveSender: resolveReactivationSender };
