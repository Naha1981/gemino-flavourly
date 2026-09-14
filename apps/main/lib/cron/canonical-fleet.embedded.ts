/**
 * Embedded fallback for scripts/cron-fleet.json.
 *
 * Keep this structural snapshot in lockstep with the canonical JSON file.
 * `canonical-fleet.test.ts` deep-compares the parsed value so drift fails the gate.
 */

const timezone = 'Africa/Johannesburg';
const schedule = (minutes: number[], hours: number[] = [-1], wdays: number[] = [-1]) => ({
  mdays: [-1],
  months: [-1],
  wdays,
  hours,
  minutes,
  timezone,
  expiresAt: 0,
});

const cron = (key: string, title: string, url: string, cronSchedule: ReturnType<typeof schedule>, auth: 'cron-secret' | null = 'cron-secret') => ({
  key,
  title,
  url,
  schedule: cronSchedule,
  auth,
});

const everyMinute = schedule(Array.from({ length: 60 }, (_, i) => i));
const every5 = schedule([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
const every10 = schedule([0, 10, 20, 30, 40, 50]);
const every15 = schedule([0, 15, 30, 45]);
const halfHourly = schedule([0, 30]);
const hourly = schedule([0]);
const at7 = schedule([0], [7]);
const at6 = schedule([0], [6]);
const at8 = schedule([0], [8]);
const mondayAt8 = schedule([0], [8], [1]);
const fourTimesDaily = schedule([0], [0, 6, 12, 18]);
const sundayAt18 = schedule([0], [18], [0]);

const fleet = {
  $schema: './cron-fleet.schema.md',
  version: 1,
  description: 'Canonical Flavourly cron fleet (S5). 24 jobs + hourly system watchdog. Read by lib/cron/canonical-fleet.ts (fs), scripts/setup-cronjobs.mjs, and GET /api/admin/sync-crons.',
  baseUrl: 'https://gemino-flavourly-whatsapp.vercel.app',
  operatorUrl: 'https://my-own-whatsapp-2z5h.onrender.com',
  timezone,
  jobs: [
    cron('outbox', 'Outbox Worker', '{baseUrl}/api/cron/outbox', everyMinute),
    cron('process-prospects', 'Process Prospects', '{baseUrl}/api/cron/process-prospects', every5),
    cron('keep-operator-awake', 'Keep Operator Awake', '{operatorUrl}/health', every5, null),
    cron('aggregate-messages', 'Aggregate Messages', '{baseUrl}/api/cron/aggregate-messages', every5),
    cron('revenue-classify', 'Revenue Classifier', '{baseUrl}/api/cron/revenue-classify', every15),
    cron('waitlist', 'Waitlist Expiration', '{baseUrl}/api/cron/waitlist', every15),
    cron('no-show-detect', 'No-Show Detection', '{baseUrl}/api/cron/no-show-detect', halfHourly),
    cron('review-requests', 'Review Requests', '{baseUrl}/api/cron/review-requests', hourly),
    cron('birthday-rewards', 'Birthday Rewards', '{baseUrl}/api/cron/birthday-rewards', at7),
    cron('vip-alerts', 'VIP Daily Brief', '{baseUrl}/api/cron/vip-alerts', at7),
    cron('daily-brief', 'Daily Brief', '{baseUrl}/api/cron/daily-brief', at7),
    cron('generate-briefs', 'Generate Briefs', '{baseUrl}/api/cron/generate-briefs', at7),
    cron('fetch-google-reviews', 'Fetch Google Reviews', '{baseUrl}/api/cron/fetch-google-reviews', at6),
    cron('fetch-competitor-ratings', 'Fetch Competitor Ratings', '{baseUrl}/api/cron/fetch-competitor-ratings', at7),
    cron('track-competitors', 'Track Competitors', '{baseUrl}/api/cron/track-competitors', at8),
    cron('detect-events', 'Detect Events', '{baseUrl}/api/cron/detect-events', mondayAt8),
    cron('reactivation-campaigns', 'Reactivation Campaigns', '{baseUrl}/api/cron/reactivation-campaigns', fourTimesDaily),
    cron('cancellation-followup', 'Cancellation Follow-Up', '{baseUrl}/api/cron/cancellation-followup', fourTimesDaily),
    cron('customer-segmentation', 'Customer Segmentation', '{baseUrl}/api/cron/customer-segmentation', fourTimesDaily),
    cron('generate-calendars', 'Generate Calendars', '{baseUrl}/api/cron/generate-calendars', sundayAt18),
    cron('reward-expiry', 'Reward Events Expiry Sweep', '{baseUrl}/api/cron/reward-expiry', every15),
    cron('booking-reminders', 'Booking Reminder Ladder (48/24/6h)', '{baseUrl}/api/cron/booking-reminders', every15),
    cron('campaign-attribution', 'Campaign Attribution Reconciliation', '{baseUrl}/api/cron/campaign-attribution', fourTimesDaily),
    cron('qa-sweep', 'QA Smoke Sweep (self-test + Render keep-alive)', '{baseUrl}/api/cron/qa-sweep', every10),
  ],
  watchdog: cron('system-watchdog', 'System Watchdog', '{baseUrl}/api/cron/system-watchdog', hourly),
};

export const EMBEDDED_FLEET_JSON: string = JSON.stringify(fleet);
