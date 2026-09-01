'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/**
 * QA-2 / owner spec — the Super Admin portal is reached through a hidden
 * affordance on the app logo:
 *   - desktop: double-click the logo;
 *   - mobile: press and HOLD the logo for 3 seconds.
 *
 * The gesture itself grants NOTHING: /admin keeps its own fail-closed
 * isSuperAdmin() guard, so a tenant who finds the gesture just lands on
 * the sign-in redirect. This mirrors the landing page, which has shipped
 * the double-click → /admin affordance since the Stitch redesign.
 *
 * Shared by the dashboard chrome (sidebar + mobile header) and the
 * marketing landing logo so the interaction feels identical everywhere.
 */

/** Owner spec: 3 seconds. */
export const ADMIN_GESTURE_HOLD_MS = 3000;

/** Finger drift tolerance before a press stops counting as a hold (px). */
const HOLD_SLOP_PX = 12;

export function AdminPortalGesture({
  children,
  title = 'Flavourly (double-click or press-and-hold for Super Admin)',
  className,
}: {
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const [holding, setHolding] = useState(false);

  const clearHold = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
    setHolding(false);
  }, []);

  const openPortal = useCallback(() => {
    clearHold();
    router.push('/admin');
  }, [clearHold, router]);

  // Safety net: unmount or tab-away must never leave a live timer.
  useEffect(() => clearHold, [clearHold]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    // Mouse users have the double-click path; a mouse "hold" is not the
    // specified gesture and would collide with text selection habits.
    if (e.pointerType === 'mouse') return;
    clearHold();
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(openPortal, ADMIN_GESTURE_HOLD_MS);
    setHolding(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!origin.current) return;
    const dx = Math.abs(e.clientX - origin.current.x);
    const dy = Math.abs(e.clientY - origin.current.y);
    if (dx > HOLD_SLOP_PX || dy > HOLD_SLOP_PX) clearHold();
  };

  const onDoubleClick = () => openPortal();

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid="admin-portal-gesture"
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      onPointerUp={clearHold}
      onPointerLeave={clearHold}
      onPointerCancel={clearHold}
      onPointerMove={onPointerMove}
      // A 3s touch-hold otherwise triggers the browser context menu /
      // text-selection callout before the timer fires.
      onContextMenu={(e) => holding && e.preventDefault()}
      className={`select-none outline-none focus-visible:ring-2 focus-visible:ring-app-primary/60 rounded-xl ${
        holding ? 'scale-[0.97] ring-2 ring-amber-500/60 transition-transform' : 'transition-transform active:scale-95'
      } ${className ?? ''}`}
      style={{ touchAction: 'manipulation' }}
    >
      {children}
    </button>
  );
}
