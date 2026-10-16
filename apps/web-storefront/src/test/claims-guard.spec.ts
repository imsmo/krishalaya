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
    expect(r.length).toBe(2);   // PC-56 STORE-2c (D3): the auto-refund refusal is retired — the refund is built
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

// PC-56 STORE-2b · brief §E / C7 — every canon claim the cart, its chains and the listing's add REFUSE stays out of every catalogue as an OFFER:
// the phrases may appear ONLY inside `store2b.refusal.*` (which say no, by name). And no STORE-2b value carries a digit, a currency sign or a
// person placeholder (every figure is interpolated — the minimum, the prices, the delta, the region; the seller is {org}).
describe('STORE-2b · claims guard (the cart, its chains, add to cart)', () => {
  const REFUSED = [
    /you have \S+ more|more carts? at/i,                                                  // one store per session (founder D3)
    /\/qtl\/100\s?km|per quintal per|estimate before slot/i,                              // the delivery estimate
    /\b\S*50 slabs|minimum \S*450|billed in .*slabs/i,                                    // slabs and a per-shipment minimum
    /plus 18% GST|\+18% GST|prices include GST|GST on delivery/i,                         // GST is extracted, never added
    /same-day harvests|see alternatives/i,
    /queued on your phone|pending sync/i, /changes stay saved on this phone|nothing is lost/i,
    /guest cart lives|lives on this device only/i,
    /upload yours once|upload renewal|licence pending|verified within a day/i,
    /reconcile zero-sum|audit trail has the entry|audit-trail entry/i,
    /repeated failures page|page the on-call/i,
    /Checkout is 3 steps/i,
  ];
  it.each(Object.entries(CATS))('%s: the refused claims appear only inside a store2b refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (k.startsWith('store2b.refusal.') || k.startsWith('store2a.refusal.')) continue;
      for (const re of REFUSED) expect([k, re.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no digit, no currency sign, no person placeholder in a STORE-2b value', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => /^(store2b\.|cart\.(titleOrg|signin|otherStore|yourCartAt|loadErrorServer|emptyOrg|browseStore|fromCheckout|status\.|summaryTitle|itemsSubtotal|quotedAtCheckout|resolveN|neverCharges|done\.|line\.|perUnitOf|photoAlt|quantityOf|reason\.|drift\.|confirm\.|failure\.|doorError|refused\.)|listing\.(qtyLabelUnit|addN|signinToBuy)$|checkout\.(placing|resolveInCart|regionUnknown)$)/.test(k));
    expect(keys.length).toBe(89);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      expect([k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([k, false]);
      expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner)\}/i.test(v)]).toEqual([k, false]);
    }
  });
  it('every English STORE-2b refusal says no / not / never / nothing / nobody', () => {
    const r = Object.entries(en).filter(([k]) => k.startsWith('store2b.refusal.'));
    expect(r.length).toBe(15);
    for (const [k, v] of r) expect([k, /\bnot\b|\bno\b|\bnever\b|\bnothing\b|\bnobody\b/i.test(v)]).toEqual([k, true]);
  });
});

// PC-56 STORE-3a · brief §E / C5 — every canon claim the order pages REFUSE stays out of every catalogue as an OFFER: the phrases may appear
// ONLY inside `store3a.refusal.*` (which say no, by name). And no STORE-3a value (store3a.*, the order statuses, the cancel reasons) carries a
// digit, a currency sign or a person placeholder — every figure is interpolated (the "99+" form is `{n}+`), the seller is the organisation.
describe('STORE-3a · claims guard (the orders, the order, the cancel chain, the confirmation)', () => {
  const REFUSED = [
    /packing recovery|freight deduction|refuse (it )?at the gate/i,                         // founder D1: no fee ladder
    /3[–-]5 bank days|bank days\b(?! is)/i,                                                  // no promised days
    /we chase|chase daily/i,
    /is notified with your reason|notified with your reason/i,                               // no notification row (B27)
    /gap refunds automatically|refunds automatically at the line price/i,                    // founder D2: no partial-fulfilment refund
    /first pick of equivalent|cancellation rate is visible/i,
    /OTP handover|re-grade slip|grading slip photo/i,
    /two farmers just heard|one SMS \+ app message/i,
    /escrow freezes for the disputed value/i,
    /My Orders disabled|order history disabled/i,
    /Pay the balance by|Get help on this order/i,
  ];
  it.each(Object.entries(CATS))('%s: the refused claims appear only inside a store3a refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (k.startsWith('store3a.refusal.') || k.startsWith('store2b.refusal.') || k.startsWith('store2a.refusal.') || k.startsWith('store2c.refusal.')) continue;
      for (const re of REFUSED) expect([k, re.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no digit, no currency sign, no person placeholder in a STORE-3a value', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store3a.') || k.startsWith('order.cancelReason.')
      || /^order\.(status\.(created|payment_pending|picked_up|in_transit|out_for_delivery|refunded|partially_refunded|partially_fulfilled|unknown)|terminal\.(refunded|partially_refunded))$/.test(k));
    expect(keys.length).toBe(139);   // PC-56 STORE-3c: store3a.refusal.payBalance retired (the balance payment is built)
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      expect([k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([k, false]);
      expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner)\}/i.test(v)]).toEqual([k, false]);
    }
  });
});

// PC-56 STORE-3b · brief §E / C5 — every canon claim the offer pages REFUSE stays out of every catalogue as an OFFER: the phrases may appear
// ONLY inside `store3b.refusal.*` (which say no, by name). And no STORE-3b value (store3b.*, the six offer statuses) carries a digit, a
// currency sign or a person placeholder — every figure is interpolated, the counterpart is the organisation.
describe('STORE-3b · claims guard (the offer list, the thread, the response chain)', () => {
  const REFUSED = [
    /both sides see the same mandi|mandi reference|Rajkot APMC/i,                              // no mandi figure
    /accept \S*4× more often|counters within/i,                                               // no AI hint
    /buying history/i,                                                                         // founder D5
    /delivered to you verbatim/i,                                                              // founder D3: no notes
    /message (the )?seller/i,                                                                  // founder D6
    /checkout picks up from the address step|exactly as if you.d bought at list price/i,      // founder D2: the regime instead
    /offers don.t reserve stock|stays live for direct buyers/i,                                // now false: accept reserves
    /Showing \S+ of \S+/i,                                                                     // keyset
    /Let it lapse/i,                                                                           // founder D4: copy, not an act
  ];
  it.each(Object.entries(CATS))('%s: the refused claims appear only inside a store3b refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (/\.refusal\./.test(k)) continue;   // every wave's refusal sentences (home.refusal.mandi, store2a/3a/3b.refusal.*) say no, by name
      for (const re of REFUSED) expect([k, re.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no digit, no currency sign, no person placeholder in a STORE-3b value', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store3b.') || /^offers\.status\.(open|countered|accepted|rejected|expired|converted)$/.test(k));
    expect(keys.length).toBe(115);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      expect([k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([k, false]);
      expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner)\}/i.test(v)]).toEqual([k, false]);
    }
  });
  it('every English STORE-3b refusal says no / not / never / cannot', () => {
    const r = Object.entries(en).filter(([k]) => k.startsWith('store3b.refusal.'));
    expect(r.length).toBe(12);
    for (const [k, v] of r) expect([k, /\bnot\b|\bno\b|\bnever\b|\bcannot\b/i.test(v)]).toEqual([k, true]);
  });
});

// PC-56 STORE-3c · brief §E / C6 — every canon claim the auction, my-bids and group-lot pages REFUSE stays out of every catalogue as an OFFER: the
// phrases may appear ONLY inside a refusal sentence (`*.refusal.*`, which say no, by name). And no STORE-3c value (store3c.* — the nine auction
// statuses, the six group-lot statuses, the deposit states, the balance rows) carries a digit, a currency sign or a person placeholder.
describe('STORE-3c · claims guard (the auction list, my bids, the group lot, the balance pay step)', () => {
  const REFUSED = [
    /\d+\s?% of your bid|of your bid\b/i,                                                       // founder D1: the lot-value rule is printed
    /names? masked/i,                                                                          // no identity at all
    /KYC-verified buyers|bidder qualification/i,                                               // no qualification check
    /reverse\s*·\s*dutch|dutch auction/i,                                                      // the entity refuses them
    /within 12\s?h|decision due within/i,                                                      // the per-auction deadline instead
    /follow to hear/i,                                                                         // no relist notifier
    /connection fingerprint|rings? get caught|caught and voided/i,                             // ip only; no ring detection
    /by tomorrow 18:00/i,                                                                      // founder D2: the settlement's due time
    /Register interest|first-committed|Interested buyers so far/i,                             // founder D3
    /indicative price|full lot value|below single-lot prices/i,                                // founder D3
    /graded separately at the centre/i,
    /never a wallet|own verified quintals/i,                                                   // the true payout sentence instead
    /we message you at|you pay only when the lot fills/i,
    /verified-buyer-only/i,
  ];
  it.each(Object.entries(CATS))('%s: the refused claims appear only inside a refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (/\.refusal\./.test(k)) continue;
      for (const re of REFUSED) expect([k, re.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: no digit, no currency sign, no person placeholder in a STORE-3c value', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store3c.'));
    expect(keys.length).toBe(136);
    for (const k of keys) {
      const v = (cat as Record<string, string>)[k];
      expect([k, /[0-9०-९૦-૯]/.test(v.replace(/\{[a-z]+\}/gi, ''))]).toEqual([k, false]);
      expect([k, /[₹$€£¥]/.test(v)]).toEqual([k, false]);
      expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|memberNo|fullName|owner|bidder|coordinator)\}/i.test(v)]).toEqual([k, false]);
    }
  });
  it('every English STORE-3c refusal says no / not / never / cannot', () => {
    const r = Object.entries(en).filter(([k]) => k.startsWith('store3c.refusal.'));
    expect(r.length).toBe(17);
    for (const [k, v] of r) expect([k, /\bnot\b|\bno\b|\bnever\b|\bcannot\b/i.test(v)]).toEqual([k, true]);
  });
});

// PC-56 HOTFIX-6 · C4 (founder D2; HOTFIX-4 D3) — the conversation page OFFERS NO CALL: a call is named only inside `store4.refusal.*`
// (which says no). The old offers ("Call (number stays private)", "We connect the call…", "Connecting your call…") are gone from every
// catalogue, and no messaging / store4 value names a person (the other side is {org}).
describe('HOTFIX-6 · claims guard (the conversation: no call offered, no person named)', () => {
  const CALL = /\bcall(s|ing)?\b|कॉल|કૉલ/i;
  it.each(Object.entries(CATS))('%s: a call appears in a messaging / store4 value only inside the refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (!k.startsWith('messages.') && !k.startsWith('store4.')) continue;
      if (k.startsWith('store4.refusal.')) continue;
      expect([k, CALL.test(v)]).toEqual([k, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: the retired call offers are in no catalogue', (_l, cat) => {
    for (const k of ['messages.callCta', 'messages.callPrivacy', 'messages.callConnecting', 'messages.callError']) expect([k, k in cat]).toEqual([k, false]);
    for (const [k, v] of Object.entries(cat)) expect([k, /number stays private|connect the call without|Connecting your call/i.test(v)]).toEqual([k, false]);
  });
  it.each(Object.entries(CATS))('%s: no person placeholder in a store4 value — {org}, never a name', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => k.startsWith('store4.'));
    expect(keys.length).toBe(6);
    for (const k of keys) expect([k, /\{(name|seller|sellerName|farmer|farmerName|member|fullName|owner|caller|callee)\}/i.test((cat as Record<string, string>)[k])]).toEqual([k, false]);
  });
  it('the English call refusal says no / not', () => {
    const r = Object.entries(en).filter(([k]) => k.startsWith('store4.refusal.'));
    expect(r.length).toBe(1);
    for (const [k, v] of r) expect([k, /\bnot\b|\bno\b|\bnever\b/i.test(v)]).toEqual([k, true]);
  });
});

// PC-56 STORE-4a · brief §E (founders D1 / D3 / D4 / D6 / D7) — the account's refused canon claims appear ONLY inside `store4a.refusal.*`
// (which say no): no "Reveal" offer, no KYC-unlocks-auctions, no licence step, no buying history, no "within 30 days", no saved card, no
// unserviceable-pincode verdict, no "Flagged off", no on-call paging. No STORE-4a value names a person.
describe('STORE-4a · claims guard (the account, the address book, the data rights)', () => {
  const REFUSED = [
    /\bReveal\b/, /unlocks? auctions|bidder qualification/i, /Pesticide licence/i, /buying history/i, /within 30 days|erases within/i,
    /card ••••|card \*\*\*\*/i, /doesn.t reach this pincode|Unserviceable/i, /Flagged off/i, /page the on-call|pages? the on-call/i,
  ];
  it.each(Object.entries(CATS))('%s: the refused claims appear only inside a refusal', (_l, cat) => {
    for (const [k, v] of Object.entries(cat)) {
      if (/\.refusal\./.test(k)) continue;
      for (const re of REFUSED) expect([k, re.test(v)]).toEqual([k, false]);
    }
  });
  it('every English STORE-4a refusal says no / not / never / cannot', () => {
    const r = Object.entries(en).filter(([k]) => k.startsWith('store4a.refusal.'));
    expect(r.length).toBe(12);
    for (const [k, v] of r) expect([k, /\bnot\b|\bno\b|\bnever\b|\bcannot\b/i.test(v)]).toEqual([k, true]);
  });
});
