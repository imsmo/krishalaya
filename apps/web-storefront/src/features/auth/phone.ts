// apps/web-storefront/src/features/auth/phone.ts · PC-56 STORE-1a · C5 — the phone field's refusals, said as a fact the person can fix.
//
// Canon W321: "This needs 10 digits after +91 — this one has 9." and "The field keeps what you typed; fix one digit, not the whole number."
// The digit rule is COUNTRY data, not a literal on the screen: a tiny table keyed by ISO country, India first, extendable. The country is
// the tenant's (GET /v1/storefront/tenant → countryCode) and, while no definer read exposes that yet, the country the API's OWN normaliser
// reads a bare national number as (`phoneDefaultCountry`) — so the screen states exactly the rule the API will apply. An unknown country
// gets the generic, honest sentence ("include the country code") and NO digit claim.
//
// This mirrors apps/api/src/shared/utils/phone.ts `normalizePhoneE164` for the rules it knows (strip spaces/dashes/brackets; "00" → "+";
// one leading trunk "0"; a bare national number; the country code typed without "+"). The API still decides: if it refuses a number this
// accepted, the screen says "not a valid mobile number" — never a digit count it cannot stand behind.

export interface PhoneRule {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Country calling code, digits only (no "+"). */
  dial: string;
  /** Digits in a national mobile number (after the calling code). */
  nationalDigits: number;
  /** A trunk prefix people write before a national number on paper ("0" in India), stripped once. Null when the country has none. */
  trunkPrefix: string | null;
}

export const PHONE_RULES: Readonly<Record<string, PhoneRule>> = Object.freeze({
  IN: Object.freeze({ country: 'IN', dial: '91', nationalDigits: 10, trunkPrefix: '0' }),
});

export function phoneRuleFor(country: string | null | undefined): PhoneRule | null {
  return (country && PHONE_RULES[country.trim().toUpperCase()]) || null;
}

const E164 = /^\+[1-9]\d{7,14}$/;

export type PhoneCheck =
  | { kind: 'ok'; e164: string }
  | { kind: 'empty' }
  /** The rule is known and the digit count is wrong: "needs {need} digits after +{dial} — this one has {have}". */
  | { kind: 'digits'; dial: string; need: number; have: number }
  /** Not a number we can read, and no digit claim to make. */
  | { kind: 'generic' };

/** Read what was typed against the country's rule. Pure; never throws. */
export function checkPhone(raw: string | null | undefined, country: string | null | undefined): PhoneCheck {
  let s = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (s.length === 0) return { kind: 'empty' };
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  const rule = phoneRuleFor(country);
  if (s.startsWith('+')) {
    if (!/^\+\d+$/.test(s)) return { kind: 'generic' };
    if (rule && s.startsWith(`+${rule.dial}`)) {
      const national = s.slice(1 + rule.dial.length);
      return national.length === rule.nationalDigits && E164.test(s) ? { kind: 'ok', e164: s } : { kind: 'digits', dial: rule.dial, need: rule.nationalDigits, have: national.length };
    }
    return E164.test(s) ? { kind: 'ok', e164: s } : { kind: 'generic' };
  }
  if (!/^\d+$/.test(s)) return { kind: 'generic' };
  if (!rule) return { kind: 'generic' };   // a bare number with no known rule: we cannot know its country
  let national = s;
  if (rule.trunkPrefix && national.length === rule.nationalDigits + rule.trunkPrefix.length && national.startsWith(rule.trunkPrefix)) national = national.slice(rule.trunkPrefix.length);
  else if (national.length === rule.nationalDigits + rule.dial.length && national.startsWith(rule.dial)) national = national.slice(rule.dial.length);
  if (national.length !== rule.nationalDigits) return { kind: 'digits', dial: rule.dial, need: rule.nationalDigits, have: national.length };
  const e164 = `+${rule.dial}${national}`;
  return E164.test(e164) ? { kind: 'ok', e164 } : { kind: 'generic' };
}
