// apps/web-gov/src/test/gov6-claims-guard.spec.ts · PC-56 GOV-6a (survey_gov6.md E7) — the CLAIMS GUARD for /dashboard's sections "Analytics" and
// "Reports" and their chains, `gov6.` scope (the gov5 shape). Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that
// matches nothing cannot pass silently), then asserted against every `gov6.` value in en, hi and gu — a guarded word is allowed ONLY in the
// keys that say no about it (named per guard). Q1-A, Q4-A and Q5-A are PINNED verbatim in English and by meaning in hi and gu. Plus a BRAND
// guard: no canon person, body, place, scheme, number or reference in any `gov6.` value or GOV-6a source — the Gujarati wall title included.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('gov6.'));
const Q1 = 'gov6.q1'; const Q4 = 'gov6.q4'; const Q5 = 'gov6.q5';

/** [name, regex, the canon phrase it is proven on, keys exempt (each says no)] */
const GUARDS: ReadonlyArray<[string, RegExp, string, string[]?]> = [
  // ── W333 · who the scheme reaches (Q1-A) ──
  ['caste', /caste/i, 'counts applicants by caste ("SC/ST")', [Q1]],   // (the canon writes "SC/ST tier"; the survey\'s Q1 names it caste)
  ['SC/ST', /SC\/ST|\bSC\b|\bST\b|scheduled (caste|tribe)/i, 'SC/ST tier: 7.2% of approvals'],
  ['tier', /\btier\b/i, 'SC/ST tier: 7.2% of approvals'],
  ['women', /\bwom[ae]n\b|\bfemale\b/i, 'Women applicants: 18% — up from 11%'],
  ['gender', /gender/i, 'Women applicants: 18% (gender reach)', [Q1]],
  ['small/marginal', /small\/marginal|marginal/i, 'Small/marginal: 74% of approvals'],
  ['landholding', /landholding|land band/i, 'outside land band 1,220', [Q1]],
  ['district', /district/i, 'District table — top 4 of 33 by volume', [Q1]],
  ['rank', /\brank/i, 'top 4 of 33 by volume (ranked)', [Q1]],
  ['top n of', /top \d+ of|by volume/i, 'top 4 of 33 by volume'],
  ['flag', /\bflag/i, 'the flag opens a support plan'],
  ['slow', /\bslow/i, 'slow + reach gap — support visit planned', ['gov6.refusal.noPlaceTable']],
  ['reach', /\breach gap|who the scheme is missing|\breach\b/i, 'slow + reach gap', []],
  ['show-cause', /show-cause|memo\b|support plan/i, 'not a show-cause notice'],
  ['dry-run', /dry-?run|predicted/i, 'dry-run predicted 71%'],
  ['ambassador', /ambassador|assisted flow/i, 'ambassador-assisted flow drives most of it'],
  // ── W333 · the numbers (F-5, E4) ──
  ['funnel', /funnel/i, 'The funnel — 31,406 applications'],
  ['decided', /\bdecided\b/i, 'decided 24,187', ['gov6.refusal.noFunnel']],
  ['median', /median/i, 'median 6 days of farmer time per round'],
  ['average', /average|\bavg\b|\bmean\b/i, 'avg 1.15 ha'],
  ['%', /%|per ?cent|per hundred/i, '3,102 (64%) fixable'],
  ['rate', /\brates?\b|approval rate/i, 'approval rate'],
  ['share', /\bshares?\b|\bratio/i, 'share of approvals'],
  ['fixable', /fixable|terminal/i, '3,102 (64%) fixable … 1,745 terminal'],
  ['instalment', /instal?ment|inst\. ?\d/i, 'disbursed (inst. 1) 13,802'],
  ['snapshot', /snapshot/i, 'Yesterday\'s computed snapshot is shown with its date'],
  ['as-of law', /as-of law|as of/i, '(as-of law)'],
  ['window', /\bwindow\b|this season|scheme year/i, 'Scheme performance — GMISS-2026 window'],
  ['rounds', /per round|\brounds?\b/i, 'median 6 days of farmer time per round'],
  ['review meeting', /review meeting|where applications die/i, 'Numbers a review meeting can act on: where applications die'],
  ['affidavit', /affidavit/i, 'v3 removes the affidavit'],
  ['camp', /\bcamp\b/i, 'the Dahod camp calendar is already seeded', ['gov6.refusal.noCamp']],
  ['surveillance', /surveillance|side-door/i, 'analytics never becomes a surveillance side-door'],
  ['officer role', /officer role/i, 'drilling to named applications needs the officer role'],
  // ── money (Q5-A) ──
  ['₹', /₹|\bINR\b|rupee|\bcrore\b|\blakh\b/i, 'approved application (v2 rules, ₹28,800)', [Q5]],
  ['PFMS', /PFMS/, 'the PFMS pipeline, median 4 days'],
  ['DBT', /\bDBT\b|transfer totals/i, 'funnel, DBT totals, pendency, appeals'],
  ['pipeline', /pipeline/i, 'the approved→disbursed gap (5,538) is the PFMS pipeline'],
  // ── W357 · reports, publishing, files (Q4-A) ──
  ['publish', /publish/i, 'auto-composed, two-person publish', [Q4]],
  ['schedule', /schedul/i, 'A scheduled report that fails to compose pages a human'],
  ['signed', /\bsigned\b|signing|\bsign\b/i, 'the W333 numbers, signed', []],
  ['hash', /\bhash/i, 'hash 7c2e…90ab'],
  ['watermark', /watermark/i, 'watermarked with the requesting officer'],
  ['byte-identical', /byte-identical|reproducible/i, 'reproducible byte-identical (W334 rule)'],
  ['RTI', /\bRTI\b/, 'RTI response extract'],
  ['PIO', /\bPIO\b/, 'PIO desk'],
  ['Secretary', /secretar/i, 'Agriculture Secretary\'s office'],
  ['recipient', /recipient/i, 'speaks the recipient\'s language'],
  ['library', /library|jungle/i, 'Reports — the library, not a jungle'],
  ['audit-stamped', /audit-stamped|audit trail|audit log/i, 'Export deck (audit-stamped)'],
  ['export', /export/i, 'Export deck (audit-stamped)'],
  ['download', /download/i, 'remains valid and downloadable', [Q4]],
  ['public page', /public page|public wall|public by definition/i, 'a public-wall PDF is public by definition'],
  ['A2', /\bA2\b|\bPDF\b/, 'MGNREGA public wall (A2 print PDF)'],
  ['notice boards', /notice boards?/i, 'panchayat notice boards'],
  ['template', /pre-built|template/i, 'Start from a template — the secretariat monthly and the public wall come pre-built', ['gov6.refusal.noNewReport']],
  ['reports role', /reports role/i, 'Configuring needs the reports role', ['gov6.refusal.noReportsRole']],
  ['pages a human', /pages? a human|paged the|on-call|software shrugged/i, 'the failure already paged the on-call'],
  ['compensation', /compensation/i, 'every late wage + its computed compensation', ['gov6.notDone.lateWages']],
  ['edition', /edition/i, 'Yesterday\'s signed edition remains valid', ['gov6.refusal.noOldEdition']],
  // ── the regulator / record words (GOV-6b's; never in 6a) ──
  ['regulator', /regulat|supervis/i, 'Regulatory Access · READ-ONLY · Supervisory user'],
  ['pseudonym', /pseudonym|re-?identif/i, 'borrower identity replaced by stable pseudonyms'],
  ['PSL', /\bPSL\b|\bNPA\b|cure rate|ombudsman|parametric/i, 'PSL-classified 78.4%'],
  ['loan / claim', /\bloans?\b|\bclaims?\b|borrower|policyholder/i, 'Active loans 18,442 across 3 partners'],
  ['data room', /data room|extract request|countersign|\bDPO\b/i, 'Data room — signed, reproducible, logged'],
  ['grant', /\bgrant/i, 'dual grant'],
  ['rule engine', /rule engine|fast lane/i, 'routed 214 high-confidence applications to fast lane'],
  ['zero-sum', /zero-sum|reconcile/i, 'Money-adjacent actions reconcile zero-sum'],
  ['signed URL', /signed URL|sha256|position and ETA/i, 'delivered by signed URL'],
  ['maker-checker', /maker-checker|diff against/i, 'Maker-checker friendly review step'],
  ['plan settings', /plan settings/i, 'See plan settings'],
];
const BRAND: ReadonlyArray<[RegExp, string]> = [
  [/Directorate/i, 'Directorate of Agriculture'], [/Gujarat/i, 'Gujarat · state authority'], [/GMISS/i, 'GMISS-2026'], [/Krishalaya Gov/i, 'scheme portfolio · Krishalaya Gov'],
  [/Junagadh/i, 'Junagadh 4,812'], [/Rajkot/i, 'Rajkot'], [/\bAnand\b/, 'Anand'], [/Dahod/i, 'Dahod 2,204'], [/Narmada/i, 'Dahod & Narmada'],
  [/Trivedi|Gohil|Kapadia/i, 'R. Trivedi (scheme officer)'], [/\bDK\b|\bSO\b/, 'avatar "DK"'], [/\d{1,3},\d{3}/, '31,406'], [/\b7c2e|\bb3f1|\b9ad4/, 'hash 7c2e…90ab'],
  [/GM26-|VR-0711|draft-v3/, 'GM26-101994'], [/\bW3[0-9]{2}\b|\bW3[0-9]{3}\b|DELTA-\d/, 'per W350'], [/\bQ1 FY27\b|FY ?27/, 'Q1 FY27'], [/જાહેર દીવાલ/, 'જાહેર દીવાલ'],
];
const SOURCES_6A = ['components/gov6/DashboardSections.tsx', 'app/dashboard/page.tsx', 'components/gov1/DashboardViews.tsx'];

describe('PC-56 GOV-6a · the claims guard (gov6. scope)', () => {
  it.each(GUARDS.map((g) => [g[0], g] as const))('the guard "%s" matches the canon phrase it exists to stop', (_n, g) => {
    expect(g[1].test(g[2])).toBe(true);
  });
  it.each(BRAND.map((b) => [String(b[0]), b] as const))('the brand guard %s matches its canon fixture', (_n, b) => {
    expect(b[0].test(b[1])).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no gov6. value trips a guard or a brand regex', (_l, cat) => {
    const vals = scoped(cat as Record<string, string>);
    expect(vals.length).toBe(78);   // GOV-6a
    for (const [k, v] of vals) {
      for (const [name, re, , exempt] of GUARDS) if (!(exempt ?? []).includes(k)) expect([k, name, re.test(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('every exempted key exists and says no in English', () => {
    const NEG = /\b(no|not|never|nothing|cannot|only)\b|n't\b/i;
    for (const [, , , exempt] of GUARDS) for (const k of exempt ?? []) expect([k, typeof en[k], NEG.test(en[k] ?? '')]).toEqual([k, 'string', true]);
  });
  it('Q1-A, Q4-A and Q5-A verbatim (en) — the three binding sentences', () => {
    expect(en[Q1]).toBe('This console counts applications only by scheme and by where each one is now. It does not count applicants by caste, gender, landholding or district, and it ranks no district or official.');
    expect(en[Q4]).toBe('This console publishes nothing, sends no reports and makes no files. Nothing on it can be downloaded.');
    expect(en[Q5]).toBe('This console shows no rupee figure and no payment timing.');
    expect(en['gov6.analytics.title']).toBe('Analytics'); expect(en['gov6.reports.title']).toBe('Reports');
  });
  it('the three sentences carry their meaning in hi and gu (each its own language)', () => {
    expect(/केवल योजना के अनुसार/.test(hi[Q1]) && /अभी कहाँ है/.test(hi[Q1]) && /जाति, लिंग, जोत या ज़िले/.test(hi[Q1]) && /नहीं गिनता/.test(hi[Q1]) && /अधिकारी की रैंकिंग नहीं करता/.test(hi[Q1])).toBe(true);
    expect(/ફક્ત યોજના પ્રમાણે/.test(gu[Q1]) && /અત્યારે ક્યાં છે/.test(gu[Q1]) && /જ્ઞાતિ, લિંગ, જમીન-ધારણ કે જિલ્લા/.test(gu[Q1]) && /ગણતું નથી/.test(gu[Q1]) && /ક્રમ નક્કી કરતું નથી/.test(gu[Q1])).toBe(true);
    expect(/कुछ भी प्रकाशित नहीं करता/.test(hi[Q4]) && /कोई रिपोर्ट नहीं भेजता/.test(hi[Q4]) && /कोई फ़ाइल नहीं बनाता/.test(hi[Q4]) && /डाउनलोड नहीं/.test(hi[Q4])).toBe(true);
    expect(/કંઈ પણ પ્રકાશિત કરતું નથી/.test(gu[Q4]) && /કોઈ રિપોર્ટ મોકલતું નથી/.test(gu[Q4]) && /કોઈ ફાઇલ બનાવતું નથી/.test(gu[Q4]) && /ડાઉનલોડ કરી શકાતું નથી/.test(gu[Q4])).toBe(true);
    expect(/रुपये की कोई राशि/.test(hi[Q5]) && /भुगतान का कोई समय/.test(hi[Q5]) && /नहीं दिखाता/.test(hi[Q5])).toBe(true);
    expect(/રૂપિયાની કોઈ રકમ/.test(gu[Q5]) && /ચુકવણીનો કોઈ સમય/.test(gu[Q5]) && /બતાવતું નથી/.test(gu[Q5])).toBe(true);
    for (const cat of [hi, gu]) for (const k of [Q1, Q4, Q5, 'gov6.analytics.title', 'gov6.reports.title']) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
  });
  it('no GOV-6a source (nor the registry) carries a canon person, body, place, number or reference', () => {
    for (const rel of [...SOURCES_6A, 'features/gov6/refusals.ts']) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND) {
        if (String(re).includes('W3')) continue;   // sources name canon FILES (W333, W3201 …) in comments by design; the copy is checked above
        expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
      }
    }
  });
});
