import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { conversations, contacts, messages } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { MessageSquare, Phone, Star, Mail, Instagram, Facebook, Globe, Radio, Check } from 'lucide-react';
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
    <span title={meta.label} className="inline-flex h-5 w-5 items-center justify-center rounded text-app-faint dark:text-zinc-400">
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

/** Stitch badge for a conversation card, derived from existing fields. */
function ConvoBadge({ outcome }: { outcome: string | null }) {
  if (outcome === 'missed' || outcome === 'lost') {
    return (
      <span className="label-sm rounded-full bg-app-error-container px-2 py-0.5 text-app-error dark:bg-red-950 dark:text-red-300">
        Action Required
      </span>
    );
  }
  if (outcome === 'converted' || outcome === 'handled') {
    return (
      <span className="label-sm inline-flex items-center gap-1 rounded-full bg-app-surface-3 px-2 py-0.5 text-app-muted dark:bg-zinc-800 dark:text-zinc-300">
        <Check className="h-3 w-3" /> AI Answered
      </span>
    );
  }
  return (
    <span className="label-sm rounded-full bg-stitch-gold/15 px-2 py-0.5 text-stitch-brass ring-1 ring-stitch-gold/50 dark:text-stitch-gold">
      AI Draft Ready
    </span>
  );
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
      outcome: conversations.outcome,
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
      {/* Header row: AI Revenue Employee status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="headline-md text-app-fg dark:text-zinc-50">AI Revenue Inbox</h1>
          <p className="body-md text-app-muted dark:text-zinc-400">Every guest conversation, handled or flagged.</p>
        </div>
        <Link
          href="/dashboard/settings"
          className="label-md inline-flex items-center gap-2 rounded-full border border-app-secondary-container bg-app-secondary-container/50 px-4 py-1.5 text-app-on-secondary-container dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
        >
          <span className="h-2 w-2 rounded-full bg-app-secondary dark:bg-emerald-400" />
          AI Revenue Employee Active
        </Link>
      </div>

      {vipAlerts.length > 0 && (
        <div className="glass-card border-l-4 !border-l-stitch-gold p-4">
          <div className="mb-3 flex items-center gap-2">
            <Star className="h-4 w-4 fill-stitch-gold text-stitch-gold" />
            <h3 className="label-md text-stitch-brass dark:text-stitch-gold">VIP Alert</h3>
            <Link
              href="/dashboard/customers/vip-today"
              className="label-sm ml-auto font-medium text-stitch-brass hover:opacity-80 dark:text-stitch-gold"
            >
              View all today →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vipAlerts.map((alert) => (
              <Link
                key={alert.id}
                href={`/dashboard/customers/${encodeURIComponent(alert.customerPhone)}`}
                className="rounded-xl border border-app-border bg-app-surface-1 p-3 transition-colors hover:border-stitch-gold dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-stitch-gold"
              >
                <div className="flex items-center justify-between">
                  <span className="label-md text-app-fg dark:text-zinc-50">{alert.customerName || 'Guest'}</span>
                  <span className="label-sm uppercase tracking-wide text-stitch-brass dark:text-stitch-gold">
                    {alert.totalVisits} visits
                  </span>
                </div>
                <div className="label-sm mt-1 flex items-center justify-between text-app-muted dark:text-zinc-400">
                  <span>{formatCents(alert.totalSpendCents)} spend</span>
                  <span className="font-mono text-[11px]">{alert.customerPhone}</span>
                </div>
                <div className="label-sm mt-1 leading-snug text-app-faint dark:text-zinc-500">
                  {formatPreferences(alert.preferences)} · Last visit {formatDate(alert.lastVisitAt)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Filter pills: All / WhatsApp / … + workstream pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-app-border bg-app-surface-0 p-2 dark:border-zinc-800 dark:bg-zinc-900/50">
        <span className="flex items-center gap-1.5 px-2 text-xs font-medium text-app-muted dark:text-zinc-400">
          <Radio className="h-3.5 w-3.5 text-app-secondary dark:text-emerald-400" /> Channels
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
        <span className="mx-1 hidden h-4 w-px bg-app-border sm:block dark:bg-zinc-800" />
        <ChannelFilterLink href="/dashboard/reputation" label="Review Drafts" active={false} />
        <ChannelFilterLink href="/dashboard/operations/approval-requests" label="Approvals" active={false} />
      </div>

      <div className="flex h-[calc(100vh-14rem)] overflow-hidden rounded-2xl border border-app-border bg-app-surface-0 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        {/* Left: conversation cards */}
        <div className="w-full overflow-y-auto border-r border-app-border md:w-1/3 dark:border-zinc-800">
          <div className="border-b border-app-border bg-app-surface-1 p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
            <h2 className="label-md text-app-fg dark:text-zinc-100">
              Live Inbox{' '}
              {activeChannel && (
                <span className="text-xs font-normal text-app-faint dark:text-zinc-400">
                  · {CHANNEL_META[activeChannel as ChannelKey]?.label}
                </span>
              )}
            </h2>
          </div>
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm leading-relaxed text-app-faint dark:text-zinc-500">
              No conversations{activeChannel ? ` on ${CHANNEL_META[activeChannel as ChannelKey]?.label}` : ''} yet.{' '}
              <br />
              When customers message you, they will appear here in real-time.
            </div>
          ) : (
            <ul className="divide-y divide-app-border dark:divide-zinc-800">
              {filtered.map((c) => {
                const needsAction = c.outcome === 'missed' || c.outcome === 'lost';
                return (
                  <li key={c.id} className={needsAction ? 'border-l-4 border-l-app-error' : ''}>
                    <Link
                      href={`/dashboard/inbox/${c.id}`}
                      className="flex items-center gap-2 p-4 transition-colors hover:bg-app-surface-1 dark:hover:bg-zinc-800/50"
                    >
                      <ChannelIcon channel={c.channel ?? 'whatsapp'} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-app-fg dark:text-zinc-50">
                            {c.contactName || c.contactPhone}
                          </span>
                          <span className="label-sm shrink-0 text-app-faint dark:text-zinc-500">
                            {c.lastMessageAt?.toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1 truncate text-xs text-app-muted dark:text-zinc-400">
                            <Phone className="h-3 w-3 text-app-faint dark:text-zinc-500" />
                            {c.contactPhone}
                          </p>
                          <ConvoBadge outcome={c.outcome ?? null} />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Right: chat pane */}
        <div className="flex flex-1 flex-col bg-app-surface-1/60 dark:bg-zinc-950/40">
          {filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-app-faint dark:text-zinc-500">
              <div className="rounded-full border border-app-border bg-app-surface-0 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <MessageSquare className="h-8 w-8 text-app-secondary dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-medium text-app-muted dark:text-zinc-300">No conversation selected</h3>
              <p className="label-sm max-w-sm text-app-faint dark:text-zinc-500">
                Your AI concierge is actively monitoring your connected channels.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-app-border bg-app-surface-1 p-4 dark:border-zinc-800 dark:bg-zinc-900/80">
                <ChannelIcon channel={filtered[0].channel ?? 'whatsapp'} />
                <h3 className="text-sm font-semibold text-app-fg dark:text-zinc-100">
                  {filtered[0].contactName || filtered[0].contactPhone}
                </h3>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                <div className="py-8 text-center text-xs text-app-faint dark:text-zinc-500">
                  Conversation thread active. AI is auto-replying to customer inquiries.
                </div>
              </div>
              <div className="border-t border-app-border bg-app-surface-0 p-4 dark:border-zinc-800 dark:bg-zinc-950">
                <input
                  type="text"
                  placeholder="Type a manual reply to take over from AI..."
                  className="w-full rounded-lg border border-app-border bg-app-surface-1 px-4 py-2.5 text-sm text-app-fg placeholder:text-app-faint focus:border-stitch-gold focus:outline-none focus:ring-1 focus:ring-stitch-gold dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:placeholder:text-zinc-600 dark:focus:border-emerald-500 dark:focus:ring-emerald-500"
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
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border border-app-secondary bg-app-secondary-container text-app-on-secondary-container dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'border border-transparent text-app-muted hover:bg-app-surface-2 hover:text-app-fg dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
      }`}
    >
      {label}
    </Link>
  );
}
