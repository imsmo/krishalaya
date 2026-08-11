// shared/utils/phone.ts · E.164 phone normalisation/validation (India-first, intl-ready).
// Phone is the primary identity key, so normalisation must be deterministic.
const E164 = /^\+[1-9]\d{7,14}$/;

/** Normalise common Indian inputs to E.164 (+91…). Returns null if not normalisable. */
export function normalizePhoneE164(raw: string, defaultCountry = '+91'): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-()]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return E164.test(s) ? s : null;
  s = s.replace(/\D/g, '');
  if (defaultCountry === '+91') {
    // **A LEADING ZERO IS THE STD PREFIX, NOT PART OF THE NUMBER (PC-56 TENANT-1b-4).** "098765 43210" is how a phone
    // number is written on paper across India, and it was returning null — so a paper-first member import would have
    // flagged a large share of a real SHG register as an invalid phone and sent staff to correct nothing. No Indian mobile
    // number begins with 0, so stripping exactly one leading zero from an 11-digit string is unambiguous.
    //
    // This change only ever turns a REFUSAL into an acceptance, so no number that resolved before resolves differently
    // now: existing accounts are untouched and the login path gains the same tolerance, which is correct — 098765 43210
    // and +91 98765 43210 are one subscriber and must be one person.
    if (s.length === 11 && s.startsWith('0')) s = s.slice(1);
    if (s.length === 10) return E164.test('+91' + s) ? '+91' + s : null;
    if (s.length === 12 && s.startsWith('91')) return E164.test('+' + s) ? '+' + s : null;
    return null;
  }
  const candidate = defaultCountry + s;
  return E164.test(candidate) ? candidate : null;
}

export function isValidE164(s: string): boolean { return E164.test(s); }

/** Mask for logs/UI: +9198****3210 */
export function maskPhone(e164: string): string {
  if (!e164 || e164.length < 6) return '****';
  return e164.slice(0, 5) + '****' + e164.slice(-4);
}
