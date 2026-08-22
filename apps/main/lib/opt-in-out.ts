/**
 * POPIA opt-in / opt-out command detection.
 *
 * This used to exist in two different places with two different rules:
 *   - the webhook route's blocklist bypass check was already an exact
 *     match on the whole trimmed message ("start")
 *   - lib/ai/responder.ts used \b(stop|unsubscribe|...)\b word-boundary
 *     regexes, which match the keyword ANYWHERE a whole word appears in
 *     the message — so "I can't stop thinking about your ribs" or "when
 *     do you start serving?" would incorrectly opt someone in/out.
 *
 * A compliance control needs to be conservative about false positives in
 * the other direction too: too permissive (catching innocuous
 * sentences) erodes trust in the whole feature and randomly silences or
 * re-subscribes real customers. These patterns require the ENTIRE
 * trimmed message to be (approximately) just the command — optionally
 * followed by a single trailing '.' or '!' — not a substring anywhere
 * within a longer sentence.
 */

const OPT_OUT_PATTERN = /^(stop|unsubscribe|opt[\s-]?out|cancel subscription|remove me)[.!]?$/i;

export function isOptOutMessage(text: string): boolean {
  return OPT_OUT_PATTERN.test(text.trim());
}

export function isOptInMessage(text: string): boolean {
  return text.trim().toLowerCase() === 'start';
}
