import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { conversations, contacts, messages } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { MessageSquare, Phone, Star, Mail, Instagram, Facebook, Globe, Radio } from 'lucide-react';
import { getOrCreateTenant } from '@/lib/tenant';
import { listVipAlerts } from '@/lib/customer/vip-store';

import Link from 'next/link';

export const dynamic = 'force-dynamic';

type ChannelKey = 'whatsapp' | 'email' | 'instagram' | 'facebook' | 'web';

const CHANNEL_META: Record<ChannelKey, { icon: any; label: string }> = {
  whatsapp: { icon: MessageSquare, label: 'WhatsApp' },
  email: { icon: Mail, label: 'Email' },
  instagram: { icon: Instagram, label: 'Instagram' },
  facebook: { icon: Facebook, label: 'Facebook' },
  web: { icon: Globe, label: 'Web' },
};

const CHANNEL_FILTERS: ChannelKey[] = ['whatsapp', 'email', 'instagram', 'facebook', 'web'];

function ChannelIcon({ channel }: { channel: string }) {
  const meta = CHANNEL_META[(channel as ChannelKey) in CHANNEL_META ? (channel as ChannelKey) : 'whatsapp'];
  const Icon = meta.icon;
  return (
    <span title={meta.label} className="inline-flex h-5 w-5 items-center justify-center rounded text-zinc-400">
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function formatCents(cents: number): string {
  return `R${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(value: Date | string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

function formatPreferences(preferences: unknown): string {
  const prefs = (preferences ?? {}) as { dietary?: string[]; favorites?: string[] };
  const parts: string[] = [];
  if (Array.isArray(prefs.dietary) && prefs.dietary.length) parts.push(`Dietary: ${prefs.dietary.join(', ')}`);
  if (Array.isArray(prefs.favorites) && prefs.favorites.length) parts.push(`Favorite: ${prefs.favorites[0]}`);
  return parts.length ? parts.join(' · ') : 'Preferences: none';
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: { channel?: string };
}) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  let tenant = await getOrCreateTenant();
  const tenantId = tenant?.id;

  if (!tenantId) {
    redirect('/sign-in');
  }

  const activeChannel = searchParams?.channel ?? '';

  const convos = await db
    .select({
      id: conversations.id,
      contactId: conversations.contactId,
      contactPhone: contacts.phone,
      contactName: contacts.name,
      channel: conversations.channel,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .leftJoin(contacts, eq(conversations.contactId, contacts.id))
    .where(eq(conversations.tenantId, tenantId))
    .orderBy(desc(conversations.lastMessageAt))
    .catch(() => []);

  const filtered = activeChannel
    ? convos.filter((c) => (c.channel ?? 'whatsapp') === activeChannel)
    : convos;

  const vipAlerts = await listVipAlerts(tenantId, 5, 0).catch(() => []);

  return (
    <div className="space-y-4">
      {vipAlerts.length > 0 && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-300">VIP Alert</h3>
            <Link
              href="/dashboard/customers/vip-today"
              className="ml-auto text-xs font-medium text-amber-400 hover:text-amber-300"
            >
              View all today →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vipAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/dashboard/customers/${encodeURIComponent(alert.customerPhone)}`}
                className="rounded-lg border border-amber-800/50 bg-zinc-900/60 p-3 hover:border-amber-500/60 hover:bg-zinc-900 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-50 text-sm">{alert.customerName || 'Guest'}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                    {alert.totalVisits} visits
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                  <span>{formatCents(alert.totalSpendCents)} spend</span>
                  <span className="font-mono text-[11px]">{alert.customerPhone}</span>
                </div>
                <div className="mt-1 text-[11px] text-zinc-500 leading-snug">
                  {formatPreferences(alert.preferences)} · Last visit {formatDate(alert.lastVisitAt)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Multi-channel filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2">
        <span className="flex items-center gap-1.5 px-2 text-xs font-medium text-zinc-400">
          <Radio className="h-3.5 w-3.5 text-emerald-400" /> Channels
        </span>
        <ChannelFilterLink href="/dashboard/inbox" label="All" active={!activeChannel} />
        {CHANNEL_FILTERS.map((ch) => (
          <ChannelFilterLink
            key={ch}
            href={`/dashboard/inbox?channel=${ch}`}
            label={CHANNEL_META[ch].label}
            active={activeChannel === ch}
          />
        ))}
      </div>

      <div className="flex h-[calc(100vh-12rem)] overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/50 shadow-sm">
      {/* Left Sidebar: Conversations List */}
      <div className="w-full md:w-1/3 border-r border-zinc-800 overflow-y-auto">
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/80">
          <h2 className="text-base font-semibold text-zinc-100">
            Live Inbox {activeChannel && <span className="text-xs font-normal text-zinc-400">· {CHANNEL_META[activeChannel as ChannelKey]?.label}</span>}
          </h2>
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-zinc-500 leading-relaxed">
            No conversations{activeChannel ? ` on ${CHANNEL_META[activeChannel as ChannelKey]?.label}` : ''} yet. <br />
            When customers message you, they will appear here in real-time.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {filtered.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/inbox/${c.id}`}
                  className="flex items-center gap-2 p-4 hover:bg-zinc-800/50 transition-colors"
                >
                  <ChannelIcon channel={c.channel ?? 'whatsapp'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="truncate font-medium text-zinc-50 text-sm">{c.contactName || c.contactPhone}</span>
                      <span className="text-xs text-zinc-500">
                        {c.lastMessageAt?.toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 truncate mt-1 flex items-center gap-1">
                      <Phone className="w-3 h-3 text-zinc-500" />
                      {c.contactPhone}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right Side: Chat Window */}
      <div className="flex-1 flex flex-col bg-zinc-950/40">
        {filtered.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-3 p-6 text-center">
            <div className="p-3 bg-zinc-900 rounded-full border border-zinc-800">
              <MessageSquare className="h-8 w-8 text-emerald-400" />
            </div>
            <h3 className="text-sm font-medium text-zinc-300">No conversation selected</h3>
            <p className="text-xs text-zinc-500 max-w-sm">
              Your AI concierge is actively monitoring your connected channels.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/80 flex items-center gap-2">
              <ChannelIcon channel={filtered[0].channel ?? 'whatsapp'} />
              <h3 className="font-semibold text-zinc-100 text-sm">{filtered[0].contactName || filtered[0].contactPhone}</h3>
            </div>
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
              <div className="text-center text-xs text-zinc-500 py-8">
                Conversation thread active. AI is auto-replying to customer inquiries.
              </div>
            </div>
            <div className="p-4 border-t border-zinc-800 bg-zinc-950">
              <input
                type="text"
                placeholder="Type a manual reply to take over from AI..."
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function ChannelFilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800'
          : 'text-zinc-400 border border-transparent hover:bg-zinc-800 hover:text-zinc-50'
      }`}
    >
      {label}
    </Link>
  );
}
