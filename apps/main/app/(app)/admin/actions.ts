'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { systemSettings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { isSuperAdmin } from '@/lib/auth/is-super-admin';
import { markAllAdminNotificationsRead } from '@/lib/qa/alerts';

/**
 * Bound directly to the kill-switch <form>'s `action` prop in
 * app/admin/page.tsx. A plain HTML form always POSTs as
 * application/x-www-form-urlencoded — pointing it at
 * /api/admin/toggle-ai (which does `await req.json()`) threw
 * "Unexpected token 'e', 'enabled=false' is not valid JSON" on every
 * single submit, a 500 with no redirect back to the page.
 *
 * A Server Action sidesteps the whole content-type mismatch: Next.js
 * handles the form submission encoding itself, this runs on the server,
 * and revalidatePath refreshes the page's data so the badge/button
 * label flips immediately without a manual reload.
 */
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
 * QA-2 — "Mark all read" for the Super Admin notification inbox (the QA
 * failure-alert panel). Sets read_at on every unread admin_notifications
 * row, which clears the unread badge. The action is bound from the portal
 * page; the isSuperAdmin() re-check below keeps it safe even if a
 * non-admin ever posts the form action directly.
 */
export async function markNotificationsReadAction() {
  if (!(await isSuperAdmin())) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  await markAllAdminNotificationsRead();

  revalidatePath('/admin');
}
