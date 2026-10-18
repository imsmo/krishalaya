// apps/web-partner/src/test/claims-guard.spec.ts · PC-56 PARTNER-1a · founder D7 (survey E2) — the canon's FALSE claims never ship as copy.
// Ported from the storefront's claims guard. Over every value of the scopes the partner console's pages print — `dash.`, `help.`, `settings.`,
// `partner.`, `partner1.` — in en, hi and gu: no mailbox ('@'), no brand domain, no helpline, no country code, no round-the-clock promise, no
// hardware-key name, no penny-drop, no "invisible by construction", no "emailed", no sandbox money, no comparison with other lenders, no
// business hours, no severity labels, no LA-number.
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { PARTNER1_REFUSALS } from '../features/partner1/refusals';
import { PARTNER2_REFUSALS } from '../features/partner2/refusals';

const CATS = { en, hi, gu } as const;
const SCOPE = /^(dash\.|help\.|settings\.|partner\.|partner1\.)/;
const FORBIDDEN: readonly [string, RegExp][] = [
  ['@', /@/], ['krishalaya.in', /krishalaya\.in/i], ['krishalaya.com', /krishalaya\.com/i], ['1800', /1800/], ['+91', /\+91/],
  ['24×7', /24\s*[×x*]\s*7/i], ['FIDO2', /FIDO2/i], ['penny', /penny/i], ['invisible by construction', /invisible by construction/i],
  ['emailed', /emailed/i], ['sandbox money', /sandbox money/i], ['repay better', /repay better/i], ['business hours', /business hours/i],
  ['P0', /\bP0\b/], ['P1', /\bP1\b/], ['LA-', /\bLA-/],
];

// PC-56 PARTNER-1b · founder D6 — the four new scopes (and every 1b refusal sentence) carry none of the canon's 1b claims either: no test
// credit, no account fields, no paper path, no live call, no regulator name, no signatory, no e-signature, no separate test world, no key
// by mail, no health page, no plan settings, no canon person or bank, no canon secret or key shape. The keys scope also never offers a
// self-made replacement ("rotate", a 24-hour overlap). The webhooks scope may say a secret is rotated BY PARTNER OPERATIONS (founder D2).
const SCOPE_1B = /^(partner1\.keys\.|partner1\.hooks\.|partner1\.onboarding\.|partner1\.readiness\.)/;
const FORBIDDEN_1B: readonly [string, RegExp][] = [
  ['self-service', /self[- ]?service/i], ['hash-only', /hash-only/i], ['penny', /penny/i], ['₹1', /₹\s*1\b/], ['IFSC', /IFSC/i], ['cheque', /cheque/i],
  ['video call', /video call/i], ['RBI', /\bRBI\b/], ['DIN', /\bDIN\b/], ['e-sign', /e-sign/i], ['countersign', /countersign/i], ['sandbox', /sandbox/i],
  ['emailed', /emailed/i], ['status page', /status page/i], ['plan settings', /plan settings/i], ['Amit', /\bAmit\b/], ['Jayesh', /Jayesh/i],
  ['Saurashtra', /Saurashtra/i], ['sgbank', /sgbank/i], ['whsec', /whsec/i], ['kv_live_', /kv_live_/i],
];
const FORBIDDEN_KEYS_ONLY: readonly [string, RegExp][] = [['rotate', /rotat/i], ['24 hours', /24\s*hours?/i]];

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

describe('PC-56 PARTNER-1b · claims guard (keys, webhooks, onboarding, readiness)', () => {
  it.each(Object.entries(CATS))('%s: no 1b claim in any partner1.keys. / .hooks. / .onboarding. / .readiness. value, nor in a 1b refusal', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...Object.keys(c).filter((k) => SCOPE_1B.test(k)), ...PARTNER1_REFUSALS.filter((r) => r.wave === '1b').map((r) => r.key)];
    expect(keys.length).toBeGreaterThan(150);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_1B, ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
    }
    for (const k of Object.keys(c).filter((x) => x.startsWith('partner1.keys.'))) for (const [name, re] of FORBIDDEN_KEYS_ONLY) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
  });
  it('the settlement statement says what is true (en): no account is collected, the FPO lends from its own wallet', () => {
    expect(en['partner1.onboarding.statement']).toMatch(/No settlement account is collected in Phase 1/);
    expect(en['partner1.onboarding.statement']).toMatch(/lender of record/);
    expect(en['partner1.hooks.secret']).toMatch(/held encrypted by the platform/);
    expect(en['partner1.hooks.secret']).toMatch(/partner operations on request/);
  });
});

// PC-56 PARTNER-2a · survey E2 — the insurer console's words: every `partner2.` value (and every 2a refusal) in en, hi and gu carries none of the
// canon's money, payout, identity, health or regulator claims — no settlement promise, no "receivable", nothing "automatic", no money set aside
// called reserves, no regulator's turnaround, no rural-sector quota, no ombudsman, no helpline or country code, no animal tag or vaccination,
// no voice call, no lapse warning, no pro-rata refund, no registry counts, no invented policy series, no "16:00" run, no "7 years", and no canon
// institution, scheme or person. The 1a list applies too (no mailbox, domain, round-the-clock promise …). M5 kills here.
const SCOPE_2A = /^partner2\./;
const FORBIDDEN_2A: readonly [string, RegExp][] = [
  ['T+1', /T\s*\+\s*1/i], ['settles', /settles?\b|settlement/i], ['receivable', /receivable/i], ['automatic', /automatic/i], ['auto-pay', /auto[- ]?pay/i],
  ['reserves', /reserves?\b/i], ['IRDAI TAT', /IRDAI|\bTAT\b/i], ['rural sector', /rural sector/i], ['ombudsman', /ombudsman/i], ['1800', /1800/], ['+91', /\+91/],
  ['ear-tag', /ear[- ]?tag/i], ['vaccinated', /vaccinat/i], ['voice', /\bvoice\b/i], ['lapse warning', /lapse warning/i], ['pro-rata', /pro[- ]?rata/i],
  ['11 kinds', /\b11 kinds\b/i], ['13 kinds', /\b13 kinds\b/i], ['BKI-', /BKI-/i], ['16:00', /16:00/], ['7 years', /\b7 years\b|seven years/i],
  ['canon insurer', /Bharat Krishi/i], ['canon bank', /Saurashtra|Gramin/i], ['canon people', /Savita|Hetal|Meera|Jayesh|Ramesh|\bAmit\b/i],
  ['schemes', /PMFBY|WBCIS|PMSBY|PMJJBY|\bIMD\b/i], ['avatars', /\bPM\b|\bAJ\b/],
];

// PC-56 PARTNER-2b — the founder-approved PARAMETRIC statement says "automatic" and "armed" only to DENY them ("There is no … automatic payout …
// nothing is armed, evaluated or paid"). It is exempt from exactly those two words — and pinned verbatim below, so a planted claim in it still
// turns this file red. Nothing else is exempt.
const STATEMENT_EXEMPT: Readonly<Record<string, readonly string[]>> = Object.freeze({ 'partner2.parametric.statement': ['automatic', 'armed'] });
const exempt = (k: string, name: string) => (STATEMENT_EXEMPT[k] ?? []).includes(name);

describe('PC-56 PARTNER-2a · claims guard (the insurer console)', () => {
  it.each(Object.entries(CATS))('%s: no 2a claim in any partner2. value, nor in a 2a refusal', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_2A.test(k)), ...PARTNER2_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(150);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_2A, ...FORBIDDEN]) if (!exempt(k, name)) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
    }
  });
  it('founder Q1 / Q4 / Q5 / Q6 words (en): commission and subsidy recorded, nothing charged; no policy number yet; policy facts only; switched off, nothing broken', () => {
    expect(en['partner2.products.recordedNote']).toMatch(/recorded on the product; nothing is charged against them today/);
    expect(en['partner2.policies.noNumber']).toBe('no policy number yet');
    expect(en['partner2.refusal.holderIdentity']).toMatch(/policy facts only/);
    expect(en['partner2.insuranceOff.title']).toMatch(/switched off/i); expect(en['partner2.insuranceOff.body']).toMatch(/Nothing is broken/);
    expect(en['partner2.refusal.premiumYours']).toMatch(/No premium total is shown as yours/);
  });
});

// PC-56 PARTNER-2b · WHERE THE MONEY IS NOT — the honest pages' words. Every `partner2.` value (and every refusal) in en, hi and gu carries none
// of the canon's issuance, premium, report or parametric claims: no next-day settlement, nothing receivable, no season, no field camp, no
// identity-number check, nothing pre-verified, no second approver, no spoken summary, no parked proposal, no weather grid vendor, no 72-hour
// clock, no rural quota, no regulator turnaround, no complaint escalation, no schedule, no download mark, nothing armed or certified, no index
// reading, none of the run's figures, nothing set aside, no standing release, no finance officer, no promise to families, no canon person, no
// canon batch / proposal / settlement number, no file fingerprint. The four founder-approved statements are pinned VERBATIM (en) and exist in hi
// and gu. M2 (a next-day settlement planted in the premiums statement) and M5 ("execution is automatic" on the parametric page) kill here; M1
// (a rupee sum labelled "collected" on the premiums page) kills in the source scan below.
const FORBIDDEN_2B: readonly [string, RegExp, string][] = [
  ['T+1', /T\s*\+\s*1/i, 'settles T+1 to your account'], ['settles', /settles?\b|settlement/i, 'the premium settles tomorrow'],
  ['receivable', /receivable/i, 'subsidy receivable'], ['kharif', /kharif/i, 'collected this kharif'], ['camp', /\bcamps?\b/i, 'camp batches arrive'],
  ['Aadhaar', /aadhaa?r/i, 'Aadhaar seeded'], ['pre-verified', /pre[- ]?verified/i, 'arrive pre-verified'], ['checker', /\bchecker/i, 'batch issuance adds a checker'],
  ['voice summary', /voice summary/i, 'policy PDF + voice summary'], ['parked', /\bparked\b/i, 'parked, holder informed'], ['AWS', /\bAWS\b/, 'AWS grid assignment'],
  ['72h', /\b72\s*h/i, 'the 72h SLA pauses'], ['rural sector', /rural sector/i, 'rural sector obligation 100%'], ['TAT', /\bTAT\b/, 'TAT comfortably met'],
  ['ombudsman', /ombudsman/i, 'escalated to ombudsman'], ['grievance', /grievance/i, 'Grievances (FY) 3'], ['quarterly', /quarterly/i, 'extracts generate quarterly'],
  ['watermark', /watermark/i, 'watermark per download'], ['armed', /\barmed\b/i, 'kharif armed'], ['certified', /certified/i, 'the certified index'],
  ['rainfall', /rainfall/i, 'the rainfall index'], ['₹77', /₹\s*77/, '₹77,16,000 batch'], ['412', /\b412\b/, '412 policies'], ['1,286', /1,286/, '1,286 acre'],
  ['earmarked', /earmarked/i, 'Reserves earmarked'], ['standing release', /standing release/i, 'standing release authority'], ['CFO', /\bCFO\b/, 'your CFO\'s authority'],
  ['families', /\bfamilies\b/i, '412 families get money'], ['Meera', /Meera/i, 'Meera Ben J.'], ['Jayesh', /Jayesh/i, 'Jayesh D.'], ['BATCH-', /BATCH-/i, 'BATCH-0711-PMF'],
  ['PRP-', /PRP-/i, 'PRP-2026-0713-02'], ['PMF-SETT-', /PMF-SETT-/i, 'PMF-SETT-0712'], ['sha256:', /sha256:/i, 'sha256:4e8a…71c9'],
  // M5's phrase and the run's own words, beyond the 2a list
  ['execution is automatic', /execution is automatic|automatic(ally)? (pay|execut|release)/i, 'execution is automatic on index certification'],
];
/** The four statements, keyed exactly as the founder approved them (2026-10-18). */
const STATEMENTS: Readonly<Record<string, string>> = Object.freeze({
  'partner2.issuance.statement': 'Cover starts when the farmer\'s premium payment is confirmed; the insurer does not issue policies on the platform yet',
  'partner2.premiums.statement': 'Premiums paid by farmers for policies on your products are collected by the platform and held in the platform\'s escrow account. Nothing is settled to your organisation yet: how and when premiums are remitted to insurers is being decided with the platform\'s advisers. Commission and the government subsidy are recorded on each product; nothing is charged or claimed against them today.',
  'partner2.reports.statement': 'Signed extracts for your filings are not available from the partner console yet',
  'partner2.parametric.statement': 'There is no parametric run, index feed, trigger evaluation or automatic payout on the platform. A parametric product is a label on a product today; nothing is armed, evaluated or paid.',
});

describe('PC-56 PARTNER-2b · claims guard (where the money is not)', () => {
  it('every 2b forbidden word is caught when planted once (each regex proven on its own canon phrase)', () => {
    for (const [name, re, planted] of FORBIDDEN_2B) expect([name, re.test(planted)]).toEqual([name, true]);
    // and a clean honest sentence passes all of them
    for (const [name, re] of FORBIDDEN_2B) expect([name, re.test('Nothing is issued from this console; counts only, never money.')]).toEqual([name, false]);
  });
  it.each(Object.entries(CATS))('%s: no 2b claim in any partner2. value, nor in any partner2 refusal (the parametric statement exempt from "armed" / "automatic" only)', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_2A.test(k)), ...PARTNER2_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(250);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of FORBIDDEN_2B) {
        const skip = exempt(k, name) || (k === 'partner2.parametric.statement' && name === 'execution is automatic' && c[k] === STATEMENTS[k]);
        if (!skip) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      }
    }
  });
  it('the four founder-approved statements, keyed exactly (en), present in hi and gu; the export line names the mailbox, never an address', () => {
    for (const [k, v] of Object.entries(STATEMENTS)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 20 && hi[k] !== v, typeof gu[k] === 'string' && gu[k].length > 20 && gu[k] !== v]).toEqual([k, true, true]);
    }
    expect(Object.keys(STATEMENT_EXEMPT)).toEqual(['partner2.parametric.statement']);
    expect(en['partner2.export.notAvailable']).toBe('Exports are not available from the partner console yet; write to the partners mailbox.');
    expect(en['partner2.reports.neverFile']).toMatch(/^We never file for you/);
  });
  it('the premiums page cannot print money: its view and page import no money formatter and carry no rupee sign, no "collected", no premium amount, no currency formatter (M1)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const SRC = path.join(__dirname, '..');
    for (const rel of ['components/partner2/InsurerPremiumsView.tsx', 'app/insurer/premiums/page.tsx']) {
      const code = fs.readFileSync(path.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const [name, re] of [['formatMoneyMinor', /formatMoneyMinor/], ['₹', /₹/], ['collected', /collected/i], ['premiumMinor', /premiumMinor|premium_minor/], ['currency formatter', /NumberFormat|currency/i], ['sumInsured', /sumInsured/]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});
