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
