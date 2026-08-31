import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REMINDER_RUNGS,
  buildConfirmationReply,
  buildReminderMessage,
  dueRung,
  reminderScanWindow,
  rungReadiness,
  rungSentField,
  runReminderCron,
  type ReminderCandidate,
  type ReminderStore,
} from './reminder-ladder.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, '..', '..');
const STORE = join(MAIN, 'lib', 'revenue', 'reminder-ladder-store.ts');
const CRON = join(MAIN, 'app', 'api', 'cron', 'booking-reminders', 'route.ts');
const RESPONDER = join(MAIN, 'lib', 'ai', 'responder.ts');
const SCHEMA = join(MAIN, 'lib', 'db', 'schema.ts');
const MIGRATE_DDL = join(MAIN, 'lib', 'db', 'migrate-ddl.ts');
const DDL_SQL = join(MAIN, 'drizzle', '0022_booking_reminder_ladder.sql');

function code(path: string): string {
  assert.ok(existsSync(path), `missing file: ${path}`);
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/{\/\*[\s\S]*?\*\/}/g, '');
}

const H = 3_600_000;
const NOW = new Date('2026-08-31T12:00:00Z');

function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: 'r1',
    tenantId: 't1',
    restaurantName: 'The Copper Pot',
    customerName: 'Thabo',
    customerPhone: '+27821234567',
    contactId: 'c1',
    conversationId: 'v1',
    reservationDate: new Date(NOW.getTime() + 36 * H),
    partySize: 4,
    reminder48SentAt: null,
    reminder24SentAt: null,
    reminder6SentAt: null,
    ...overrides,
  };
}

/**
 * O2 — the reminder ladder's windows are the money decision: each booking
 * gets at most one reminder per rung, rungs fire only inside their disjoint
 * windows, and a late-made booking never receives absurd "48 hours to go"
 * messages. All pure — no database.
 */
describe('rungReadiness — disjoint windows', () => {
  test('48h rung: due while 24h < time-until <= 48h', () => {
    assert.equal(rungReadiness(48, new Date(NOW.getTime() + 36 * H), NOW, null), 'due');
    assert.equal(rungReadiness(48, new Date(NOW.getTime() + 47.9 * H), NOW, null), 'due');
    // Outside: too far out, and inside the 24h rung's window.
    assert.equal(rungReadiness(48, new Date(NOW.getTime() + 60 * H), NOW, null), 'not_yet_in_window');
    assert.equal(rungReadiness(48, new Date(NOW.getTime() + 20 * H), NOW, null), 'not_yet_in_window');
    // Boundary: exactly 48h away is inside.
    assert.equal(rungReadiness(48, new Date(NOW.getTime() + 48 * H), NOW, null), 'due');
    // Exactly 24h away belongs to the 24h rung, not 48h.
    assert.equal(rungReadiness(48, new Date(NOW.getTime() + 24 * H), NOW, null), 'not_yet_in_window');
  });

  test('24h rung: due while 6h < time-until <= 24h', () => {
    assert.equal(rungReadiness(24, new Date(NOW.getTime() + 12 * H), NOW, null), 'due');
    assert.equal(rungReadiness(24, new Date(NOW.getTime() + 24 * H), NOW, null), 'due');
    assert.equal(rungReadiness(24, new Date(NOW.getTime() + 30 * H), NOW, null), 'not_yet_in_window');
    assert.equal(rungReadiness(24, new Date(NOW.getTime() + 5 * H), NOW, null), 'not_yet_in_window');
  });

  test('6h rung: due while 0 < time-until <= 6h', () => {
    assert.equal(rungReadiness(6, new Date(NOW.getTime() + 3 * H), NOW, null), 'due');
    assert.equal(rungReadiness(6, new Date(NOW.getTime() + 6 * H), NOW, null), 'due');
    assert.equal(rungReadiness(6, new Date(NOW.getTime() + 12 * H), NOW, null), 'not_yet_in_window');
    assert.equal(rungReadiness(6, new Date(NOW.getTime() - 1 * H), NOW, null), 'reservation_passed');
  });

  test('a sent rung never fires again, even after edits', () => {
    const date = new Date(NOW.getTime() + 36 * H);
    assert.equal(rungReadiness(48, date, NOW, new Date(NOW.getTime() - H)), 'already_sent');
  });

  test('MUTATION GUARD: rungs are exactly 48/24/6', () => {
    assert.deepEqual([...REMINDER_RUNGS].sort((a, b) => b - a), [48, 24, 6]);
  });
});

describe('dueRung — one rung per booking per moment', () => {
  test('booking 36h out owes exactly the 48h reminder', () => {
    assert.equal(dueRung(candidate(), NOW), 48);
  });

  test('booking 12h out owes exactly the 24h reminder (never a late 48h)', () => {
    assert.equal(dueRung(candidate({ reservationDate: new Date(NOW.getTime() + 12 * H) }), NOW), 24);
  });

  test('booking 3h out owes exactly the 6h reminder', () => {
    assert.equal(dueRung(candidate({ reservationDate: new Date(NOW.getTime() + 3 * H) }), NOW), 6);
  });

  test('a booking made 3 days out owes nothing yet', () => {
    assert.equal(dueRung(candidate({ reservationDate: new Date(NOW.getTime() + 72 * H) }), NOW), null);
  });

  test('sent flags suppress their rungs and expose the next one', () => {
    const c = candidate({ reminder48SentAt: new Date(NOW.getTime() - H) });
    assert.equal(dueRung(c, NOW), null); // 36h away, 48h sent, 24h window not open
    const c2 = candidate({
      reservationDate: new Date(NOW.getTime() + 20 * H),
      reminder48SentAt: new Date(NOW.getTime() - 20 * H),
    });
    assert.equal(dueRung(c2, NOW), 24);
    const c3 = candidate({
      reservationDate: new Date(NOW.getTime() + 4 * H),
      reminder48SentAt: new Date(NOW.getTime() - 40 * H),
      reminder24SentAt: new Date(NOW.getTime() - 18 * H),
    });
    assert.equal(dueRung(c3, NOW), 6);
    const all = candidate({
      reservationDate: new Date(NOW.getTime() + 3 * H),
      reminder48SentAt: new Date(NOW.getTime() - 45 * H),
      reminder24SentAt: new Date(NOW.getTime() - 21 * H),
      reminder6SentAt: new Date(NOW.getTime() - 3 * H),
    });
    assert.equal(dueRung(all, NOW), null);
  });
});

describe('copy contracts', () => {
  test('reminder carries CONFIRM and CANCEL self-service exits', () => {
    const msg = buildReminderMessage({
      restaurantName: 'The Copper Pot',
      customerName: 'Thabo',
      reservationDate: new Date('2026-09-02T19:00:00Z'),
      partySize: 4,
      rungHours: 24,
      now: NOW,
    });
    assert.match(msg, /Thabo/);
    assert.match(msg, /The Copper Pot/);
    assert.match(msg, /\*4\*/);
    assert.match(msg, /\*CONFIRM\*/);
    assert.match(msg, /\*CANCEL\*/);
  });

  test('confirmation reply locks in the booking details', () => {
    const msg = buildConfirmationReply({
      restaurantName: 'The Copper Pot',
      reservationDate: new Date('2026-09-02T19:00:00Z'),
      partySize: 2,
    });
    assert.match(msg, /confirmed/i);
    assert.match(msg, /The Copper Pot/);
    assert.match(msg, /\*2\*/);
    assert.match(msg, /CANCEL/);
  });

  test('confirmation with no booking is honest, never invents one', () => {
    const msg = buildConfirmationReply({
      restaurantName: 'The Copper Pot',
      reservationDate: null,
      partySize: null,
    });
    assert.match(msg, /couldn't find an upcoming booking/i);
    assert.doesNotMatch(msg, /locked in/i);
  });
});

describe('scan window', () => {
  test('window is [now, now+48h]', () => {
    const { from, to } = reminderScanWindow(NOW);
    assert.equal(from.getTime(), NOW.getTime());
    assert.equal(to.getTime(), NOW.getTime() + 48 * H);
  });
});

describe('runReminderCron — runner behaviour (in-memory store)', () => {
  function makeStore(behaviour: {
    candidates: ReminderCandidate[];
    claimResult?: boolean;
    recipient?: { to: string; waAccountId: string; name: string | null } | null;
    sendable?: (tenantId: string) => boolean;
  }): ReminderStore & { queued: { tenantId: string; to: string; text: string }[]; claims: { id: string; rung: number }[] } {
    const queued: { tenantId: string; to: string; text: string }[] = [];
    const claims: { id: string; rung: number }[] = [];
    return {
      queued,
      claims,
      async findReminderCandidates() {
        return behaviour.candidates;
      },
      async claimReminderRung(id, rung) {
        claims.push({ id, rung });
        return behaviour.claimResult ?? true;
      },
      async findRecipient() {
        return 'recipient' in behaviour ? behaviour.recipient ?? null : { to: '+27820000000', waAccountId: 'wa1', name: 'Thabo' };
      },
      async queueReminder(input) {
        queued.push({ tenantId: input.tenantId, to: input.to, text: input.text });
      },
    };
  }

  test('sends exactly one reminder per due booking and claims the rung', async () => {
    const store = makeStore({ candidates: [candidate()] });
    const summary = await runReminderCron(store, { now: NOW });
    assert.equal(summary.scanned, 1);
    assert.equal(summary.sent, 1);
    assert.equal(store.claims.length, 1);
    assert.equal(store.claims[0].rung, 48);
    assert.equal(store.queued.length, 1);
    assert.match(store.queued[0].text, /CONFIRM/);
  });

  test('nothing due -> nothing sent, no claims', async () => {
    const store = makeStore({
      candidates: [candidate({ reservationDate: new Date(NOW.getTime() + 72 * H) })],
    });
    const summary = await runReminderCron(store, { now: NOW });
    assert.equal(summary.sent, 0);
    assert.equal(store.claims.length, 0);
    assert.equal(summary.skipped.notDue, 1);
  });

  test('lost the claim race -> skipped as already sent, no duplicate queue', async () => {
    const store = makeStore({ candidates: [candidate()], claimResult: false });
    const summary = await runReminderCron(store, { now: NOW });
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.alreadySent, 1);
    assert.equal(store.queued.length, 0);
  });

  test('billing-blocked tenant is skipped and the rung stays unclaimed', async () => {
    const store = makeStore({ candidates: [candidate()] });
    const summary = await runReminderCron(store, {
      now: NOW,
      isSendable: () => false,
    });
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.billingBlocked, 1);
    assert.equal(store.claims.length, 0);
  });

  test('no recipient -> skipped without claiming (next run can retry)', async () => {
    const store = makeStore({ candidates: [candidate()], recipient: null });
    const summary = await runReminderCron(store, { now: NOW });
    assert.equal(summary.sent, 0);
    assert.equal(summary.skipped.noRecipient, 1);
    assert.equal(store.claims.length, 0);
  });

  test('queue failure is counted, never aborts the batch', async () => {
    const store = makeStore({
      candidates: [candidate(), candidate({ id: 'r2' })],
    });
    // First queue call throws.
    let first = true;
    const orig = store.queueReminder.bind(store);
    store.queueReminder = async (input) => {
      if (first) {
        first = false;
        throw new Error('boom');
      }
      return orig(input);
    };
    const summary = await runReminderCron(store, { now: NOW });
    assert.equal(summary.sent, 1);
    assert.equal(summary.skipped.failed, 1);
  });
});

describe('O2 — store and cron wiring seams', () => {
  const storeSrc = code(STORE);
  const cronSrc = code(CRON);

  test('cron is guarded by assertCronAuthorized and respects the kill-switch', () => {
    assert.match(cronSrc, /assertCronAuthorized\(req\)/);
    assert.match(cronSrc, /runReminderCron\(/);
    assert.match(cronSrc, /masterAiSwitch === false/);
    assert.match(cronSrc, /canSendAutomatedMessages/);
  });

  test('scan excludes opted-out contacts (POPIA), AI-off tenants, manual takeover', () => {
    assert.match(storeSrc, /or\(isNull\(contacts\.id\), eq\(contacts\.blocklisted, false\)\)/);
    assert.match(storeSrc, /eq\(tenants\.aiEnabled, true\)/);
    assert.match(storeSrc, /eq\(tenants\.manualMode, false\)/);
    assert.match(storeSrc, /or\(isNull\(conversations\.id\), eq\(conversations\.manualTakeover, false\)\)/);
    assert.match(storeSrc, /eq\(reservations\.status, 'confirmed'\)/);
  });

  test('rung claim is atomic: guarded by IS NULL', () => {
    assert.match(storeSrc, /isNull\(reservations\[field\]\)/);
    assert.match(storeSrc, /returning\(\{ id: reservations\.id \}\)/);
  });

  test('reminders go through the outbox (send_whatsapp job)', () => {
    assert.match(storeSrc, /type: 'send_whatsapp'/);
  });

  test('CONFIRM/YES handling sits in the responder before the booking intent', () => {
    const src = code(RESPONDER);
    const confirmAt = src.indexOf("'confirm', 'confirmed', 'yes'");
    const bookingAt = src.indexOf("lower.includes('book')");
    const cancelAt = src.indexOf('isCancellationRequest(text)');
    assert.ok(confirmAt > -1, 'CONFIRM handler missing');
    assert.ok(confirmAt < bookingAt, 'CONFIRM must precede the booking intent');
    assert.ok(cancelAt > -1 && cancelAt < confirmAt, 'cancellation intent must own cancel phrasing first');
    assert.match(src, /customerConfirmedAt: new Date\(\)/);
    assert.match(src, /buildConfirmationReply\(/);
  });

  test('rungSentField maps rungs to their columns', () => {
    assert.equal(rungSentField(48), 'reminder48SentAt');
    assert.equal(rungSentField(24), 'reminder24SentAt');
    assert.equal(rungSentField(6), 'reminder6SentAt');
  });
});

describe('O2 — schema parity', () => {
  test('reservations carries the three rung timestamps + customer confirmation', () => {
    const src = readFileSync(SCHEMA, 'utf8');
    for (const col of [
      'reminder48_sent_at',
      'reminder24_sent_at',
      'reminder6_sent_at',
      'customer_confirmed_at',
    ]) {
      assert.match(src, new RegExp(col), `${col} missing from schema.ts`);
    }
  });

  test('drizzle 0022 mirrors the runtime DDL', () => {
    const sql = readFileSync(DDL_SQL, 'utf8');
    assert.match(sql, /ADD COLUMN IF NOT EXISTS reminder48_sent_at/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS customer_confirmed_at/);
    const ddl = readFileSync(MIGRATE_DDL, 'utf8');
    assert.match(ddl, /reminder48_sent_at/);
    assert.match(ddl, /reservations_reminder_ladder_idx/);
  });
});
