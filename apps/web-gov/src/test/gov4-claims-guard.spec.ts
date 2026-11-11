// apps/web-gov/src/test/gov4-claims-guard.spec.ts · PC-56 GOV-4a (survey_gov4.md E7) — the CLAIMS GUARD for the field visits page, `gov4.` scope
// (the gov3 shape). Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that matches nothing cannot pass silently),
// then asserted against every `gov4.` value in en, hi and gu — Q1's sentence alone may say "photo", "video", "phone" and "documents" (it says
// the console never shows them), Q3's alone "flag" (it says the console does not). Q1-A, Q2-A, Q3-A, Q5-A and the download sentence are PINNED
// verbatim in English and by meaning in hi and gu. Plus a BRAND guard: no canon person, body, place, number or reference in any `gov4.` value
// or GOV-4a source. GOV-4b adds W356's guards (each proven on its canon phrase — the "device" guard on W337's, the only canon phrase that
// names one), Q4-A pinned verbatim in English and by meaning in hi and gu, and its sources to the brand guard.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('gov4.'));

/** [name, regex, the canon phrase it is proven on, keys exempt] */
const GUARDS: ReadonlyArray<[string, RegExp, string, string[]?]> = [
  ['verified', /verified|verification passed|\bverif/i, 'Supervisor review — completed verifications'],
  ['geotag', /geotag/i, 'photo 1 · geotag ✓ · 09:44'],
  ['GPS', /\bGPS\b/, 'GPS walk result 1.44 ha'],
  ['walk', /\bwalk/i, 'walk trace attached'],
  ['trace', /\btrace\b/i, 'walk trace attached'],
  ['polygon', /polygon/i, 'Geotags are checked against the parcel polygon on sync'],
  ['parcel', /parcel/i, 'geotag 380 m off parcel'],
  ['photo', /photo/i, 'photos taken from the road', ['gov4.q1']],
  ['video', /video/i, 'video 0:22', ['gov4.q1']],
  ['OTP', /\bOTP\b/, 'Submit — needs farmer OTP'],
  ['phone', /phone/i, 'OTP goes to the FARMER\'s registered phone', ['gov4.q1']],
  ['7/12', /7\/12/, '7/12 ref SR-JND-51••2'],
  ['land record', /land record|land-record/i, 'a land record reference'],
  ['beat', /\bbeat/i, 'Assign by beat'],
  ['taluka', /taluka/i, 'Junagadh taluka'],
  ['supervisor', /supervisor/i, 'Supervisor review'],
  ['coaching', /coaching/i, 'officer coaching, farmer paid on true 1.82'],
  ['flag', /\bflag/i, 'pattern flag (signals-not-verdicts)', ['gov4.q3']],
  ['workload', /workload|fairness/i, 'Officer workload — fairness view'],
  ['re-check', /re-?check/i, '10% random re-checks + every flag'],
  ['km', /\bkm\b/i, 'route km within 15% of each other'],
  ['offline', /offline/i, 'offline-capable'],
  ['sync', /\bsync/i, 'syncs from the road'],
  ['draft', /draft/i, 'Save draft'],
  ['instalment', /instal?ment|\binst-\d/i, 'Site visits that release instalment 2'],
  ['₹', /₹|\bINR\b|rupee|\bcrore\b|\blakh\b/i, 'Money these visits release ₹3,18,81,600'],
  ['%', /%/, '1.44 ha vs 1.5 approved (96%)'],
  ['batch', /batch/i, 'joins the NEXT daily batch'],
  ['SSO', /\bSSO\b/, 'government SSO'],
  ['hardware key', /hardware key|security key/i, 'step-up: hardware key at batch release'],
  ['step-up', /step-up/i, 'step-up: hardware key at batch release'],
  ['regulator', /regulator/i, 'regulator, dual grant'],
  ['IP', /\bIP\b/, 'Gandhinagar office IP range'],
  ['RTI', /\bRTI\b/, 'Signed export (RTI-ready)'],
  ['never locked', /never locked/i, 'account never locked'],
  ['export', /export/i, 'Export week (audit-stamped)'],
  ['zero-sum', /zero-sum/i, 'Money-adjacent actions reconcile zero-sum'],
  ['on-call', /on-call/i, 'repeated failures page the on-call.'],
  ['audit trail', /audit trail|audit-stamped/i, 'View audit trail'],
  ['site visit', /site visit/i, 'Awaiting site visit 2,214'],
  ['pairing', /same-village|pair automatically/i, 'Same-village visits pair automatically'],
  ['queue clear', /queue clear|target state/i, 'Queue clear — the target state'],
  ['earning trust', /earning its trust/i, 'the system is earning its trust'],
  // ── GOV-4b · W356 (the access & session audit) ──
  ['device', /device/i, 'Only the assigned officer\'s device can capture', ['gov4.refusal.noDevice', 'gov4.refusal.noSignInDevice']],
  ['location', /out-of-state|\blocation|office [^·]*range/i, 'fallback credentials · out-of-state IP'],
  ['suspicious', /suspicious|who knocks|often the finding/i, 'the pattern of who KNOCKS is often the finding'],
  ['throttled', /throttl/i, 'sign-in attempt ×3 · failed · throttled'],
  ['fallback', /fallback|dept\b/i, 'unknown (ID pattern: dept fallback) · fallback credentials'],
  ['security desk', /security desk|paged independently/i, 'security desk paged independently of throttling'],
  ['waits longer', /waits longer|longer than the last/i, 'each retry waits longer than the last'],
  ['append-only', /append-only/i, 'Both are append-only.'],
  ['data room', /data room|signed extract/i, 'signed extract requested (data room)'],
  ['dual grant', /dual grant|both sides/i, 'S••• O. (regulator, dual grant) · logged to both sides'],
  ['readable by all', /watching the watchers|readable by all/i, 'Readable by all officials — watching the watchers is the design'],
  ['own trail', /own trail|on their profile/i, 'Officials see their own trail on their profile'],
  ['who got in', /who got in|who tried/i, 'Access & session audit — who got in, who tried'],
  ['access events', /access events/i, 'Showing 1–25 of 12,847 access events (90 days)'],
  ['dry-run viewed', /dry-run|viewed \(/i, 'dry-run viewed (draft v3) — logged per W328 rule'],
];
const BRAND: ReadonlyArray<[RegExp, string]> = [
  [/Directorate/i, 'Directorate of Agriculture'], [/Gujarat/i, 'Gujarat · state authority'], [/Junagadh/i, 'Junagadh taluka'], [/Bhesan/i, 'Bhesan'],
  [/Vanthali/i, 'Vanthali'], [/Keshod/i, 'Keshod'], [/Gandhinagar/i, 'Gandhinagar office IP range'], [/Chauhan/i, 'V. Chauhan'], [/Damor/i, 'M. Damor'],
  [/Solanki/i, 'P. Solanki'], [/Rathva/i, 'B. Rathva'], [/Trivedi/i, 'R. Trivedi'], [/Kapadia/i, 'Dr. D. Kapadia'], [/GM26-/i, 'GM26-096233'],
  [/SR-JND/i, 'SR-JND-51••2'], [/DBT-\d/i, 'DBT-0713-2'], [/\bDK\b/, 'avatar "DK"'], [/[A-Z]••• [A-Z]\./, 'H••• V.'], [/\+91/, '+91 97••• ••214'],
  [/DELTA-\d/, 'DELTA-040'], [/W-D29|\bW318\b|\bW328\b/, 'the W-D29 rule'],
];
const SOURCES_4A = ['components/gov4/VerificationViews.tsx', 'app/verification/page.tsx', 'features/gov4/refusals.ts'];
const SOURCES_4B = ['components/gov4/SignInsViews.tsx', 'components/gov1/AccessViews.tsx', 'app/access/page.tsx'];

describe('PC-56 GOV-4a · the claims guard (gov4. scope)', () => {
  it.each(GUARDS.map((g) => [g[0], g] as const))('the guard "%s" matches the canon phrase it exists to stop', (_n, g) => {
    expect(g[1].test(g[2])).toBe(true);
  });
  it.each(BRAND.map((b) => [String(b[0]), b] as const))('the brand guard %s matches its canon fixture', (_n, b) => {
    expect(b[0].test(b[1])).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no gov4. value trips a guard or a brand regex', (_l, cat) => {
    const vals = scoped(cat as Record<string, string>);
    expect(vals.length).toBe(82);   // GOV-4a 57 + GOV-4b 25
    for (const [k, v] of vals) {
      for (const [name, re, , exempt] of GUARDS) if (!(exempt ?? []).includes(k)) expect([k, name, re.test(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('Q2-A, Q1-A, Q3-A, Q5-A and the download sentence verbatim (en)', () => {
    expect(en['gov4.q2']).toBe('Field visits are not scheduled or recorded on this platform. Checking an application here is a desk check, not a visit to the farm.');
    expect(en['gov4.q1']).toBe('This console never shows where a farm is, photos or videos from a farm, identity or land documents, or a farmer\'s phone number.');
    expect(en['gov4.q3']).toBe('This console does not rank, flag or score officials.');
    expect(en['gov4.q5']).toBe('A field visit changes no payment. Benefits are paid by PFMS and the banks, outside this platform.');
    expect(en['gov4.download']).toBe('Nothing on this page can be downloaded.');
  });
  it('GOV-4b · Q4-A verbatim (en); the lock said without "never locked" and without a number; the sign-ins download sentence', () => {
    expect(en['gov4.q4']).toBe('Each sign-in to this console is recorded by the platform. This console does not list sign-ins, and it never shows where anyone signed in from.');
    expect(en['gov4.signins.lock']).toBe('After too many wrong codes, no code is taken for a while; the sign-in page says how many minutes to wait.');
    expect(en['gov4.signins.download']).toBe('Sign-ins cannot be downloaded from this console.');
    for (const cat of Object.values(CATS)) for (const [k, v] of scoped(cat as Record<string, string>)) expect([k, /never locked|not locked|\bunlocked\b/i.test(v)]).toEqual([k, false]);
    for (const cat of Object.values(CATS)) expect(/\d/.test((cat as Record<string, string>)['gov4.signins.lock'])).toBe(false);
  });
  it('GOV-4b · Q4-A carries its meaning in hi and gu (each its own language)', () => {
    expect(/हर साइन इन/.test(hi['gov4.q4']) && /दर्ज किया जाता/.test(hi['gov4.q4']) && /सूची नहीं दिखाता/.test(hi['gov4.q4']) && /कभी नहीं दिखाता कि किसी ने कहाँ से/.test(hi['gov4.q4'])).toBe(true);
    expect(/દરેક સાઇન ઇન/.test(gu['gov4.q4']) && /નોંધાય છે/.test(gu['gov4.q4']) && /યાદી બતાવતું નથી/.test(gu['gov4.q4']) && /ક્યાંથી સાઇન ઇન કર્યું તે ક્યારેય બતાવતું નથી/.test(gu['gov4.q4'])).toBe(true);
    expect(/डाउनलोड नहीं/.test(hi['gov4.signins.download']) && /ડાઉનલોડ કરી શકાતી નથી/.test(gu['gov4.signins.download'])).toBe(true);
    for (const cat of [hi, gu]) for (const k of ['gov4.q4', 'gov4.signins.lock', 'gov4.signins.download']) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
  });
  it('the four sentences and the download sentence carry their meaning in hi and gu (each its own language)', () => {
    expect(/खेत निरीक्षण/.test(hi['gov4.q2']) && /न तय किए जाते/.test(hi['gov4.q2']) && /न दर्ज किए जाते/.test(hi['gov4.q2']) && /खेत का दौरा नहीं/.test(hi['gov4.q2'])).toBe(true);
    expect(/ખેતર મુલાકાતો/.test(gu['gov4.q2']) && /ન તો નક્કી થાય/.test(gu['gov4.q2']) && /ન નોંધાય/.test(gu['gov4.q2']) && /ખેતરની મુલાકાત નહીં/.test(gu['gov4.q2'])).toBe(true);
    expect(/कभी नहीं दिखाता/.test(hi['gov4.q1']) && /खेत कहाँ है/.test(hi['gov4.q1']) && /तस्वीरें या वीडियो/.test(hi['gov4.q1']) && /दस्तावेज़/.test(hi['gov4.q1']) && /फ़ोन नंबर/.test(hi['gov4.q1'])).toBe(true);
    expect(/ક્યારેય બતાવતું નથી/.test(gu['gov4.q1']) && /ખેતર ક્યાં છે/.test(gu['gov4.q1']) && /ફોટા કે વીડિયો/.test(gu['gov4.q1']) && /દસ્તાવેજો/.test(gu['gov4.q1']) && /ફોન નંબર/.test(gu['gov4.q1'])).toBe(true);
    expect(/क्रम/.test(hi['gov4.q3']) && /चिह्नित/.test(hi['gov4.q3']) && /अंक/.test(hi['gov4.q3'])).toBe(true);
    expect(/ક્રમ/.test(gu['gov4.q3']) && /ચિહ્નિત/.test(gu['gov4.q3']) && /ગુણ/.test(gu['gov4.q3'])).toBe(true);
    expect(/कोई भुगतान नहीं बदलता/.test(hi['gov4.q5']) && /PFMS और बैंक/.test(hi['gov4.q5']) && /प्लेटफ़ॉर्म के बाहर/.test(hi['gov4.q5'])).toBe(true);
    expect(/કોઈ ચુકવણી બદલાતી નથી/.test(gu['gov4.q5']) && /PFMS અને બેંકો/.test(gu['gov4.q5']) && /પ્લેટફોર્મની બહાર/.test(gu['gov4.q5'])).toBe(true);
    expect(/डाउनलोड नहीं/.test(hi['gov4.download']) && /ડાઉનલોડ કરી શકાતું નથી/.test(gu['gov4.download'])).toBe(true);
    for (const cat of [hi, gu]) for (const k of ['gov4.q1', 'gov4.q2', 'gov4.q3', 'gov4.q5', 'gov4.download']) expect([k, cat[k] !== en[k]]).toEqual([k, true]);
  });
  it('no GOV-4a source (nor the registry) carries a canon person, body, place, number or reference', () => {
    for (const rel of [...SOURCES_4A, ...SOURCES_4B]) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
