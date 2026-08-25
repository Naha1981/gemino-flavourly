import Link from 'next/link';

export function FlavourlyLogo({ compact = false }: { compact?: boolean }) {
  return <Link href="/" aria-label="Flavourly home" className="flex items-center gap-2">
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 25V8M16 12c-5-1-8-4-8-8 5 0 8 3 8 8Z" fill="#1F6F5C"/><path d="M12 8V3M16 8V3M20 8V3M10 8h12M16 25c0 3-2 4-2 4h4s-2-1-2-4Z" fill="none" stroke="#C9A25A" strokeWidth="1.7" strokeLinecap="round"/></svg>
    {!compact && <span className="font-display text-xl tracking-tight text-cream">Flavour<span className="text-gold-400">ly</span></span>}
  </Link>;
}
