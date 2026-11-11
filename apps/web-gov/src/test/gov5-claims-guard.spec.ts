// apps/web-gov/src/test/gov5-claims-guard.spec.ts · PC-56 GOV-5a (survey_gov5.md E7) — the CLAIMS GUARD for the MGNREGA page, `gov5.` scope
// (the gov4 shape). Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that matches nothing cannot pass silently),
// then asserted against every `gov5.` value in en, hi and gu — a guarded word is allowed ONLY in the keys that say no about it (named per
// guard). Q3-A, Q2-A, Q1-A and the download sentence are PINNED verbatim in English and by meaning in hi and gu. Q4-A's page sentence is
// pinned ABSENT (the page cannot know the flag). Plus a BRAND guard: no canon person, body, place, number or reference in any `gov5.` value
// or GOV-5a source — the Gujarati wage promise included.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('gov5.'));
const READS = ['gov5.chain.jobReread.confirm.body', 'gov5.chain.musterReread.confirm.body', 'gov5.chain.workReread.confirm.body'];

/** [name, regex, the canon phrase it is proven on, keys exempt (each says no)] */
const GUARDS: ReadonlyArray<[string, RegExp, string, string[]?]> = [
  ['synced', /\bsynced\b|\bsyncing\b/i, 'Job cards synced 1,847'],
  ['sync', /\bsync\b/i, 'Sync now'],
  ['mirror', /mirror/i, 'Mirrored from NREGASoft (last full sync today 08:10)'],
  ['convergence', /convergence/i, 'MGNREGA convergence · NREGASoft is the record'],
  ['NREGASoft', /NREGASoft/i, 'NREGASoft remains the system of record', ['gov5.q3', 'gov5.refusal.noSyncTime', 'gov5.refusal.noForwarding', 'gov5.refusal.noMatch', 'gov5.refusal.noSync', 'gov5.chain.sync.confirm.body']],
  ['demand', /demand/i, 'Work demand — the 15-day register', ['gov5.q3']],
  ['job card', /job.?cards?/i, 'Job cards — synced register', ['gov5.q2', 'gov5.notDone.jobCards', 'gov5.refusal.noFile', 'gov5.chain.jobFile.ready.body', 'gov5.chain.jobReread.confirm.body']],
  ['GJ-', /GJ-|\d{2}••/, 'GJ-06••-00214'],
  ['household', /household/i, 'The 100-day guarantee is per HOUSEHOLD per financial year', ['gov5.q2', 'gov5.notDone.demand', 'gov5.refusal.noCardRows', 'gov5.refusal.noMessage']],
  ['muster', /muster/i, 'Muster MR-88 — pond deepening', ['gov5.notDone.muster', 'gov5.notDone.musters', 'gov5.refusal.noMusterKept', 'gov5.chain.musterReread.confirm.body']],
  ['attendance', /attendance/i, 'Attendance — observed from sync', ['gov5.q2', 'gov5.notDone.muster', 'gov5.refusal.noMatch']],
  ['persondays', /person.?days?/i, 'Persondays this FY 24,612'],
  ['worksite', /worksite/i, 'Worksite facts', ['gov5.q2', 'gov5.notDone.muster', 'gov5.refusal.noWorksiteFacts']],
  ['mate', /\bmate\b/i, 'Mate: S••• B. (f)'],
  ['panchayat', /panchayat/i, 'Vanthali Gram Panchayat', ['gov5.refusal.persona', 'gov5.refusal.noRanking']],
  ['sarpanch', /sarpanch/i, 'Publishing is the sarpanch + secretary', ['gov5.refusal.persona']],
  ['rozgar', /rozgar/i, 'Recording needs the rozgar sahayak role', ['gov5.refusal.persona']],
  ['Gram Sabha', /gram sabha/i, 'Gram Sabha audit — next: Sat 01 Aug'],
  ['15-day', /15-day|\b15 days\b|day 16/i, 'the 15-day register'],
  ['clock', /clock/i, 'Clocks that must not run out'],
  ['allowance', /allowance/i, 'unemployment allowance accruing — state liability', ['gov5.notDone.counts']],
  ['compensation', /compensation/i, 'compensation accruing at 0.05%/day', ['gov5.notDone.counts']],
  ['liability', /liabilit/i, 'allowance liability already flagged'],
  ['FTO', /\bFTO\b/, 'Wages & FTO'],
  ['wage', /wage/i, 'Wages awaiting payment ₹35,000', ['gov5.q1', 'gov5.refusal.noRates']],
  ['credited', /credited|credit pending/i, 'credited 22 Jun (day 9)'],
  ['₹', /₹|\bINR\b|rupee|\bcrore\b|\blakh\b/i, 'rate ₹280/day'],
  ['%', /%/, '0.05%/day'],
  ['rate', /\brates?\b/i, 'the notified rates table', ['gov5.refusal.noRates']],
  ['notified', /notified/i, 'from the notified rates table'],
  ['exhausted', /exhausted/i, 'guarantee exhausted this FY'],
  ['wall', /\bwall\b/i, 'Publish this month\'s wall'],
  ['QR', /\bQR\b/, 'QR to the same page online'],
  ['publish', /publish/i, 'Publish this month\'s wall'],
  ['grievance', /grievance|complaint/i, 'Grievances — open register'],
  ['voice line', /voice line/i, 'Demand can arrive here by voice line'],
  ['*123#', /\*123#|USSD/i, '*123# (USSD)'],
  ['SMS', /\bSMS\b/, 'their own app/SMS in Gujarati'],
  ['receipt time', /receipt time|dated receipt/i, 'the clock runs from OUR receipt time'],
  ['offer letter', /offer drafted|offer letter/i, 'offer drafted — pond deepening ph-2'],
  ['match chip', /match chip|dual-confirm|geo-?fenced/i, 'geo-fenced dual-confirm attendance … a match chip shows'],
  ['spot-verifiable', /spot-verif|observed from/i, 'observed from sync, spot-verifiable on site'],
  ['measurement book', /measurement book/i, 'measurement book entry MB-114/8'],
  ['creche', /creche|drinking water|shade/i, 'creche + drinking water + shade recorded present'],
  ['read for all', /read for all|edit for none|readable forever/i, 'Read for all, edit for none'],
  ['enrolment', /enrol/i, 'the console explains the enrolment path'],
  ['export', /export/i, 'Export (audit-stamped)'],
  ['zero-sum', /zero-sum|reconcile/i, 'Money-adjacent actions reconcile zero-sum'],
  ['on-call', /on-call/i, 'repeated failures page the on-call.'],
  ['audit trail', /audit trail|audit-stamped/i, 'View audit trail'],
  ['signed URL', /signed URL|sha256|position and ETA/i, 'delivered by signed URL'],
  ['maker-checker', /maker-checker|diff against/i, 'Maker-checker friendly review step'],
  ['plan settings', /plan settings/i, 'See plan settings'],
  ['switched off records', /records are switched off|switched off on this platform/i, 'The organisation\'s MGNREGA records are switched off on this platform.'],
];
const BRAND: ReadonlyArray<[RegExp, string]> = [
  [/Vanthali/i, 'Vanthali Gram Panchayat'], [/Junagadh/i, 'Junagadh · panchayat'], [/talav/i, 'Vanthali talav'], [/sector \d/i, 'Farm bund repair, sector 3'],
  [/ward \d/i, 'Kachcha road, ward 2'], [/pond deepening/i, 'pond deepening ph-2'], [/bund repair/i, 'Farm bund repair'], [/Kachcha/i, 'Kachcha road'],
  [/[A-Z]••• [A-Z]\./, 'H••• B. (f)'], [/worker ••\d/, 'worker ••847'], [/GJ-06/, 'GJ-06••-00391'], [/D-2026-/, 'D-2026-0791'], [/\bMR-\d/, 'MR-88'],
  [/\bMB-\d/, 'MB-114/8'], [/\bW313\b|\bW289\b/, 'the W313 ladder'], [/DELTA-\d/, 'DELTA-041'], [/\bNK\b/, 'avatar "NK"'], [/પગાર|જુલાઈ પહેલાં/, 'પગાર ૨૬ જુલાઈ પહેલાં આવશે.'],
];
const SOURCES_5A = ['components/gov5/MgnregaViews.tsx', 'app/mgnrega/page.tsx', 'features/gov5/refusals.ts'];

describe('PC-56 GOV-5a · the claims guard (gov5. scope)', () => {
  it.each(GUARDS.map((g) => [g[0], g] as const))('the guard "%s" matches the canon phrase it exists to stop', (_n, g) => {
    expect(g[1].test(g[2])).toBe(true);
  });
  it.each(BRAND.map((b) => [String(b[0]), b] as const))('the brand guard %s matches its canon fixture', (_n, b) => {
    expect(b[0].test(b[1])).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no gov5. value trips a guard or a brand regex', (_l, cat) => {
    const vals = scoped(cat as Record<string, string>);
    expect(vals.length).toBe(81);   // GOV-5a
    for (const [k, v] of vals) {
      for (const [name, re, , exempt] of GUARDS) if (!(exempt ?? []).includes(k)) expect([k, name, re.test(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('every exempted key exists and says no in English', () => {
    const NEG = /\b(no|not|never|nothing|cannot|only)\b|n't\b/i;
    for (const [, , , exempt] of GUARDS) for (const k of exempt ?? []) expect([k, typeof en[k], NEG.test(en[k] ?? '')]).toEqual([k, 'string', true]);
    for (const k of READS) expect(NEG.test(en[k])).toBe(true);
  });
  it('Q3-A, Q2-A, Q1-A and the download sentence verbatim (en); Q4-A\'s sentence is not in any catalogue', () => {
    expect(en['gov5.q3']).toBe('MGNREGA\'s register is NREGASoft. This console records no work demand and does not connect to NREGASoft.');
    expect(en['gov5.q2']).toBe('This console shows no job card, worker, household, attendance or worksite.');
    expect(en['gov5.q1']).toBe('This console shows no wage or payment figure.');
    expect(en['gov5.download']).toBe('Nothing on this page can be downloaded.');
    expect('gov5.q4' in en || 'gov5.q4' in hi || 'gov5.q4' in gu).toBe(false);
  });
  it('the three sentences and the download sentence carry their meaning in hi and gu (each its own language)', () => {
    expect(/मनरेगा का रजिस्टर NREGASoft है/.test(hi['gov5.q3']) && /माँग दर्ज नहीं करता/.test(hi['gov5.q3']) && /NREGASoft से नहीं जुड़ता/.test(hi['gov5.q3'])).toBe(true);
    expect(/મનરેગાનું રજિસ્ટર NREGASoft છે/.test(gu['gov5.q3']) && /માંગ નોંધતું નથી/.test(gu['gov5.q3']) && /NREGASoft સાથે જોડાતું નથી/.test(gu['gov5.q3'])).toBe(true);
    expect(/जॉब कार्ड/.test(hi['gov5.q2']) && /मज़दूर/.test(hi['gov5.q2']) && /परिवार/.test(hi['gov5.q2']) && /हाज़िरी/.test(hi['gov5.q2']) && /कार्यस्थल/.test(hi['gov5.q2']) && /नहीं दिखाता/.test(hi['gov5.q2'])).toBe(true);
    expect(/જોબ કાર્ડ/.test(gu['gov5.q2']) && /શ્રમિક/.test(gu['gov5.q2']) && /પરિવાર/.test(gu['gov5.q2']) && /હાજરી/.test(gu['gov5.q2']) && /કાર્યસ્થળ/.test(gu['gov5.q2']) && /બતાવતું નથી/.test(gu['gov5.q2'])).toBe(true);
    expect(/मज़दूरी या भुगतान/.test(hi['gov5.q1']) && /नहीं दिखाता/.test(hi['gov5.q1'])).toBe(true);
    expect(/વેતન કે ચુકવણી/.test(gu['gov5.q1']) && /બતાવતું નથી/.test(gu['gov5.q1'])).toBe(true);
    expect(/डाउनलोड नहीं/.test(hi['gov5.download']) && /ડાઉનલોડ કરી શકાતું નથી/.test(gu['gov5.download'])).toBe(true);
    for (const cat of [hi, gu]) for (const k of ['gov5.q1', 'gov5.q2', 'gov5.q3', 'gov5.download']) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
  });
  it('no GOV-5a source (nor the registry) carries a canon person, body, place, number or reference', () => {
    for (const rel of SOURCES_5A) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
