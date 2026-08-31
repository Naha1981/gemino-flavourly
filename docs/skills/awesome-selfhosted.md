# Discovery prompt — Awesome-Selfhosted

**Use when:** evaluating whether to self-host a capability (queue, cache, analytics) instead of paying a SaaS.

Prompt template:
> From awesome-selfhosted, list candidates for [capability]. For each: maintenance burden (updates, backups), resource floor (RAM/CPU on a R200/mo VPS), single-tenant vs multi-tenant fit, and what breaks first at 50 tenants. Recommend ONE or "none — the managed service is cheaper at our scale".

Repo policy: default is OSS-first ONLY when it runs inside the existing Render/Vercel envelope; otherwise the managed option wins (see ADR-0001 dependency policy).