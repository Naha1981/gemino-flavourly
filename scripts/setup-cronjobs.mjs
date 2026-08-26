// API_KEY="..." CRON_SECRET="..." node scripts/setup-cronjobs.mjs
//
// One-shot dev tool: syncs cron-job.org jobs for the Gemino Flavourly platform.
// Reads API_KEY and CRON_SECRET from environment.
// Fetches existing jobs, uses one as a shape template, then creates/updates/skips.
// Never touches non-app-domain jobs (e.g. Render /health keep-awake).
// DO NOT commit this script with real keys. It is gitignored by design.

const BASE_URL = 'https://api.cron-job.org';
const APP_URL = 'https://gemino-flavourly-whatsapp.vercel.app';
const OPERATOR_URL = process.env.OPERATOR_URL || 'https://gemino-flavourly-operator.onrender.com';

const API_KEY = process.env.API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

if (!API_KEY) {
  console.error('ERROR: API_KEY environment variable is required.');
  console.error('Usage: API_KEY="..." CRON_SECRET="..." node scripts/setup-cronjobs.mjs');
  process.exit(1);
}

if (!CRON_SECRET) {
  console.error('ERROR: CRON_SECRET environment variable is required.');
  console.error('Usage: API_KEY="..." CRON_SECRET="..." node scripts/setup-cronjobs.mjs');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

function schedule({ hours = [-1], minutes = [0], mdays = [-1], months = [-1], wdays = [-1] }) {
  return { hours, minutes, mdays, months, wdays, timezone: 'Africa/Johannesburg', expiresAt: 0 };
}

const jobs = [
  { title: 'Outbox Worker', url: `${APP_URL}/api/cron/outbox`, schedule: schedule({ minutes: Array.from({ length: 60 }, (_, i) => i) }) },
  { title: 'Process Prospects', url: `${APP_URL}/api/cron/process-prospects`, schedule: schedule({ minutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] }) },
  { title: 'Keep Operator Awake', url: `${OPERATOR_URL}/health`, schedule: schedule({ minutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] }) },
  { title: 'Aggregate Messages', url: `${APP_URL}/api/cron/aggregate-messages`, schedule: schedule({ minutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55] }) },
  { title: 'Revenue Classifier', url: `${APP_URL}/api/cron/revenue-classify`, schedule: schedule({ minutes: [0, 15, 30, 45] }) },
  { title: 'Waitlist Expiration', url: `${APP_URL}/api/cron/waitlist`, schedule: schedule({ minutes: [0, 15, 30, 45] }) },
  { title: 'No-Show Detection', url: `${APP_URL}/api/cron/no-show-detect`, schedule: schedule({ minutes: [0, 30] }) },
  { title: 'Review Requests', url: `${APP_URL}/api/cron/review-requests`, schedule: schedule({ minutes: [0] }) },
  { title: 'Daily Brief', url: `${APP_URL}/api/cron/daily-brief`, schedule: schedule({ hours: [7], minutes: [0] }) },
  { title: 'Fetch Google Reviews', url: `${APP_URL}/api/cron/fetch-google-reviews`, schedule: schedule({ hours: [6], minutes: [0] }) },
  { title: 'Fetch Competitor Ratings', url: `${APP_URL}/api/cron/fetch-competitor-ratings`, schedule: schedule({ hours: [7], minutes: [0] }) },
  { title: 'Track Competitors', url: `${APP_URL}/api/cron/track-competitors`, schedule: schedule({ hours: [8], minutes: [0] }) },
  { title: 'Detect Events', url: `${APP_URL}/api/cron/detect-events`, schedule: schedule({ hours: [8], minutes: [0], wdays: [1] }) },
  { title: 'Reactivation Campaigns', url: `${APP_URL}/api/cron/reactivation-campaigns`, schedule: schedule({ hours: [10], minutes: [0] }) },
  { title: 'Cancellation Follow-Up', url: `${APP_URL}/api/cron/cancellation-followup`, schedule: schedule({ hours: [0, 6, 12, 18], minutes: [0] }) },
  { title: 'Customer Segmentation', url: `${APP_URL}/api/cron/customer-segmentation`, schedule: schedule({ hours: [0, 6, 12, 18], minutes: [0] }) },
  { title: 'Generate Briefs', url: `${APP_URL}/api/cron/generate-briefs`, schedule: schedule({ hours: [7], minutes: [0] }) },
  { title: 'Generate Calendars', url: `${APP_URL}/api/cron/generate-calendars`, schedule: schedule({ hours: [18], minutes: [0], wdays: [0] }) },
];

let created = 0;
let updated = 0;
let skipped = 0;
let failed = 0;

async function api(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { res, data, text };
}

async function fetchExistingJobs() {
  console.log('Fetching existing jobs from cron-job.org...\n');
  const { res, data, text } = await api('/jobs');
  if (!res.ok) {
    console.error(`ERROR: Failed to fetch jobs — ${res.status}`);
    console.error(`Body: ${text}`);
    process.exit(1);
  }
  if (!data || !Array.isArray(data.jobs)) {
    console.error('ERROR: Unexpected response shape from /jobs');
    console.error(`Body: ${JSON.stringify(data)}`);
    process.exit(1);
  }
  return data.jobs;
}

function findExisting(jobs, url) {
  return jobs.find((j) => j.url === url);
}

async function createJob(jobDef, shapeTemplate) {
  const body = {
    job: {
      title: jobDef.title,
      url: jobDef.url,
      enabled: true,
      saveResponses: true,
      requestMethod: shapeTemplate.requestMethod ?? 1,
      ...(shapeTemplate.requestHeaders ? { requestHeaders: shapeTemplate.requestHeaders } : {}),
      ...(shapeTemplate.requestBody ? { requestBody: shapeTemplate.requestBody } : {}),
      schedule: jobDef.schedule,
    },
  };

  const { res, data, text } = await api('/jobs', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (res.ok || res.status === 201 || res.status === 200) {
    console.log(`CREATE: ${jobDef.title}`);
    created += 1;
    return;
  }

  if (res.status === 400 && typeof data === 'object' && (data?.error?.code === 'title_already_exists' || data?.error?.code === 'ALREADY_EXISTS')) {
    console.log(`SKIP (exists): ${jobDef.title}`);
    skipped += 1;
    return;
  }

  if (res.status === 429) {
    console.error(`FAILED: ${jobDef.title} — rate limited (${res.status})`);
    failed += 1;
    return;
  }

  console.error(`FAILED: ${jobDef.title} — ${res.status} ${text}`);
  failed += 1;
}

async function updateJob(jobDef, existing, authHeader) {
  const body = {
    job: {
      title: jobDef.title,
      url: jobDef.url,
      enabled: true,
      saveResponses: true,
      requestMethod: existing.requestMethod ?? 1,
      requestHeaders: [{ name: 'Authorization', value: authHeader }],
      schedule: jobDef.schedule,
    },
  };

  const { res, text } = await api(`/jobs/${existing.jobId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (res.ok || res.status === 200 || res.status === 201) {
    console.log(`UPDATE: ${jobDef.title}`);
    updated += 1;
    return;
  }

  console.error(`FAILED to update ${jobDef.title} — ${res.status} ${text}`);
  failed += 1;
}

async function main() {
  const existingJobs = await fetchExistingJobs();

  const appJobs = jobs.filter((j) => j.url.includes(APP_URL));
  const template = existingJobs.find((j) => j.url.includes(APP_URL)) || existingJobs[0] || null;

  console.log(`Managing ${appJobs.length} app-domain jobs (template: ${template ? template.title + ' (' + template.requestMethod + ')' : 'none'})\n`);

  for (const jobDef of appJobs) {
    const existing = findExisting(existingJobs, jobDef.url);
    const authHeader = `Bearer ${CRON_SECRET}`;
    if (!existing) {
      await createJob(jobDef, template || { requestMethod: 1, requestHeaders: [{ name: 'Authorization', value: authHeader }] });
    } else {
      const currentAuth = existing.requestHeaders?.find((h) => h.name === 'Authorization')?.value || '';
      if (currentAuth !== authHeader) {
        await updateJob(jobDef, existing, authHeader);
      } else {
        console.log(`SKIP (exists): ${jobDef.title}`);
        skipped += 1;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log(`\nSummary: created=${created}, updated=${updated}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
