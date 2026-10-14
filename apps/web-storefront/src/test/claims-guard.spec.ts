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

// PC-56 HOTFIX-4 · brief §E / C5 (founder D2/D3/D4) — the money pages' refused claims stay out of every catalogue, and no STORE-2 value
// names a PERSON: a seller is the organisation ({org}), never a farmer's name placeholder.
describe('HOTFIX-4 · claims guard (money and privacy)', () => {
  const STORE2 = /^(checkout\.|bill\.|cart\.|store2\.|listing\.|money\.)/;
  it.each(Object.entries(CATS))('%s: no person-name placeholder in any STORE-2 value — {org}, never {name} / {seller} / {farmer} / {member}', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (!STORE2.test(k)) continue;
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner)\}/i.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: "price includes platform fee" is said nowhere; no COD cap figure; the refunds / one-payment lines only as refusals', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      expect([k, /includes?\s+(grading\s*&\s*)?platform fee|प्लेटफ़ॉर्म शुल्क शामिल|પ્લેટફોર્મ ફી સામેલ/i.test(v)]).toEqual([k, false]);
      expect([k, /20,000|20000|२०,०००|૨૦,૦૦૦/.test(v)]).toEqual([k, false]);
      if (k.startsWith('store2.refusal.')) continue;
      expect([k, /automatic refund|refund is automatic|one payment covers|escrow splits/i.test(v)]).toEqual([k, false]);
    }
  });
  it('every English HOTFIX-4 refusal says no / not', () => {
    const r = Object.entries(en).filter(([k]) => k.startsWith('store2.refusal.') && k !== 'store2.refusal.title');
    expect(r.length).toBe(3);
    for (const [k, v] of r) expect([k, /\bnot\b|\bno\b|\bnever\b/i.test(v)]).toEqual([k, true]);
  });
});

// PC-56 STORE-2a · brief §E / C7 — every canon claim the five browse surfaces REFUSE stays out of every catalogue as an OFFER. The phrases
// may appear ONLY inside `store2a.refusal.*` (which say no, by name); nowhere else in en / hi / gu. And no STORE-2a value carries a digit or
// a person placeholder (every figure is interpolated; the seller is {org}).
describe('STORE-2a · claims guard (browse, search, the lot, the organisation, inputs)', () => {
  const REFUSED = [
    /Tell me when|Tell me if it returns|Follow seller|hear when the next lot/i,              // no notifier
    /three languages at once|spelling doesn.t have to be perfect|spoken search works|heard you as/i,
    /closest matches|empty wall/i,
    /nearest first|\b\d+\s?km\b|\/qtl\/100\s?km|per[- ]km/i,                                   // founder D3
    /confidence 0|AI photo-grade|AI suggested/i,                                                // founder D2
    /grade verified again at dispatch|verified again at dispatch/i,
    /bulk[- ]tier|bulk pricing (is|unlocks)|verified-buyer-only/i,
    /KYC verified|centre-graded seller|completed sales\b/i,
    /read them translated|buyers read them translated/i,
    /oldest stock first|oldest batch ships first|MRP-capped|\b18\+/i,
    /hasn.t switched on input sales/i,
    /for this tenant\/plan|See store settings/i,
    /page(s)? the on-call/i,
    /mandi reference today|below it \(|APMC today/i,
    /it syncs when signal returns|listings saved from your last visit/i,
  ];
  it.each(Object.entries(CATS))('%s: the refused claims appear only inside a store2a refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (k.startsWith('store2a.refusal.')) continue;
      for (const re of REFUSED) expect([k, re.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no digit and no person placeholder in a STORE-2a value (figures are interpolated; the seller is {org})', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => /^(browse|search|lot|sellers|inputs|store2a)\./.test(k));
    expect(keys.length).toBe(112);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      expect([k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([k, false]);
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner)\}/i.test(v)]).toEqual([k, false]);
      expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
    }
  });
});
