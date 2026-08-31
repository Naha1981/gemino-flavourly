'use client';

import { useState } from 'react';

/**
 * O1 — client side of the geo-claim page.
 *
 * Asks the browser for geolocation (requires a secure context, which the
 * production deployment always provides), POSTs the coordinates to the
 * token-scoped verification endpoint, and renders honest outcomes. The
 * server does ALL distance math — this component never decides anything, it
 * only transports coordinates and displays the server's verdict.
 */
export function GeoClaimClient(props: {
  token: string;
  restaurantName: string;
  guestName: string;
  rewardName: string;
  pointsCost: number;
  ttlMinutes: number;
  expiresAtIso: string;
}) {
  const [state, setState] = useState<
    | { phase: 'idle' }
    | { phase: 'locating' }
    | { phase: 'submitting' }
    | { phase: 'error'; message: string }
    | { phase: 'done'; outcome: 'verified' | 'rejected_too_far' | 'expired' | 'other'; distanceM?: number }
  >({ phase: 'idle' });

  function verify() {
    if (!('geolocation' in navigator)) {
      setState({ phase: 'error', message: 'This browser cannot share your location.' });
      return;
    }
    setState({ phase: 'locating' });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setState({ phase: 'submitting' });
        try {
          const res = await fetch(`/api/loyalty/geo-claim/${props.token}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
            }),
          });
          const data = (await res.json()) as {
            outcome?: string;
            distanceM?: number;
          };
          const outcome = data.outcome ?? 'other';
          if (outcome === 'verified' || outcome === 'rejected_too_far' || outcome === 'expired') {
            setState({ phase: 'done', outcome, distanceM: data.distanceM });
          } else {
            setState({
              phase: 'error',
              message:
                outcome === 'restaurant_location_missing'
                  ? 'The restaurant has not set its location yet — please ask the staff to redeem your reward at the counter.'
                  : 'Something went wrong. Please try again in a moment.',
            });
          }
        } catch {
          setState({ phase: 'error', message: 'Network error — please try again.' });
        }
      },
      () => {
        setState({
          phase: 'error',
          message:
            'We need your location to verify you are at the restaurant. Please allow location access and try again.',
        });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  }

  if (state.phase === 'done') {
    if (state.outcome === 'verified') {
      return (
        <div
          className="rounded-2xl border border-emerald-800/60 bg-emerald-950/40 p-8 text-center"
          data-testid="geo-claim-verified"
        >
          <p className="text-3xl">🎉</p>
          <h1 className="mt-3 text-lg font-semibold text-emerald-300">Reward unlocked!</h1>
          <p className="mt-2 text-sm text-zinc-300">
            {props.rewardName} — verified at {state.distanceM ?? '?'}m from {props.restaurantName}.
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            Show this screen to your server to collect your reward.
          </p>
        </div>
      );
    }
    if (state.outcome === 'rejected_too_far') {
      return (
        <div
          className="rounded-2xl border border-red-900/60 bg-red-950/30 p-8 text-center"
          data-testid="geo-claim-rejected"
        >
          <p className="text-3xl">📍</p>
          <h1 className="mt-3 text-lg font-semibold text-red-300">Location too far</h1>
          <p className="mt-2 text-sm text-zinc-300">
            You are {state.distanceM ?? '?'}m away — rewards verify within 500m of{' '}
            {props.restaurantName}.
          </p>
          <p className="mt-4 text-xs text-zinc-500">
            Walk over to the restaurant and text <strong className="text-zinc-300">REDEEM</strong>{' '}
            again for a fresh link.
          </p>
        </div>
      );
    }
    return (
      <div
        className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 text-center"
        data-testid="geo-claim-expired"
      >
        <p className="text-3xl">⏳</p>
        <h1 className="mt-3 text-lg font-semibold text-zinc-100">Link expired</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Text <strong className="text-zinc-200">REDEEM</strong> on WhatsApp for a fresh link.
        </p>
      </div>
    );
  }

  const busy = state.phase === 'locating' || state.phase === 'submitting';

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 text-center">
      <p className="text-3xl">🎁</p>
      <h1 className="mt-3 text-lg font-semibold text-zinc-100">
        {props.rewardName} ({props.pointsCost} pts)
      </h1>
      <p className="mt-2 text-sm text-zinc-400">
        Hi {props.guestName}! Tap below when you&apos;re at {props.restaurantName} — we&apos;ll check
        you&apos;re within 500m and unlock your reward.
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        Link valid until {new Date(props.expiresAtIso).toLocaleTimeString('en-ZA')} (
        {props.ttlMinutes} minutes from issue).
      </p>
      <button
        onClick={verify}
        disabled={busy}
        className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="geo-claim-verify"
      >
        {state.phase === 'locating'
          ? 'Getting your location…'
          : state.phase === 'submitting'
            ? 'Verifying…'
            : 'Verify my location & claim'}
      </button>
      {state.phase === 'error' && (
        <p className="mt-4 text-xs text-red-400" data-testid="geo-claim-error">
          {state.message}
        </p>
      )}
      <p className="mt-4 text-[10px] text-zinc-600">
        Your coordinates are used once, only to verify this redemption, and are never stored
        without the distance to the restaurant.
      </p>
    </div>
  );
}
