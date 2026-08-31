# ADR-021: Activepieces deferred with an explicit review trigger

**Status:** ACCEPTED (deferred) · **Date:** 2026-08-31

## Context

Activepieces (open-source Zapier alternative, MIT core) is the only iPaaS compatible with our OSS-first policy (ADR-0001/ADR-020). It could let a restaurant owner self-serve "when booking created → post to my POS". But hosting it on the current Render envelope adds a second always-on service + upgrade burden, with **zero customers requesting integrations today**.

## Decision

Deferred. Recorded with an explicit review trigger rather than an open "maybe":

> **Revisit Activepieces when 3+ paying customers request webhook/API integrations** (counted in the CRM as integration requests, not idle curiosity).

Until then, integration needs are served by `/api/v1` + outbound webhooks (ADR-020).

## Consequences

- (+) No infrastructure or maintenance cost now.
- (+) The decision is reversible and its trigger is measurable.
- (−) When the trigger fires, expect a 1-gate build (docker service, SSO, per-tenant isolation) — estimated one bounded gate, not a rewrite.
