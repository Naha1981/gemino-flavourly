/**
 * GATE QA-2 — PURE alert policy (framework-free, no db import, node:test
 * friendly — same convention as lib/cron/authorize.ts and
 * lib/whatsapp/qr-freshness.ts).
 *
 * Everything here is a decision or an outbound HTTP call with an
 * injectable fetch. The database leg (dedupe query, row insert, portal
 * reads) lives in ./alerts.ts and is covered by wiring tests + the e2e
 * failing-first suite.
 */

/** Same failing check alerts at most once per 6 hours (owner spec). */
export const QA_ALERT_DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Owner's alert destination (overridable via env; never a secret). */
export const QA_ALERT_DEFAULT_TO = 'naha.thabiso@gmail.com';

export type QaAlertSeverity = 'info' | 'warning' | 'critical';

export interface QaAlertInput {
  severity: QaAlertSeverity;
  /** Stable check identity, e.g. "qa-sweep/database" — the dedupe key. */
  check: string;
  message: string;
  /** Evidence: Playwright report artifact URL, run URL, sweep origin… */
  reportUrl?: string | null;
}

// ---------------------------------------------------------------------------
// Email leg (Resend REST, mockable)
// ---------------------------------------------------------------------------

export interface EmailSendResult {
  status: 'sent' | 'mock-sent' | 'skipped_no_key' | 'error';
  id?: string;
  error?: string;
}

/** Transport selection is a pure decision so tests can pin it. */
export function resolveEmailTransport(env: Record<string, string | undefined>): 'mock' | 'resend' | 'none' {
  if (env.QA_ALERT_EMAIL_TRANSPORT === 'mock') return 'mock';
  if (env.RESEND_API_KEY) return 'resend';
  return 'none';
}

/** Subject line exactly per the owner spec: "Flavourly QA broken: <check>". */
export function buildAlertSubject(check: string): string {
  return `Flavourly QA broken: ${check}`;
}

/** Plain-text body: failing check + evidence/report link (owner spec). */
export function buildAlertEmailText(input: QaAlertInput): string {
  const lines = [
    `A Flavourly self-test failed.`,
    ``,
    `Check:    ${input.check}`,
    `Severity: ${input.severity}`,
    `Time:     ${new Date().toISOString()}`,
    ``,
    `What failed:`,
    input.message,
  ];
  if (input.reportUrl) {
    lines.push('', `Evidence / report: ${input.reportUrl}`);
  }
  lines.push(
    '',
    `— Flavourly QA alert pipeline (deduped: this check will not re-alert for 6 hours).`
  );
  return lines.join('\n');
}

export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<Response>;

/** Injectable for tests; defaults to the global fetch. */
let emailFetch: FetchLike = (url, init) => fetch(url, init);

export function __setEmailFetchForTests(fn: FetchLike | null): void {
  emailFetch = fn ?? ((url, init) => fetch(url, init));
}

export async function sendQaAlertEmail(
  subject: string,
  text: string,
  env: Record<string, string | undefined> = process.env
): Promise<EmailSendResult> {
  const transport = resolveEmailTransport(env);
  if (transport === 'mock') {
    return { status: 'mock-sent', id: 'mock' };
  }
  if (transport === 'none') {
    return { status: 'skipped_no_key' };
  }
  try {
    const res = await emailFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.QA_ALERT_FROM || 'Flavourly QA <onboarding@resend.dev>',
        to: [env.QA_ALERT_TO || QA_ALERT_DEFAULT_TO],
        subject,
        text,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'error', error: `Resend HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { status: 'sent', id: data.id };
  } catch (err: any) {
    return { status: 'error', error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Dedupe decision
// ---------------------------------------------------------------------------

/**
 * Pure dedupe decision (unit-testable): has this check already alerted
 * inside the window? `lastAlertAt` may be null (never alerted).
 */
export function shouldDedupeAlert(lastAlertAt: Date | null, now: Date = new Date()): boolean {
  if (!lastAlertAt) return false;
  return now.getTime() - lastAlertAt.getTime() < QA_ALERT_DEDUPE_WINDOW_MS;
}
