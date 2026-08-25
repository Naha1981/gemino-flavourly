'use client';

export function BrandLoader() {
  return <div role="status" aria-label="Loading Flavourly" className="brand-loader mx-auto flex max-w-md flex-col items-center gap-5 py-10">
    <svg viewBox="0 0 360 90" className="w-full" aria-hidden="true"><path className="loader-line" d="M42 45H318"/><g className="loader-node"><circle cx="42" cy="45" r="18"/><text x="42" y="49" textAnchor="middle">C</text></g><g className="loader-node"><circle cx="180" cy="45" r="18"/><text x="180" y="49" textAnchor="middle">U</text></g><g className="loader-node"><circle cx="318" cy="45" r="18"/><text x="318" y="49" textAnchor="middle">O</text></g><rect className="loader-card" x="25" y="35" width="24" height="20" rx="4"/></svg>
    <span className="font-display text-lg text-cream loader-wordmark">Flavour<span className="text-gold-400">ly</span></span>
  </div>;
}
