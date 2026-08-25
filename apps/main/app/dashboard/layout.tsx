import { FileText, LayoutDashboard, MessageSquare, QrCode, Settings, Star, Swords, TrendingUp, Users, Radio } from 'lucide-react';
import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const links = [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/dashboard/inbox', label: 'Inbox', icon: MessageSquare },
    { href: '/dashboard/customers', label: 'Customers', icon: Users },
    { href: '/dashboard/customers/vip-today', label: 'VIP Today', icon: Star },
    // Gate #11 — Reputation: Google reviews, response drafting, competitor ratings.
    { href: '/dashboard/reputation', label: 'Reputation', icon: TrendingUp },
    // Gates #15-#18 — Market Intelligence: competitor discovery, menu/price/
    // promotion tracking, market opportunities and positioning.
    {href: '/dashboard/market/competitors', label: 'Market Intelligence', icon: Swords },
    { href: '/dashboard/marketing', label: 'Marketing', icon: FileText },
    { href: '/dashboard/marketing/campaigns', label: 'Campaigns', icon: FileText },
    { href: '/dashboard/marketing/events', label: 'Events', icon: FileText },
    { href: '/dashboard/marketing/calendar', label: 'Calendar', icon: FileText },
    { href: '/dashboard/operations/channel-configs', label: 'Channels', icon: Radio },
    { href: '/dashboard/operations/approval-requests', label: 'Approvals', icon: TrendingUp },
    { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: QrCode },
    { href: '/dashboard/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-50">
      <aside className="flex w-64 flex-col border-r border-zinc-800 bg-zinc-900/50 p-6">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-lg font-bold text-zinc-900 shadow-sm">
            G
          </span>
          <span className="text-lg font-semibold tracking-tight">Gemino AI</span>
        </div>
        
        <nav className="flex-1 space-y-2">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-md px-4 py-2.5 text-sm font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
            >
              <link.icon className="h-4 w-4 text-emerald-400" />
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs text-zinc-500">Account</span>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </aside>
      
      <main className="flex-1 overflow-y-auto p-8">
        {children}
      </main>
    </div>
  );
}
