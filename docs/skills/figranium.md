# Discovery prompt — Figranium

**Use when:** scouting product/UX patterns for a feature before building it.

Prompt template:
> Search Figranium for [restaurant SaaS / WhatsApp automation / loyalty UX] patterns. For each result capture: the user job, the shortest path to value, and one anti-pattern to avoid. Return a table with links. Reject anything that requires a new heavyweight dependency (Iron Rule: reuse the existing stack).

Repo policy: patterns are adopted into PRODUCT_MAP language and UI conventions, never imported as code. Any dependency addition needs an ADR.