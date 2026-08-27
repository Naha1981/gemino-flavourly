import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';
// Stitch typography + icons — self-hosted via npm packages (fontsource /
// material-symbols). No Google CDN at build or runtime.
import '@fontsource/playfair-display/500.css';
import '@fontsource/playfair-display/600.css';
import '@fontsource/playfair-display/700.css';
import 'material-symbols/outlined.css';
import { ThemeModeProvider } from '@/components/theme-mode';
import { clerkIsConfigured } from '@/lib/auth/route-guard-core';

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // RC1 layer 2 — `<ClerkProvider>` throws
  // "@clerk/clerk-react: Missing publishableKey" when the key is absent,
  // which 500'd EVERY page including /pricing, /privacy and /terms. Those
  // pages need no auth, so we skip the provider and let the degraded Clerk
  // stand-ins in components/clerk-shell render instead.
  const clerkReady = clerkIsConfigured(process.env);
  if (!clerkReady) {
    console.error(
      '[layout] Clerk publishable key missing/invalid — rendering without ClerkProvider. ' +
        'Public pages stay up; auth features are disabled. ' +
        'Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in Vercel -> Settings -> Environment Variables.',
    );
  }

  const shell = (
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

  return clerkReady ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
