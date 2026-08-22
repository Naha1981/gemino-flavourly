import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { isDemoMode } from '@/lib/config';
import LandingClient from './landing-client';

export default async function Page() {
  const session = await getSessionUser();
  if (session && !isDemoMode() && !session.isDemo) {
    redirect('/dashboard');
  }

  return <LandingClient demo={isDemoMode()} />;
}
