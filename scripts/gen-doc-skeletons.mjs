#!/usr/bin/env node
// DOC-1: creates the small doc skeletons (skills prompts, integrations
// placeholders, ADR stubs where full text lives in dedicated files).
// Idempotent: refuses to overwrite non-empty existing files.
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

function put(rel, content) {
  const p = join(DOCS, rel);
  mkdirSync(dirname(p), { recursive: true });
  if (existsSync(p) && readFileSync(p, 'utf8').trim().length > 0) {
    console.log(`skip (exists): ${rel}`);
    return;
  }
  writeFileSync(p, content);
  console.log(`wrote: ${rel}`);
}

// ── docs/skills: discovery-skill reference prompts ───────────────────────────
const SKILLS = {
  'figranium.md': `# Discovery prompt — Figranium

**Use when:** scouting product/UX patterns for a feature before building it.

Prompt template:
> Search Figranium for [restaurant SaaS / WhatsApp automation / loyalty UX] patterns. For each result capture: the user job, the shortest path to value, and one anti-pattern to avoid. Return a table with links. Reject anything that requires a new heavyweight dependency (Iron Rule: reuse the existing stack).

Repo policy: patterns are adopted into PRODUCT_MAP language and UI conventions, never imported as code. Any dependency addition needs an ADR.`,
  'awesome-selfhosted.md': `# Discovery prompt — Awesome-Selfhosted

**Use when:** evaluating whether to self-host a capability (queue, cache, analytics) instead of paying a SaaS.

Prompt template:
> From awesome-selfhosted, list candidates for [capability]. For each: maintenance burden (updates, backups), resource floor (RAM/CPU on a R200/mo VPS), single-tenant vs multi-tenant fit, and what breaks first at 50 tenants. Recommend ONE or "none — the managed service is cheaper at our scale".

Repo policy: default is OSS-first ONLY when it runs inside the existing Render/Vercel envelope; otherwise the managed option wins (see ADR-0001 dependency policy).`,
  'openalternative.md': `# Discovery prompt — OpenAlternative

**Use when:** a task looks like it needs a commercial SaaS — check for an open alternative first.

Prompt template:
> Find open-source alternatives to [commercial tool]. For each: license (must be permissive or AGPL-with-isolation), last release date, and whether it can run as a sidecar on Render. Compare total cost of ownership vs the commercial API at our volume.

Repo policy: an alternative is only adopted if it removes a paid dependency AND passes the awesome-selfhosted resource test. Decision recorded as an ADR.`,
  'free-ai-apis.md': `# Discovery prompt — Free-AI-APIs

**Use when:** adding any AI capability — find the free/most generous tier before committing to a paid key.

Prompt template:
> List free-tier LLM APIs usable from a Node server (rate limits, context window, license of the ToS for customer-data processing). Rank for: (a) WhatsApp-length concierge replies, (b) marketing copy drafting, (c) review-reply drafting. Note which are usable with POPIA-sensitive data.

Current stack answer: Groq primary (GROQ_API_KEY) + Gemini fallback — already wired in lib/ai/responder.ts. Any third provider must slot into the same fallback chain, never replace it.`,
  'api-arsenal.md': `# Discovery prompt — Public-API arsenal

**Use when:** a feature needs external data (maps, reviews, weather, holidays, payments).

Prompt template:
> Find public APIs providing [data]. For each: auth model, free quota, SLA, EU/ZA data residency, and webhook support. Rank by "works without a credit card" first.

Current registry: see docs/API_REGISTRY.md (Places, PayFast, Groq, Gemini, Firecrawl, cron-job.org, Neon, Clerk). New API = new row in the registry + ADR.`,
};

for (const [name, content] of Object.entries(SKILLS)) put(`skills/${name}`, content);

// ── docs/integrations: planned-status skeletons ─────────────────────────────
const INTEGRATIONS = {
  'api.md': `# Integration: REST API (/api/v1)

**Status: PLANNED** — gate API-1 (see docs/PROGRAM.md row 15). MCP gateway deferred with it (ADR-022).

Scope when built:
- Versioned JSON REST under /api/v1, per-tenant API keys (hashed at rest).
- Resources: contacts, reservations, campaigns, reviews, loyalty balances.
- Rate limits per tier; idempotency keys required on all POSTs.
- OpenAPI document generated from route handlers (not hand-written).`,
  'webhooks.md': `# Integration: outbound webhooks

**Status: PLANNED** — gate API-1/OPS-1.

Scope when built:
- Events: booking.created, booking.confirmed, booking.no_show, review.received, campaign.completed, subscription.activated.
- HMAC-SHA256 signed (same scheme as the operator webhook), retries with exponential backoff, dead-letter viewer in super admin.
- Note: inbound PayFast ITN + operator webhook already shipped (see docs/API_REGISTRY.md).`,
  'events.md': `# Integration: event stream / telemetry

**Status: PLANNED** — gate TEL-1 (Telemetry & Intent Intelligence).

Scope when built:
- Internal event bus: qr_scanned, join_started, joined, message_replied, reward_verified.
- Rules → intent scores → next-best-action queue → outcome measurement (the Observe→Learn loop).
- Hub-event tracking for the public menu pages (FEATURE_MATRIX row 1 proof).`,
  'mcp.md': `# Integration: MCP gateway

**Status: DEFERRED** — ADR-022. Revisit at gate API-1.

Rationale: no current customer asks for MCP; the REST API covers agent access with less surface. Trigger to revisit: an agent-platform customer or 3+ integration requests.`,
  'make.md': `# Integration: Make.com

**Status: EXCLUDED** — ADR-020 (commercial iPaaS exclusion). Revisit only if a paying Signature/Group customer requires it; then it lands via the webhook surface, never a bespoke SDK.`,
  'zapier.md': `# Integration: Zapier

**Status: EXCLUDED** — ADR-020. Same terms as Make.com.`,
};

for (const [name, content] of Object.entries(INTEGRATIONS)) put(`integrations/${name}`, content);

console.log('done');
