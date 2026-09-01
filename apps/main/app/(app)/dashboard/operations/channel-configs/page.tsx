import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOrCreateTenant } from '@/lib/tenant';
import { db } from '@/lib/db';
import { waAccounts } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { listChannelConfigs } from '@/lib/operations/channel-config-store';
import { QrCode } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function ChannelConfigsPage() {
  const tenant = await getOrCreateTenant();
  if (!tenant) redirect('/sign-in');

  const configs = await listChannelConfigs(tenant.id);

  // UI-3R / F4 (S25) — the WhatsApp card must reflect the LIVE connection
  // (the wa_accounts row the WhatsApp page maintains), not the
  // channel-config table: the old card said "Disabled / Not configured"
  // while a QR connection was actually up.
  const [waAccount] = await db
    .select({ isConnected: waAccounts.isConnected, phoneNumber: waAccounts.phoneNumber })
    .from(waAccounts)
    .where(eq(waAccounts.tenantId, tenant.id))
    .limit(1)
    .catch(() => [{ isConnected: false, phoneNumber: null } as { isConnected: boolean; phoneNumber: string | null }]);
  const waConnected = Boolean(waAccount?.isConnected);

  const channels = [
    { key: 'whatsapp', label: 'WhatsApp', icon: '💬' },
    { key: 'email', label: 'Email', icon: '📧' },
    { key: 'instagram', label: 'Instagram', icon: '📷' },
    { key: 'facebook', label: 'Facebook', icon: '👤' },
    { key: 'web', label: 'Web Chat', icon: '🌐' },
  ];

  const enabledCount = channels.filter((ch) => (ch.key === 'whatsapp' ? waConnected : configs.find((c) => c.channel === ch.key)?.enabled)).length;

  return (
    <div className="space-y-6">
      <div className="border-b border-zinc-800 pb-4">
        <h1 className="text-xl font-semibold text-zinc-50">Channels</h1>
        <p className="text-xs text-zinc-400">
          Every door guests can reach you through. {enabledCount} of {channels.length} open right now.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {channels.map((ch) => {
          const config = configs.find((c) => c.channel === ch.key);
          // WhatsApp reads the live connection; everything else reads the
          // channel-config table.
          const isOpen = ch.key === 'whatsapp' ? waConnected : (config?.enabled ?? false);
          return (
            <div key={ch.key} className={`rounded-lg border p-4 ${isOpen ? 'border-emerald-800 bg-zinc-900/80' : 'border-zinc-800 bg-zinc-900/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{ch.icon}</span>
                  <span className="text-sm font-medium text-zinc-100">{ch.label}</span>
                </div>
                {isOpen ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950 px-2 py-0.5 text-xs text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                    Not connected
                  </span>
                )}
              </div>

              {ch.key === 'whatsapp' ? (
                /* F4/S25 — live status + the action that opens the door. */
                <div className="mt-3 space-y-2 text-xs text-zinc-400">
                  <p>{waConnected ? `Connected${waAccount?.phoneNumber ? ` as ${waAccount.phoneNumber}` : ''}. Messages flow through your AI concierge.` : 'Not connected yet — scan the QR code once and your AI concierge starts answering.'}</p>
                  <Link
                    href="/dashboard/whatsapp"
                    className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/30"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    {waConnected ? 'Manage connection' : 'Connect WhatsApp'}
                  </Link>
                </div>
              ) : config ? (
                <div className="mt-3 space-y-2 text-xs text-zinc-400">
                  <div className="flex justify-between">
                    <span>Credentials</span>
                    <span className={config.credentialsEncrypted ? 'text-emerald-300' : 'text-red-300'}>
                      {config.credentialsEncrypted ? 'Stored' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Updated</span>
                    <span>{new Date(config.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ) : (
                /* F11/S26 — owner language, no API talk: an honest
                   "coming soon" instead of a dead-end disabled card. */
                <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                  {ch.label} is coming soon — we&apos;ll set it up with you. It will feed the same inbox and AI as your WhatsApp messages.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 p-6">
        <p className="text-sm leading-relaxed text-zinc-400">
          WhatsApp is your main channel today. Email, Instagram, Facebook and Web Chat are next — every one of them
          will flow into the same inbox and be answered by the same AI concierge, so nothing changes in your daily routine.
        </p>
      </div>
    </div>
  );
}
