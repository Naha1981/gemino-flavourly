/**
 * POPIA / GDPR command parser.
 *
 * Exact-command only. Substring matching hijacks ordinary sentences
 * ("please don't stop by") and is a compliance foot-gun.
 */
const OPT_OUT = new Set(['STOP', 'UNSUBSCRIBE', 'OPT-OUT', 'OPT OUT', 'CANCEL SUBSCRIPTION', 'REMOVE ME']);
const OPT_IN = new Set(['START', 'SUBSCRIBE', 'OPT-IN', 'OPT IN']);

function normalize(text: string): string {
  return text.trim().toUpperCase().replace(/[.!?]+$/g, '').trim();
}

export function isOptOutCommand(text: string): boolean {
  return OPT_OUT.has(normalize(text));
}

export function isOptInCommand(text: string): boolean {
  return OPT_IN.has(normalize(text));
}
