'use server';

import { revalidatePath, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { systemSettings, adminNotifications } from '@/lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

// QA-2 release verification: server mutations revalidate their read surfaces.
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
 * Keep the UPDATE free of RETURNING so the same mutation works in the
 * pg-mem gate harness and production Postgres.
 */
export async function markNotificationsReadAction() {
  if (!(await isSuperAdmin())) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  await db
    .update(adminNotifications)
    .set({ readAt: new Date() })
    .where(isNull(adminNotifications.readAt));

  revalidatePath('/admin');
  redirect('/admin');
}
