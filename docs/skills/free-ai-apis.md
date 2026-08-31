# Discovery prompt — Free-AI-APIs

**Use when:** adding any AI capability — find the free/most generous tier before committing to a paid key.

Prompt template:
> List free-tier LLM APIs usable from a Node server (rate limits, context window, license of the ToS for customer-data processing). Rank for: (a) WhatsApp-length concierge replies, (b) marketing copy drafting, (c) review-reply drafting. Note which are usable with POPIA-sensitive data.

Current stack answer: Groq primary (GROQ_API_KEY) + Gemini fallback — already wired in lib/ai/responder.ts. Any third provider must slot into the same fallback chain, never replace it.