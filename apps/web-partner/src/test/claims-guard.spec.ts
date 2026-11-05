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
import { PARTNER3_REFUSALS } from '../features/partner3/refusals';
import { PARTNER4_REFUSALS } from '../features/partner4/refusals';
import { PARTNER5_REFUSALS } from '../features/partner5/refusals';
import { PARTNER6_REFUSALS, SURFACES_6A, SURFACES_6B, SURFACES_6C } from '../features/partner6/refusals';

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

// PC-56 PARTNER-2c · THE LENDER'S SHELF — every `partner2.` value (and every refusal) in en, hi and gu carries none of the canon's lending-shelf
// claims: no count of kinds the registry does not hold, no farmer-side comparison of lenders' terms, nothing "openly", no same-day listing, no
// rate ceiling or fair-lending rule, no generated farmer display, no member estimate for an organisation, no fee bearer, no snapshot law, and no
// canon institution, place or avatar. Each regex is proven on its own canon phrase. M5 ("farmers compare your terms openly" planted in the
// shelf's copy) kills here. Founder Q7's sentence is pinned verbatim (en) and exists in hi and gu.
const FORBIDDEN_2C: readonly [string, RegExp, string][] = [
  ['13 kinds', /\b13 kinds\b/i, 'Product kinds are registry data — 13 kinds from KCC to invoice discounting'],
  ['compare your terms', /compare (your|their|the) terms/i, 'Farmers compare your terms against other lenders\''],
  ['openly', /\bopenly\b/i, 'against other lenders\', openly'],
  ['the same day', /the same day|same[- ]day/i, 'FPO members see it in their app the same day'],
  ['fair-lending', /fair[- ]lending/i, 'APR above the platform fair-lending ceiling'],
  ['ceiling', /\bceiling\b/i, 'above the ceiling for the kind will not save'],
  ['auto-generated', /auto[- ]?generated/i, 'Farmer-facing display (auto-generated, Gujarati)'],
  ['qualify today', /qualify today/i, 'members qualify today (estimate shown before you save)'],
  ['640', /\b640\b/, '≈ 640 Anand FPO members'],
  ['never the farmer', /never the farmer/i, 'Charged to your bank — never the farmer'],
  ['charged to your bank', /charged to your (bank|organisation)/i, 'Charged to your bank'],
  ['snapshot law', /snapshot law/i, 'rate changes take effect for NEW applications only (snapshot law)'],
  ['Saurashtra', /Saurashtra/i, 'Saurashtra Gramin Bank'],
  ['Anand', /\bAnand\b/, '640 Anand FPO members'],
  ['AJ', /\bAJ\b/, 'the avatar AJ'],
];

describe('PC-56 PARTNER-2c · claims guard (the lender\'s shelf)', () => {
  it('every 2c forbidden word is caught when planted once (each regex proven on its own canon phrase); an honest sentence passes', () => {
    for (const [name, re, planted] of FORBIDDEN_2C) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const [name, re] of FORBIDDEN_2C) expect([name, re.test(en['partner2.refusal.loanProductsPlatformAuthored'])]).toEqual([name, false]);
  });
  it.each(Object.entries(CATS))('%s: no 2c claim in any partner2. value, nor in any partner2 refusal', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_2A.test(k)), ...PARTNER2_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(350);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of FORBIDDEN_2C) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
    }
  });
  it('founder Q7 (en, verbatim) and the shelf\'s binding words: the fee is data, nothing charged; rates in basis points; the count is consented; hi and gu carry their own', () => {
    expect(en['partner2.refusal.loanProductsPlatformAuthored']).toBe('Loan products are authored by the platform\'s partner operations after a signed agreement, not from this console; write to the partners mailbox to propose a change.');
    expect(en['partner2.loanProducts.feeLine']).toBe('recorded on the product: {amount} per loan / {bps} bps — the platform\'s fee leg is not live; nothing is charged today');
    expect(en['partner2.loanProducts.aprLine']).toBe('{apr} bps APR − {subvention} bps subsidy = {net} bps net of subsidy');
    expect(en['partner2.loanProducts.empty.title']).toBe('No products on your shelf yet');
    expect(en['partner2.loanProducts.empty.body']).toMatch(/^Products are authored by the platform's partner operations/);
    expect(en['partner2.loanProducts.appsNote']).toMatch(/consented/); expect(en['partner2.loanProducts.appsNote']).toMatch(/No applicant is named/);
    for (const k of ['partner2.refusal.loanProductsPlatformAuthored', 'partner2.loanProducts.feeLine', 'partner2.loanProducts.lead']) {
      expect([k, typeof hi[k] === 'string' && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k] !== en[k]]).toEqual([k, true, true]);
    }
    // no percentage anywhere in the shelf's words — rates are integer basis points (the M4 wall is in the render test)
    for (const [k, v] of Object.entries(en).filter(([x]) => x.startsWith('partner2.loanProducts.'))) expect([k, /\d+(\.\d+)?\s*%|\{\w+\}\s*%/.test(v)]).toEqual([k, false]);
  });
});

// PC-56 PARTNER-3a · THE INSURER READS ITS OWN CLAIMS (survey E4) — every `partner3.` value (and every PARTNER-3 refusal) in en, hi and gu
// carries none of the canon's claims words: nothing "paying", no 16:00 run, no settlement run, no voice, no second approver, no ₹1,00,000
// threshold, no 94%, no appeal path, no 7 years, no clock, no geotag / EXIF / same device, nothing hash-sealed or watermarked, nothing
// auto-verified, no duplicate signal, no confidence score, no re-shoot, no empanelment, no professional network, no paid-per-report, no
// auto-recusal, no cluster, no slot, no quadrat, no field sheet, no indicated payout, no loss ratio, no median, no ombudsman, nothing jointly
// funded, no risk desk, no FIR, no serial claimant, no canon person, no canon policy or claim number. Each regex is proven on its own canon
// phrase. No `partner3.` value carries "%" at all — the only percentage a 3a page prints is the survey's recorded damage figure, composed in
// features/partner3/figures.ts. M5 ("paying" planted on the queue's approved chip) kills here. The founder's decide sentence is pinned verbatim.
const SCOPE_3A = /^partner3\./;
const FORBIDDEN_3A: readonly [string, RegExp, string][] = [
  ['paying', /paying/i, 'approved · paying'], ['16:00', /16:00/, 'approved 10:20 · 16:00 run'], ['settlement run', /settlement run/i, 'in 16:00 settlement run'],
  ['voice', /\bvoice\b/i, 'one voice call, gu'], ['second approver', /second approver|2nd approver/i, 'decisions above ₹1,00,000 add a second approver'],
  ['₹1,00,000', /₹\s*1,00,000|₹\s*1L|≥\s*₹/i, 'decisions above ₹1,00,000'], ['94%', /94\s*%/, '94% of surveyed claims pay'], ['appeal path', /appeal path/i, 'clause + evidence + appeal path'],
  ['7 years', /\b7 years\b|seven years/i, 'full survey + decision record (7 years)'], ['clock', /clock/i, 'SLA clocks and survey schedules are server-side'],
  ['geotag', /geo-?tag/i, 'geotag inside parcel ✓'], ['EXIF', /\bEXIF\b/i, 'EXIF fresh ✓'], ['same device', /same device/i, 'same device as her app registration'],
  ['hash-sealed', /hash-?sealed/i, 'evidence board frozen into the claim file (hash-sealed)'], ['watermark', /watermark/i, 'media downloads are watermarked + recorded'],
  ['auto-verified', /auto-?verified/i, 'Auto-verified today 9'], ['duplicate', /duplicat/i, 'duplicate-image signal'], ['confidence', /confidence/i, 'hints with confidence scores'],
  ['re-shoot', /re-?shoot/i, 'Request re-shoot (guided)'], ['empanel', /empanel/i, 'Empanel surveyor'], ['professional network', /professional network/i, 'the platform\'s own professional network'],
  ['paid per', /paid per/i, 'paid per completed report through platform rails'], ['auto-recuse', /auto-?recuse/i, 'conflicts auto-recuse'], ['cluster', /cluster/i, 'hail cluster — Wed 15 Jul'],
  ['slot', /\bslots?\b/i, '2 slots this week'], ['quadrat', /quadrat/i, '5 sample quadrats per plot'], ['field sheet', /field sheet/i, 'signed the field sheet'],
  ['indicated payout', /indicated payout|indicated =/i, 'Indicated payout'], ['loss ratio', /loss ratio/i, 'Loss ratio (FY, non-parametric) 61%'], ['median', /median/i, 'Median event → paid 9 days'],
  ['ombudsman', /ombudsman/i, 'Repudiation complaints 0 to ombudsman'], ['jointly funded', /jointly funded/i, 'are now jointly funded'], ['risk desk', /risk desk/i, 'referred to platform risk desk'],
  ['FIR', /\bFIR\b/, 'FIR guidance to us'], ['serial', /\bserial\b/i, 'serial claimants'],
  ['Kesar', /Kesar/i, 'Kesar Ben V.'], ['Rathod', /Rathod/i, 'Dr. A. Rathod'], ['Shah', /\bShah\b/, 'R. Shah'], ['Iyer', /\bIyer\b/, 'M. Iyer'],
  ['BKI-', /BKI-/i, 'BKI-CTL-…3319'], ['CLM-', /CLM-/i, 'CLM-2026-0084'],
];
const DECIDE_STATEMENT = 'Claim decisions are not made from the partner console yet: the organisation that serves the farmer records the decision today, and the insurer\'s own decision will arrive together with its funding leg.';

describe('PC-56 PARTNER-3a · claims guard (the insurer\'s own claims)', () => {
  it('every 3a forbidden word is caught when planted once (each regex proven on its own canon phrase); an honest sentence passes', () => {
    for (const [name, re, planted] of FORBIDDEN_3A) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const [name, re] of FORBIDDEN_3A) expect([name, re.test(DECIDE_STATEMENT)]).toEqual([name, false]);
  });
  it.each(Object.entries(CATS))('%s: no 3a claim in any partner3. value, nor in any PARTNER-3 refusal; no "%" anywhere in the scope', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_3A.test(k)), ...PARTNER3_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(150);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_3A.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      expect([k, c[k].includes('%')]).toEqual([k, false]);
    }
  });
  it('founder Q3\'s decide sentence, keyed exactly (en), present in hi and gu; the export line names the mailbox, never an address', () => {
    expect(en['partner3.claim.decideStatement']).toBe(DECIDE_STATEMENT);
    for (const cat of [hi, gu]) expect([typeof cat['partner3.claim.decideStatement'] === 'string', cat['partner3.claim.decideStatement'] !== DECIDE_STATEMENT, cat['partner3.claim.decideStatement'].length > 40]).toEqual([true, true, true]);
    expect(en['partner3.export.notAvailable']).toBe('Exports are not available from the partner console yet; write to the partners mailbox.');
    expect(en['partner3.claims.lateNote']).toMatch(/A late report is recorded; nothing rejects a claim for it\./);
    expect(en['partner3.chip.approved']).toBe('Approved (incl. partially)');
  });
});

// PC-56 PARTNER-3b · WHAT THE INSURER DOES NOT HOLD — EVIDENCE, SURVEYORS, SURVEYS, FLAGS (survey E4, the founder's doors Q4 / Q5 / Q6 and the
// 3b door of 2026-10-28). The 3a list above already bans geotag, EXIF, same device, hash-sealed, watermark, auto-verified, duplicate,
// confidence, re-shoot, empanel, professional network, paid per, auto-recuse, cluster, slot, quadrat, field sheet, indicated payout, risk desk,
// FIR, serial and the 3a names — which is why none of the six statements uses those words, and why the canon's own button labels ("Empanel
// surveyor", "Request re-shoot (guided)", "Confirm Wednesday cluster") are NOT shipped as copy. This block adds the rest of the 3b canon: the
// remaining named people (and the honorifics the canon uses), the four places, the flag series and its rates, the two confidence scores, the
// breed, the health-record and scheme acronyms, the methodology words and the marketplace cross-signal. Each regex is proven on its own canon
// phrase, and the six founder-approved statements are pinned VERBATIM in en (present, different and non-trivial in hi and gu). M4 (the canon's
// "flagged automatically" planted in the fraud statement) kills here.
const FORBIDDEN_3B: readonly [string, RegExp, string][] = [
  ['Vaghela', /Vaghela/i, 'Dr. S. Vaghela — rides her Tuesday vaccination loop'],
  ['Chudasama', /Chudasama/i, 'H. Chudasama · agri (crop/CCE)'],
  ['Manju', /Manju/i, 'claimant Manju Ben R.'],
  ['Popat', /Popat/i, 'Popat Bhai K. (0087a) 2.0 acre'],
  ['Jashu', /Jashu/i, 'Jashu Ben P.'],
  ['Karsan', /Karsan/i, 'Karsan Bhai T.'],
  ['Ben ', /\bBen\s/, 'Kesar Ben V. · cattle death'],
  ['Bhai', /Bhai/i, 'Popat Bhai K.'],
  ['Dr.', /\bDr\./, 'Surveyor: Dr. A. Rathod (vet desk, independent)'],
  ['Bhavnagar', /Bhavnagar/i, 'CLM-…0093 cattle death · Bhavnagar route'],
  ['Junagadh', /Junagadh/i, 'vet (livestock) · Junagadh belt'],
  ['Amreli', /Amreli/i, 'agri (crop/CCE) · Junagadh + Amreli'],
  ['Bilkha', /Bilkha/i, '3 holders, Bilkha village'],
  ['FRD-', /FRD-/i, 'FRD-0713-01 · CLM-…0095'],
  ['flag rate', /flag rate/i, '3 of 3 flags (90d) · flag rate 4.1%'],
  ['false-flag', /false-?flag/i, 'false-flag rate 33% — watched, because flags have human cost'],
  ['0.9410', /0\.9410/, 'tag legible 0.9410'],
  ['0.8830', /0\.8830/, 'hail pattern consistent 0.8830'],
  ['4.1%', /4\.1\s*%/, 'flag rate 4.1%'],
  ['33%', /\b33\s*%/, 'false-flag rate 33%'],
  ['Jaffarabadi', /Jaffarabadi/i, 'ANM record: Jaffarabadi buffalo, 6 yrs, vaccinated'],
  ['ANM', /\bANM\b/, 'Registry cross-check — ANM record'],
  ['WBCIS', /WBCIS/i, 'repeat-hail villages offered WBCIS add-on'],
  ['CCE', /\bCCE\b/, 'agri (crop/CCE) · Junagadh + Amreli'],
  ['reference plot', /reference (undamaged )?plot/i, 'Reference undamaged plot photographed'],
  ['GPS', /\bGPS\b/i, '5 sample quadrats per plot, GPS-pinned'],
  ['theft-then-listing', /theft-?then-?listing/i, 'The theft-then-listing catch is the platform advantage'],
  ['flagged automatically', /flagged automatically/i, 'Suspicious claim patterns are flagged automatically for review'],
  ['server-side', /server-?side/i, 'Signal evaluation is server-side'],
  ['ear-tag', /ear[- ]?tag/i, 'Ear-tag ••2764 verified on-site'],
  ['vaccinated', /vaccinat/i, 'Health file coherent: vaccinated'],
  ['same-day', /\bsame[- ]day\b/i, 'Awaiting review 5 · oldest 6h · target same-day'],
  ['acre', /\bacres?\b/i, 'Popat Bhai K. (0087a) 2.0 acre 62%'],
];
/** The six statements of PARTNER-3b, keyed exactly as the founder approved them on 2026-10-28. */
const STATEMENTS_3B: Readonly<Record<string, string>> = Object.freeze({
  'partner3.evidence.statement': 'Claim evidence — photos, videos and documents — stays with the farmer and the organisation that serves them. Insurers do not see, review, verify or request evidence on the platform.',
  'partner3.surveyors.statement': 'There is no surveyor roster on the platform and this console manages nobody\'s staff. Surveys are arranged by the organisation that serves the farmer.',
  'partner3.surveys.statement': 'Surveys are scheduled and recorded by the organisation that serves the farmer, not from this console. Shown here are the claims on your products by survey status, as recorded.',
  'partner3.report.statement': 'The survey report is recorded by the organisation that serves the farmer. The insurer sees the recorded damage percentage and nothing else of the report; there is no report-acceptance step on the platform.',
  'partner3.fraud.statement': 'There are no fraud flags on the platform and none is raised from this console.',
  'partner3.chain.act3b.confirm': 'This action is not available from the partner console: evidence, surveys and surveyors are handled by the organisation that serves the farmer, and no fraud flag exists on the platform. Nothing was changed.',
});

describe('PC-56 PARTNER-3b · claims guard (what the insurer does not hold)', () => {
  it('every 3b forbidden word is caught when planted once (each regex proven on its own canon phrase); each of the six statements passes all of them', () => {
    for (const [name, re, planted] of FORBIDDEN_3B) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const [name, re] of FORBIDDEN_3B) for (const [k, v] of Object.entries(STATEMENTS_3B)) expect([k, name, re.test(v)]).toEqual([k, name, false]);
  });
  it.each(Object.entries(CATS))('%s: no 3a or 3b claim in any partner3. value, nor in any PARTNER-3 refusal; still no "%" anywhere in the scope', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_3A.test(k)), ...PARTNER3_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(220);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of FORBIDDEN_3B) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      expect([k, c[k].includes('%')]).toEqual([k, false]);
    }
  });
  it('the six founder-approved statements, keyed exactly (en), present in hi and gu and not an English copy', () => {
    for (const [k, v] of Object.entries(STATEMENTS_3B)) {
      expect([k, en[k]]).toEqual([k, v]);
      for (const cat of [hi, gu]) expect([k, typeof cat[k] === 'string' && cat[k].length > 20 && cat[k] !== v]).toEqual([k, true]);
    }
    expect(Object.keys(STATEMENTS_3B).length).toBe(6);
  });
  it('the DECOR controls are worded honestly, never with the canon\'s own labels; the counts line says CLAIMS, and the report block has its three branches', () => {
    for (const k of ['partner3.surveyors.empanel', 'partner3.board.reshoot', 'partner3.surveys.confirm', 'partner3.report.accept', 'partner3.report.query'])
      for (const [name, re] of [...FORBIDDEN_3A.map(([n, r]) => [n, r] as const), ...FORBIDDEN_3B.map(([n, r]) => [n, r] as const)]) expect([k, name, re.test(en[k])]).toEqual([k, name, false]);
    expect(en['partner3.surveys.countsOnlyClaims']).toMatch(/counts of CLAIMS/);
    expect(en['partner3.surveys.countsOnlyClaims']).toMatch(/no photo, video or document is counted anywhere on the platform/);
    expect(en['partner3.report.damage']).toBe('Recorded damage: {value}');
    expect(en['partner3.report.noSurveyYet']).toBe('No survey is recorded on this claim yet.');
    expect(en['partner3.report.noDamageRecorded']).toBe('The recorded report carries no damage percentage.');
    expect(en['partner3.evidence.empty.title']).toBe('No claim on your products is awaiting a survey');
  });
});

// PC-56 PARTNER-4a · THE LENDER READS ITS OWN BOOK (survey E6) — every `partner4.` value, every PARTNER-4 refusal, AND the eight surviving
// `loan.` values (the prefix that had NO scope until now, which is how three shipped sentences offering disbursal survived — survey C-19 /
// F-26) in en, hi and gu carry none of the canon's lending words: nothing disbursed from here, no co-approval, no response timer or clock, no
// rating or model or weighting, no "verified platform income", no bank-data rails, no identity-number tail, no land record or acreage, no
// scale-of-finance, no subsidy earned as an effective rate, no "%", no charge for opening a loan, no sanction letter, no instalment plan, no
// punctuality figure, no arrears bucket or portfolio-at-risk rate, nothing away from the platform, none of the canon's role names, no dairy
// bill, no animals, no money-record anchor, no seven-year promise, and no canon institution, person, place, bank, account tail or avatar.
// Each regex is PROVEN on its own canon phrase below, and no `partner4.` value carries "%" at all. M8 (a percentage planted on the portfolio)
// kills here; so would the return of `loan.disburseSubmit`.
const SCOPE_4A = /^(partner4\.|loan\.)/;
const FORBIDDEN_4A: readonly [string, RegExp, string][] = [
  // the one act the platform refuses by name. `disbursed` as a STATE is legitimate and must stay printable, so the verb and the noun forms
  // are banned and the past participle is not — the regex is proven on both directions below.
  ['disburse', /disburs(e\b|es\b|e[- ]|al\b|als\b|ing\b|ement)/i, 'Disburse ready batch (8 · ₹9,20,000)'],
  ['co-approve', /co-?approv/i, 'Co-approve — disburse now'],
  ['SLA', /\bSLA\b/, 'SLA left ▴'],
  ['clock', /clock/i, 'SLA clocks run server-side'],
  ['credit score', /credit[- ]?scor/i, 'Credit score — explainable, consent-shared'],
  ['742', /\b742\b/, 'Score (300–900) 742 · good'],
  ['band', /\bband\b/i, 'the 300–900 band'],
  ['model v', /model v/i, 'model v2.4 · computed 10 Jul'],
  ['factor', /factor/i, 'the factors JSON block: income_consistency +186'],
  ['verified platform income', /verified platform income/i, 'Verified platform income (12mo) ₹4,73,460'],
  ['account aggregator', /account[- ]?aggregator/i, 'consent-shared via account-aggregator rails'],
  ['Aadhaar', /aadhaa?r/i, 'Aadhaar (masked) verified XXXX-XXXX-8817'],
  ['7/12', /\b7\/12\b/, 'Land record (7/12) verified'],
  ['acre', /\bacres?\b/i, '4.2 acre · 2 parcels'],
  ['scale of finance', /scale[- ]?of[- ]?finance/i, 'Limit set from scale-of-finance × acreage'],
  ['subvention effective', /subvention[^.]*effective|effective[^.]*subvention/i, '4% effective with prompt-repayment subvention'],
  ['effective', /effective/i, '7.0% APR − 3.0% subvention = 4.0% effective'],
  ['origination fee', /origination fee/i, 'Platform origination fee posts to ledger'],
  ['sanction letter', /sanction letter/i, 'Borrower gets the sanction letter PDF'],
  ['EMI', /\bEMI\b/, 'EMI schedule generation'],
  ['schedule', /schedul/i, 'Schedule & repayment history'],
  ['on time', /\bon[- ]?time\b/i, '11/11 on time'],
  ['DPD', /\bDPD\b/, 'Overdue 1–30 DPD · 31 loans'],
  ['PAR', /\bPAR\b/, 'PAR > 30 1.9% outstanding basis'],
  ['off-platform', /off[- ]?platform/i, 'vs 4.8% your off-platform agri book'],
  ['credit officer', /credit[- ]?officer/i, 'Deciding needs credit-officer role'],
  ['disbursal officer', /disbursal[- ]?officer/i, 'Needs disbursal officer role'],
  ['servicing role', /servicing role/i, 'Servicing detail restricted — Needs servicing role'],
  ['credit-risk role', /credit[- ]?risk role/i, 'Risk analytics need your bank\'s credit-risk role'],
  ['collections role', /collections role/i, 'Collections view needs collections role'],
  ['milk bill', /milk bill/i, 'deduction ₹4,180 ≈ 23% of her avg fortnightly milk bill'],
  ['herd', /\bherds?\b/i, 'dairy product allows 2 active, herd-size-based'],
  ['ledger anchor', /ledger anchor/i, 'Ledger anchors — disbursal LTX-…71204'],
  ['LTX-', /LTX-/i, 'fee LTX-…71205'],
  ['7 years', /\b7 years\b|seven years/i, 'Closed loans stay viewable for 7 years'],
  ['code of conduct', /code of conduct/i, 'Collections code of conduct (platform-enforced)'],
  ['Saurashtra', /Saurashtra/i, 'Saurashtra Gramin Bank'],
  ['Gramin', /Gramin/i, 'Saurashtra Gramin Bank'],
  ['Kotak', /Kotak/i, 'Kotak ••7726 (verified)'],
  ['SBI', /\bSBI\b/, 'SBI ••2214 (verified)'],
  ['Anand FPO', /Anand/i, 'Ramesh P. · Anand FPO'],
  ['Mehsana', /Mehsana/i, 'Mehsana'],
  ['Junagadh', /Junagadh/i, '4.2 acre · 2 parcels · Junagadh'],
  ['LA-2026', /LA-2026/i, 'LA-2026-0710-08'],
  ['LN-2026', /LN-2026/i, 'LN-2026-0114 dairy'],
  ['KCC-2026', /KCC-2026/i, 'KCC-2026-0031 · limit ₹4,00,000'],
  ['CASE-0041', /CASE-0041/i, 'CASE-0041'],
  ['XXXX-XXXX', /XXXX-XXXX/i, 'XXXX-XXXX-8817'],
  ['AJ', /\bAJ\b/, 'the avatar AJ'],
  ['RBI ref', /RBI ref/i, 'RBI ref ••4471'],
  ['Ben ', /\bBen\s/, 'Hetal Ben S.'],
  ['Bhai', /Bhai/i, 'Popat Bhai K.'],
];

// PC-56 PARTNER-4b · WHAT A LENDER DOES NOT DISBURSE (founder 4b-3 / 4b-4 / 4b-5 / 4b-6) — the words of the two screens that promise a lender
// things this platform does not do: a second signature it never gave, a collections regime nobody enforces, a contact engine that does not
// exist, a destination model, a verified account tail, an instalment letter and the acronyms of arrears. Each regex is PROVEN on its own canon
// phrase below, and each is applied to EVERY `partner4.` and `loan.` value in all three languages (the same scope as 4a's).
const FORBIDDEN_4B: readonly [string, RegExp, string][] = [
  ['disbursal officer', /disbursal[- ]?officer/i, 'checker: your disbursal officer'],
  ['collections role', /collections role/i, 'Collections view needs collections role'],
  ['code of conduct', /code of conduct/i, 'Collections code of conduct (platform-enforced)'],
  ['contact hours window', /contact hours \d|contact hours only|hours 08:00/i, 'contact hours 08:00–19:00 only'],
  ['third-party agent', /third[- ]?party agents?/i, 'no third-party agents on platform-originated loans'],
  // the AFFIRMATIVE shapes only, as the `disburse` regex does: the word must stay printable in the sentence that DENIES the claim
  // (4a's own `contactTools` refusal says "no suspension exists", and this wave's says "no suspension of a partner organisation")
  ['suspension claim', /violation|partner suspension/i, 'Violation = partner suspension.'],
  ['penny-drop', /penny[- ]?drop/i, '8/8 destination accounts verified · penny-drop confirmed'],
  ['supplier-direct', /supplier[- ]?direct/i, 'supplier-direct (cattle purchase, dairy loan)'],
  ['auto-retries', /auto[- ]?retr/i, 'A failed transfer auto-retries and never blocks its batch-mates'],
  ['gentle-nudge', /gentle[- ]?nudge/i, 'gentle-nudge stage (Gujarati voice)'],
  ['T-3', /\bT-3\b/, 'reminder T-3 sent'],
  ['mediation promised', /mediation scheduled|mediated restructure|mediation before/i, 'FPO mediation scheduled 16 Jul'],
  ['••', /••/, 'Kotak ••7726 (verified)'],
  ['co-approval', /co-?approval/i, 'Co-approval recorded both sides'],
  ['both sides', /both sides/i, 'every rupee traceable both sides'],
  ['auto-assembled', /auto[- ]?assembl/i, 'maker: platform (auto-assembled)'],
];
/** The canon words 4b must NOT ban, because each is the honest content of one of its own pages. */
const PERMITTED_4B = ['Disbursed', 'Paid in this window', 'the borrower’s waiting period', '1 to 30 days past a recorded due date',
  'No due date is recorded at all', 'A loan that repays itself from the dairy cycle never becomes a knock on the door.'];

// PC-56 PARTNER-4c · THE KCC ACCOUNT THE PLATFORM DOES NOT KEEP (founder 4c-1 … 4c-6) — the words of an account that exists in no table:
// its ceiling, its unused remainder, the thing that revolves, the yearly re-opening, the crop-finance sheet with its land and its yearly
// uplift, the yearly review, the share of a ceiling, the interest that is said to build up, the subsidy said to be paid for repaying early,
// the check on what a farmer does with her own loan, the promise that the record cannot be altered — and the canon's person, crops and
// account number. Each regex is PROVEN on its own canon phrase below, and each is applied to EVERY `partner4.` and `loan.` value in all
// three languages (the same scope as 4a's and 4b's). M3 (the accrual sentence restored into a partner4. value) kills here.
//
// FOUR of them are deliberately NARROWED to the canon's affirmative shape, because the bare word is the honest content of a sentence this
// console already ships — exactly as 4a's `disburse` regex bans the act and spares the state (recorded in the wave report, §6):
//   • `available`  — `partner4.export.notAvailable` says "Exports are not available …" (4a / 2b-1), so the canon's FIGURE form is banned;
//   • `subvention` — `partner4.application.aprLine` carries the PLACEHOLDER `{subvention}` (the 2c integer-bps rule), so the canon's
//                    "credited … for repaying promptly" form is banned (and `effective` already bans the rest of that claim outright);
//   • `escalation` — `partner4.refusal.bankLimitDelegation` truthfully says "no escalation exists on this platform" (4b);
//   • `append-only`— `partner4.loan.noRepayments.body` truthfully says the REPAYMENT record is append-only (it has a real trigger, 0079),
//                    while the KCC ledger has only a grant (founder 4c-5), so the canon's reassurance about THE LEDGER is what is banned.
const FORBIDDEN_4C: readonly [string, RegExp, string][] = [
  ['revolving', /revolving/i, 'KCC account — active · revolving'],
  ['credit limit', /credit limit|\blimit ₹|unused limit/i, 'Annual reviews of this account’s credit limit'],
  // the brief's own words for the thing W216 says is absent (founder 4c-3): "no credit limit, drawing power, renewal date or limit review"
  ['drawing power', /drawing power/i, 'no credit limit, drawing power, renewal date or limit review is recorded here'],
  ['scale of finance', /scale[- ]?of[- ]?finance/i, 'Limit set from scale-of-finance × acreage'],
  ['escalation (affirmative)', /escalation\s*\/\s*yr|escalation per year|annual escalation|\+\s*\d+\s*escalation/i, '+ 10% escalation/yr — worksheet attached'],
  ['worksheet', /worksheet/i, 'borrower notified in Gujarati with the worksheet'],
  ['renewal', /renewal/i, 'renewal due Feb 2027'],
  ['limit review', /limit review|review of this account/i, 'Record limit review'],
  ['utilisation', /utilisation|utilization/i, 'Utilisation 55% healthy'],
  ['headroom', /headroom/i, 'healthy — headroom for emergencies'],
  ['available (figure)', /available ₹|available headroom|available balance|available limit/i, 'available ₹1,80,000'],
  ['accrual', /accrual/i, 'daily accrual on drawn balance'],
  ['accrues', /accrue/i, 'July accrues daily on drawn balance only'],
  ['interest applied', /interest applied|interest accrued/i, 'Interest applied on drawn balance only, monthly'],
  ['subvention credited', /subvention credited|credited on prompt|preserves the subvention/i, 'subvention credited on prompt seasonal repayment'],
  ['prompt repayment', /prompt[- ]?repayment|prompt seasonal/i, '4% effective with prompt-repayment subvention'],
  ['purpose check', /purpose check/i, 'Drawls above ₹50,000 … get a purpose check'],
  ['moneylender', /moneylender/i, 'input finance that leaks to moneylender repayment'],
  ['append-only (the ledger)', /ledger is append-?only|append-?only and safe/i, 'The ledger is append-only and safe.'],
  ['one truth, two languages', /one truth, two languages/i, 'He sees this same ledger in Gujarati — one truth, two languages'],
  ['cotton', /cotton/i, '3.5 acre cotton + 1.0 acre summer cumin'],
  ['cumin', /cumin/i, '1.0 acre summer cumin'],
  ['KCC-', /KCC-/i, 'KCC-2026-0031'],
  ['Jayesh', /Jayesh/i, 'KCC account — Jayesh D.'],
];
/** The canon words 4c must NOT ban, because each is the honest content of one of its own pages or of an earlier wave's. */
const PERMITTED_4C = ['A fresh KCC sits at zero until the season starts — no drawl, no interest, no cost.',
  'Kisan Credit Card loan', 'Exports are not available from the partner console yet; write to the partners mailbox.',
  'The record is append-only: a repayment is never edited or removed.',
  'No limit, no delegated authority and no escalation exists on this platform.',
  '{apr} bps APR − {subvention} bps subsidy = {net} bps net of subsidy',
  'there is no ceiling on it, no power to draw against one',
  'Nothing on this platform charges interest, on any basis at all.'];

describe('PC-56 PARTNER-4a · claims guard (the lender\'s own book)', () => {
  it('every 4a forbidden word is caught when planted once (each regex proven on its own canon phrase); an honest sentence passes all of them', () => {
    for (const [name, re, planted] of FORBIDDEN_4A) expect([name, re.test(planted)]).toEqual([name, true]);
    const honest = 'The money is the cooperative\'s own: it is the lender of record and it pays the farmer from its own console.';
    for (const [name, re] of FORBIDDEN_4A) expect([name, re.test(honest)]).toEqual([name, false]);
  });
  it('the `disburse` regex bans the ACT and spares the STATE: a loan that was disbursed is still printable, in all three languages', () => {
    const [, DISBURSE] = FORBIDDEN_4A[0];
    for (const banned of ['Disburse ready batch', 'Disburse approved amount', 'Disbursal moves funds', 'disbursal officer', 'Co-approve — disburse now', 'disbursement batch', 'disbursing']) {
      expect([banned, DISBURSE.test(banned)]).toEqual([banned, true]);
    }
    for (const allowed of ['Disbursed', 'disbursed (30d)', en['loan.st.disbursed'], hi['loan.st.disbursed'], gu['loan.st.disbursed'], en['partner4.loan.disbursed'], en['partner4.portfolio.colDisbursed']]) {
      expect([allowed, DISBURSE.test(allowed)]).toEqual([allowed, false]);
    }
  });
  it('PC-56 PARTNER-4b · every 4b forbidden word is caught when planted once (each regex on its own canon phrase), and none of this wave\'s own honest sentences trips one', () => {
    for (const [name, re, planted] of FORBIDDEN_4B) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of PERMITTED_4B) for (const [name, re] of FORBIDDEN_4B) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    // and the sentences this wave KEEPS from the canon pass every regex of both waves
    for (const k of ['partner4.repayments.dairyCycleTruth', 'partner4.repayments.autoDeduction', 'partner4.payouts.coolingOffServerSide',
      'partner4.batch.true.total', 'partner4.batch.true.preflight', 'partner4.batch.true.allOrNothing']) {
      for (const cat of [en, hi, gu]) {
        expect([k, typeof cat[k]]).toEqual([k, 'string']);
        for (const [name, re] of [...FORBIDDEN_4A.map(([n, r]) => [n, r] as const), ...FORBIDDEN_4B.map(([n, r]) => [n, r] as const)]) {
          expect([k, name, re.test(cat[k])]).toEqual([k, name, false]);
        }
      }
    }
    // the hardest one: the whole collections regime is refused WITHOUT quoting the canon's own words back
    expect(en['partner4.refusal.codeOfConduct']).toMatch(/^The platform enforces no rules of collection at all/);
    expect(en['partner4.refusal.secondSignature']).toMatch(/user id typed into the same request/);
    expect(en['partner4.batch.whoseMoney']).toMatch(/prepared and confirmed by the organisation that serves the farmer/);
    expect(en['partner4.batch.neverYours']).toMatch(/never moves a lender’s money, and a lender never moves the organisation’s/);
    for (const k of ['partner4.refusal.codeOfConduct', 'partner4.refusal.secondSignature', 'partner4.batch.whoseMoney']) {
      expect([k, hi[k] !== en[k] && hi[k].length > 20, gu[k] !== en[k] && gu[k].length > 20]).toEqual([k, true, true]);
    }
  });
  it('PC-56 PARTNER-4c · every 4c forbidden word is caught when planted once (each regex on its own canon phrase), and none of this wave\'s own honest sentences — nor an earlier wave\'s — trips one', () => {
    for (const [name, re, planted] of FORBIDDEN_4C) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of PERMITTED_4C) for (const [name, re] of FORBIDDEN_4C) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    // the four NARROWED regexes spare the sentences this console already ships, and still catch the canon's own form
    expect(FORBIDDEN_4C.find(([n]) => n === 'available (figure)')?.[1].test(en['partner4.export.notAvailable'])).toBe(false);
    expect(FORBIDDEN_4C.find(([n]) => n === 'append-only (the ledger)')?.[1].test(en['partner4.loan.noRepayments.body'])).toBe(false);
    expect(FORBIDDEN_4C.find(([n]) => n === 'append-only (the ledger)')?.[1].test('The ledger is append-only and safe.')).toBe(true);
    expect(FORBIDDEN_4C.find(([n]) => n === 'escalation (affirmative)')?.[1].test(en['partner4.refusal.bankLimitDelegation'])).toBe(false);
    expect(FORBIDDEN_4C.find(([n]) => n === 'subvention credited')?.[1].test(en['partner4.application.aprLine'])).toBe(false);
    // and the sentences this wave KEEPS from the canon pass every regex of all three waves
    for (const k of ['partner4.kcc.zeroTruth', 'partner4.drawls.zeroTruth']) {
      for (const cat of [en, hi, gu]) {
        for (const [name, re] of [...FORBIDDEN_4A.map(([n, r]) => [n, r] as const), ...FORBIDDEN_4B.map(([n, r]) => [n, r] as const), ...FORBIDDEN_4C.map(([n, r]) => [n, r] as const)]) {
          expect([k, name, re.test(cat[k])]).toEqual([k, name, false]);
        }
      }
    }
  });
  it.each(Object.entries(CATS))('%s: no 4a, 4b or 4c claim in any partner4. or loan. value, nor in any PARTNER-4 refusal; and no "%" anywhere in the scope', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_4A.test(k)), ...PARTNER4_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(200);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_4A.map(([n, r]) => [n, r] as const), ...FORBIDDEN_4B.map(([n, r]) => [n, r] as const),
        ...FORBIDDEN_4C.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) {
        expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      }
      expect([k, c[k].includes('%')]).toEqual([k, false]);
    }
  });
  it('PC-56 PARTNER-4c · founder 4c-1 / 4c-2 / 4c-3 / 4c-5 (en, verbatim): the account that is not there, the ledger that moves no money, and the guarantee not yet earned', () => {
    expect(en['partner4.kcc.statement']).toMatch(/^There is no KCC account on this platform\. A Kisan Credit Card loan is an ordinary loan whose product kind is recorded as kcc/);
    expect(en['partner4.kcc.notSetHere']).toMatch(/None of them is set from this console either/);
    expect(en['partner4.drawls.statement']).toMatch(/^The drawl ledger is the organisation’s own record of what it advanced and recovered against this loan\./);
    expect(en['partner4.drawls.statement']).toMatch(/It is not a money movement on this platform, and it is not shown here\.$/);
    expect(en['partner4.drawls.notMoney']).toMatch(/no posting to any wallet, no key that makes a repeat safe, no second person, and no switch that could stop it/);
    expect(en['partner4.drawls.integrityOwed']).toMatch(/protected by a privilege, not by the database itself/);
    expect(en['partner4.kcc.zeroTruth']).toBe('A fresh KCC sits at zero until the season starts — no drawl, no interest, no cost.');
    for (const k of ['partner4.kcc.statement', 'partner4.drawls.statement', 'partner4.drawls.notMoney', 'partner4.drawls.integrityOwed']) {
      expect([k, typeof hi[k] === 'string' && hi[k] !== en[k] && hi[k].length > 20, typeof gu[k] === 'string' && gu[k] !== en[k] && gu[k].length > 20]).toEqual([k, true, true]);
    }
    // the canon's stale backend banner is NOWHERE in any catalogue (founder 4c-4)
    for (const cat of [en, hi, gu]) for (const [k, v] of Object.entries(cat)) expect([k, /DELTA-032|Backend pending|Design leads/i.test(v)]).toEqual([k, false]);
  });
  it('the `loan.` prefix is IN scope now, and the three sentences that OFFERED disbursal are gone from every catalogue (survey C-19)', () => {
    for (const cat of [en, hi, gu]) {
      const loanKeys = Object.keys(cat).filter((k) => k.startsWith('loan.'));
      expect(loanKeys.every((k) => SCOPE_4A.test(k))).toBe(true);
      expect(loanKeys.sort()).toEqual(['loan.st.approved', 'loan.st.disbursed', 'loan.st.draft', 'loan.st.rejected', 'loan.st.submitted', 'loan.st.under_review', 'loan.st.unknown', 'loan.st.withdrawn']);
      for (const k of ['loan.disburseSubmit', 'loan.disburseHint', 'loan.ok.disburse']) expect([k, k in cat]).toEqual([k, false]);
    }
  });
  it('founder 4a-2 / 4a-3 / 4a-4 / 4a-5 (en, verbatim): the wall, the consent nobody writes, the rating refused by name, the dates the platform does not hold', () => {
    expect(en['partner4.loan.noMaturity']).toBe('no maturity date recorded');
    expect(en['partner4.loan.noNextDue']).toBe('no next due date recorded');
    expect(en['partner4.loan.noForeclosureFee']).toBe('No charge is made for closing this loan early — nothing on this platform charges one.');
    expect(en['partner4.application.aprLine']).toBe('{apr} bps APR − {subvention} bps subsidy = {net} bps net of subsidy');
    expect(en['partner4.export.notAvailable']).toBe('Exports are not available from the partner console yet; write to the partners mailbox.');
    expect(en['partner4.application.consentGate']).toMatch(/the data goes from your view — as promised to the borrower/);
    expect(en['partner4.application.consentNone']).toMatch(/No consent has been recorded for this application yet/);
    expect(en['partner4.refusal.creditScore']).toMatch(/^No borrower is rated on this platform/);
    expect(en['partner4.loan.servicingConsent']).toMatch(/not under the application consent, which ends with the decision/);
    expect(en['partner4.portfolio.windowNote']).toMatch(/count the loans OPENED in this window/);
    for (const k of ['partner4.loan.noForeclosureFee', 'partner4.application.consentGate', 'partner4.application.consentNone', 'partner4.refusal.creditScore', 'partner4.loan.servicingConsent']) {
      expect([k, typeof hi[k] === 'string' && hi[k] !== en[k] && hi[k].length > 20, typeof gu[k] === 'string' && gu[k] !== en[k] && gu[k].length > 20]).toEqual([k, true, true]);
    }
  });
  it('no lending view or page prints a percentage sign, a rate word or a money-record anchor (M8 kills here)', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    for (const rel of ['components/partner4/LenderQueueView.tsx', 'components/partner4/LenderApplicationView.tsx', 'components/partner4/LenderPortfolioView.tsx',
      'components/partner4/LenderLoanView.tsx', 'components/partner4/LenderChain.tsx', 'components/partner4/LendingSubNav.tsx',
      'components/partner4/LenderPayoutsView.tsx', 'components/partner4/LenderRepaymentsView.tsx', 'components/partner4/LenderBatchView.tsx',
      'app/lender/queue/page.tsx', 'app/lender/queue/[id]/page.tsx', 'app/lender/portfolio/page.tsx', 'app/lender/portfolio/[id]/page.tsx',
      'app/lender/disbursements/page.tsx', 'app/lender/disbursements/[id]/page.tsx', 'app/lender/repayments/page.tsx',
      // PC-56 PARTNER-4c · the two KCC views and the two KCC pages
      'components/partner4/LenderKccView.tsx', 'components/partner4/LenderKccDrawlsView.tsx',
      'app/lender/kcc/[id]/page.tsx', 'app/lender/kcc/[id]/drawls/page.tsx']) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const [name, re] of [['%', /%/], ['toFixed', /toFixed/], ['percent', /percent/i], ['borrowerUserId', /borrowerUserId/], ['channel', /channel/i],
        ['ledgerTxn', /ledgerTxn|ledger_txn/i], ['originationFee', /originationFee|origination_fee/i], ['narrative', /narrative/i],
        // PC-56 PARTNER-4c · not one field of the drawl ledger may be named in a lending view or page
        ['balanceAfter', /balanceAfter|balance_after/i], ['entryKind', /entryKind|entry_kind/i], ['accrualBasis', /accrualBasis|accrual_basis/i],
        ['purposeCheck', /purposeCheck|purpose_check/i], ['destinationKind', /destinationKind|destination_kind/i],
        ['amountMinor (a ledger entry)', /drawlAmount|amount_minor/i]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});

// ══ PC-56 PARTNER-5a · THE BOOK IN ARREARS, AS COUNTS (founder 5a-5 … 5a-8) ═══════════════════════════════════════════════════════════════
// The words of W222 and W223 that promise a lender things this platform does not do: a share of the book, missed instalments, a review before
// a classification, a cure that keeps the last bucket empty, a nightly job, a risk role, a recovery, a death, a herd, a scheme, a family's
// help, a committee, a board's file, a record that cannot change, causes documented, a rule against a single officer — and the canon's
// bank, its regulator reference and its loan numbers. Each regex is PROVEN on its own canon phrase, and kept to the canon's AFFIRMATIVE shape
// where the bare word is the honest content of a refusal this scope prints (P4bR D-5; the FORBIDDEN_4C precedent). Applied to EVERY
// `partner5.` value AND to every key PARTNER5_REFUSALS prints (including the PARTNER-4 keys it reuses), in en, hi and gu. M5 kills here.
const SCOPE_5A = /^partner5\./;
const FORBIDDEN_5A: readonly [string, RegExp, string][] = [
  ['%', /%/, '95.4%'],
  ['of book', /of book/i, '0.16% of book'],
  ['missed inst', /missed inst/i, 'Arrears (missed inst.)'],
  ['pre-NPA', /pre-?NPA/i, '90+ DPD (pre-NPA review)'],
  ['cure machinery', /cure machinery|cure rate/i, 'the cure machinery (auto-deduction, early vet-visit-style nudges, mediation) works upstream'],
  ['vet-visit', /vet[- ]visit/i, 'early vet-visit-style nudges'],
  ['nightly', /nightly/i, 'Bucket math is server-computed nightly + live-adjusted.'],
  ['credit-risk role', /credit[- ]risk role/i, 'Risk-committee view; needs credit-risk role.'],
  ['recovered since', /recovered since|recoveries post/i, 'recoveries post to the ledger like any money'],
  ['deceased', /deceased/i, 'Borrower deceased · crop insurance lapsed'],
  ['herd loss', /herd loss/i, 'Herd loss (disease outbreak, documented)'],
  ['PMFBY', /PMFBY/i, '₹18,000 (PMFBY claim, family-assisted)'],
  ['family-assisted', /family[- ]assisted/i, 'PMFBY claim, family-assisted'],
  ['committee sign-off', /committee sign-?off/i, 'Committee sign-off (your bank) + platform conduct check'],
  ['board pack', /board pack/i, 'Export (board pack)'],
  ['immutable', /immutable/i, 'Couldn’t load write-offs — Records are immutable.'],
  // AFFIRMATIVE only: PARTNER-4 truthfully says the REPAYMENT record is append-only (it has a trigger, 0079); the canon's reassurance about
  // the ledger / the write-off records is what is banned (4c-5 / 5a-8)
  ['append-only (affirmative)', /ledger is append-?only|records are append-?only|append-?only and safe/i, 'The ledger is append-only and safe.'],
  ['both causes documented', /both causes documented|causes documented/i, '2 of 2 write-offs (FY) · both causes documented — neither is ‘refused to pay’'],
  ['never a single officer', /never a single officer/i, 'initiating needs committee workflow, never a single officer.'],
  ['LN-20xx', /LN-20\d\d/, 'LN-2025-0387 dairy loan'],
  ['Saurashtra', /Saurashtra/i, 'Saurashtra Gramin Bank'],
  ['RBI ref', /RBI ref/i, 'RBI ref ••4471'],
  // AFFIRMATIVE only: PARTNER-4's reused refusal truthfully says "There are no plan settings for your organisation to open."
  ['plan settings (affirmative)', /see plan settings/i, 'This module is switched off for this tenant/plan (feature flag). See plan settings.'],
  ['DPD', /\bDPD\b/, 'DPD Aging'],
  ['current bucket', /\bcurrent\b/i, 'current 1,110 ₹6,52,66,000 ₹0 95.4%'],
  ['the cure promise', /stays empty|works upstream/i, 'works upstream so the bottom bucket stays empty'],
  ['closes your books', /closes your books|recovery stays open/i, 'A write-off closes your books, not the borrower’s story — recovery stays open, humane, and logged.'],
  ['gate exists', /the gate exists/i, 'A clean book — the gate exists for the years that are not like this one.'],
  ['CASE-0', /CASE-0\d/, 'CASE-0041'],
  ['rainfall', /rainfall/i, 'June rainfall 61% of normal'],
];
/** The honest sentences 5a must NOT ban, because each is the content of a refusal or a page this scope prints. */
const PERMITTED_5A = [
  'No share of the book is printed for any row.',
  'No figure for instalments that were missed is shown',
  'No job works these rows out overnight or adjusts them afterwards.',
  'There are no plan settings for your organisation to open. Nothing on this platform lets a partner switch its own modules on.',
  'No record of a write-off exists to protect. The loan’s own row is an ordinary one, and nothing here claims it cannot be changed.',
  'No document is prepared for your board from this console.',
  'The record is append-only: a repayment is never edited or removed.',
];
/** The four sentences founder 5a-6 / 5a-7 pinned, VERBATIM. */
const PINNED_5A: Readonly<Record<string, string>> = {
  'partner5.aging.statement': 'No loan on this platform has a recorded due date yet, and nothing marks a loan overdue; every arrears row is therefore zero, and the count of loans with no due date says why.',
  'partner5.aging.restructuredNote': 'Loans whose status is restructured sit outside these buckets and outside the servicing total; the count of such loans is shown beside the total.',
  'partner5.writeoffs.statement': 'A write-off on this platform is recorded by the organisation that serves the farmer and keeps no cause, date, committee or recovery; a written-off loan cannot be repaid here yet. Shown are the loans opened in this window that are now written off, with the outstanding as recorded.',
  'partner5.writeoffs.lockdownNote': 'No new write-off can be recorded on the platform until it keeps a record of who decided it, when and why, with a second person.',
};

describe('PC-56 PARTNER-5a · claims guard (the book in arrears, as counts)', () => {
  it('every 5a forbidden word is caught when planted once (each regex proven on its own canon phrase); none of this scope\'s honest sentences trips one', () => {
    for (const [name, re, planted] of FORBIDDEN_5A) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of PERMITTED_5A) for (const [name, re] of FORBIDDEN_5A) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    // the two NARROWED regexes spare the refusals this scope prints, and still catch the canon's own form
    const re = (n: string) => (FORBIDDEN_5A.find(([x]) => x === n) as [string, RegExp, string])[1];
    expect(re('plan settings (affirmative)').test(en['partner4.refusal.planSettings'])).toBe(false);
    expect(re('plan settings (affirmative)').test('See plan settings.')).toBe(true);
    expect(re('append-only (affirmative)').test(en['partner4.loan.noRepayments.body'] ?? '')).toBe(false);
    expect(re('append-only (affirmative)').test('Records are append-only.')).toBe(true);
    // and the four pinned sentences pass every one of them
    for (const [k, v] of Object.entries(PINNED_5A)) for (const [name, r] of FORBIDDEN_5A) expect([k, name, r.test(v)]).toEqual([k, name, false]);
  });
  it.each(Object.entries(CATS))('%s: no 5a claim in any partner5. value, nor in any key PARTNER5_REFUSALS prints; and no "%" anywhere in the scope', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = [...new Set([...Object.keys(c).filter((k) => SCOPE_5A.test(k)), ...PARTNER5_REFUSALS.map((r) => r.key)])];
    expect(keys.length).toBeGreaterThan(70);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_5A.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      expect([k, c[k].includes('%')]).toEqual([k, false]);
    }
  });
  it('founder 5a-6 / 5a-7 (en, VERBATIM): the two statements and the two notes; present and distinct in hi and gu', () => {
    for (const [k, v] of Object.entries(PINNED_5A)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 40 && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k].length > 40 && gu[k] !== en[k]]).toEqual([k, true, true]);
      expect([k, hi[k] !== gu[k]]).toEqual([k, true]);
    }
    expect(new Set(Object.keys(PINNED_5A).map((k) => en[k])).size).toBe(4);
    // the sum-check prints BOTH figures (founder 5a-6)
    expect(en['partner5.aging.sumCheck']).toMatch(/^The six rows add up to the servicing book’s outstanding: \{sum\} = \{total\}$/);
  });
  it('no arrears view or page names a percentage, a float formatter, a borrower, a channel, a reason or a cause in its CODE (M5 has a twin here)', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    const files = ['components/partner5/LenderAgingView.tsx', 'components/partner5/LenderWriteoffsView.tsx', 'components/partner5/LenderChain5.tsx',
      'app/lender/portfolio/aging/page.tsx', 'app/lender/portfolio/writeoffs/page.tsx',
      // PC-56 PARTNER-5b · NAMED UPDATE: the three honest collections views and pages join the scan (and the folder listing below)
      'components/partner5/LenderCollectionsView.tsx', 'components/partner5/LenderCollectionsCaseView.tsx', 'components/partner5/LenderRestructureView.tsx',
      'app/lender/collections/page.tsx', 'app/lender/collections/[id]/page.tsx', 'app/lender/collections/[id]/restructure/page.tsx'];
    expect(fs2.readdirSync(path2.join(SRC, 'components', 'partner5')).filter((f) => f.endsWith('.tsx')).sort())
      // PC-56 PARTNER-5c · NAMED UPDATE: + LenderReportsView.tsx (W214) — scanned by its own 5c code scan below (its i18n key names the
      // production-zero REASON, so this scan's `reason` ban is not the right instrument for it)
      .toEqual(['LenderAgingView.tsx', 'LenderChain5.tsx', 'LenderCollectionsCaseView.tsx', 'LenderCollectionsView.tsx', 'LenderReportsView.tsx', 'LenderRestructureView.tsx', 'LenderWriteoffsView.tsx']);
    for (const rel of files) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, code.length > 300]).toEqual([rel, true]);
      for (const [name, re] of [['%', /%/], ['toFixed', /toFixed/], ['percent', /percent/i], ['borrowerUserId', /borrowerUserId|borrower_user_id/],
        ['channel', /channel/i], ['reason', /reason/i], ['cause', /cause/i], ['writtenOffAt', /writtenOffAt|written_off_at|writtenOffBy/i]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});

// ══ PC-56 PARTNER-5b · COLLECTIONS THE PLATFORM DOES NOT DO (founder 5b-1 … 5b-5; doors Q4 + Q5) ════════════════════════════════════════════
// The words of W219, W220 and W221 that would put a lender inside a cooperative's arrears: a rate of recovery, named cases, a next case, a
// promise tracked, a last contact, a contact log, a transcript, a field officer, a meeting fixed, a dairy inference, a name one click away,
// a phone, a case or loan number, a committee, an asset classification under a regulator's rules, a weather clause, a rainfall figure, three
// humans, an acceptance by OTP and voice, a think-it-over window, a comparison document, a collections role, "platform-enforced", a record
// that cannot change, plan settings, and the canon's acceptance order. Each regex is PROVEN on its own canon phrase and narrowed to the
// AFFIRMATIVE shape where a refusal this scope prints carries the bare word (P4bR D-5). Applied to every `partner5.collections.` /
// `partner5.case.` / `partner5.restructure.` / 5b chain value AND to every key PARTNER5_REFUSALS prints on a 5b surface (including the
// PARTNER-4 keys it reuses), in en, hi and gu; and to the CODE of the three pages and their three views.
const SCOPE_5B = /^partner5\.(collections\.|case\.|restructure\.|subnav\.collections$|chain\.(collectionsForm|collectionsAct|caseAct|restructureAct)\.)/;
const SURFACES_5B = ['collections', 'collections_case', 'restructure', 'collections_form', 'collections_act', 'case_act', 'restructure_act'] as const;
const FORBIDDEN_5B: readonly [string, RegExp, string][] = [
  ['%', /%/, 'Cure rate (90d) 83%'],
  ['cure rate', /cure rate/i, 'Cure rate (90d) 83% — most arrears cure within one season'],
  ['named case', /named cases?\b/i, '3 highlighted of 14 named cases (≥16 DPD)'],
  ['take next', /take next/i, 'Take next case'],
  // stricter than the brief's affirmative form: no value of this scope says the phrase at all (the honest sentences say "promise to repay")
  ['promise-to-pay', /promise[- ]to[- ]pay/i, 'promise-to-pay 21 Jul (post-harvest) · promise tracked'],
  ['promise tracked', /promises? tracked|promise(-to-pay)? tracking/i, 'promise-to-pay tracking'],
  ['last contact', /last contact/i, 'DPD ▾ · Case · Arrears · Last contact · Stage'],
  ['contact log (affirmative)', /contact logs? (is|are|\()|contact logs and promises|every (borrower )?contact (is )?logged|contacts? logged with/i, 'Contact log (every touch, code-of-conduct)'],
  ['transcript', /transcript/i, 'no pressure language (transcript scored ✓)'],
  ['field officer', /field officer/i, 'Present: borrower, FPO coordinator (his own federation), your field officer.'],
  ['mediation fixed', /mediation (scheduled|thu|agreed)/i, 'FPO mediation Thu 16 Jul'],
  ['vet visit', /vet[- ]visit/i, 'milk volume dip — vet visit suggested'],
  ['milk volume', /milk volumes?/i, 'the system noticed her milk volumes dipped BEFORE the missed instalment'],
  ['fix the cow', /fix the cow/i, 'Fix the cow, fix the loan.'],
  ['name visible', /name (visible|in case view)/i, 'name in case view — logged'],
  ['+91', /\+91/, '+91 95••• ••217'],
  ['CASE-n', /CASE-\d/, 'CASE-0041'],
  ['LN-20xx', /LN-20\d\d/, 'LN-2026-0041'],
  ['committee sign-off', /committee sign-?off/i, 'Asset seizure before mediation + 90 DPD + committee sign-off'],
  ['NPA per / RBI norms', /NPA per|RBI norms|\bNPA\b/i, 'NPA per your RBI norms — the platform never helps hide it'],
  ['monsoon clause', /monsoon clause/i, 'monsoon clause qualifies'],
  ['rainfall', /rainfall/i, 'June rainfall 61% of normal, district notification attached'],
  ['credit record notes', /credit record notes/i, 'credit record notes the weather cause'],
  ['weather, not will', /weather, not will/i, 'his revenue gap is weather, not will'],
  ['three humans', /three humans/i, 'three humans, always'],
  ['OTP + voice', /OTP \+ voice|OTP and voice/i, 'Acceptance by OTP + voice'],
  ['your checker', /your checker/i, 'your checker countersigns'],
  ['think-it-over', /think-it-over/i, '24h think-it-over window'],
  ['comparison PDF', /comparison PDF/i, 'borrower gets the comparison PDF forever'],
  ['collections role / lead', /collections (role|lead)/i, 'Named cases need collections role'],
  ['platform-enforced', /platform-enforced/i, 'What is off the table (platform-enforced)'],
  // the WORD, not only its affirmative form: no value printed on a 5b surface uses it at all (the refusal says "kept safe" instead)
  ['append-only', /\bappend-?only\b/i, 'Contact log is append-only and safe.'],
  ['plan settings (affirmative)', /see plan settings/i, 'This module is switched off for this tenant/plan (feature flag). See plan settings.'],
  ['after borrower accepts', /after (the )?borrower accepts?/i, 'Take to mediation (checker after borrower accepts)'],
  ['his choice, documented', /his choice,? documented/i, 'His choice, documented.'],
  ['resets the tone', /resets the tone|escalates one step/i, 'a kept promise resets the tone; a missed one escalates one step, never three'],
  ['full contact history', /full contact history/i, 'Cured cases archive with their full contact history.'],
  ['every open is logged', /every open is logged|this access is logged/i, 'every open is logged — including yours, just now.'],
  ['versioned server-side', /versioned server-side/i, 'The draft is versioned server-side.'],
  ['automatically past', /automatically past/i, 'Cases enter this queue automatically past the DPD threshold.'],
  ['gets it in Gujarati', /gets it in Gujarati/i, 'Record promise (he gets it in Gujarati, in writing)'],
  ['stale banner', /DELTA-033|Backend pending|Design leads/i, 'Backend pending (DELTA-033): loan_restructures terms table'],
  ['all loans current', /all loans current|quiet work/i, 'All loans current — the auto-deduction channels are doing their quiet work.'],
  ['DPD', /\bDPD\b/, '16–30 DPD (named cases)'],
];
/** The honest sentences 5b must NOT ban: the reused 4b-5 refusals and this wave's own refusals that say no to the same words. */
const PERMITTED_5B = [
  'Nothing is logged about who was contacted, because there is no contact tool here and no record of one.',
  'No record of contact exists to be kept safe. The word for a record the database refuses to change is not used about anything on this page.',
  'No promise to repay is taken, kept or sent here, and this page has no field to type one into.',
  'A restructure can carry a word that says mediation, and nothing anywhere makes it a step that must happen before another.',
  'There are no plan settings for your organisation to open. Nothing on this platform lets a partner switch its own modules on.',
  'No borrower who is behind on a loan is listed here — not by name, not by reference, not by row.',
];
/** The three statements and the absence line founder 5b-2 / 5b-3 / 5b-4 pinned, VERBATIM. */
const PINNED_5B: Readonly<Record<string, string>> = {
  'partner5.collections.statement': 'A lender does not collect on this platform. The organisation that serves the farmer is the lender of record and services its own book. No borrower in arrears is named, contacted or ranked here.',
  'partner5.case.statement': "There is no collections case on this platform. Nothing about a borrower is shown or looked up here — no name, phone, reason, contact, promise or meeting. This loan's own facts are on its loan page.",
  'partner5.restructure.statement': "A restructure is proposed and decided by the organisation that serves the farmer, not from this console. The lender is not a party to it on this platform, and nothing of any proposal is shown here. A restructure cannot yet be accepted or activated on the platform. The loan's status appears on its own page.",
  'partner5.collections.noSellingBlock': "Nothing on this platform restricts a borrower's selling because of a loan.",
};
const keys5B = (c: Record<string, string>) => [...new Set([...Object.keys(c).filter((k) => SCOPE_5B.test(k)),
  ...PARTNER5_REFUSALS.filter((r) => r.surfaces.some((x) => (SURFACES_5B as readonly string[]).includes(x))).map((r) => r.key)])];

describe('PC-56 PARTNER-5b · claims guard (collections the platform does not do)', () => {
  it('every 5b forbidden word is caught when planted once (each regex proven on its own canon phrase); none of this scope\'s honest sentences trips one', () => {
    for (const [name, re, planted] of FORBIDDEN_5B) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of PERMITTED_5B) for (const [name, re] of FORBIDDEN_5B) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    for (const [k, v] of Object.entries(PINNED_5B)) for (const [name, r] of [...FORBIDDEN_5B, ...FORBIDDEN_5A]) expect([k, name, r.test(v)]).toEqual([k, name, false]);
    // the narrowed contact-log regex spares PARTNER-4b's reused refusal and still catches the canon's three forms
    const re = (n: string) => (FORBIDDEN_5B.find(([x]) => x === n) as [string, RegExp, string])[1];
    expect(re('contact log (affirmative)').test(en['partner4.refusal.contactLog'])).toBe(false);
    for (const canon of ['every contact logged', 'every borrower contact is logged with time + channel + summary', 'Contact logs and promises are server-side.']) {
      expect([canon, re('contact log (affirmative)').test(canon)]).toEqual([canon, true]);
    }
  });
  it.each(Object.entries(CATS))('%s: no 5b claim in any 5b value, nor in any key PARTNER5_REFUSALS prints on a 5b surface; no "%" anywhere', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = keys5B(c);
    expect(keys.length).toBeGreaterThan(80);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_5B.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      expect([k, c[k].includes('%')]).toEqual([k, false]);
    }
    // every key of the scope is in all three catalogues
    for (const k of Object.keys(en).filter((x) => SCOPE_5B.test(x))) expect([k, typeof c[k] === 'string' && c[k].length > 0]).toEqual([k, true]);
  });
  it('founder 5b-2 / 5b-3 / 5b-4 (en, VERBATIM): the three statements and the absence line; present and distinct in hi and gu', () => {
    for (const [k, v] of Object.entries(PINNED_5B)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 30 && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k].length > 30 && gu[k] !== en[k]]).toEqual([k, true, true]);
      expect([k, hi[k] !== gu[k]]).toEqual([k, true]);
    }
    // the absence line is an ABSENCE, never a rule the platform keeps
    expect(en['partner5.collections.noSellingBlock']).toMatch(/^Nothing on this platform/);
    expect(/enforc|guarantee|never blocked|protect/i.test(en['partner5.collections.noSellingBlock'])).toBe(false);
    // the restructure chain sentence never repeats the canon's acceptance order
    for (const s of ['confirm', 'success', 'failure']) expect(/accept/i.test(en[`partner5.chain.restructureAct.${s}.body`])).toBe(false);
  });
  it('the three pages and their three views name no read, no input, no figure, no borrower and no proposal field in their CODE', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    for (const rel of ['components/partner5/LenderCollectionsView.tsx', 'components/partner5/LenderCollectionsCaseView.tsx', 'components/partner5/LenderRestructureView.tsx',
      'app/lender/collections/page.tsx', 'app/lender/collections/[id]/page.tsx', 'app/lender/collections/[id]/restructure/page.tsx']) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, code.length > 300]).toEqual([rel, true]);
      for (const [name, re] of [['partnerClient', /partnerClient|api-client|@krishalaya\/sdk-js/], ['mailbox', /mailbox/i], ['<input', /<input|<select|<textarea|<form|<label|htmlFor/],
        ['formatMoney', /formatMoney|formatCount|toFixed|%/], ['borrower field', /borrowerUserId|borrower_user_id|borrowerName|phone/i],
        ['proposal field', /instalment|tenor|rateApr|holiday|caseRef|case_ref|proposedBy|checkerId|mediationAt/i], ['figure', /\{\s*\d|\bcount\b/]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});

// ══ PC-56 PARTNER-5c · THE PROMISE THE PLATFORM SETS (founder 5c-1 / 5c-3; doors Q7 + Q6) ════════════════════════════════════════════════════
// The words of W214 that sell a lender things this platform does not keep: a share of decisions on time, a satisfaction score out of five, a
// conduct count and a clean quarter, "your contract", a shared scoreboard and a provider-health console, monthly and report packs with
// hashes, a portfolio-at-risk figure, a consent registry, a partner desk with a response time, a partnership manager and a quarterly review,
// a same-day answer, a disbursal promise, surge weeks, a documents pause honoured, records that cannot change, a pack on the 1st, a
// compliance role, plan settings. Each regex is PROVEN on its own canon phrase and narrowed to the canon's AFFIRMATIVE shape only where a
// reused refusal this scope prints carries the bare words (PARTNER-2b's "No report pack is generated", PARTNER-4's "There are no plan
// settings"). Applied to every `partner5.sla.` / SLA chain value and `nav.slaReports` AND to every key PARTNER5_REFUSALS prints on a 5c
// surface, in en, hi and gu. And founder 5c-3: no `%` in ANY `partner1.dash.` value (the guard is how a percentage stays gone — M3 kills here).
const SCOPE_5C = /^(partner5\.(sla\.|chain\.(slaExport|slaAct)\.)|nav\.slaReports$)/;
const SURFACES_5C = ['sla', 'sla_export', 'sla_act'] as const;
const FORBIDDEN_5C: readonly [string, RegExp, string][] = [
  ['%', /%/, 'Decision SLA (30d) 94%'],
  ['n / 5', /\d+(\.\d+)?\s*\/\s*5\b/, 'Borrower CSAT 4.6 / 5'],
  ['CSAT', /CSAT/i, 'Borrower CSAT 4.6 / 5 post-disbursal survey, in Gujarati'],
  ['conduct flags', /conduct flags?/i, 'Conduct flags 0'],
  ['clean quarter', /clean quarter/i, 'collections code — clean quarter'],
  ['your contract', /your contract/i, 'Your contract with the platform, measured (financial_partners.sla)'],
  ['same scoreboard', /same scoreboard|one scoreboard/i, 'Both sides see the same scoreboard.'],
  ['provider-health', /provider[- ]health/i, 'The same SLA numbers appear on the platform’s provider-health console'],
  ['monthly pack', /monthly (performance |report )?packs?/i, 'Download monthly pack (signed)'],
  // AFFIRMATIVE: PARTNER-2b's reused refusal truthfully says "No report pack is generated on the platform."
  ['report pack (affirmative)', /report packs? (yet|\(|will|appear)|report packs \(signed/i, 'Monthly report packs (signed exports)'],
  ['sha256:', /sha256:/i, 'sha256:<hash>'],
  ['PAR', /\bPAR\b/, 'Originations · repayments · PAR · SLA · consent registry'],
  ['consent registry', /consent registry/i, 'Originations · repayments · PAR · SLA · consent registry'],
  ['partner desk', /partner desk/i, 'Integration issues → partner desk, 4h response (P1)'],
  ['partnership manager', /partnership manager/i, 'Commercial terms → your partnership manager'],
  ['quarterly review', /quarterly review/i, '(quarterly review 04 Aug)'],
  ['4h response', /\d+\s*h(ours?)? response/i, 'partner desk, 4h response (P1)'],
  ['same-day', /same[- ]day/i, 'Data/consent questions → platform compliance, same-day'],
  ['disbursal promise', /disbursal SLA|disbursal \d+\s*h/i, 'Disbursal SLA 99% · disbursal 48h post-cooling-off'],
  ['volume-surge', /volume[- ]surge/i, '4 breaches — all volume-surge weeks'],
  ['docs_pending pause', /docs_pending|pause honoured/i, 'docs_pending pause honoured on every one'],
  ['immutable', /immutable/i, 'Generated packs are immutable and re-downloadable.'],
  ['re-downloadable', /re-?downloadable/i, 'Generated packs are immutable and re-downloadable.'],
  ['generates on the 1st', /generates on the 1st|on the 1st/i, 'Your first monthly pack generates on the 1st'],
  ['compliance role', /compliance role/i, 'Monthly packs need your bank’s admin or compliance role.'],
  ['same manifest', /same manifest|manifest format/i, 'same manifest format as the auditor console'],
  ['claim-free', /claim-free/i, 'claim-free data handling'],
  ['plan settings (affirmative)', /see plan settings/i, 'This module is switched off for this tenant/plan (feature flag). See plan settings.'],
  ['breaches', /\bbreach(es)?\b/i, '4 breaches — all volume-surge weeks'],
];
/** The honest sentences 5c must NOT ban: the reused refusals that say no to the same things. */
const PERMITTED_5C = [
  'No report pack is generated on the platform.',
  'There are no plan settings for your organisation to open. Nothing on this platform lets a partner switch its own modules on.',
  'No share of decisions is printed.',
  'No borrower satisfaction score exists: no survey is sent to a borrower after a loan and no score is kept.',
];
/** The three sentences and the zero reason founder 5c-1 pinned, VERBATIM. */
const PINNED_5C: Readonly<Record<string, string>> = {
  'partner5.sla.promise': 'The platform has published a decision promise of {hours} hours for your organisation.',
  'partner5.sla.promiseNone': 'The platform has not published a decision promise for your organisation.',
  'partner5.sla.promiseSetBy': 'The platform sets this promise; it is not changed from this console.',
  'partner5.sla.zeroReason': 'These figures count only applications whose applicants consented to show them to you. No consent is recorded on the platform yet, so in production every figure here is zero.',
};
const keys5C = (c: Record<string, string>) => [...new Set([...Object.keys(c).filter((k) => SCOPE_5C.test(k)),
  ...PARTNER5_REFUSALS.filter((r) => r.surfaces.some((x) => (SURFACES_5C as readonly string[]).includes(x))).map((r) => r.key)])];

describe('PC-56 PARTNER-5c · claims guard (the promise the platform sets)', () => {
  it('every 5c forbidden word is caught when planted once (each regex proven on its own canon phrase); none of the honest sentences trips one', () => {
    for (const [name, re, planted] of FORBIDDEN_5C) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of PERMITTED_5C) for (const [name, re] of FORBIDDEN_5C) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    for (const [k, v] of Object.entries(PINNED_5C)) for (const [name, r] of [...FORBIDDEN_5C, ...FORBIDDEN_5A]) expect([k, name, r.test(v)]).toEqual([k, name, false]);
    // the narrowed regexes spare the reused refusals verbatim and still catch the canon's own forms
    const re = (n: string) => (FORBIDDEN_5C.find(([x]) => x === n) as [string, RegExp, string])[1];
    expect(re('report pack (affirmative)').test(en['partner2.refusal.reportPack'])).toBe(false);
    for (const canon of ['No report packs yet', 'Monthly report packs (signed exports)']) expect([canon, re('report pack (affirmative)').test(canon)]).toEqual([canon, true]);
    expect(re('plan settings (affirmative)').test(en['partner4.refusal.planSettings'])).toBe(false);
  });
  it.each(Object.entries(CATS))('%s: no 5c claim in any 5c value, nor in any key PARTNER5_REFUSALS prints on a 5c surface; no "%" anywhere', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = keys5C(c);
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_5C.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
      expect([k, c[k].includes('%')]).toEqual([k, false]);
    }
    for (const k of Object.keys(en).filter((x) => SCOPE_5C.test(x))) expect([k, typeof c[k] === 'string' && c[k].length > 0]).toEqual([k, true]);
  });
  it('founder 5c-1 (en, VERBATIM): the promise both ways, who sets it, and the production-zero reason; present and distinct in hi and gu', () => {
    for (const [k, v] of Object.entries(PINNED_5C)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 30 && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k].length > 30 && gu[k] !== en[k]]).toEqual([k, true, true]);
      expect([k, hi[k] !== gu[k]]).toEqual([k, true]);
    }
    expect(en['partner5.sla.promise']).toContain('{hours}');
    for (const cat of [hi, gu]) expect((cat as Record<string, string>)['partner5.sla.promise']).toContain('{hours}');
    // a breach is only a COUNT labelled "after the promise", never a cause; the within/after lines are "N of M", never a share
    expect(en['partner5.sla.after']).toBe('Decided after the promise: {late} of {n}');
    expect(en['partner5.sla.within']).toBe('Decided within the promise: {w} of {n}');
    // no English 5c value ever says "contract", nor offers a percentile, a rate, a ratio or a share as a figure
    for (const k of Object.keys(en).filter((x) => SCOPE_5C.test(x))) expect([k, /contract|percent|\brate\b|\bratio\b/i.test(en[k])]).toEqual([k, false]);
  });
  it.each(Object.entries(CATS))('founder 5c-3 · %s: no "%" in ANY partner1.dash. value; the retired rate and on-time keys are gone; the counts line is in place', (_l, cat) => {
    const c = cat as Record<string, string>;
    const dash = Object.keys(c).filter((k) => k.startsWith('partner1.dash.'));
    expect(dash.length).toBeGreaterThan(30);
    for (const k of dash) expect([k, c[k].includes('%')]).toEqual([k, false]);
    for (const k of ['partner1.dash.rate', 'partner1.dash.rateValue', 'partner1.dash.rateNone', 'partner1.dash.rateHint', 'partner1.dash.onTime', 'partner1.dash.onTimeNone', 'partner1.dash.onTimeHint']) {
      expect([k, k in c]).toEqual([k, false]);
    }
    expect(c['partner1.dash.approvedOf']).toMatch(/\{approved\}/); expect(c['partner1.dash.approvedOf']).toMatch(/\{decided\}/);
  });
  it('C-8 corrected: the punctuality refusal is true of the console as shipped — no figure anywhere, the due date is the India-time day it was paid', () => {
    expect(en['partner4.refusal.onTime']).toBe('No punctuality figure is shown anywhere in this console. With no instalment plan on the platform, a repayment’s recorded due date is the India-time day it was paid, so every repayment would count as punctual and the figure would mean nothing.');
    expect(en['partner4.refusal.onTime']).not.toMatch(/the moment it was paid/);
    for (const cat of [hi, gu]) expect((cat as Record<string, string>)['partner4.refusal.onTime']).not.toBe(en['partner4.refusal.onTime']);
  });
  it('the W214 page and view name no percentage, no float formatter, no division and no latency arithmetic in their CODE; the dashboard view no longer formats a share', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    for (const rel of ['components/partner5/LenderReportsView.tsx', 'app/lender/reports/page.tsx', 'components/partner1/DashboardView.tsx']) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, code.length > 300]).toEqual([rel, true]);
      for (const [name, re] of [['%', /%/], ['toFixed', /toFixed/], ['percent', /percent/i], ['bpsPercentText', /bpsPercentText|approvalRateBps|shareBps|onTime\./],
        ['division of figures', /\b(withinPromise|decided|within|medianSec|p90Sec)\s*\//], ['seconds arithmetic', /\/\s*3600|\/\s*60\b|\*\s*100\b/], ['Math', /Math\./]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});

// ══ PC-56 PARTNER-6a · WHERE A CLAIM IS NOT PAID (founder 6a-1 / 6a-2; brief E6) ═══════════════════════════════════════════════════════════════
// The words of W260 / W261 / W2901–W2903 that tell an insurer a claim is paid: a percentage, a rupee sign, "ready to pay", "paid FY / today",
// a daily run at a time of day, a payout id, a zero-sum reconciliation, a verified account, a second approver over a threshold, a hash-sealed
// file, a watermark, a seven-year promise, reinsurance and cedant documentation, a pre-approved offer, a vet desk, an ear-tag, money that lands
// tonight, a village that can verify, a finance role, plan settings. Each regex is PROVEN on its own canon phrase and kept in the canon's
// AFFIRMATIVE shape where an honest refusal needs the bare word ("nothing to reconcile", "There are no plan settings"). Applied to every
// `partner6.` value AND to every key PARTNER6_REFUSALS prints on a 6a surface (the reused PARTNER-3 / PARTNER-4 keys included), in en, hi and
// gu. Stricter than the brief: the word "run" is banned outright from every `partner6.` value (no honest sentence on these pages needs it).
const SCOPE_6A = /^partner6\./;
const FORBIDDEN_6A: readonly [string, RegExp, string][] = [
  ['%', /%/, '94% of surveyed claims pay'],   // W253's line (3a) — W260 / W261 print none; the brief bans it on this scope too
  ['₹', /₹/, 'Ready to pay ₹1,58,000'],
  ['ready to pay', /ready to pay/i, 'Ready to pay ₹1,58,000 · 2 claims approved this morning'],
  ['paid FY / today', /paid (FY|today)/i, 'Paid FY ₹41,80,000 · 64 claims · median approve → paid 5h'],
  ["today's run", /today[’']?s run/i, 'Release today’s run (2 claims, checker)'],
  ['16:00', /\b16:00\b/, 'Run today 16:00'],
  ['payout_id / po-', /payout_id|\bpo-/i, 'payout_id po-…7741 → ledger txn'],
  ['zero-sum', /zero-sum/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows'],
  ['reconcile (affirmative)', /(?<!nothing to |no need to |never )\breconcil(e[sd]?|iation)\b/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows'],
  ['verified a/c', /verified a\/c|a\/c ••/i, 'verified a/c ••4482'],
  ['2nd approver / ≥₹1L', /2nd approver|≥ ?₹ ?1L/i, '2nd approver ✓ (≥₹1L)'],
  ['hash-sealed / sha256', /hash-sealed|sha256/i, 'Claim file (complete, hash-sealed)'],
  ['watermark', /watermark/i, 'Finance + claims role; the claim file export is watermarked.'],
  ['7 years', /\b7 years\b/i, 'Paid settlements keep their full chain (7 years).'],
  ['reinsurance / cedant', /reinsurance|cedant/i, 'the hash-sealed file IS the cedant documentation'],
  ['pre-approved', /pre-approved/i, 'dairy loan pre-approved offer, HER choice, zero pressure'],
  ['vet desk', /vet desk/i, 'the vet desk follows up next week about a replacement animal'],
  ['ear-tag', /ear-tag/i, 'ear-tag ••2764 verified'],
  ['money lands / tonight / in account', /money[- ](lands|tonight|in[- ]account)/i, "The distance from 'approved' to money-in-account is measured in hours"],
  ['village can verify', /village can verify/i, 'a village can verify its own insurance money'],
  ['finance role', /finance (\+ claims )?role/i, 'Finance role at your insurer + checker'],
  ['plan settings (affirmative)', /see plan settings/i, 'Claim Settlements disabled … See plan settings.'],
  ['run', /\bruns?\b/i, 'the run fires daily at 16:00 regardless'],
];
/** Honest sentences of this wave's own shape that MUST pass (the affirmative narrowing proven both ways). */
const PERMITTED_6A = [
  'There is nothing to reconcile, because no money moved.',
  'There are no plan settings for your organisation to open. Nothing on this platform lets a partner switch its own modules on.',
  'No claim is paid on this platform.',
];
/** The two statements and the paid line founder 6a-1 / 6a-2 pinned, VERBATIM. */
const PINNED_6A: Readonly<Record<string, string>> = {
  'partner6.settlements.statement': 'No claim is paid on this platform, and no money moves between your organisation and the platform. The counts below are the claims on your products that have been approved; the payment that would follow is not made here.',
  'partner6.settlement.statement': "No settlement exists for any claim on this platform. This claim's own facts are on its claim page.",
  'partner6.settlements.paidNone': 'No claim is paid on this platform.',
};
const keys6A = (c: Record<string, string>) => [...new Set([...Object.keys(c).filter((k) => SCOPE_6A.test(k)),
  ...PARTNER6_REFUSALS.filter((r) => r.surfaces.some((x) => SURFACES_6A.includes(x))).map((r) => r.key)])];

describe('PC-56 PARTNER-6a · claims guard (where a claim is not paid)', () => {
  it('every 6a forbidden word is caught when planted once (each regex proven on its own canon phrase); the honest sentences pass every one', () => {
    for (const [name, re, planted] of FORBIDDEN_6A) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of [...PERMITTED_6A, ...Object.values(PINNED_6A)]) for (const [name, re] of FORBIDDEN_6A) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
  });
  it.each(Object.entries(CATS))('%s: no 6a claim in any partner6. value, nor in any key PARTNER6_REFUSALS prints on a 6a surface (the reused keys included)', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = keys6A(c);
    expect(keys.length).toBeGreaterThan(65);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      // the bare word "run" is banned on the partner6 scope only (a reused earlier key is held to the canon's affirmative shapes)
      for (const [name, re] of [...FORBIDDEN_6A.filter(([n]) => n !== 'run' || SCOPE_6A.test(k)).map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
    }
    for (const k of Object.keys(en).filter((x) => SCOPE_6A.test(x))) expect([k, typeof c[k] === 'string' && c[k].length > 0]).toEqual([k, true]);
  });
  it('founder 6a-1 / 6a-2 (en, VERBATIM): the two statements and the paid line; present and distinct in hi and gu', () => {
    for (const [k, v] of Object.entries(PINNED_6A)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 20 && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k].length > 20 && gu[k] !== en[k]]).toEqual([k, true, true]);
      expect([k, hi[k] !== gu[k]]).toEqual([k, true]);
    }
    // the statement opens with the paid line — the one sentence every state of W260 carries
    expect(en['partner6.settlements.statement'].startsWith(en['partner6.settlements.paidNone'].replace(/\.$/, ''))).toBe(true);
    // the window wording says FILED (survey F-8): the count is never read as "approved in this window"
    expect(en['partner6.settlements.filedNote']).toMatch(/filed in this window that are approved now — not the claims approved in it/);
    for (const k of ['partner6.settlements.windowFy', 'partner6.settlements.windowRange']) expect([k, /filed/i.test(en[k])]).toEqual([k, true]);
  });
  it('the W260 / W261 views and pages print no money in their CODE: no currency formatter, no amount or approvedMinor field, no "%", no rupee sign', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    for (const rel of ['components/partner6/InsurerSettlementsView.tsx', 'components/partner6/InsurerSettlementView.tsx', 'components/partner6/InsurerChain6.tsx',
      'app/insurer/settlements/page.tsx', 'app/insurer/settlements/[id]/page.tsx', 'features/partner6/figures.ts']) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, code.length > 300]).toEqual([rel, true]);
      for (const [name, re] of [['formatMoney', /formatMoney|formatCurrency|Intl\.NumberFormat|toLocaleString|toFixed/], ['amount field', /approvedMinor|approved_minor|amountMinor|amount_minor|sumInsured|\bamount\b/i],
        ['%', /%/], ['₹', /₹/], ['claimant field', /claimant|holderName|fullName|accountLast4|account_last4|ifsc|payoutId|payout_id|surveyor/i], ['<input', /<input|<select|<textarea|<form/]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});


// ══ PC-56 PARTNER-6b · CONSENT AND THE FILINGS THE PLATFORM DOES NOT MAKE (founder 6b-1 … 6b-3; doors Q3-A / Q4-A / Q6-A; brief E4) ═══════════
// The words of W213 / W224 and their chains that sell a lender a consent registry it would hold and a regulatory service the platform does
// not provide: a percentage; "revocable", "revocation takes effect", "within 60 seconds", "logged on both sides", "time-boxed", "standing
// access" (Q4-A — none is true until P4-B6 builds an expiry and a withdrawal); "your bank holds"; a regulator's return named as a platform
// product; PSL, priority sector, weaker section, small & marginal, women borrowers; a landholding or land-record classification; "from KYC";
// signed extracts; sha256; watermarks; a compliance role; a consent channel; a phone country code; an application reference; a warehouse-
// receipt valuation; a standard consent term; plan settings. Each regex is PROVEN on its own canon phrase and kept in the canon's AFFIRMATIVE
// shape where an honest sentence needs the word (the founder's statement says "It never gives your organisation a borrower's gender or
// landholding" — legal; the reused PARTNER-2 role refusal says "No … compliance role exists" — legal). Applied to every 6b value (the two
// pages, the four chains, `nav.consents`) AND to every key PARTNER6_REFUSALS prints on a 6b surface (reused keys included), in en, hi and gu.
const SCOPE_6B = /^(partner6\.(consents\.|regulatory\.|chain\.(consentsExport|consentsAct|regulatoryForm|regulatoryAct)\.)|nav\.consents$)/;
const FORBIDDEN_6B: readonly [string, RegExp, string][] = [
  ['%', /%/, 'Small & marginal farmers 74%'],
  ['revocable', /revocab/i, 'purpose-bound, time-boxed, revocable'],
  ['revocation takes effect', /revocation takes effect/i, 'A revocation takes effect within 60 seconds and is logged on both sides.'],
  ['within 60 seconds', /within \d+ seconds/i, 'A revocation takes effect within 60 seconds'],
  ['logged on both sides', /logged on both sides/i, 'is logged on both sides'],
  ['time-boxed', /time-?boxed/i, 'purpose-bound, time-boxed, revocable'],
  // AFFIRMATIVE: the canon's own promise; no honest sentence on these pages needs the phrase at all
  ['standing access (affirmative)', /(never|no|don['’]t) (hold|have) standing access|standing access to (anyone|any)/i, 'Consents arrive with applications — you never hold standing access to anyone.'],
  ['your bank holds', /your bank holds/i, 'Every data-sharing consent your bank holds (credit_score_consents)'],
  ['RBI (compliance|PSL|DSB)', /RBI (compliance|PSL|DSB)/i, 'This registry is exportable (signed) for your RBI compliance file.'],
  ['PSL', /\bPSL\b/, 'PSL-qualifying (agri)'],
  ['priority sector', /priority[- ]sector/i, 'pre-shaped for the filings you already make: priority-sector lending (agri)'],
  ['weaker section', /weaker[- ]section/i, 'weaker-section splits'],
  ['small & marginal', /small (&|and) marginal/i, 'Small & marginal farmers 74%'],
  ['women borrower', /women[- ]borrower/i, 'Women borrowers 41%'],
  // AFFIRMATIVE: the classification by land, never the statement's "never gives … landholding"
  ['landholding / land records (affirmative)', /landholding\s*(≤|<=|of|under|below|up to|\d)|(from|verified) land records/i, 'landholding ≤ 2 ha, from verified land records'],
  ['from KYC', /from KYC/i, 'women-borrower from KYC'],
  ['signed extract', /signed extracts?|extracts?,? signed|extracts? (generate|are signed)/i, 'Extracts, signed — your compliance team files'],
  ['sha256', /sha256/i, 'sha256:7a91…44c2'],
  ['watermark', /watermark/i, 'extracts are signed and watermarked per download'],
  // AFFIRMATIVE: PARTNER-2's reused refusal truthfully says "No underwriting, finance or compliance role exists"
  ['compliance role (affirmative)', /compliance role (at|needed|required)|(bank['’]s|your) (admin or )?compliance role/i, 'Registry restricted — Compliance role at your bank'],
  ['voice (gu)', /voice \(gu\)|app tap/i, '11 Jul · voice (gu)'],
  ['+91', /\+91/, '+91 94••• ••883'],
  ['LA-20xx', /LA-20\d\d/, 'LA-2026-0711-09'],
  ['NWR', /\bNWR\b/, 'score + factors + NWR valuation'],
  ['7d standard', /\d+d standard/i, '(short-form consent — 7d standard)'],
  ['plan settings (affirmative)', /see plan settings/i, 'Consent Registry disabled … See plan settings.'],
  ['Q1 pack', /Q\d pack/i, 'Generate Q1 pack'],
  ['exportable (signed)', /exportable \(signed\)|registry \(signed\)/i, 'Export registry (signed)'],
];
/** Honest sentences that MUST pass (the affirmative narrowing proven both ways). */
const PERMITTED_6B = [
  "It never gives your organisation a borrower's gender or landholding.",
  'No underwriting, finance or compliance role exists: the four partner roles read the same facts.',
  'There are no plan settings for your organisation to open. Nothing on this platform lets a partner switch its own modules on.',
  "No borrower is grouped by the size of the land they farm: a farmer's land record belongs to another part of the platform and is never read for your organisation.",
];
/** The three sentences founder 6b-1 / 6b-3 pinned, VERBATIM. */
const PINNED_6B: Readonly<Record<string, string>> = {
  'partner6.consents.statement': "A farmer's consent to show you a loan application is given for that one application. The platform checks it every time your organisation reads the application, and your access ends when the consent expires. You never see who consented, when, how or what the consent covers.",
  'partner6.consents.noneYet': 'No consent is recorded on the platform yet: the step that asks the farmer for it does not exist.',
  'partner6.regulatory.statement': "The platform produces no regulatory extract and classifies nothing for a regulator. It never gives your organisation a borrower's gender or landholding. Your book's own figures are on Portfolio and DPD aging; your organisation files its own returns — the platform never files for you.",
};
const keys6B = (c: Record<string, string>) => [...new Set([...Object.keys(c).filter((k) => SCOPE_6B.test(k)),
  ...PARTNER6_REFUSALS.filter((r) => r.surfaces.some((x) => SURFACES_6B.includes(x))).map((r) => r.key), 'partner4.export.notAvailable'])];

describe('PC-56 PARTNER-6b · claims guard (consent and the filings the platform does not make)', () => {
  it('every 6b forbidden word is caught when planted once (each regex proven on its own canon phrase); the honest sentences pass every one', () => {
    for (const [name, re, planted] of FORBIDDEN_6B) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of [...PERMITTED_6B, ...Object.values(PINNED_6B)]) for (const [name, re] of FORBIDDEN_6B) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    const re = (n: string) => (FORBIDDEN_6B.find(([x]) => x === n) as [string, RegExp, string])[1];
    expect(re('compliance role (affirmative)').test(en['partner2.refusal.partnerRoles'])).toBe(false);
    expect(re('plan settings (affirmative)').test(en['partner4.refusal.planSettings'])).toBe(false);
    for (const canon of ['Small & marginal farmers 74% · landholding ≤ 2 ha', 'small/marginal from verified land records']) expect([canon, re('landholding / land records (affirmative)').test(canon)]).toEqual([canon, true]);
  });
  it.each(Object.entries(CATS))('%s: no 6b claim in any 6b value, nor in any key PARTNER6_REFUSALS prints on a 6b surface (the reused keys included)', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = keys6B(c);
    expect(keys.length).toBeGreaterThan(70);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_6B.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
    }
    for (const k of Object.keys(en).filter((x) => SCOPE_6B.test(x))) expect([k, typeof c[k] === 'string' && c[k].length > 0]).toEqual([k, true]);
  });
  it('founder 6b-1 / 6b-3 (en, VERBATIM): the consent statement, the truth today and the regulatory statement; present and distinct in hi and gu', () => {
    for (const [k, v] of Object.entries(PINNED_6B)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 30 && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k].length > 30 && gu[k] !== en[k]]).toEqual([k, true, true]);
      expect([k, hi[k] !== gu[k]]).toEqual([k, true]);
    }
    // founder 6b-2 (Q4-A): the strongest thing the page says about an end is "ends when the consent expires"
    expect(en['partner6.consents.statement']).toContain('your access ends when the consent expires');
    for (const k of Object.keys(en).filter((x) => SCOPE_6B.test(x) || x.startsWith('partner6.refusal.'))) expect([k, /revocab|time-?boxed|standing access|within \d+ seconds|both sides/i.test(en[k])]).toEqual([k, false]);
  });
  it('the W213 / W224 views, pages and chain carry no figure in their CODE: no number formatter, no count, no "%", no input', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    for (const rel of ['components/partner6/LenderConsentsView.tsx', 'components/partner6/LenderRegulatoryView.tsx', 'components/partner6/LenderChain6.tsx',
      'app/lender/consents/page.tsx', 'app/lender/reports/regulatory/page.tsx']) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, code.length > 300]).toEqual([rel, true]);
      for (const [name, re] of [['formatter', /Intl\.NumberFormat|toLocaleString|toFixed|formatMoney/], ['count field', /\.length|count|total|\bn\b=|\{n\}/i],
        ['%', /%/], ['₹', /₹/], ['person field', /userId|user_id|phone|fullName|full_name|gender|land_parcels|landParcel|purposeRef|purpose_ref|expiresAt|expires_at|grantedAt|granted_at/i],
        ['<input', /<input|<select|<textarea|<form/]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});


// ══ PC-56 PARTNER-6c · WHAT THE PLATFORM TELLS A PARTNER PERSON (founder 6c-1 … 6c-3; doors Q5-A / Q7-A; brief E3) ═══════════════════════════════
// The words of W270 / W271 and their chains that would give a partner person an inbox, a preference matrix and deliveries the platform never
// makes: a percentage; "critical rings / breaks through / everywhere"; "the same engine farmers get"; a digest; quiet hours (affirmative) and
// the canon's 22:00 / 07:00; a survey clock; a policyholder; a doctor; "payout completed"; a rupee; DND; push fallback; renewal requests;
// reachability; "locked"; "a farmer is waiting on this"; "defaults active"; "saved preferences still apply"; "switching is one click"; "every
// template (also) exists"; "N of M events"; plan settings (affirmative). Each regex is PROVEN on its own canon phrase (AFFIRMATIVE where an
// honest sentence needs the word: "There is no quiet-time window", "There are no plan settings"). Applied to every 6c value (the two pages, the
// language act, the three chains, `nav.notifications`) AND to every key PARTNER6_REFUSALS prints on a 6c surface (reused keys included), in en,
// hi and gu. The two founder statements are PINNED verbatim.
const SCOPE_6C = /^(partner6\.(notifications\.|notificationPrefs\.|language\.|chain\.(notificationForm|notificationAct|notificationsAct)\.)|nav\.notifications$)/;
const FORBIDDEN_6C: readonly [string, RegExp, string][] = [
  ['%', /%/, 'unread 3 · critical 1 · 98% delivered'],
  ['critical rings / breaks through / everywhere', /critical (rings|breaks? through|everywhere)|critical events will always break through/i, 'Critical rings, informational waits, promotional asks permission'],
  ['same engine farmers get', /same engine farmers( get)?/i, 'the same engine farmers get.'],
  ['digest', /digest/i, 'Daily digest — 9 informational items batched'],
  ['quiet hours (affirmative)', /quiet hours\s*(—|-|:|\d|rule|ignore)|critical ignores quiet hours|per your quiet[- ]hours/i, 'Quiet hours — 22:00 – 07:00 · informational items wait'],
  ['22:00 / 07:00', /\b22:00\b|\b07:00\b/, 'Quiet hours — 22:00 – 07:00'],
  ['assign within 48h / survey clock', /assign within 48h|survey clock/i, 'survey clock started — assign within 48h.'],
  ['policy holder', /policy ?holder/i, 'CLM-… · policy holder <name>'],
  ['Dr.', /\bDr\./, 'Dr. <name> filed the joint report for all 3 holdings'],
  ['payout completed', /payout completed/i, 'Payout completed — ₹… to <name>'],
  ['₹', /₹/, 'Payout completed — ₹1,10,000'],
  ['DND', /\bDND\b/, 'Your DND-registered number rejected the parametric-window reminder'],
  ['push fallback / fallback, never silence', /push fallback|fallback,? never silence/i, 'SMS failed → push fallback sent · Fallback, never silence.'],
  ['renewal requests', /renewal requests/i, 'Renewal requests go out from the policies screen.'],
  ['reachability', /reachability/i, "Admins can view (not edit) team members' critical-tier reachability for on-call planning."],
  ['locked', /\blocked\b/i, 'Security events are locked on every channel.'],
  ['a farmer is waiting on this', /a farmer is waiting on this/i, 'Cannot be switched off — a farmer is waiting on this.'],
  ['defaults active', /defaults active/i, "Defaults active — You haven't customised anything yet"],
  ['saved preferences still apply', /saved preferences still apply/i, 'Your saved preferences still apply to deliveries — only this view failed.'],
  ['switching is one click', /switching is one click|one click, not a support ticket/i, 'switching is one click, not a support ticket.'],
  ['every template (also) exists', /every template (also )?exists/i, 'every template also exists in हिन्दी and ગુજરાતી'],
  ['N of M events', /\b\d+ of \d+ events\b/i, '8 of 31 events shown — grouped by what they interrupt'],
  ['plan settings (affirmative)', /see plan settings/i, 'Notifications disabled … See plan settings.'],
];
/** Honest sentences of this wave's shape that MUST pass (the affirmative narrowing proven both ways). */
const PERMITTED_6C = [
  'There is no quiet-time window to set: nothing is sent to you that could be held back.',
  'There are no plan settings for your organisation to open. Nothing on this platform lets a partner switch its own modules on.',
  'Not every line of console text exists in Hindi and Gujarati yet: older text with no translation is shown in English.',
];
/** The two statements founder 6c-1 / 6c-2 pinned, VERBATIM. */
const PINNED_6C: Readonly<Record<string, string>> = {
  'partner6.notifications.statement': "The platform sends the people of your organisation two kinds of message, by SMS: a sign-in code when you sign in, and an invitation when a colleague adds you to the team. Nothing else is sent to you in this console. Your organisation's machine notifications are its webhooks, set up by the platform, and their delivery log is on the Webhooks page.",
  'partner6.notificationPrefs.statement': 'The sign-in code and the team invitation cannot be switched off: you need them to use the console. No other message is sent to you here, so there is nothing else to set.',
};
const keys6C = (c: Record<string, string>) => [...new Set([...Object.keys(c).filter((k) => SCOPE_6C.test(k)),
  ...PARTNER6_REFUSALS.filter((r) => r.surfaces.some((x) => SURFACES_6C.includes(x))).map((r) => r.key)])];

describe('PC-56 PARTNER-6c · claims guard (what the platform tells a partner person)', () => {
  it('every 6c forbidden word is caught when planted once (each regex proven on its own canon phrase); the honest sentences pass every one', () => {
    for (const [name, re, planted] of FORBIDDEN_6C) expect([name, re.test(planted)]).toEqual([name, true]);
    for (const ok of [...PERMITTED_6C, ...Object.values(PINNED_6C)]) for (const [name, re] of FORBIDDEN_6C) expect([ok, name, re.test(ok)]).toEqual([ok, name, false]);
    const re = (n: string) => (FORBIDDEN_6C.find(([x]) => x === n) as [string, RegExp, string])[1];
    expect(re('plan settings (affirmative)').test(en['partner4.refusal.planSettings'])).toBe(false);
    for (const canon of ['Critical ignores quiet hours, by design.', "suppressed into tomorrow's digest per your quiet-hours rule"]) expect([canon, re('quiet hours (affirmative)').test(canon) || re('digest').test(canon)]).toEqual([canon, true]);
  });
  it.each(Object.entries(CATS))('%s: no 6c claim in any 6c value, nor in any key PARTNER6_REFUSALS prints on a 6c surface (the reused keys included)', (_l, cat) => {
    const c = cat as Record<string, string>;
    const keys = keys6C(c);
    expect(keys.length).toBeGreaterThan(60);
    for (const k of keys) {
      expect([k, typeof c[k]]).toEqual([k, 'string']);
      for (const [name, re] of [...FORBIDDEN_6C.map(([n, r]) => [n, r] as const), ...FORBIDDEN]) expect([k, name, re.test(c[k])]).toEqual([k, name, false]);
    }
    for (const k of Object.keys(en).filter((x) => SCOPE_6C.test(x))) expect([k, typeof c[k] === 'string' && c[k].length > 0]).toEqual([k, true]);
  });
  it('founder 6c-1 / 6c-2 (en, VERBATIM): the two statements; present and distinct in hi and gu; the English-fallback note says so plainly', () => {
    for (const [k, v] of Object.entries(PINNED_6C)) {
      expect([k, en[k]]).toEqual([k, v]);
      expect([k, typeof hi[k] === 'string' && hi[k].length > 30 && hi[k] !== en[k], typeof gu[k] === 'string' && gu[k].length > 30 && gu[k] !== en[k]]).toEqual([k, true, true]);
      expect([k, hi[k] !== gu[k]]).toEqual([k, true]);
    }
    // founder 6c-3: say plainly that some older text is English-only — never that every template exists in hi / gu
    expect(en['partner6.language.fallbackNote']).toMatch(/still in English only/);
    // the statement names exactly two messages and points at the webhook log; nothing about an inbox, an item or a person
    expect(en['partner6.notifications.statement']).toMatch(/two kinds of message, by SMS/);
    expect(en['partner6.notifications.statement']).toMatch(/delivery log is on the Webhooks page/);
  });
  it('the W270 / W271 views, pages, chain and language act carry no inbox, item, counter, person field or literal language list in their CODE', () => {
    const fs2 = require('node:fs') as typeof import('node:fs');
    const path2 = require('node:path') as typeof import('node:path');
    const SRC = path2.join(__dirname, '..');
    for (const rel of ['components/partner6/AccountNotificationsView.tsx', 'components/partner6/AccountNotificationPrefsView.tsx', 'components/partner6/AccountChain6.tsx',
      'app/account/notifications/page.tsx', 'app/account/notifications/preferences/page.tsx', 'app/account/notifications/preferences/actions.ts', 'features/partner6/language.ts']) {
      const code = fs2.readFileSync(path2.join(SRC, rel), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      expect([rel, code.length > 300]).toEqual([rel, true]);
      for (const [name, re] of [['formatter', /Intl\.NumberFormat|toLocaleString|toFixed|formatMoney/], ['count / unread field', /\bunread\b|\bcounts?\b|\btotal\b/i],
        ['%', /%/], ['₹', /₹/], ['person field', /userId|user_id|phone|fullName|full_name|policyholder|payee|surveyor/i],
        ['checkbox / select / textarea', /type="checkbox"|<select|<textarea/i], ['event code', /eventCode|event_code|claim\.intimated|payout\.completed|consent\.expiring/]] as const) {
        expect([rel, name, re.test(code)]).toEqual([rel, name, false]);
      }
    }
  });
});
