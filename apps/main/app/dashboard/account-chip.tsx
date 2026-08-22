'use client';

export function AccountChip({ name, email, demo }: { name: string; email: string; demo: boolean }) {
  if (!demo) {
    try {
      const { UserButton } = require('@clerk/nextjs') as typeof import('@clerk/nextjs');
      return (
        <div className="flex items-center justify-between px-1">
          <div>
            <p className="text-sm text-cream">{name}</p>
            <p className="text-[11px] text-cream-dim">{email}</p>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      );
    } catch {
      /* fall through */
    }
  }

  return (
    <div className="px-1">
      <p className="text-sm text-cream">{name}</p>
      <p className="text-[11px] text-cream-dim">{email}</p>
      {demo && <p className="mt-2 text-[10px] uppercase tracking-widest text-saffron">Demo house</p>}
    </div>
  );
}
