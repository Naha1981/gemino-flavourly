import { db } from '@/lib/db';
import { jobs } from '@/lib/db/schema';

export async function enqueueWhatsApp(opts: {
  tenantId: string;
  waAccountId: string;
  to: string;
  text: string;
}) {
  const [job] = await db
    .insert(jobs)
    .values({
      tenantId: opts.tenantId,
      type: 'send_whatsapp',
      payload: {
        waAccountId: opts.waAccountId,
        to: opts.to,
        text: opts.text,
      },
      status: 'pending',
      nextRunAt: new Date(),
    })
    .returning();
  return job;
}
