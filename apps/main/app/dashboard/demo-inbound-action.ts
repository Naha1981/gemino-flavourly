'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { processDemoInbound } from '@/lib/demo/inbound';

export async function sendDemoInbound(formData: FormData) {
  const text = String(formData.get('text') || '').trim();
  if (!text) return;
  const conversationId = await processDemoInbound({ text });
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/inbox');
  revalidatePath('/dashboard/bookings');
  revalidatePath('/dashboard/waitlist');
  revalidatePath('/dashboard/loyalty');
  if (conversationId) redirect(`/dashboard/inbox/${conversationId}`);
}
