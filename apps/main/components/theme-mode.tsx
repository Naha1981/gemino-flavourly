'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';

/**
 * Stitch design system — light mode is the DEFAULT; dark mode is opt-in.
 *
 * The preference persists in localStorage (flavourly_theme) and is applied
 * as a `dark` class on <html>. An inline script in the root layout applies
 * the class before first paint so a returning dark-mode user never sees a
 * light flash (and a fresh profile always starts light).
 */

export const THEME_STORAGE_KEY = 'flavourly_theme';
export type ThemeMode = 'light' | 'dark';

interface ThemeModeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue>({
  theme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
});

function applyThemeClass(mode: ThemeMode) {
  const root = document.documentElement;
  if (mode === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>('light');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark') setThemeState('dark');
    } catch {
      // storage unavailable — stay light
    }
    applyThemeClass(theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    applyThemeClass(mode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore quota/privacy failures; the class still applies
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeModeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode() {
  return useContext(ThemeModeContext);
}

/** Compact sun/moon toggle for the dashboard header. */
export function ThemeToggle({ label = 'Toggle dark mode' }: { label?: string }) {
  const { theme, toggleTheme } = useThemeMode();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-testid="theme-toggle"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-app-border bg-app-surface-0 text-app-fg transition-colors hover:bg-app-surface-2"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

/**
 * Flavourly logo chip: light-surface treatment keeps the dark-green + gold
 * mark legible in dark mode. Never replaces the logo asset itself.
 *
 * QA-2 / owner spec "make the app logo bigger, clear, readable, visually
 * visible": default height bumped h-9 → h-11 (44px — the 579×357 wordmark
 * renders ~71px wide, comfortably readable), the surface padding and ring
 * enlarged to match, and the dashboard sidebar/mobile header pass their own
 * larger sizes on top (h-12 / h-9).
 */
export function LogoChip({ src = '/logo.png', alt = 'Flavourly', className = 'h-11' }: { src?: string; alt?: string; className?: string }) {
  return (
    <span className="inline-flex items-center rounded-xl bg-white/95 px-2.5 py-1.5 shadow-sm ring-1 ring-black/[0.04] dark:bg-[#fff8f0]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className={`${className} w-auto`} />
    </span>
  );
}
