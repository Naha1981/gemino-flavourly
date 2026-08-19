import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { waAccounts, conversations, messages, waitlistEntries, tenants, reservations } from '@/lib/db/schema';
import { eq, desc, count, sql } from 'drizzle-orm';
import {
  QrCode,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Users,
  Calendar,
  Sparkles,
  ArrowRight,
  Radio,
  Settings,
  Flame,
} from 'lucide-react';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function TenantDashboard() {
  let userId = null;
  let tenantId = 'demo-tenant-id';

  try {
    const authSession = await auth();
    userId = authSession.userId;
    // In production, derive tenantId from Clerk user public metadata
    const metaTenantId = (authSession.sessionClaims as any)?.metadata?.tenantId;
    if (metaTenantId) tenantId = metaTenantId;
  } catch {
    // Allows demo preview if Clerk not configured yet
  }

  // Fetch or mock the default tenant if not found
  let tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  }).catch(() => null);

  if (!tenant) {
    // Fetch first available tenant or provide placeholder
    tenant = await db.query.tenants.findFirst().catch(() => null);
    if (tenant) tenantId = tenant.id;
  }

  // Fetch WhatsApp account connection state for this tenant
  const waAccount = tenantId
    ? await db.query.waAccounts.findFirst({
        where: eq(waAccounts.tenantId, tenantId),
      }).catch(() => null)
    : null;

  // Operational metrics
  const activeConversationsResult = tenantId
    ? await db
        .select({ count: count() })
        .from(conversations)
        .where(eq(conversations.tenantId, tenantId))
        .catch(() => [{ count: 0 }])
    : [{ count: 0 }];

  const waitlistCountResult = tenantId
    ? await db
        .select({ count: count() })
        .from(waitlistEntries)
        .where(eq(waitlistEntries.tenantId, tenantId))
        .catch(() => [{ count: 0 }])
    : [{ count: 0 }];

  const bookingsCountResult = tenantId
    ? await db
        .select({ count: count() })
        .from(reservations)
        .where(eq(reservations.tenantId, tenantId))
        .catch(() => [{ count: 0 }])
    : [{ count: 0 }];

  // Recent messages feed
  const recentMessages = tenantId
    ? await db
        .select({
          id: messages.id,
          direction: messages.direction,
          content: messages.content,
          isAIGenerated: messages.isAIGenerated,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(eq(messages.tenantId, tenantId))
        .orderBy(desc(messages.createdAt))
        .limit(6)
        .catch(() => [])
    : [];

  const activeConversations = activeConversationsResult[0]?.count ?? 0;
  const waitlistCount = waitlistCountResult[0]?.count ?? 0;
  const bookingsCount = bookingsCountResult[0]?.count ?? 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 selection:bg-zinc-800">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-zinc-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">
                {tenant?.name || 'Restaurant'} Operations Dashboard
              </h1>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Manage your direct WhatsApp AI Concierge, live customer queue, and reservation requests.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/conversations"
              className="px-4 py-2 bg-zinc-100 text-zinc-950 text-xs font-medium rounded-md hover:bg-zinc-200 transition-all flex items-center gap-1.5 shadow-sm"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Live Conversations
            </Link>
            <Link
              href="/dashboard/waitlist"
              className="px-3.5 py-2 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs font-medium rounded-md hover:bg-zinc-800 transition-colors"
            >
              Waitlist Manager
            </Link>
          </div>
        </div>

        {/* WhatsApp Connection Banner */}
        <div
          className={`rounded-lg border p-6 transition-all ${
            waAccount?.isConnected
              ? 'bg-emerald-950/20 border-emerald-800/60'
              : 'bg-amber-950/20 border-amber-800/60'
          }`}
        >
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              {waAccount?.isConnected ? (
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-6 h-6 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <h3 className="font-semibold text-sm text-zinc-100 flex items-center gap-2">
                  {waAccount?.isConnected ? 'WhatsApp Connected & AI Active' : 'Action Required: Connect WhatsApp'}
                  <span
                    className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                      waAccount?.isConnected
                        ? 'bg-emerald-900/60 text-emerald-300'
                        : 'bg-amber-900/60 text-amber-300'
                    }`}
                  >
                    {waAccount?.isConnected ? 'Online 24/7' : 'Disconnected'}
                  </span>
                </h3>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-xl">
                  {waAccount?.isConnected
                    ? `Live on phone line ${waAccount.phoneNumber || 'Linked Phone'}. AI is actively processing reservations, waitlists, and guest enquiries.`
                    : 'Scan the QR code below with your WhatsApp app (Linked Devices) to start autonomous AI customer replies.'}
                </p>

                {/* QR Code Container */}
                {!waAccount?.isConnected && (
                  <div className="mt-4 pt-2">
                    {waAccount?.qrCode ? (
                      <div className="bg-white p-3 rounded-lg border border-zinc-200 inline-block shadow-lg">
                        <img
                          src={
                            waAccount.qrCode.startsWith('data:')
                              ? waAccount.qrCode
                              : `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                                  waAccount.qrCode
                                )}`
                          }
                          alt="WhatsApp QR Code"
                          className="w-44 h-44 object-contain"
                        />
                        <p className="text-[10px] text-center text-zinc-600 mt-2 font-medium">
                          WhatsApp → Linked Devices → Link a Device
                        </p>
                      </div>
                    ) : (
                      <form action="/api/whatsapp/connect" method="POST" className="mt-2">
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <button
                          type="submit"
                          className="px-4 py-2 bg-amber-500 text-zinc-950 font-semibold text-xs rounded-md hover:bg-amber-400 transition-colors flex items-center gap-2"
                        >
                          <QrCode className="w-4 h-4" />
                          Generate New WhatsApp QR Code
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>

            {waAccount?.isConnected && (
              <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1.5 rounded-md self-start">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
                <span>Socket Connected to Render Engine</span>
              </div>
            )}
          </div>
        </div>

        {/* Operational Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <MetricCard
            title="Active Conversations"
            value={activeConversations.toString()}
            icon={MessageSquare}
            hint="Customer WhatsApp threads"
          />
          <MetricCard
            title="Current Waitlist Queue"
            value={waitlistCount.toString()}
            icon={Users}
            hint="Guests waiting for tables"
          />
          <MetricCard
            title="Bookings & Reservations"
            value={bookingsCount.toString()}
            icon={Calendar}
            hint="Upcoming table bookings"
          />
        </div>

        {/* Quick Actions & Recent Activity Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Message Feed */}
          <div className="lg:col-span-2 bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">Live WhatsApp Activity</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Real-time incoming and outgoing AI concierge logs</p>
              </div>
              <Link
                href="/dashboard/conversations"
                className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1 font-medium"
              >
                View full inbox <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="divide-y divide-zinc-800/70">
              {recentMessages.length === 0 ? (
                <div className="px-6 py-12 text-center text-xs text-zinc-500">
                  No WhatsApp messages yet. Scan the QR code and send a test message from your phone.
                </div>
              ) : (
                recentMessages.map((msg) => (
                  <div key={msg.id} className="px-6 py-4 flex items-start gap-3.5 hover:bg-zinc-800/30 transition-colors">
                    <div
                      className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                        msg.direction === 'inbound' ? 'bg-blue-400' : 'bg-emerald-400'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-semibold text-zinc-100">
                            {msg.direction === 'inbound' ? 'Guest / Customer' : 'AI Concierge'}
                          </p>
                          {msg.isAIGenerated && (
                            <span className="text-[9px] uppercase px-1.5 py-0.2 bg-emerald-950 border border-emerald-800 text-emerald-400 rounded">
                              Auto-Replied
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-zinc-500 font-mono">
                          {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-300 mt-1 whitespace-pre-line leading-relaxed">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Quick Management Shortcuts */}
          <div className="space-y-4">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5 space-y-4">
              <h3 className="text-sm font-semibold text-zinc-100">Module Shortcuts</h3>
              <div className="space-y-2">
                <Link
                  href="/dashboard/conversations"
                  className="p-3 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between transition-colors text-xs font-medium text-zinc-200"
                >
                  <span className="flex items-center gap-2.5">
                    <MessageSquare className="w-4 h-4 text-blue-400" />
                    Live WhatsApp Inbox
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                </Link>

                <Link
                  href="/dashboard/waitlist"
                  className="p-3 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between transition-colors text-xs font-medium text-zinc-200"
                >
                  <span className="flex items-center gap-2.5">
                    <Users className="w-4 h-4 text-amber-400" />
                    Waitlist Queue
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                </Link>

                <Link
                  href="/dashboard/loyalty"
                  className="p-3 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between transition-colors text-xs font-medium text-zinc-200"
                >
                  <span className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    Loyalty & Rewards
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                </Link>

                <Link
                  href="/dashboard/settings"
                  className="p-3 rounded-md bg-zinc-950 border border-zinc-800 hover:border-zinc-700 flex items-center justify-between transition-colors text-xs font-medium text-zinc-200"
                >
                  <span className="flex items-center gap-2.5">
                    <Settings className="w-4 h-4 text-zinc-400" />
                    AI System Prompt & Settings
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-zinc-500" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  hint,
}: {
  title: string;
  value: string;
  icon: any;
  hint: string;
}) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">{title}</span>
        <div className="p-2 bg-zinc-800 rounded-md text-zinc-300">
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-3xl font-semibold text-zinc-50 mt-3 tracking-tight">{value}</p>
      <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>
    </div>
  );
}
