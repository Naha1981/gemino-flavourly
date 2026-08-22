import { isClerkConfigured, isDemoMode, DEMO_USER } from '@/lib/config';

export type SessionUser = {
  userId: string;
  email: string;
  firstName: string;
  isDemo: boolean;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (isDemoMode() || !isClerkConfigured()) {
    return { ...DEMO_USER, isDemo: true };
  }

  try {
    const { auth, clerkClient } = await import('@clerk/nextjs/server');
    const { userId } = await auth();
    if (!userId) return null;

    const client = typeof clerkClient === 'function' ? await (clerkClient as any)() : clerkClient;
    const user = await client.users.getUser(userId).catch(() => null);
    const email = user?.emailAddresses?.[0]?.emailAddress || '';
    return {
      userId,
      email,
      firstName: user?.firstName || email.split('@')[0] || 'Owner',
      isDemo: false,
    };
  } catch (err) {
    console.error('[session] Clerk auth failed', err);
    return null;
  }
}

export async function requireUser(): Promise<SessionUser | null> {
  return getSessionUser();
}
