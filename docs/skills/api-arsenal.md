# Discovery prompt — Public-API arsenal

**Use when:** a feature needs external data (maps, reviews, weather, holidays, payments).

Prompt template:
> Find public APIs providing [data]. For each: auth model, free quota, SLA, EU/ZA data residency, and webhook support. Rank by "works without a credit card" first.

Current registry: see docs/API_REGISTRY.md (Places, PayFast, Groq, Gemini, Firecrawl, cron-job.org, Neon, Clerk). New API = new row in the registry + ADR.