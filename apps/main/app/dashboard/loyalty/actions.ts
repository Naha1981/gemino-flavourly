'use server';

import { revalidatePath } from 'next/cache';
import { db, initDb } from '@/lib/db';
import { contacts, loyaltyTransactions } from '@/lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { getOrCreateTenant } from '@/lib/tenant';

export async function awardLoyaltyAction(formData: FormData) {
  await initDb();
  const tenant = await getOrCreateTenant();
  if (!tenant) throw new Error('Not signed in');

  const contactId = String(formData.get('contactId') || '');
  const amount = parseInt(String(formData.get('amount') || '0'), 10);
  const description = String(formData.get('description') || 'Floor award').slice(0, 200);

  if (!contactId || !Number.isFinite(amount) || amount === 0) {
    throw new Error('Contact and non-zero amount are required');
  }

  const contact = await db.query.contacts.findFirst({
    where: and(eq(contacts.id, contactId), eq(contacts.tenantId, tenant.id)),
  });
  if (!contact) throw new Error('Guest not found for this house');

  await db.insert(loyaltyTransactions).values({
    tenantId: tenant.id,
    contactId,
    type: amount > 0 ? 'earn' : 'adjustment',
    amount,
    description,
  });

  await db
    .update(contacts)
    .set({ loyaltyPoints: sql`${contacts.loyaltyPoints} + ${amount}` })
    .where(eq(contacts.id, contactId));

  revalidatePath('/dashboard/loyalty');
}
