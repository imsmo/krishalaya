// apps/web-partner/src/test/claims-guard.spec.ts · PC-56 PARTNER-1a · founder D7 (survey E2) — the canon's FALSE claims never ship as copy.
// Ported from the storefront's claims guard. Over every value of the scopes the partner console's pages print — `dash.`, `help.`, `settings.`,
// `partner.`, `partner1.` — in en, hi and gu: no mailbox ('@'), no brand domain, no helpline, no country code, no round-the-clock promise, no
// hardware-key name, no penny-drop, no "invisible by construction", no "emailed", no sandbox money, no comparison with other lenders, no
// business hours, no severity labels, no LA-number.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const SCOPE = /^(dash\.|help\.|settings\.|partner\.|partner1\.)/;
const FORBIDDEN: readonly [string, RegExp][] = [
  ['@', /@/], ['krishalaya.in', /krishalaya\.in/i], ['krishalaya.com', /krishalaya\.com/i], ['1800', /1800/], ['+91', /\+91/],
  ['24×7', /24\s*[×x*]\s*7/i], ['FIDO2', /FIDO2/i], ['penny', /penny/i], ['invisible by construction', /invisible by construction/i],
  ['emailed', /emailed/i], ['sandbox money', /sandbox money/i], ['repay better', /repay better/i], ['business hours', /business hours/i],
  ['P0', /\bP0\b/], ['P1', /\bP1\b/], ['LA-', /\bLA-/],
];

describe('PC-56 PARTNER-1a · claims guard', () => {
  it.each(Object.entries(CATS))('%s: no forbidden claim in any dash. / help. / settings. / partner. / partner1. value', (_l, cat) => {
    const keys = Object.keys(cat).filter((k) => SCOPE.test(k));
    expect(keys.length).toBeGreaterThan(200);
    for (const k of keys) for (const [name, re] of FORBIDDEN) expect([k, name, re.test((cat as Record<string, string>)[k])]).toEqual([k, name, false]);
  });
  it.each(Object.entries(CATS))('%s: the flagged-off sentence says "switched off … nothing is broken", never "unavailable"', (_l, cat) => {
    expect((cat as Record<string, string>)['partner.off.body']).toBeTruthy();
    expect(en['partner.off.title']).toMatch(/switched off/i); expect(en['partner.off.body']).toMatch(/Nothing is broken/);
    for (const k of ['partner.off.title', 'partner.off.body']) expect([k, /unavailable/i.test(en[k])]).toEqual([k, false]);
  });
  it('the old false lines are gone: "You only see consented data" lead, the support mailbox, "business hours IST"', () => {
    for (const k of ['dash.lead', 'help.contactBody', 'help.integrationBody', 'dash.approved', 'dash.pendingExposure']) expect([k, k in en]).toEqual([k, false]);
  });
});
