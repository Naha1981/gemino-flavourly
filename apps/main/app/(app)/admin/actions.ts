'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { systemSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { markAllAdminNotificationsRead } from '@/lib/qa/alerts';

export async function toggleGlobalAiAction(formData: FormData) {
  if (!(await isSuperAdmin())) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  const enabled = formData.get('enabled') === 'true';

  const settings = await db.query.systemSettings.findFirst();
  if (!settings) {
    await db.insert(systemSettings).values({ masterAiSwitch: enabled });
  } else {
    await db
      .update(systemSettings)
      .set({ masterAiSwitch: enabled, updatedAt: new Date() })
      .where(eq(systemSettings.id, settings.id));
  }

  revalidatePath('/admin');
}

/**
 * QA-2 — Mark all Super Admin notification alerts as read.
 * Revalidate and redirect so the server-component notification count is
 * guaranteed to be recomputed after the mutation rather than relying on a
 * stale client-rendered tree.
 */
export async function markNotificationsReadAction() {
  if (!(await isSuperAdmin())) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  await markAllAdminNotificationsRead();
  revalidatePath('/admin');
  redirect('/admin');
}
