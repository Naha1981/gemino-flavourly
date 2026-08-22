'use client';

import { ReactNode } from 'react';

export default function Providers({
  children,
  clerkEnabled,
}: {
  children: ReactNode;
  clerkEnabled: boolean;
}) {
  if (!clerkEnabled) return <>{children}</>;

  const { ClerkProvider } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: '#c9862a',
          colorBackground: '#14110e',
          colorText: '#f4efe6',
          colorInputBackground: '#0c0b0a',
          colorInputText: '#f4efe6',
          borderRadius: '0.6rem',
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
