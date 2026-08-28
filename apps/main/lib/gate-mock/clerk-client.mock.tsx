/**
 * GATE V4/V5 — Mock of the client-facing `@clerk/nextjs` surface for the
 * local gate harness (active only with GATE_MOCK=1 via the next.config.mjs
 * webpack alias).
 *
 * The mock implements the identity-provider surface only:
 *   - the mock sign-in/sign-up page sets the `__gate_user` cookie to the
 *     selected persona (this IS the "Clerk completed authentication" step);
 *   - SignedIn/SignedOut/UserButton/useUser report that cookie;
 *   - SignInButton/SignUpButton are plain links to the mock IdP pages.
 *
 * No authorization logic lives here — every server component, layout and
 * route handler still runs its real checks (isSuperAdmin, tenant resolver,
 * 401/403/404 boundaries) against the seeded pg-mem rows.
 */
'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { GATE_PERSONAS, GATE_USER_COOKIE } from './personas';

/** Read the mock session cookie (client-only; SSR renders the signed-out
 *  branch and the effect flips it — a hydration-safe pattern for the mock). */
function useGateIdentity(): { userId: string | null; persona: (typeof GATE_PERSONAS)[keyof typeof GATE_PERSONAS] | null } {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${GATE_USER_COOKIE}=([^;]+)`));
    const id = m ? decodeURIComponent(m[1]) : null;
    setUserId(id && GATE_PERSONAS_IDS.has(id) ? id : null);
  }, []);
  const persona = userId ? PERSONAS_BY_ID.get(userId)! : null;
  return { userId, persona };
}

const PERSONAS_BY_ID = new Map(
  Object.values(GATE_PERSONAS).map((p) => [p.userId, p] as const),
);
const GATE_PERSONAS_IDS = new Set(PERSONAS_BY_ID.keys());

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function SignedIn({ children }: { children: ReactNode }) {
  const { userId } = useGateIdentity();
  return <>{userId ? children : null}</>;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { userId } = useGateIdentity();
  return <>{userId ? null : children}</>;
}

function buttonHref(path: string, forceRedirectUrl?: string): string {
  if (!forceRedirectUrl) return path;
  return `${path}?redirect_url=${encodeURIComponent(forceRedirectUrl)}`;
}

export function SignInButton({
  children,
  forceRedirectUrl,
  appearance,
}: {
  children?: ReactNode;
  forceRedirectUrl?: string;
  appearance?: unknown;
}) {
  return (
    <a href={buttonHref('/sign-in', forceRedirectUrl)} data-testid="gate-sign-in-button">
      {children ?? 'Sign in'}
    </a>
  );
}

export function SignUpButton({
  children,
  forceRedirectUrl,
  appearance,
}: {
  children?: ReactNode;
  forceRedirectUrl?: string;
  appearance?: unknown;
}) {
  return (
    <a href={buttonHref('/sign-up', forceRedirectUrl)} data-testid="gate-sign-up-button">
      {children ?? 'Sign up'}
    </a>
  );
}

export function UserButton({ afterSignOutUrl }: { afterSignOutUrl?: string }) {
  const { persona } = useGateIdentity();
  if (!persona) return null;
  return (
    <span
      data-testid="gate-user-button"
      title={`Mock session: ${persona.email}`}
      style={{ fontFamily: 'monospace' }}
    >
      {persona.email}
      {afterSignOutUrl ? (
        <button
          type="button"
          data-testid="gate-sign-out"
          onClick={() => {
            document.cookie = `${GATE_USER_COOKIE}=; Path=/; Max-Age=0`;
            window.location.href = '/';
          }}
          style={{ marginLeft: 8, cursor: 'pointer' }}
        >
          Sign out
        </button>
      ) : null}
    </span>
  );
}

export function useUser() {
  const { userId, persona } = useGateIdentity();
  return {
    userId,
    email: persona?.email ?? null,
    firstName: persona?.name.split(' ')[0] ?? null,
    isLoaded: true,
    isSignedIn: !!userId,
  };
}

/**
 * Mock identity provider: the "Clerk" sign-in/sign-up card. Selecting a
 * persona and submitting sets the `__gate_user` cookie (path=/) and
 * redirects to the app's post-auth destination. This is the ONLY place the
 * harness grants a session — and it grants nothing beyond the persona
 * identity itself.
 */
function MockIdpCard({ mode, fallbackRedirectUrl }: { mode: 'sign-in' | 'sign-up'; fallbackRedirectUrl?: string }) {
  const [selected, setSelected] = useState<string>(GATE_PERSONAS.superAdmin.userId);
  const dest =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('redirect_url')
      : null;
  const target = dest || fallbackRedirectUrl || (mode === 'sign-up' ? '/onboarding' : '/dashboard');

  return (
    <div style={{ maxWidth: 420, width: '100%' }} data-testid="gate-mock-idp">
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>
        {mode === 'sign-in' ? 'Sign in' : 'Create your account'}
      </h1>
      <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}>
        GATE HARNESS — mock identity provider (GATE_MOCK=1). Pick the persona you want the
        app to believe is signed in. No real credentials exist; the app&rsquo;s own
        authorization logic still decides every privilege.
      </p>
      <select
        data-testid="gate-mock-persona-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 12, background: '#111', color: '#eee', border: '1px solid #444' }}
      >
        {Object.values(GATE_PERSONAS).map((p) => (
          <option key={p.userId} value={p.userId}>
            {p.name} &lt;{p.email}&gt;
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="gate-mock-auth-submit"
        onClick={() => {
          document.cookie = `${GATE_USER_COOKIE}=${encodeURIComponent(selected)}; Path=/; Max-Age=28800; SameSite=Lax`;
          window.location.href = target;
        }}
        style={{ width: '100%', padding: 10, cursor: 'pointer', background: '#10b981', color: '#0a0a0a', fontWeight: 600, border: 'none' }}
      >
        {mode === 'sign-in' ? 'Continue' : 'Continue to sign up'}
      </button>
    </div>
  );
}

export function SignIn(props: {
  fallbackRedirectUrl?: string;
  forceRedirectUrl?: string;
  appearance?: unknown;
  routing?: unknown;
}) {
  return <MockIdpCard mode="sign-in" fallbackRedirectUrl={props.forceRedirectUrl ?? props.fallbackRedirectUrl} />;
}

export function SignUp(props: {
  fallbackRedirectUrl?: string;
  forceRedirectUrl?: string;
  afterSignUpUrl?: string;
  appearance?: unknown;
  routing?: unknown;
}) {
  return <MockIdpCard mode="sign-up" fallbackRedirectUrl={props.forceRedirectUrl ?? props.afterSignUpUrl ?? props.fallbackRedirectUrl} />;
}
