import { test, expect, type Page, type Request, type Response } from '@playwright/test';
import jsQR from 'jsqr';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isMockMode,
  productionCredentials,
  signInProduction,
  appUrl,
  shot,
  ARTIFACT_DIR,
} from './persona-helpers';

/**
 * PRODUCTION QR LINKING E2E — the last mile of the QR saga.
 *
 * Runs ONLY against production (BASE_URL) with the owner-provided QA
 * credentials QA_EMAIL / QA_PASSWORD (env vars or GitHub Actions secrets —
 * NEVER hardcoded; a source-scan unit test enforces it). The GATE_MOCK leg
 * of the same journey is covered by personas.spec.ts + the mock operator;
 * this spec is the one that exercises the REAL Vercel→Render chain.
 *
 * Proves, in one signed-in journey (read-only for tenant data: the page
 * only links the QA tenant's own WhatsApp row):
 *
 *   1. SIGN-IN — the QA user can log in (Clerk, password strategy).
 *   2. OPERATOR_URL — the /api/whatsapp/connect kick reaches the real
 *      Render operator. A misconfigured OPERATOR_URL answers 502 with the
 *      WRONG HOST NAMED VERBATIM in the error body ("engine unreachable
 *      (host: …)") — this spec fails with that exact string, so the env
 *      var diagnoses itself. No secrets are read; the proof is the
 *      response itself.
 *   3. QR RENDERS + DECODES — the linking page shows the pairing QR and
 *      jsQR decodes the rendered canvas to a machine-scannable Baileys
 *      payload (2@…, 4 comma-separated fields, ~237 chars).
 *   4. LIVE MERGE — at least one /api/whatsapp/status poll returns a
 *      NON-NULL qrCode with operatorOnline:true. The core DB row's
 *      qr_code column is NEVER written, so a non-null qrCode in this
 *      response can ONLY come from the merged live operator snapshot —
 *      pre-fix (operatorClient.getStatus() without tenantId) this is
 *      structurally impossible and the spec fails HERE. This is the
 *      red→green assertion for fix/qr-status-tenantid-contract.
 *   5. ROTATION — ~25s later the canvas decodes to a DIFFERENT payload
 *      (the operator re-emits pairing codes every ~20s; the page's
 *      "new one every ~20 seconds" contract is live).
 *
 * Full network waterfall + decode evidence land in qa2-artifacts/
 * (prod-qr-waterfall.json, prod-qr-decode.json, screenshots) — the CI
 * artifact upload already includes that directory.
 *
 * Run (owner-provided credentials only):
 *   QA_EMAIL=… QA_PASSWORD=… \
 *   BASE_URL=https://gemino-flavourly-whatsapp.vercel.app \
 *     npx playwright test tests/e2e/personas/whatsapp-qr-prod.spec.ts
 */

const mockMode = isMockMode();
const creds = productionCredentials();

test.describe('production QR linking — real Vercel→Render chain (owner QA credentials)', () => {
  test.skip(mockMode, 'production-only spec — the GATE_MOCK leg covers the mock-operator journey');
  test.skip(
    !creds,
    'QA_EMAIL / QA_PASSWORD not provided — the authed production leg cannot run. ' +
      'Owner: create the Clerk QA user (password strategy, no email-code step) and pass the ' +
      'credentials as env vars or GitHub Actions secrets (docs/qa2/SETUP.md).'
  );

  test(
    'sign in, render the pairing QR, prove the live merge and rotation',
    async ({ page }) => {
      test.setTimeout(240_000);

      // -------------------------------------------------------------------
      // Waterfall: every request/response of the journey (status + timing),
      // bodies for the two WhatsApp API routes. Attached BEFORE navigation
      // so the sign-in chain itself is captured.
      // -------------------------------------------------------------------
      interface WaterfallRow {
        at: string;
        method: string;
        path: string;
        status: number;
        ms: number;
        body?: unknown;
      }
      const waterfall: WaterfallRow[] = [];
      const started = new Map<Request, number>();
      const bodyJobs: Promise<void>[] = [];

      page.on('request', (req) => {
        started.set(req, Date.now());
      });
      page.on('response', (res) => {
        const t0 = started.get(res.request());
        const row: WaterfallRow = {
          at: new Date().toISOString(),
          method: res.request().method(),
          path: new URL(res.url()).pathname + new URL(res.url()).search,
          status: res.status(),
          ms: t0 === undefined ? -1 : Date.now() - t0,
        };
        waterfall.push(row);
        if (/\/api\/whatsapp\/(status|connect)/.test(row.path)) {
          bodyJobs.push(
            res
              .json()
              .then((b) => {
                row.body = b;
              })
              .catch(() => {})
          );
        }
      });

      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      // -------------------------------------------------------------------
      // 1. Sign in with the QA user.
      // -------------------------------------------------------------------
      const signedIn = await signInProduction(page, creds!);
      expect(
        signedIn,
        'Clerk sign-in failed. Check the QA user: password strategy must be enabled and the ' +
          'email-code step disabled for automation, and the credentials must be exact.'
      ).toBe(true);

      // -------------------------------------------------------------------
      // 2. Open the linking page and prove the /connect kick reaches the
      //    real operator (the OPERATOR_URL proof — no secrets read).
      // -------------------------------------------------------------------
      await page.goto(appUrl('/dashboard/whatsapp'), { waitUntil: 'domcontentloaded' });

      const waitForRow = async (
        pattern: RegExp,
        timeoutMs: number
      ): Promise<WaterfallRow | null> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const hit = waterfall.find((r) => pattern.test(r.path));
          if (hit) return hit;
          await page.waitForTimeout(500);
        }
        return null;
      };

      const connectRow = await waitForRow(/\/api\/whatsapp\/connect/, 75_000);
      expect(
        connectRow,
        'No /api/whatsapp/connect kick was observed within 75s. The linking page auto-kicks ' +
          'on load while unlinked — if this run landed on an already-connected account, use a ' +
          'fresh/unlinked QA tenant so the pairing journey is exercisable.'
      ).toBeTruthy();

      expect(
        connectRow!.status,
        [
          'OPERATOR_URL / OPERATOR_API_KEY misconfiguration — the /connect kick failed.',
          'The operator host is named VERBATIM in the engine error (self-diagnosing route):',
          JSON.stringify(connectRow!.body),
          'Fix the Vercel env var to https://gemino-flavourly-whatsapp.onrender.com and re-run.',
        ].join(' ')
      ).toBe(200);

      // -------------------------------------------------------------------
      // 3. The pairing QR renders and decodes to a Baileys payload.
      // -------------------------------------------------------------------
      const qrFrame = page.locator('[data-testid="qr-frame"]');
      await expect(
        qrFrame,
        'The QR frame never rendered. Screenshot evidence is in qa2-artifacts/ — check the ' +
          'engine-error / engine-offline boxes for the named cause.'
      ).toBeVisible({ timeout: 60_000 });
      await shot(page, 'prod-qr-1');

      const decodeCanvas = async (): Promise<{ text: string; size: string } | null> => {
        const img = await page.evaluate(() => {
          const canvas = document.querySelector(
            '[data-testid="qr-frame"] canvas'
          ) as HTMLCanvasElement | null;
          if (!canvas) return null;
          const ctx = canvas.getContext('2d');
          if (!ctx) return null;
          const { width, height } = canvas;
          const data = ctx.getImageData(0, 0, width, height);
          return { data: data.data, width, height };
        });
        if (!img) return null;
        const decoded = jsQR(img.data, img.width, img.height);
        if (!decoded) return null;
        return { text: decoded.data, size: `${img.width}x${img.height}` };
      };

      const first = await decodeCanvas();
      expect(
        first,
        'The QR frame rendered but the canvas could not be decoded in time. If the frame ' +
          'VANISHED between render and decode, that is the pre-fix signature: the status poll ' +
          'nulls the QR and it only reappears on the next kick (see the live-merge assertion).'
      ).toBeTruthy();

      expect(
        first!.text.startsWith('2@'),
        `unexpected payload head: ${first!.text.slice(0, 12)}…`
      ).toBe(true);

      const fields = first!.text.split(',').length;
      expect(
        fields >= 4,
        `expected a 4-field Baileys pairing payload (2@ref,key,ttl,curve), got ${fields} fields ` +
          `(${first!.text.length} chars): ${first!.text.slice(0, 40)}…`
      ).toBe(true);

      expect(
        first!.text.length >= 120 && first!.text.length <= 400,
        `unexpected pairing payload length: ${first!.text.length}`
      ).toBe(true);

      // -------------------------------------------------------------------
      // 4. THE LIVE MERGE — a /api/whatsapp/status poll with a non-null
      //    qrCode + operatorOnline:true. Structurally impossible pre-fix
      //    (the core row's qr_code is never written); this is the
      //    red→green assertion for the tenantId contract fix.
      // -------------------------------------------------------------------
      const liveStatus = await (async (): Promise<WaterfallRow | null> => {
        const deadline = Date.now() + 45_000;
        for (;;) {
          const hit = waterfall.find(
            (r) =>
              /\/api\/whatsapp\/status/.test(r.path) &&
              r.status === 200 &&
              r.body !== undefined &&
              Boolean((r.body as Record<string, unknown>).qrCode) &&
              (r.body as Record<string, unknown>).operatorOnline === true
          );
          if (hit) return hit;
          if (Date.now() > deadline) return null;
          await page.waitForTimeout(500);
        }
      })();
      expect(
        liveStatus,
        [
          'THE LIVE QR MERGE IS NOT EXECUTING in production.',
          'Every /api/whatsapp/status poll returned qrCode:null — and the core DB row\'s qr_code',
          'column is NEVER written, so only the merged operator snapshot can populate it.',
          `Observed status polls: ${JSON.stringify(
            waterfall.filter((r) => /\/api\/whatsapp\/status/.test(r.path)).map((r) => r.body)
          )}`,
          'This is exactly what fix/qr-status-tenantid-contract repairs (operatorClient.getStatus',
          'must send tenantId). Merge the PR and re-run this spec — it must be green.'
        ].join(' ')
      ).toBeTruthy();

      // -------------------------------------------------------------------
      // 5. Rotation — the decoded payload CHANGES within the window.
      // -------------------------------------------------------------------
      await page.waitForTimeout(25_000);
      await expect(qrFrame, 'the QR frame vanished during the rotation window').toBeVisible({
        timeout: 10_000,
      });

      let second: { text: string; size: string } | null = null;
      const rotationDeadline = Date.now() + 30_000;
      while (Date.now() < rotationDeadline && !second) {
        second = await decodeCanvas();
        if (!second) await page.waitForTimeout(1_000);
      }
      await shot(page, 'prod-qr-2');

      expect(
        second,
        'the canvas could not be decoded after the rotation window — the QR is not staying rendered'
      ).toBeTruthy();
      expect(
        second!.text !== first!.text,
        'the QR payload did NOT rotate within ~25s — the "new one every ~20 seconds" contract is broken'
      ).toBe(true);

      // No engine error may survive the journey (a failed kick would have
      // failed the connect assertion above, but the box is pinned here too).
      await expect(page.locator('[data-testid="engine-error"]')).toHaveCount(0);

      // -------------------------------------------------------------------
      // Evidence: full waterfall + decode summary.
      // -------------------------------------------------------------------
      await Promise.all(bodyJobs);
      mkdirSync(ARTIFACT_DIR, { recursive: true });
      writeFileSync(
        join(ARTIFACT_DIR, 'prod-qr-waterfall.json'),
        JSON.stringify(
          {
            baseUrl: process.env.BASE_URL,
            checkedAt: new Date().toISOString(),
            consoleErrorCount: consoleErrors.length,
            consoleErrors: consoleErrors.slice(0, 20),
            requests: waterfall,
          },
          null,
          2
        )
      );
      writeFileSync(
        join(ARTIFACT_DIR, 'prod-qr-decode.json'),
        JSON.stringify(
          {
            ok: true,
            canvasSize: first!.size,
            firstHead: first!.text.slice(0, 32),
            secondHead: second!.text.slice(0, 32),
            payloadLength: first!.text.length,
            commaFields: first!.text.split(',').length,
            rotated: first!.text !== second!.text,
            liveMerge: { qrCode: true, operatorOnline: true },
            checkedAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    }
  );
});
