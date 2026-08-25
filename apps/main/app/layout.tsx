import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

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
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body className="min-h-screen bg-green-950 font-sans text-text antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
