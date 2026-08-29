'use client';

import { useEffect, type ReactNode } from 'react';
import { storeClaimToken } from '../actions';

/**
 * Client gate for the magic-link claim flow.
 *
 * On mount, if the user arrived via /sign-up?claim=<token>, fires the server
 * action that stashes the token in the `flavourly_claim` cookie for 1 hour.
 * After Clerk completes the sign-up it redirects to /onboarding, where the
 * claim-redeem effect reads that cookie and calls POST /api/claim/redeem.
 */
export function ClaimSignUpGate({ claim, children }: { claim: string | null; children: ReactNode }) {
  useEffect(() => {
    if (claim) {
      storeClaimToken(claim).catch(() => {
        // Non-fatal: a failed cookie write just means the claim won't redeem.
      });
    }
  }, [claim]);

  return <>{children}</>;
}
