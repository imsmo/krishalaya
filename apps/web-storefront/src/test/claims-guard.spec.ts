// apps/web-storefront/src/test/claims-guard.spec.ts · PC-56 STORE-1a · C5 + brief §E — the canon's FALSE claims never ship as offers.
// No helpline number ("1800…"), no USSD code ("*123#") anywhere in the catalogues. "USSD", "voice", "missed-call" and "Call me" may appear
// ONLY in the `auth.refused.*` sentences that refuse them by name (and those sentences must say no). ("voice" is checked on the sign-in
// keys only — a chat voice message is a real, separate feature.) No "valid 10 minutes" literal (the
// server's TTL is printed), no "5 codes in 10 minutes … 30 minutes" literal, and the old false notice ("If that number has an account…")
// is gone: the API sends a code to every number.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;

describe('STORE-1a · claims guard', () => {
  it.each(Object.entries(CATS))('%s: no helpline number, no USSD code, anywhere', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) expect([k, /1800|\*123#/.test(v)]).toEqual([k, false]);
  });
  it.each(Object.entries(CATS))('%s: USSD / voice / missed-call / "Call me" only inside a refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      // PC-56 STORE-1c: W307's refusals (signup.refused.*) name USSD / missed-call too — to refuse them, never to offer them
      if (k.startsWith('auth.refused.') || k.startsWith('signup.refused.')) continue;
      expect([k, /USSD|missed[- ]call|Call me|मिस्ड|મિસ્ડ/i.test(v)]).toEqual([k, false]);
      // "voice" is a real feature elsewhere (a chat voice message, `messages.voice*`); on the sign-in surface it is only ever refused.
      if (k.startsWith('auth.')) expect([k, /\bvoice\b|वॉइस|વૉઇસ/i.test(v)]).toEqual([k, false]);
    }
  });
  it('every English refusal says no', () => {
    const refusals = Object.entries(en).filter(([k]) => k.startsWith('auth.refused.'));
    expect(refusals.length).toBeGreaterThanOrEqual(4);
    for (const [k, v] of refusals) expect([k, /\bnot\b|\bno\b|\bnever\b/i.test(v)]).toEqual([k, true]);
  });
  it('STORE-1c: every English W307 refusal says no — and none offers a desk, a number or an e-mail', () => {
    const refusals = Object.entries(en).filter(([k]) => k.startsWith('signup.refused.') && k !== 'signup.refused.title');
    expect(refusals.length).toBe(11);
    for (const [k, v] of refusals) expect([k, /\bnot\b|\bno\b|\bnever\b/i.test(v)]).toEqual([k, true]);
    for (const cat of Object.values(CATS)) for (const [k, v] of Object.entries(cat)) {
      if (!k.startsWith('signup.') && !k.startsWith('pricing.')) continue;
      expect([k, /@|krishalaya\.in|1800|valid 10 minutes|resolution desk sorts/i.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no canon time literals for the OTP and no enumeration-shaped notice', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (!k.startsWith('auth.')) continue;
      expect([k, /10 minutes|10 मिनट|10 મિનિટ|30 minutes|If that number has an account/i.test(v)]).toEqual([k, false]);
    }
  });
});
