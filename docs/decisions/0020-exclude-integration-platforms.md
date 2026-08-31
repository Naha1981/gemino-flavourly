# ADR-020: Exclude n8n / Zapier / Make / Trigger.dev as integration paths

**Status:** ACCEPTED · **Date:** 2026-08-31 · **Scope:** platform integrations

## Context

The PRD's sales motion is WhatsApp-first for non-technical restaurant owners. Integration requests, when they come, will be "push my bookings into my POS/sheet". The iPaaS platforms (n8n self-host, Zapier, Make, Trigger.dev) each add: a dependency surface, an auth/secret store, a billing relationship (or a server to babysit), and a support burden — for zero current customers asking.

## Decision

1. **Excluded:** Zapier, Make (Integromat), Trigger.dev, and self-hosted n8n as first-party integration paths.
2. Inbound integrations land through the **public REST API (`/api/v1`, gate API-1)** and **outbound webhooks** — surfaces we control, test, and rate-limit per tier.
3. A customer who lives on Zapier/Make is served by *them* polling our REST API/webhooks, not by us shipping bespoke SDKs.
4. Activepieces is the one candidate kept warm — see ADR-021.

## Consequences

- (+) No new infrastructure, secrets, or vendor relationships before revenue justifies them.
- (+) Integration surface stays testable in the repo (contract tests).
- (−) A minority of enterprise prospects may ask for native Zapier/Make apps — handled case-by-case via the webhook surface.
- Trigger to revisit: a paying Signature/Group customer with a hard requirement.

## Compliance

Iron Rules 2 (bounded gates — integration platform work is not a gate), 8 (pilot-first), and the OSS-first policy (ADR-0001 dependency discipline).
