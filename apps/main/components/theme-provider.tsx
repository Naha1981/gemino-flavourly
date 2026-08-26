'use client';

import { createContext, useContext, type ReactNode, type CSSProperties } from 'react';

/**
 * Branding injection.
 *
 * Loads a tenant's brand profile (extracted by the Brand Intelligence Engine)
 * and exposes it two ways:
 *   1. As CSS custom properties (--brand-primary, --brand-secondary,
 *      --brand-background) + a font-family override on the wrapper element, so
 *      any style that references those variables adopts the restaurant's own
 *      palette.
 *   2. As a React context so components (e.g. the /claim page and dashboard
 *      layout) can render the tenant's logo and brand name.
 *
 * With no brand (the common case for live tenants) it renders children
 * untouched — the default Flavourly branding stays.
 */

export interface BrandForTheme {
  brandName?: string | null;
  logoUrl?: string | null;
  logoPath?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  backgroundColor?: string | null;
  fontFamily?: string | null;
}

export interface BrandThemeContextValue {
  brand: BrandForTheme | null;
}

const BrandThemeContext = createContext<BrandThemeContextValue>({ brand: null });

const FALLBACK_COLORS = {
  primary: '#1F6F5C',
  secondary: '#C9A25A',
  background: '#0b1210',
};

export function ThemeProvider({
  children,
  brand,
}: {
  children: ReactNode;
  brand?: BrandForTheme | null;
}) {
  const active = brand ?? null;
  const primary = active?.primaryColor || FALLBACK_COLORS.primary;
  const secondary = active?.secondaryColor || FALLBACK_COLORS.secondary;
  const background = active?.backgroundColor || FALLBACK_COLORS.background;
  const font =
    active?.fontFamily && active.fontFamily !== 'serif' ? active.fontFamily : undefined;

  const style = ({
    '--brand-primary': primary,
    '--brand-secondary': secondary,
    '--brand-background': background,
    ...(font ? { fontFamily: font } : {}),
  } as unknown) as CSSProperties;

  return (
    <BrandThemeContext.Provider value={{ brand: active }}>
      <div style={style}>{children}</div>
    </BrandThemeContext.Provider>
  );
}

export function useBrandTheme(): BrandThemeContextValue {
  return useContext(BrandThemeContext);
}
