'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { waitlistEntries, waAccounts, jobs } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';

/**
 * Bound to the "Table Ready (Notify WA)" button on /dashboard/waitlist.
 * That button previously had no onClick handler at all — clicking it did
 * nothing. This actually sends the WhatsApp notification (via the same
 * outbox pattern as everything else) and moves the entry to 'offered'.
 */
export async function notifyWaitlistEntryAction(formData: FormData) {
  const tenant = await getOrCreateTenant();
  if (!tenant) throw new Error('Not signed in');

  const entryId = String(formData.get('entryId') ?? '');
  if (!entryId) throw new Error('Missing waitlist entry id');

  // Scope the lookup to this tenant — without this, a malicious or buggy
  // client could pass another tenant's entryId and trigger a WhatsApp
  // send / status change on someone else's guest.
  const entry = await db.query.waitlistEntries.findFirst({
    where: and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.tenantId, tenant.id)),
  });
  if (!entry) throw new Error('Waitlist entry not found for this tenant');

  if (!entry.customerPhone) {
    throw new Error('This waitlist entry has no WhatsApp phone number on file');
  }

  const waAccount = await db.query.waAccounts.findFirst({
    where: and(eq(waAccounts.tenantId, tenant.id), eq(waAccounts.isConnected, true)),
  });
  if (!waAccount) {
    throw new Error('No connected WhatsApp account for this tenant — connect WhatsApp first');
  }

  const text = `Hi ${entry.customerName || 'there'}! Your table for ${entry.partySize} at ${tenant.name} is ready. Please head to the host stand within the next 10 minutes.`;

  await db.insert(jobs).values({
    tenantId: tenant.id,
    type: 'send_whatsapp',
    payload: { waAccountId: waAccount.id, to: entry.customerPhone, text },
    status: 'pending',
    nextRunAt: new Date(),
  });

  await db
    .update(waitlistEntries)
    .set({ status: 'offered', notifiedAt: new Date() })
    .where(eq(waitlistEntries.id, entry.id));

  revalidatePath('/dashboard/waitlist');
}
