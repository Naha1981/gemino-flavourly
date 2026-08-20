import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import LandingClient from './landing-client';

/**
 * Server Component wrapper for the landing page.
 *
 * Previously this whole page was `'use client'`, so a signed-in user
 * hitting `/` would only find out they're authenticated after Clerk's
 * client-side JS hydrates and evaluates `<SignedIn>` — meaning they'd
 * always see the landing page first, with a manual "Open Dashboard"
 * button, rather than landing on /dashboard directly. This server-side
 * check redirects before any of that renders.
 *
 * The interactive landing page itself (nav, hero, sign-in/up buttons,
 * the hidden double-click-logo admin door) is unchanged, just moved to
 * ./landing-client.tsx so it can stay a client component.
 */
export default async function Page() {
  const { userId } = await auth();
  if (userId) {
    redirect('/dashboard');
  }

  return <LandingClient />;
}
