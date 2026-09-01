import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QA_ALERT_DEDUPE_WINDOW_MS,
  QA_ALERT_DEFAULT_TO,
  buildAlertSubject,
  buildAlertEmailText,
  shouldDedupeAlert,
  resolveEmailTransport,
  sendQaAlertEmail,
  __setEmailFetchForTests,
} from './alert-policy.ts';

/**
 * GATE QA-2 — alert pipeline unit tests (failing-first: written before
 * lib/qa/alerts.ts existed; every assertion below was red on the
 * unmodified branch — see the gate report for the red run).
 *
 * Pure decisions are tested directly; the Resend leg is exercised with an
 * injected fetch so no network and no key is ever needed.
 */

describe('QA-2 alert subject/body (owner spec wording)', () => {
  test('subject is exactly "Flavourly QA broken: <check>"', () => {
    assert.equal(buildAlertSubject('qa-sweep/database'), 'Flavourly QA broken: qa-sweep/database');
  });

  test('email body carries the failing check, the message and the report link', () => {
    const text = buildAlertEmailText({
      severity: 'critical',
      check: 'qa-sweep/landing',
      message: 'HTTP 500',
      reportUrl: 'https://github.com/x/actions/runs/1',
    });
    assert.match(text, /qa-sweep\/landing/);
    assert.match(text, /HTTP 500/);
    assert.match(text, /https:\/\/github\.com\/x\/actions\/runs\/1/);
    assert.match(text, /Flavourly/);
  });

  test('body without a report link does not render a dangling label', () => {
    const text = buildAlertEmailText({
      severity: 'warning',
      check: 'qa-sweep/operator',
      message: 'unreachable',
      reportUrl: null,
    });
    assert.doesNotMatch(text, /report:/i);
  });
});

describe('QA-2 dedupe window (once per 6h, per check)', () => {
  test('window constant is 6 hours', () => {
    assert.equal(QA_ALERT_DEDUPE_WINDOW_MS, 6 * 60 * 60 * 1000);
  });

  test('an alert 10 minutes ago dedupes', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const last = new Date('2026-09-01T11:50:00Z');
    assert.equal(shouldDedupeAlert(last, now), true);
  });

  test('an alert 6h1m ago does NOT dedupe', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const last = new Date('2026-09-01T05:59:00Z');
    assert.equal(shouldDedupeAlert(last, now), false);
  });

  test('never alerted (null) does not dedupe', () => {
    assert.equal(shouldDedupeAlert(null, new Date()), false);
  });
});

describe('QA-2 email transport selection (pure, env-driven)', () => {
  test('mock transport when QA_ALERT_EMAIL_TRANSPORT=mock (test harness)', () => {
    assert.equal(resolveEmailTransport({ QA_ALERT_EMAIL_TRANSPORT: 'mock' }), 'mock');
  });

  test('resend transport when RESEND_API_KEY is set', () => {
    assert.equal(resolveEmailTransport({ RESEND_API_KEY: 're_x' }), 'resend');
  });

  test('none (skip) when neither is configured — never throws', () => {
    assert.equal(resolveEmailTransport({}), 'none');
  });

  test('mock beats resend (explicit test mode wins)', () => {
    assert.equal(
      resolveEmailTransport({ QA_ALERT_EMAIL_TRANSPORT: 'mock', RESEND_API_KEY: 're_x' }),
      'mock'
    );
  });
});

describe('QA-2 email delivery (injected fetch — no network, no secrets)', () => {
  test('mock transport reports mock-sent', async () => {
    const result = await sendQaAlertEmail('s', 'b', {
      QA_ALERT_EMAIL_TRANSPORT: 'mock',
    });
    assert.equal(result.status, 'mock-sent');
  });

  test('no key reports skipped_no_key (row still lands — portal is the fallback channel)', async () => {
    const result = await sendQaAlertEmail('s', 'b', {});
    assert.equal(result.status, 'skipped_no_key');
  });

  test('resend success maps to sent + provider id', async () => {
    const calls: { url: string; init: Record<string, unknown> }[] = [];
    __setEmailFetchForTests(async (url, init) => {
      calls.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
    });
    try {
      const result = await sendQaAlertEmail('Flavourly QA broken: x', 'body', {
        RESEND_API_KEY: 're_test',
        QA_ALERT_TO: 'owner@example.com',
      });
      assert.equal(result.status, 'sent');
      assert.equal(result.id, 'email-1');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://api.resend.com/emails');
      const headers = calls[0].init.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer re_test');
      const body = JSON.parse(calls[0].init.body as string);
      assert.equal(body.subject, 'Flavourly QA broken: x');
      assert.deepEqual(body.to, ['owner@example.com']);
      assert.equal(body.from, 'Flavourly QA <onboarding@resend.dev>');
    } finally {
      __setEmailFetchForTests(null);
    }
  });

  test('resend HTTP error maps to status error with the body (never throws)', async () => {
    __setEmailFetchForTests(async () => new Response('rate limited', { status: 429 }));
    try {
      const result = await sendQaAlertEmail('s', 'b', { RESEND_API_KEY: 're_x' });
      assert.equal(result.status, 'error');
      assert.match(result.error ?? '', /429/);
    } finally {
      __setEmailFetchForTests(null);
    }
  });

  test('resend network failure maps to status error (never throws)', async () => {
    __setEmailFetchForTests(async () => {
      throw new Error('ECONNREFUSED');
    });
    try {
      const result = await sendQaAlertEmail('s', 'b', { RESEND_API_KEY: 're_x' });
      assert.equal(result.status, 'error');
      assert.match(result.error ?? '', /ECONNREFUSED/);
    } finally {
      __setEmailFetchForTests(null);
    }
  });

  test('default destination is the owner address (spec) and stays overridable', () => {
    assert.equal(QA_ALERT_DEFAULT_TO, 'naha.thabiso@gmail.com');
  });
});
