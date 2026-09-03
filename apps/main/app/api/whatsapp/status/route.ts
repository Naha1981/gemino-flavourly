import { NextResponse } from 'next/server';
import { getOrCreateTenant } from '@/lib/tenant';
import { ensureWaAccount } from '@/lib/whatsapp/ensure-account';
import { operatorClient } from '@/lib/operator-client';

export const dynamic = 'force-dynamic';

// ───────────────────────────────────────────────────────────────────────
// Operator reachability signal (round 2, 2026-08-31).
//
// The linking page used to have NO way to distinguish "engine is
// starting" from "engine is unreachable": /api/whatsapp/status only
// echoed the DB row, so a broken OPERATOR_URL or a spun-down Render
// service rendered as "Starting the WhatsApp engine…" forever. The
// status response now carries `operatorOnline` while the account is in
// the linking phase (no QR yet, not connected) — the only state where
// the distinction matters.
//
// Cached for OPERATOR_HEALTH_TTL_MS so a 3s poll from one tab (or
// several) cannot turn into a health-check storm against Render, and
// the check is skipped entirely once a QR is on the row.
// ───────────────────────────────────────────────────────────────────────
const OPERATOR_HEALTH_TTL_MS = 5_000;
let operatorHealthCache: { at: number; ok: boolean } | null = null;

async function checkOperatorOnline(): Promise<boolean> {
  const now = Date.now();
  if (operatorHealthCache && now - operatorHealthCache.at < OPERATOR_HEALTH_TTL_MS) {
    return operatorHealthCache.ok;
  }
  const ok = await operatorClient.checkHealth();
  operatorHealthCache = { at: now, ok };
  return ok;
}

export async function GET() {
  // Round 2: every failure path below returns a STRUCTURED error the
  // linking page can render. Previously a thrown error here produced a
  // generic 500 while the page silently swallowed it — the "Starting
  // the WhatsApp engine…" forever freeze with zero diagnostics.
  let tenant;
  try {
    tenant = await getOrCreateTenant();
  } catch (err) {
    return NextResponse.json(
      { error: `Could not resolve your account: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  if (!tenant) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  // Auto-provisions the row for tenants created before the row-per-tenant
  // invariant existed — without this, the entire linking flow 404'd for
  // them and no QR could ever be displayed (2026-08-31 gate finding).
  let account;
  try {
    account = await ensureWaAccount(tenant.id);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the WhatsApp account row: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  if (!account) {
    return NextResponse.json({ error: 'Could not provision WhatsApp account row.' }, { status: 500 });
  }

  // Engine reachability: only while linking (no code on the row yet).
  // Best-effort — a Render cold start reports offline, which the page
  // shows as "engine waking up", never as a hard failure.
  let operatorOnline: boolean | null = null;
  if (!account.isConnected && !account.qrCode) {
    operatorOnline = await checkOperatorOnline();
  }

  // QA-2 (QR verification, task 1): while NOT connected, merge the
  // operator's LIVE socket snapshot over the DB row. The DB row is the
  // operator's persisted copy, but pairing codes rotate every ~20s —
  // reading the live /status (bounded 5s) keeps the displayed code as
  // fresh as the engine itself and lets the full linking lifecycle be
  // asserted end-to-end (the QA harness drives a rotating mock operator).
  // Unreachable engine → null → the DB values stand (round-2 behaviour).
  //
  // BOTH ids are mandatory: the operator's /status is fail-closed
  // (400 without tenantId, 403 on tenant mismatch — PR #44). Passing
  // account.id alone got every live-snapshot call 400-rejected, so the
  // merge below never executed in production and the QR vanished ~3s
  // after every /connect kick (the core row's qr_code is never written).
  const live = !account.isConnected
    ? await operatorClient.getStatus(tenant.id, account.id).catch(() => null)
    : null;
  if (live) {
    operatorOnline = true;
  }

  return NextResponse.json({
    isConnected: live ? live.isConnected : account.isConnected,
    phoneNumber: live?.phoneNumber ?? account.phoneNumber ?? null,
    qrCode: live?.qrCode ?? account.qrCode ?? null,
    status: live
      ? live.isConnected
        ? 'connected'
        : live.qrCode
          ? 'connecting'
          : (account.status ?? 'unlinked')
      : (account.status ?? 'unlinked'),
    operatorOnline,
  });
}
