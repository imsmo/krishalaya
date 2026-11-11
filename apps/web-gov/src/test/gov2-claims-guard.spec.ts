// apps/web-gov/src/test/gov2-claims-guard.spec.ts · PC-56 GOV-2b (survey_gov2.md E8) — the CLAIMS GUARD for the scheme pages, `gov2.` scope
// (the gov1 shape). Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that matches nothing cannot pass silently),
// then asserted against every `gov2.` value in en, hi and gu. The refusals are worded so the canon's words never appear even in the negative
// — the guard is a plain match. Q5-A's sentence is PINNED verbatim in English and by meaning (both clauses) in hi and gu. Plus a BRAND guard:
// no canon person, body, place or scheme code in any `gov2.` value or GOV-2b source.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('gov2.'));

/** [name, regex, the canon phrase it is proven on] */
const GUARDS: ReadonlyArray<[string, RegExp, string]> = [
  ['AI', /\bAI\b/, 'what the AI pre-checker runs is EXACTLY what you built'],
  ['confidence', /confidence/i, 'AI pre-check · confidence 0.9640'],
  ['7/12', /7\/12/, 'Land holding between 0.1 and 4.0 ha (from linked 7/12 land record)'],
  ['land record', /land record/i, 'from linked 7/12 land record'],
  ['DigiLocker', /DigiLocker/i, 'UIDAI Aadhaar OTP / DigiLocker'],
  ['penny', /penny/i, 'bank passbook / penny-drop'],
  ['masked capture', /masked capture/i, 'Aadhaar (masked capture)'],
  ['district', /district/i, 'District-scoped view'],
  ['taluka', /taluka/i, 'taluka-level pilots'],
  ['budget', /budget/i, 'Budget line … FAILS red if projection exceeds sanction'],
  ['sanction', /sanction/i, 'sanctioned ₹11,80,00,00,000'],
  ['projected', /projected|projection/i, 'projected ₹11,49,12,00,000'],
  ['Joint Director', /Joint Director/i, 'v3 draft — awaiting Joint Director'],
  ['awaiting', /awaiting/i, 'draft v2 — awaiting approval'],
  ['grade-5', /grade-?\d/i, 'Plain-language card reads at grade-5 level in EN + GU + HI'],
  ['co-pay', /co-?pay/i, 'Small/marginal → co-pay 10%'],
  ['SC/ST', /SC\/ST/, 'SC/ST certificate on file → 5%'],
  ['caste', /caste/i, 'caste certificate'],
  ['₹', /₹|\bINR\b|rupee/i, '₹24,000 /ha · cap 2 ha'],
  ['%', /%/, 'Small/marginal → co-pay 10%'],
  ['per ha', /\/\s*ha\b|\bper ha\b|hectare/i, '₹24,000 /ha · cap 2 ha'],
  ['IST', /\bIST\b/, 'Closes at 23:59 IST on the closing day'],
  ['grace', /grace/i, '48h grace'],
  ['RTI', /\bRTI\b/, 'an RTI query … deserves the 2024 rules, verbatim'],
  ['court', /\bcourt\b/i, 'the same record an RTI query or a court can request'],
  ['verbatim', /verbatim/i, 'deserves the 2024 rules, verbatim'],
  ['would qualify', /would qualify/i, '~6,84,000 farmers would qualify'],
  ['dry run', /dry run/i, 'Dry run completed'],
  ['translation desk', /translation desk/i, '11 more languages via the translation desk'],
  ['with currency', /with currency/i, 'Stored in minor units with currency INR'],
  ['installation verification', /installation verification/i, '40% on installation verification'],
  ['kept locally', /kept locally/i, 'Draft not saved — kept locally on this console'],
  ['Central schemes', /appear via the platform registry|automatically/i, 'Central schemes (PM-Kisan, PMFBY…) appear via the platform registry automatically'],
  ['maker-checker', /maker-?checker/i, 'Maker-checker friendly review step'],
  ['zero-sum', /zero-sum/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows'],
  ['reconcile', /reconcil/i, 'Money-adjacent actions reconcile zero-sum'],
  ['on-call', /on-call/i, 'repeated failures page the on-call.'],
  ['audit trail', /audit trail/i, 'View audit trail'],
  ['back to confirm', /back to confirm/i, 'Retry — back to confirm'],
  ['SLA', /\bSLA\b/, 'appeal SLA'],
  ['plan settings', /plan settings/i, 'See plan settings.'],
  // NAMED UPDATE, PC-56 GOV-2c (survey E8 — the application pages' canon words)
  ['export', /export/i, 'Export (audit-stamped)'],
  ['fast lane', /fast lane/i, 'fast lane'],
  ['auto-rout', /auto-?rout/i, 'auto-routed on high confidence'],
  ['EXIF', /EXIF/i, 'doc uploaded, EXIF plausible'],
  ['target', /\btarget\b/i, '10-day target'],
  ['due by', /due by/i, 'next: officer decision due by Mon 20 Jul'],
  ['pre-check', /pre-?check/i, 'AI pre-check · confidence'],
  ['ambassador', /ambassador/i, 'assisted by ambassador (recorded)'],
  ['govt ref', /govt ref/i, 'govt ref GJ-AGR-26-88••41'],
  ['fixable', /fixable/i, 'fixable reasons auto-offer the clarification path instead'],
  ['read everything', /read everything|visibility is not authority/i, 'You can read everything; visibility is not authority'],
  ['claimed', /\d+(\.\d+)?\s*(ha|acres?) claimed/i, '1.2 ha claimed'],
  ['model', /\bmodel\b/i, "the model's reasoning is preserved beside it"],
];
const BRAND: ReadonlyArray<[RegExp, string]> = [
  [/Directorate/i, 'Directorate of Agriculture, Gujarat'], [/Gujarat/i, 'Gujarat Micro-Irrigation Support'], [/GMISS/i, 'GMISS-2026'],
  [/guj_/i, 'guj_pond_2026'], [/Trivedi/i, 'R. Trivedi'], [/Kapadia/i, 'Dr. D. Kapadia'], [/Junagadh|Dahod|Anand\b|Rajkot|Vanthali/i, 'Junagadh'],
  [/PM-?Kisan|PMFBY/i, 'PM-Kisan, PMFBY'], [/\bDK\b/, 'avatar "DK"'], [/GM26-/i, 'GM26-104487'],
  [/SR-JND|GJ-AGR/i, 'SR-JND-44••7'], [/[A-Z]••• [A-Z]\./, 'B••• D.'],
];
const SOURCES_2B = ['components/gov2/SchemesViews.tsx', 'components/gov2/Gov2Chain.tsx', 'features/gov2/schemes.ts', 'features/gov2/rules-format.ts',
  'app/schemes/page.tsx', 'app/schemes/[id]/page.tsx',
  // NAMED UPDATE, PC-56 GOV-2c
  'components/gov2/ApplicationsViews.tsx', 'features/gov2/applications.ts', 'app/applications/page.tsx', 'app/applications/[id]/page.tsx', 'app/applications/[id]/actions.ts'];   // (refusals.ts quotes the canon, anonymised in brackets — held to BRAND below too)

describe('PC-56 GOV-2b · the claims guard (gov2. scope)', () => {
  it.each(GUARDS.map((g) => [g[0], g] as const))('the guard "%s" matches the canon phrase it exists to stop', (_n, g) => {
    expect(g[1].test(g[2])).toBe(true);
  });
  it.each(BRAND.map((b) => [String(b[0]), b] as const))('the brand guard %s matches its canon fixture', (_n, b) => {
    expect(b[0].test(b[1])).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no gov2. value trips a guard or a brand regex', (_l, cat) => {
    const vals = scoped(cat);
    expect(vals.length).toBe(320);   // NAMED UPDATE, PC-56 GOV-2c: 183 (2b) + 137 (2c)
    for (const [k, v] of vals) {
      for (const [name, re] of GUARDS) expect([k, name, re.test(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('Q5-A verbatim (en) and both clauses in hi and gu; the same sentence in every chain\'s statement', () => {
    expect(en['gov2.q5']).toBe('Schemes are written by the platform\'s team, not from this console. Each version is drafted by one person and published by another.');
    expect(/प्लेटफ़ॉर्म की टीम/.test(hi['gov2.q5']) && /कंसोल से नहीं/.test(hi['gov2.q5']) && /एक व्यक्ति तैयार/.test(hi['gov2.q5']) && /दूसरा व्यक्ति प्रकाशित/.test(hi['gov2.q5'])).toBe(true);
    expect(/પ્લેટફોર્મની ટીમ/.test(gu['gov2.q5']) && /કન્સોલમાંથી નહીં/.test(gu['gov2.q5']) && /એક વ્યક્તિ તૈયાર/.test(gu['gov2.q5']) && /બીજી વ્યક્તિ પ્રકાશિત/.test(gu['gov2.q5'])).toBe(true);
  });
  it('GOV-2c: Q1-A, Q2-A, Q3-A and Q4-A verbatim (en) and by meaning in hi and gu', () => {
    expect(en['gov2.q1']).toBe('Approving records the decision. It pays nothing: the benefit is paid by the government\'s own systems, outside this platform.');
    expect(en['gov2.q2']).toBe('A decision is made by a different person from the one who checked the application. Every step is recorded, and the farmer\'s organisation can see it.');
    expect(en['gov2.q3']).toBe('You see only what this scheme asks for. A farmer\'s personal details are hidden, and an application she has not sent is never shown.');
    expect(en['gov2.q4']).toBe('Applications cannot be downloaded from this console. Each one is opened here, and every opening is recorded.');
    expect(/निर्णय दर्ज/.test(hi['gov2.q1']) && /कोई भुगतान नहीं/.test(hi['gov2.q1']) && /प्लेटफ़ॉर्म के बाहर/.test(hi['gov2.q1'])).toBe(true);
    expect(/નિર્ણય નોંધાય/.test(gu['gov2.q1']) && /કોઈ ચુકવણી થતી નથી/.test(gu['gov2.q1']) && /પ્લેટફોર્મની બહાર/.test(gu['gov2.q1'])).toBe(true);
    expect(/दूसरा व्यक्ति/.test(hi['gov2.q2']) && /जाँच नहीं की/.test(hi['gov2.q2']) && /किसान का संगठन/.test(hi['gov2.q2'])).toBe(true);
    expect(/બીજી વ્યક્તિ/.test(gu['gov2.q2']) && /તપાસ કરી નથી/.test(gu['gov2.q2']) && /ખેડૂતનું સંગઠન/.test(gu['gov2.q2'])).toBe(true);
    expect(/छिपी रहती/.test(hi['gov2.q3']) && /कभी नहीं दिखाया/.test(hi['gov2.q3'])).toBe(true);
    expect(/છુપાયેલી રહે/.test(gu['gov2.q3']) && /ક્યારેય બતાવાતી નથી/.test(gu['gov2.q3'])).toBe(true);
    expect(/डाउनलोड नहीं/.test(hi['gov2.q4']) && /दर्ज होता/.test(hi['gov2.q4'])).toBe(true);
    expect(/ડાઉનલોડ કરી શકાતી નથી/.test(gu['gov2.q4']) && /નોંધાય છે/.test(gu['gov2.q4'])).toBe(true);
    for (const cat of [hi, gu]) for (const k of ['gov2.q1', 'gov2.q2', 'gov2.q3', 'gov2.q4']) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
  });
  it('the facts printed beside Q5-A are the ones the code proves (pinned)', () => {
    expect(en['gov2.versionRule']).toBe('A published version can never be changed. An application records the version number it was made under.');
    expect(en['gov2.noMoney']).toBe('This console shows no benefit money figure: a scheme shows its benefit type and number of instalments only.');
    expect(en['gov2.rules.notAtApply']).toBe('This check is not run when a farmer applies.');
    expect(en['gov2.newerDraft']).toBe('A newer draft by the platform\'s team exists. Its content is not shown here.');
  });
  it('no GOV-2b source (nor the registry) carries a canon person, body, place or scheme code', () => {
    for (const rel of [...SOURCES_2B, 'features/gov2/refusals.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
