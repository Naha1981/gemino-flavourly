# GATE REPORT — UI-5 / UI-5B: Landing Page Rebuild (“The Closed Loop”)

**Branch:** `feat/landing-closed-loop` (branched from `main` @ f2c5e9c — independent of open PR #48)
**Status:** COMPLETE — PR open, **NOT merged. AWAITING OWNER APPROVAL.**
**Scope:** UI/copy only on the public landing page. Auth, magic-link claim flow, pricing data
source, business logic, cron, operator: untouched.

---

## 1. What was built

The landing page no longer reads like a generic dark SaaS template. It now sells the closed
loop in the owner’s approved words, wrapped in warm restaurant photography.

### Copy authority (UI-5B, simple English — applied verbatim)

| Element | Shipped copy |
|---|---|
| H1 | “Full tables. Even on Tuesdays.” |
| Sub | “Flavourly answers your WhatsApp in 2–3 seconds. It sees customers near your restaurant and invites them in. It fills your slow hours. It checks your competitors every day. And it shows you the money it made you — in Rands.” |
| Kicker (gold) | “No other tool does all this. And proves it.” |
| CTAs | “See it on your restaurant — 2 minutes” (→ `/sign-up`) · “Start free for 14 days” (Clerk flow) |
| Trust chips | No app needed · POPIA safe · Pause anytime · Your number stays yours |
| Final CTA | “Set your table in 5 minutes. If Flavourly doesn’t pay for itself, the dashboard will tell you — that’s the deal.” |

Sections, in order: **Hero** (chat mock + GPS chip + reminder chip, all badged *Example*) →
**Sound familiar?** (6 pain→fix cards) → **The nearby invite** (with consent line) →
**Test before you spend** (with “Forecast only. Real results are measured after launch.”) →
**See the money** (till-slip receipt: R11 000 / R19 800 / R3 750 / R6 000, total R40 550) →
**How it works** (3 photographed steps + dashboard fragment) → **FAQ** (4 one-liners) →
**Final CTA** over a dining-room toast photo → footer with the honesty line
(“Every number on this page is an example. Your dashboard shows your real Rands.”).

### Visuals (UI-5)

- **Light linen theme** — `#FFFBF5` background, charcoal text, forest green `#0E3B33` +
  champagne gold `#C9A25A`. No dark void, no purple/blue gradients, no glassmorphism, no
  icon-only cards. Display serif headings (the app’s bundled **Fraunces Variable**, the
  established `font-display` token — same warm-serif role as the requested Playfair Display,
  which remains loaded as the configured fallback; zero new font payload) + Inter body.
- **Five self-hosted warm restaurant photographs** (`public/images/landing/`, ~85–120 KB
  optimized progressive JPEG each, AI-generated — no identifiable people, no third-party
  licences, no CDN dependency): candlelit dining-room hero, plated dessert, QR table tent,
  chef at the kitchen pass, guests toasting.
- **Honesty rule enforced visually** — the old fabricated “Flavourly HQ / Live overview”
  strip is gone; every illustrative number carries an “Example” badge; chat mockups are
  restaurant-specific (bobotie, table for 4, BOOK); dashboard fragments show covers /
  no-shows / VIPs, not generic charts.
- `next/image` with explicit dimensions everywhere; hero photo is the LCP `priority` image
  with `sizes="100vw"`.

### CTA wiring

“See it on your restaurant — 2 minutes” → `/sign-up` (the branded-demo/trial entry, real
route). “Start free for 14 days” → Clerk `SignUpButton` → `/dashboard`. Signed-in visitors
see “Open Your Dashboard” (and are still auto-redirected client-side, unchanged PERF-1
contract). The logo double-click → `/admin` easter egg is preserved.

## 2. Evidence

| Check | Result |
|---|---|
| `tsc --noEmit` | clean (0 errors) |
| `npm run test:main` | **1790 / 1790 green** (was 1778 on main; +12 new: 11 landing-copy wiring + 1 honesty pin) |
| `GATE_MOCK=1 next build` | green — `/` prerenders static (○), 41/41 pages, ESLint clean |
| Playwright screenshots | 1280 / 768 / 390 viewport + full-page = 6 PNGs in `download/ui5-screenshots/` |
| Console errors | **0 real errors** at all 3 viewports (1 documented harness artifact/viewport, below) |
| Horizontal overflow | 0 px at all 3 viewports |
| LCP (production server, local) | 212–576 ms — the gate bar is 2.5 s |
| CTA/footer link resolution | all 7 internal links: 200, except `/dashboard` → 307 → `/sign-in` (correct unauthenticated behaviour) |
| e2e | `app.spec` Test 1 (new H1 + logo dblclick → /admin) ✓ · Test 3 (middleware redirect) ✓ · `operator-health` landing ✓ · `gate-v4-v5` J1.1 (200, `/_next/image` logo, no error markers) ✓ |
| VLM visual review | 9/10 — “warm, upscale dining atmosphere… production-ready”; all sections in order, all photos render, no clipping/overlap/contrast defects (two-pass: first pass caught lazy-image screenshot artifact, fixed in harness) |

**Screenshots:** `/home/z/my-project/download/ui5-screenshots/`
(`{1280,768,390}.png` + `-full.png`, `evidence-index.json`).

## 3. Known items (documented, not blockers)

1. **Link-prefetch harness artifact.** When the footer scrolls into view, Next prefetches
   `/dashboard` as an anonymous RSC request; the gate mock’s `protect()` answers that with a
   404 JSON (its API branch). With real Clerk this prefetch is a silent 307 abort — no
   console error in production. Recorded as `harnessArtifacts` in the evidence index.
2. **`app.spec` Test 2 (real `.cl-signIn-root` DOM)** cannot pass under `GATE_MOCK` by design —
   the mock replaces Clerk’s UI wholesale. It targets the real Vercel deployment. Pre-existing;
   auth is explicitly out of this gate’s scope.
3. **Operator `/health` e2e** needs the operator service (port 3001) which this harness does
   not run. Pre-existing, unrelated.
4. **Fraunces vs Playfair** — the gate asked for Playfair Display + Inter. The app already
   ships Playfair (fontsource) AND its brand display serif Fraunces (self-hosted, used by the
   dashboard). `font-display` resolves to Fraunces; Playfair remains the configured fallback
   in `tailwind.config.ts`. Rationale: one warm-serif voice across marketing + product, zero
   new font payload. One-line swap if the owner prefers strict Playfair.
5. **Photography provenance** — images are AI-generated (no identifiable individuals, no
   licence dependencies). The QR pattern in the table-tent photo is illustrative, not
   scannable — the real QR flow lives in onboarding/WhatsApp pages (untouched).
6. **LCP measurement** is from the local production-mode server; the Vercel preview should be
   re-checked after merge (expect equal or better with edge image optimization).

## 4. Not touched (per gate directive)

auth · magic-link claim flow · pricing data source · business logic · cron · operator ·
`app/(marketing)/page.tsx` static-prerender contract · Clerk wrappers (`components/clerk-shell`) ·
the `/pricing`, `/privacy`, `/terms` pages (they keep their current theme; a follow-up could
align them to linen if desired).

## 5. Verdict

All evidence green. The page now communicates the one-line pitch — *“Flavourly captures
every enquiry, makes guests show up, rewards them only when they’re physically in your
restaurant, simulates campaigns before you spend a rand, watches your competitors — and
then shows you the payment-verified rand it recovered. No other tool closes that loop.”* —
in Grade-7 English, over photography a restaurant owner can smell.

**END: AWAITING OWNER APPROVAL TO MERGE.**
