# Flavourly Restaurant Revenue Intelligence OS

This slice establishes Flavourly as the Restaurant Revenue Intelligence OS, combining revenue intelligence, menu intelligence and basket growth on one platform.

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

## Product boundary

`Orderly` is the parent product and commercial promise. `Flavourly` is a bounded capability inside it; it must reuse the same restaurant, menu, customer, order, evidence and attribution primitives.

No second Orderly application or duplicated infrastructure should be introduced.

## Architecture

`Public audit → Restaurant intelligence → Market opportunities → Activation → Lead Machine → Revenue attribution → Learning`.

The audit engine is deterministic and provider-independent. AI can be added behind the NahaLabs model/provider abstraction after evidence extraction and schema validation.
