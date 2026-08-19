import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Gemino — Multi-Tenant WhatsApp AI Operating System',
  description: 'Automate table bookings, instant customer concierge, waitlist dispatch, and loyalty over direct WhatsApp.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body className={`${inter.className} min-h-screen bg-zinc-950 text-zinc-100 antialiased`}>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
