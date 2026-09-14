'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { systemSettings, adminNotifications } from '@/lib/db/schema';
import { eq, isNull } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';

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

export async function markNotificationsReadAction() {
  if (!(await isSuperAdmin())) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  await db
    .update(adminNotifications)
    .set({ readAt: new Date() })
    .where(isNull(adminNotifications.readAt));

  // Force a fresh navigation so the server-rendered unread count is not
  // replaced by a cached RSC tree after the mutation.
  revalidatePath('/admin', 'page');
  redirect('/admin?qa-read=1');
}
