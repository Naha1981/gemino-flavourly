# MatrAIx Synthetic QA — Flavourly

Isolated UX discovery layer. Never replaces Playwright. Never touches production sockets.

```
synthetic-testing/
  personas/     # restaurant owners + diners
  scenarios/    # onboarding, inbox, booking, waitlist
  reports/      # JSON run output
  evidence/     # screenshots
  regression/   # Playwright tests born from failures
```

Run:

```
npm run synthetic:report
```

Gate: 0 critical, high-severity < 2%, primary task success ≥ 80% on the 10-persona smoke (local demo). Production WhatsApp is out of scope for synthetics.
