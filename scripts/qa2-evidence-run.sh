#!/bin/bash
# GATE QA-2 — one-shot evidence run (also the owner's local entry point,
# referenced by docs/qa2/SETUP.md).
#
# Boots the mock WhatsApp operator (rotating QR, operator contract) and a
# GATE_MOCK BUILD of the app (next build + next start — exactly what the
# GitHub Actions job runs, and immune to the dev-server cold-compile races
# that produced flaky console-error noise under fullyParallel), then runs:
#   1. the full persona suite (tests/e2e) — 6 personas, every nav item,
#      console errors, screenshots;
#   2. the QR machine-scannability decode (jsQR + rotation proof);
#   3. the existing mock-compatible e2e specs (regression) + the production
#      contract specs against the live deployment (read-only).
#
# One invocation because the sandbox reaps detached background processes
# between shells. Exit codes are captured from log files (never from a
# pipe, where $? would belong to tail).
set -u
cd /home/z/my-project/app

export GATE_BASE_URL=http://127.0.0.1:3100
export BASE_URL=http://127.0.0.1:3100
export QA_ALERT_EMAIL_TRANSPORT=mock
export OPERATOR_URL=http://127.0.0.1:3001
PRODUCTION_BASE="https://gemino-flavourly-whatsapp.vercel.app"
# CRON_SECRET for the playwright process comes from the local env file.
CRON_SECRET_VALUE=$(sed -n 's/^CRON_SECRET=//p' apps/main/.env.local | tr -d '"' | head -1)
export CRON_SECRET="${CRON_SECRET_VALUE:-qa-local-cron-secret}"

# Kill EVERYTHING on the harness ports — including detached next-server
# children from earlier runs whose cmdline does not contain the pattern
# pkill -f would match (a stale orphan served the 2026-09-01 first run).
for port in 3100 3001; do
  pid=$(ss -ltnp 2>/dev/null | rg ":${port} " | rg -o 'pid=[0-9]+' | head -1 | rg -o '[0-9]+')
  [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  fuser -k "${port}/tcp" 2>/dev/null
done
pkill -f "next dev -p 3100" 2>/dev/null
pkill -f "mock-operator.mjs" 2>/dev/null
sleep 1

LOG=/home/z/my-project/scripts/qa2-gate-dev.log
EVID=/home/z/my-project/scripts/qa2-evidence
mkdir -p "$EVID"

echo "=== GATE_MOCK build (skip with QA2_SKIP_BUILD=1 if .next is fresh) ==="
if [ "${QA2_SKIP_BUILD:-0}" != "1" ]; then
  (cd apps/main && GATE_MOCK=1 npx next build > "$EVID/build.log" 2>&1) || { tail -20 "$EVID/build.log"; exit 1; }
  rg "Compiled successfully|Generating static" "$EVID/build.log" | head -2
fi

node tests/e2e/personas/mock-operator.mjs 3001 > "$EVID/operator.log" 2>&1 &
OPERATOR_PID=$!
(cd apps/main && GATE_MOCK=1 OPERATOR_URL=http://127.0.0.1:3001 QA_ALERT_EMAIL_TRANSPORT=mock \
   npx next start -p 3100 > "$LOG" 2>&1) &
SERVER_PID=$!

for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3100/ 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  echo "FATAL: our server died (an orphan may hold port 3100)"; tail -20 "$LOG"; exit 1
fi
echo "boot: $code (app pid $SERVER_PID, operator pid $OPERATOR_PID)"
[ "$code" = "200" ] || { cat "$LOG" | tail -30; exit 1; }

echo "=== persona suite + QA-2 specs ==="
GATE_BASE_URL=$GATE_BASE_URL CRON_SECRET=$CRON_SECRET \
  npx playwright test tests/e2e --reporter=list > "$EVID/personas.log" 2>&1
E2E=$?
rg "✔ .*passed|passed \(|failed" "$EVID/personas.log" | tail -4

echo "=== QR decode proof ==="
GATE_BASE_URL=$GATE_BASE_URL node scripts/qa2-qr-decode.mjs > "$EVID/qr.log" 2>&1
QR=$?
tail -10 "$EVID/qr.log"

echo "=== regression: mock-compatible specs ==="
# app.spec Test 2 needs the REAL Clerk sign-in DOM (GATE_MOCK swaps it by
# design — documented in the UI-5 gate report), so it is filtered out here
# and covered by the production leg below.
GATE_BASE_URL=$GATE_BASE_URL BASE_URL=$BASE_URL CRON_SECRET=$CRON_SECRET \
  npx playwright test e2e/app.spec.ts e2e/operator-health.spec.ts --grep-invert "Test 2" --reporter=list > "$EVID/regression-mock.log" 2>&1
REG=$?
rg "passed \(|failed" "$EVID/regression-mock.log" | tail -3

echo "=== regression: production contract specs (read-only) ==="
BASE_URL=$PRODUCTION_BASE npx playwright test e2e/contracts.spec.ts e2e/magic-link.spec.ts --reporter=list > "$EVID/regression-prod.log" 2>&1
REGPROD=$?
rg "passed \(|failed" "$EVID/regression-prod.log" | tail -3

kill $SERVER_PID $OPERATOR_PID 2>/dev/null
sleep 1
for port in 3100 3001; do
  pid=$(ss -ltnp 2>/dev/null | rg ":${port} " | rg -o 'pid=[0-9]+' | head -1 | rg -o '[0-9]+')
  [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
done
pkill -f "next dev -p 3100" 2>/dev/null
pkill -f "mock-operator.mjs" 2>/dev/null
echo "personas:$E2E qr:$QR regression-mock:$REG regression-prod:$REGPROD"
[ "$E2E" = "0" ] && [ "$QR" = "0" ] && [ "$REG" = "0" ] && [ "$REGPROD" = "0" ]
