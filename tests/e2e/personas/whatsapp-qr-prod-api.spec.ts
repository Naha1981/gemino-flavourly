import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appUrl, ARTIFACT_DIR } from './persona-helpers';

/**
 * PRODUCTION QR LINKING — API-level proof (no browser page).
 *
 * The browser spec (whatsapp-qr-prod.spec.ts) signs in with QA_EMAIL /
 * QA_PASSWORD — which requires the Clerk instance to allow password-only
 * sign-in for the QA user. Until the instance's "email verification at
 * sign-in" second factor is relaxed for automation (owner decision —
 * one toggle in the Clerk dashboard), the FULL chain can still be proven
 * at the API level with a session minted out-of-band via the Clerk
 * Backend API (scripts/qa-prod-session.mjs):
 *
 *   eval "$(CLERK_SECRET_KEY=sk_... node scripts/qa-prod-session.mjs)" && \
 *   BASE_URL=https://gemino-flavourly-whatsapp.vercel.app \
 *     npx playwright test tests/e2e/personas/whatsapp-qr-prod-api.spec.ts
 *
 * The minted session JWT + dev-browser token are injected as the exact
 * cookie trio @clerk/backend's authenticateRequest accepts on a dev-key
 * instance (__session, __client_uat <= token.iat, __clerk_db_jwt). No
 * page is navigated, so client-side clerk-js never resets the cookies —
 * request-level journeys keep the session for their whole lifetime
 * (verified against the live deployment 2026-09-03).
 *
 * Asserts the same core chain as the browser spec:
 *   1. POST /api/whatsapp/connect → 200 with a real Baileys pairing
 *      payload (2@…, 4+ comma fields, 120–400 chars). A wrong
 *      OPERATOR_URL answers 502 naming the host (self-diagnosing).
 *   2. GET /api/whatsapp/status → qrCode NON-NULL + operatorOnline:true —
 *      THE LIVE MERGE. The core qr_code column is never written, so a
 *      non-null qrCode can ONLY be the merged live operator snapshot:
 *      the red→green assertion for the tenantId contract fix.
 *   3. ~22s later the qrCode CHANGED (rotation contract).
 */

const SESSION_JWT = process.env.QA_SESSION_JWT;
const DEV_TOKEN = process.env.QA_DEV_BROWSER_TOKEN;
const API_COOKIES_AVAILABLE = Boolean(SESSION_JWT && DEV_TOKEN);

test.describe('production QR linking — API level (minted session, real Vercel→Render chain)', () => {
  test.skip(!API_COOKIES_AVAILABLE, () =>
    'QA_SESSION_JWT / QA_DEV_BROWSER_TOKEN not provided — mint them with ' +
      'scripts/qa-prod-session.mjs (needs CLERK_SECRET_KEY once; see the spec header ' +
      'for the one-liner). The browser spec covers the password path.'
  );

  test('connect kick returns a real pairing payload; the live merge serves it; it rotates', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const host = new URL(appUrl('/')).hostname;
    const iat = JSON.parse(
      Buffer.from((SESSION_JWT as string).split('.')[1], 'base64url').toString()
    ).iat;
    await page.context().addCookies([
      {
        name: '__session',
        value: SESSION_JWT as string,
        domain: host,
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      },
      {
        // Must be <= the JWT's iat or the middleware treats the session as
        // stale (authenticateRequest line: payload.iat < clientUat).
        name: '__client_uat',
        value: String(iat),
        domain: host,
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
      {
        // Dev-key instances require a dev-browser token alongside __session.
        name: '__clerk_db_jwt',
        value: DEV_TOKEN as string,
        domain: host,
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ]);

    // -------------------------------------------------------------------
    // 1. The connect kick — proves OPERATOR_URL, the API key, BOTH ids and
    //    a live operator socket in one response.
    // -------------------------------------------------------------------
    const connectRes = await page.request.post(appUrl('/api/whatsapp/connect'));
    expect(
      connectRes.status(),
      'The /connect kick failed. A misconfigured OPERATOR_URL answers 502 with the ' +
        'host named verbatim in the error body. ' +
        JSON.stringify(await connectRes.json().catch(() => null))
    ).toBe(200);
    const connectBody = (await connectRes.json()) as {
      ok: boolean;
      qrCode: string | null;
    };
    expect(connectBody.ok).toBe(true);
    expect(
      connectBody.qrCode,
      'The operator answered 200 but served no pairing payload — the linking journey ' +
        'cannot start without a QR.'
    ).toBeTruthy();
    expect(connectBody.qrCode!.startsWith('2@')).toBe(true);
    expect(connectBody.qrCode!.split(',').length).toBeGreaterThanOrEqual(4);
    expect(connectBody.qrCode!.length).toBeGreaterThanOrEqual(120);
    expect(connectBody.qrCode!.length).toBeLessThanOrEqual(400);

    // -------------------------------------------------------------------
    // 2. THE LIVE MERGE — a status poll with a non-null qrCode. The core
    //    row's qr_code is NEVER written; only the merged operator snapshot
    //    (operatorClient.getStatus(tenantId, waAccountId)) can populate it.
    // -------------------------------------------------------------------
    const statusRes = await page.request.get(appUrl('/api/whatsapp/status'));
    expect(statusRes.status()).toBe(200);
    const statusBody = (await statusRes.json()) as {
      qrCode: string | null;
      operatorOnline: boolean | null;
      status: string;
    };
    expect(
      statusBody.qrCode,
      'THE LIVE QR MERGE IS NOT EXECUTING: qrCode is null on the status poll. ' +
        'This is exactly what the tenantId contract fix repairs — the operator ' +
        'refuses status calls without BOTH ids (400), which nulls the snapshot.'
    ).toBeTruthy();
    expect(statusBody.operatorOnline).toBe(true);
    expect(statusBody.status).toBe('connecting');

    // -------------------------------------------------------------------
    // 3. Rotation — the pairing payload changes within ~25s.
    // -------------------------------------------------------------------
    await page.waitForTimeout(22_000);
    const secondRes = await page.request.get(appUrl('/api/whatsapp/status'));
    const secondBody = (await secondRes.json()) as { qrCode: string | null };
    expect(
      secondBody.qrCode,
      'the live merge went null during the rotation window — the snapshot is not staying fresh'
    ).toBeTruthy();
    expect(
      secondBody.qrCode !== statusBody.qrCode,
      'the pairing payload did NOT rotate within ~22s — the "new one every ~20 seconds" ' +
        'contract is broken'
    ).toBe(true);

    // Evidence artifact (mirrors the browser spec's decode json).
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(
      join(ARTIFACT_DIR, 'prod-qr-api.json'),
      JSON.stringify(
        {
          ok: true,
          baseUrl: process.env.BASE_URL,
          checkedAt: new Date().toISOString(),
          connectPayloadLength: connectBody.qrCode?.length,
          liveMerge: { qrCode: true, operatorOnline: statusBody.operatorOnline },
          rotated: secondBody.qrCode !== statusBody.qrCode,
          firstHead: statusBody.qrCode?.slice(0, 32),
          secondHead: secondBody.qrCode?.slice(0, 32),
        },
        null,
        2
      )
    );
  });
});
