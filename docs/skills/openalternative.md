# Discovery prompt — OpenAlternative

**Use when:** a task looks like it needs a commercial SaaS — check for an open alternative first.

Prompt template:
> Find open-source alternatives to [commercial tool]. For each: license (must be permissive or AGPL-with-isolation), last release date, and whether it can run as a sidecar on Render. Compare total cost of ownership vs the commercial API at our volume.

Repo policy: an alternative is only adopted if it removes a paid dependency AND passes the awesome-selfhosted resource test. Decision recorded as an ADR.