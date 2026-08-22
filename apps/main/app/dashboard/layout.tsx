import Link from 'next/link';
import { ReactNode } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  QrCode,
  Settings,
  Users,
  Gift,
  CalendarDays,
} from 'lucide-react';
import { getSessionUser } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/config';
import { AccountChip } from './account-chip';

const links = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/dashboard/bookings', label: 'Bookings', icon: CalendarDays },
  { href: '/dashboard/waitlist', label: 'Waitlist', icon: Users },
  { href: '/dashboard/loyalty', label: 'Loyalty', icon: Gift },
  { href: '/dashboard/whatsapp', label: 'WhatsApp', icon: QrCode },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await getSessionUser();

  return (
    <div className="flex min-h-screen bg-ink text-cream">
      <aside className="hidden w-64 flex-col border-r border-line bg-ink-2/70 p-6 md:flex">
        <Link href="/" className="mb-10 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-saffron font-display text-lg font-semibold text-ink">
            F
          </span>
          <div>
            <div className="font-display text-lg leading-none">Flavourly</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-cream-dim">House desk</div>
          </div>
        </Link>

        <nav className="flex-1 space-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-cream-dim transition-colors hover:bg-ink hover:text-cream"
            >
              <link.icon className="h-4 w-4 text-saffron" />
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="border-t border-line pt-4">
          <AccountChip
            name={session?.firstName || 'Owner'}
            email={session?.email || ''}
            demo={isDemoMode()}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-2 overflow-x-auto border-b border-line px-4 py-3 md:hidden">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="whitespace-nowrap rounded-full border border-line px-3 py-1 text-xs text-cream-dim"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <main className="flex-1 overflow-y-auto p-6 md:p-10">{children}</main>
      </div>
    </div>
  );
}
