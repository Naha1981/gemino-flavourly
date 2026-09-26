# Flavourly Restaurant Revenue Intelligence

This slice starts the unified Restaurant Revenue Intelligence OS on top of the existing Flavourly platform.

## Implemented

- Public `/audit` restaurant diagnostic entry point.
- Public `POST /api/public/restaurant-audit` endpoint.
- Evidence-first website/menu audit using the existing Brand Intelligence scraper.
- Deterministic leakage candidates for menu pricing, descriptions, visible menu coverage, logo metadata and opening hours.
- Optional rating/competitor context support without inventing missing evidence.
- Authenticated `/dashboard/intelligence` command centre.
- Reuse of existing tenant, revenue, booking, review and market-intelligence data.
- Evidence language that separates verified observations from hypotheses/unknowns.

## Deliberately not claimed

A website scan does not prove revenue loss, customer intent, conversion rate or causation.

## Next layers

Menu optimisation → verified food assets → approvals → activation → Lead Machine attribution → measured experiments → revenue learning.

## Architecture

`Public audit → Restaurant intelligence → Market opportunities → Activation → Lead Machine → Revenue attribution → Learning`.

The audit engine is deterministic and provider-independent. AI can be added behind the NahaLabs model/provider abstraction after evidence extraction and schema validation.
