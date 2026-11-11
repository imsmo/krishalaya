// apps/web-gov/src/test/gov3-claims-guard.spec.ts · PC-56 GOV-3a (survey_gov3.md E7) — the CLAIMS GUARD for the benefit payments page, `gov3.`
// scope (the gov2 shape). Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that matches nothing cannot pass
// silently), then asserted against every `gov3.` value in en, hi and gu — Q1's sentence alone may say "releases" and "pauses" (it says the
// console never does). Q1-A, Q2-A and Q4-A are PINNED verbatim in English and by meaning in hi and gu. Plus a BRAND guard: no canon person,
// body, place, scheme code or reference in any `gov3.` value or GOV-3a source.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('gov3.'));

/** [name, regex, the canon phrase it is proven on, keys exempt] */
const GUARDS: ReadonlyArray<[string, RegExp, string, string[]?]> = [
  ['₹', /₹|\bINR\b|rupee|\bcrore\b|\blakh\b/i, 'Credited this season ₹22,85,61,120'],
  ['%', /%/, '≤ 3 days 5,245 (38%)'],
  ['PFMS ack', /PFMS ack/i, 'Our file vs PFMS acknowledgement, to the rupee'],
  ['acknowledg', /acknowledg/i, 'display states over PFMS acknowledgements'],
  ['observed from', /observed from|observes/i, 'DBT transfers — observed from PFMS'],
  ['reconcil', /reconcil/i, 'The platform observes and reconciles credits'],
  ['foot', /\bfoot/i, 'The footing line — must be zero'],
  ['batch', /batch/i, 'A queued payment joins the next daily batch'],
  ['release', /releas/i, 'RELEASE is two humans\' job', ['gov3.q1']],
  ['trigger', /trigger/i, 'Payment triggers — what fires money, exactly'],
  ['pause', /paus/i, 'Pause all triggers', ['gov3.q1']],
  ['FTO', /\bFTO\b/, 'FTO generated'],
  ['sanction', /sanction/i, 'Sum within remaining sanction'],
  ['budget', /budget/i, 'Budget line'],
  ['pipeline', /pipeline/i, 'In PFMS pipeline ₹9,56,96,640'],
  ['penny', /penny/i, 'Account verified (penny-drop or prior credit)'],
  ['NPCI', /NPCI/i, 'Aadhaar-seeded beneficiary per NPCI mapper'],
  ['Aadhaar-seeded', /Aadhaar/i, 'Aadhaar-seeded beneficiary per NPCI mapper'],
  ['account', /account/i, 'returned — account dormant'],
  ['IFSC', /IFSC/i, 'IFSC migrated (bank merger)'],
  ['a/c', /a\/c/i, '₹17,280 → a/c ••42'],
  ['••', /••/, 'PFMS-26-71••402'],
  ['re-queue', /re-?queue/i, 'the credit re-queues automatically on fix'],
  ['recall', /recall/i, 'wrong beneficiary — recall via PFMS process'],
  ['SMS', /\bSMS\b/, 'the farmer gets an SMS naming the exact bank issue'],
  ['reminder', /reminder/i, 'Send fix-reminders (this week\'s 47 unfixed)'],
  ['ambassador', /ambassador/i, 'SMS + ambassador follow-up'],
  ['Joint Director', /Joint Director/i, 'finance officer prepares → Joint Director releases'],
  ['finance officer', /finance officer|finance-officer/i, 'Finance-officer scope'],
  ['two-key', /two-?key/i, 'Release is two-key'],
  ['median', /median/i, 'median 4 days'],
  ['p90', /\bp90\b/i, 'p90 9 days'],
  ['target', /target/i, 'Target: under 0.5%'],
  ['this season', /this season|season/i, 'Credited this season'],
  ['export', /export/i, 'Export recon (audit-stamped)'],
  ['zero-sum', /zero-sum/i, 'Money-adjacent actions reconcile zero-sum'],
  ['on-call', /on-call/i, 'repeated failures page the on-call.'],
  ['audit trail', /audit trail/i, 'View audit trail'],
  ['audit-stamped', /audit-stamped|signed URL|sha256|checksum/i, 'audit-stamped, checksummed, delivered by signed URL'],
  ['credited', /\bcredited\b/i, 'credited Sat 11 Jul'],
  ['back to confirm', /back to confirm/i, 'Retry — back to confirm'],
  ['plan settings', /plan settings/i, 'See plan settings.'],
  ['within days', /within \d+ days|\d+ days/i, 'approvals today usually show here within 4 days'],
];
const BRAND: ReadonlyArray<[RegExp, string]> = [
  [/Directorate/i, 'Directorate of Agriculture, Gujarat'], [/Gujarat/i, 'Gujarat · state authority'], [/GMISS/i, 'GMISS-2026'],
  [/DBT-\d/i, 'DBT-0713-2'], [/Christian/i, 'A. Christian'], [/Kapadia/i, 'Dr. D. Kapadia'], [/Keshod/i, 'Keshod'], [/GM26-/i, 'GM26-097854'],
  [/PFMS-\d/i, 'PFMS-26-71••402'], [/\bDK\b/, 'avatar "DK"'], [/[A-Z]••• [A-Z]\./, 'D••• B.'], [/\bW3(13|33|35)\b/, 'W313 as-of law'],
];
const SOURCES_3A = ['components/gov3/DbtViews.tsx', 'app/dbt/page.tsx', 'features/gov3/refusals.ts'];

describe('PC-56 GOV-3a · the claims guard (gov3. scope)', () => {
  it.each(GUARDS.map((g) => [g[0], g] as const))('the guard "%s" matches the canon phrase it exists to stop', (_n, g) => {
    expect(g[1].test(g[2])).toBe(true);
  });
  it.each(BRAND.map((b) => [String(b[0]), b] as const))('the brand guard %s matches its canon fixture', (_n, b) => {
    expect(b[0].test(b[1])).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no gov3. value trips a guard or a brand regex', (_l, cat) => {
    const vals = scoped(cat);
    expect(vals.length).toBe(56);
    for (const [k, v] of vals) {
      for (const [name, re, , exempt] of GUARDS) if (!(exempt ?? []).includes(k)) expect([k, name, re.test(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('Q1-A, Q2-A and Q4-A verbatim (en) and by meaning in hi and gu', () => {
    expect(en['gov3.q1']).toBe('This console never prepares, releases or pauses a payment. Benefits are paid by PFMS and the banks, outside this platform, and this platform cannot check them.');
    expect(en['gov3.q2']).toBe('Payments and returned payments are not recorded on this platform. An approved application stays approved here; the payment itself happens outside this platform.');
    expect(en['gov3.q4']).toBe('Payment records cannot be downloaded from this console.');
    expect(/तैयार, जारी या रोकता नहीं/.test(hi['gov3.q1']) && /PFMS और बैंक/.test(hi['gov3.q1']) && /प्लेटफ़ॉर्म के बाहर/.test(hi['gov3.q1']) && /जाँच नहीं कर सकता/.test(hi['gov3.q1'])).toBe(true);
    expect(/તૈયાર, જારી કે અટકાવતું નથી/.test(gu['gov3.q1']) && /PFMS અને બેંકો/.test(gu['gov3.q1']) && /પ્લેટફોર્મની બહાર/.test(gu['gov3.q1']) && /તપાસ કરી શકતું નથી/.test(gu['gov3.q1'])).toBe(true);
    expect(/दर्ज नहीं किए जाते/.test(hi['gov3.q2']) && /स्वीकृत ही रहता/.test(hi['gov3.q2']) && /प्लेटफ़ॉर्म के बाहर/.test(hi['gov3.q2'])).toBe(true);
    expect(/નોંધાતી નથી/.test(gu['gov3.q2']) && /મંજૂર જ રહે/.test(gu['gov3.q2']) && /પ્લેટફોર્મની બહાર/.test(gu['gov3.q2'])).toBe(true);
    expect(/डाउनलोड नहीं/.test(hi['gov3.q4']) && /डाउनलोड કરી શકાતા નથી|ડાઉનલોડ કરી શકાતા નથી/.test(gu['gov3.q4'])).toBe(true);
    for (const cat of [hi, gu]) for (const k of ['gov3.q1', 'gov3.q2', 'gov3.q4']) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
  });
  it('the facts printed beside the sentences are the ones the code proves (pinned)', () => {
    expect(en['gov3.dbt.disbursedBefore']).toBe('An application counted as marked disbursed was marked so by an officer before this platform stopped recording payments. That mark is not proof that a payment was made.');
    expect(en['gov3.dbt.noneMarked']).toBe('No application to your schemes has been marked disbursed.');
    expect(en['gov3.refusal.rereadWrites']).toBe('Reading the counts again writes nothing.');
  });
  it('no GOV-3a source (nor the registry) carries a canon person, body, place, scheme code or reference', () => {
    for (const rel of SOURCES_3A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
