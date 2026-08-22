import type { Metadata } from 'next';
import { isClerkConfigured } from '@/lib/config';
import { initDb } from '@/lib/db';
import Providers from './providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: 'Flavourly — WhatsApp that fills your tables',
  description:
    'Every restaurant gets a WhatsApp number that answers in seconds, books tables, runs the waitlist, and turns guests into regulars.',
  openGraph: {
    title: 'Flavourly — WhatsApp that fills your tables',
    description: 'The restaurant operations desk that lives inside WhatsApp.',
    images: ['/images/og-flavourly.jpg'],
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await initDb().catch((err) => {
    console.error('[layout] initDb failed', err);
  });

  return (
    <html lang="en" className="dark">
      <body className="font-sans min-h-screen bg-ink text-cream antialiased">
        <Providers clerkEnabled={isClerkConfigured()}>{children}</Providers>
      </body>
    </html>
  );
}
