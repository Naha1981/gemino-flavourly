import type { Metadata } from 'next';
import './globals.css';
// Stitch typography + icons — self-hosted via npm packages (fontsource /
// material-symbols). No Google CDN at build or runtime.
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import 'material-symbols/outlined.css';
import { ThemeModeProvider } from '@/components/theme-mode';

export const metadata: Metadata = {
  title: 'Flavourly — The AI WhatsApp Employee for South African Restaurants',
  description: 'Flavourly answers WhatsApp, books tables and brings back customers for South African restaurants.',
  icons: [
    { rel: 'icon', url: '/icon.svg', type: 'image/svg+xml' },
    { rel: 'apple-touch-icon', url: '/logo-mark.png' },
  ],
  manifest: '/manifest.json',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Flavourly — The AI WhatsApp Employee for South African Restaurants',
    description: 'Your restaurant, fully booked. While you cook.',
    type: 'website',
    images: ['/logo.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Flavourly — The AI WhatsApp Employee',
    description: 'WhatsApp bookings, handled automatically.',
    images: ['/logo.png'],
  },
};

/**
 * PERF-1 — this shell deliberately contains ZERO dynamic APIs (no
 * `cookies()`, `headers()`, `auth()`) and ZERO `<ClerkProvider>`.
 *
 * Previously `<ClerkProvider>` lived here, wrapping every route in the app.
 * `<ClerkProvider>`'s server half reads request headers to hydrate initial
 * auth state, and Next.js treats "layout uses a dynamic API" as "every route
 * under this layout is dynamic" — so /pricing, /privacy and /terms (which
 * touch no auth state at all) were forced into server-rendered-on-demand
 * (ƒ) instead of prerendered-static (○), even though nothing about their
 * content depends on the visitor's session.
 *
 * `<ClerkProvider>` now lives only in app/(app)/layout.tsx, scoped to the
 * routes that actually need it (dashboard, admin, sign-in, sign-up,
 * onboarding, claim). app/(marketing)/layout.tsx has no provider at all.
 * Route groups are siblings, not nested, so a page only ever renders
 * whichever one layout applies to it — never both, so there's no risk of
 * two <ClerkProvider> instances mounting at once.
 *
 * Marketing pages that still need to show signed-in-aware nav chrome (the
 * "Open Dashboard" button, avatar, etc.) get it via components/clerk-shell,
 * which lazily self-mounts its own client-only <ClerkProvider> — see that
 * file for why that's safe here.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Stitch: light is the default. A returning user's saved dark
            preference is applied before first paint (no flash). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('flavourly_theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-app-bg font-sans text-app-fg antialiased">
        <ThemeModeProvider>{children}</ThemeModeProvider>
      </body>
    </html>
  );
}
