// apps/web-gov/src/test/claims-guard.spec.ts · PC-56 GOV-1a (survey_gov1.md E8) — the CLAIMS GUARD for the government console, `gov1.` scope (the
// web-ops / web-partner shape). Each regex is first PROVEN on the canon phrase it exists to stop (so a regex that matches nothing cannot pass
// silently), then asserted against every `gov1.` value (and the console's nav labels and the sign-in title) in en, hi and gu. The refusals
// are worded so the canon's words never appear even in the negative — the guard is a plain match, except where a named exemption is listed.
// The lead-drafted sentences are PINNED verbatim (Q4-A whole; Q5-A's TRUE half only — its second sentence must NOT be printed). Plus a
// BRAND guard: no canon person, body, place or mailbox in any `gov1.` value or in a GOV-1a source.
// PC-56 GOV-1b (brief §E, E8): the 1b regexes — `season`, `target`, `district`, `SLA`, `%`, `approval rate`, `emblem` (except the refusal),
// `GIGW`, `certif` (except the refusal), `PFMS`, `confirmed by`, `pay on time` — each proven on its W325 / W358 phrase; plus the money and
// ranking words of W325 (₹ / rupee / INR, average, median, flagged). `PFMS` has NO exemption: Q1-A's sentence is not printed (the government
// axis cannot read credits — GOV-0 0239 grants kv_gov nothing on dbt_transfers). Q3-A's sentence pinned verbatim.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const EXTRA = ['nav.brand', 'nav.dashboard', 'nav.signOut', 'login.title', 'login.sendOtp', 'login.otpLabel', 'dash.title'];
const scoped = (cat: Record<string, string>) => Object.entries(cat).filter(([k]) => k.startsWith('gov1.') || EXTRA.includes(k));

/** [name, regex, the canon phrase it is proven on, keys exempt (a refusal that must name the thing to refuse it)] */
const GUARDS: ReadonlyArray<[string, RegExp, string, string[]?]> = [
  ['SSO', /\bSSO\b|single sign-on/i, 'Sign in with government SSO (e-Pramaan / departmental)'],
  ['e-Pramaan', /e-?Pramaan/i, 'Sign in with government SSO (e-Pramaan / departmental)'],
  ['departmental', /department/i, 'Departmental credentials (fallback, being retired)'],
  ['Official ID', /official id/i, 'Official ID'],
  ['hardware', /hardware/i, 'additionally needs your hardware security key'],
  ['security key', /security key/i, 'additionally needs your hardware security key'],
  ['step-up', /step-?up/i, 'Step-up rule: viewing needs sign-in'],
  ['release', /releas/i, 'RELEASING MONEY (FTO sign-off, batch release)'],
  ['FTO', /\bFTO\b/, 'FTO sign-off'],
  ['PFMS', /PFMS/, 'every number below walks back to an application or a PFMS reference'],
  ['confirmed by', /confirmed by/i, '13,802 credits confirmed by PFMS'],
  ['season', /season/i, 'Applications this season'],
  ['target', /target/i, 'target ≤ 10'],
  ['district', /district/i, 'slowest district 11.4'],
  ['SLA', /\bSLA\b/, 'SLA 14d'],
  ['%', /%/, 'Approval rate 80.0%'],
  ['fixable', /fixable/i, '3,102 fixable-reason'],
  ['approval rate', /approval rate/i, 'Approval rate 80.0%'],
  ['emblem', /emblem/i, 'authority emblem slot', ['gov1.refusal.authShell', 'gov1.refusal.emblem']],
  ['GIGW', /GIGW/, 'aligned to GIGW guidance'],
  ['certif', /certif/i, 'formal GIGW conformance audit'.replace('audit', 'certification'), ['gov1.refusal.accessibilityClaim']],
  ['pay on time', /pay on time/i, 'work in the villager\'s language and pay on time'],
  ['two-person', /two-person/i, 'Theme changes are two-person'],
  ['maker-checker', /maker-?checker/i, 'Granting is maker-checker'],
  ['regulator', /regulator/i, 'External grants (regulators, auditors)'],
  ['auditor', /auditor/i, 'External grants (regulators, auditors)'],
  ['extracts', /extracts/i, '22 extracts this period'],
  ['renewed late', /renewed late/i, 'a "renewed late" mark forever'],
  ['review date (affirmative)', /carries .*review date/i, 'every role and every external grant carries an expiry, an approver, and a review date'],
  ['on-call', /on-call/i, 'repeated failures page the on-call.'],
  ['zero-sum', /zero-sum/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows'],
  ['reconcile', /reconcil/i, 'Money-adjacent actions reconcile zero-sum before this page ever shows'],
  ['audit trail', /audit trail/i, 'View audit trail'],
  ['device', /device/i, 'is recorded with device and origin.'],
  ['stored grants', /stored grants/i, 'Active sessions continue under their stored grants'],
  ['plan settings', /plan settings/i, 'Nothing is broken — it is not enabled. See plan settings.'],
  ['authorised officials only', /authori[sz]ed (government )?officials only/i, 'For authorised government officials only.'],
  // ── GOV-1b · W325 / W358 (the money and ranking words, and the 1b phrases of the regexes above) ──
  ['season (W325)', /season/i, 'Disbursed this season (DBT)'],
  ['target (W325)', /target/i, 'Median decision time 6.2 days · target ≤ 10'],
  ['district (W325)', /district/i, 'slowest district 11.4 (Dahod — flagged)'],
  ['SLA (W325)', /\bSLA\b/, 'its SLA is tracked as hard as approvals'],
  ['% (W325)', /%/, '24,187 decided (77%)'],
  ['rupee', /₹|\bINR\b|rupee/i, 'Disbursed this season (DBT) ₹22,85,61,120'],
  ['average', /\bavg\b|average/i, 'avg ₹16,560 (avg 1.15 ha, instalment 1 at v2 rates)'],
  ['median', /median/i, 'Median decision time 6.2 days'],
  ['flagged', /flagged/i, 'slowest district 11.4 (Dahod — flagged)'],
  ['confirmed by (W325)', /confirmed by/i, '13,802 credits confirmed by PFMS'],
  ['PFMS (W325)', /PFMS/, 'every number below walks back to an application or a PFMS reference'],
  ['GIGW (W358)', /GIGW/, 'formal GIGW conformance audit: backend/process-pending'],
  ['pay on time (W358)', /pay on time/i, 'The most patriotic thing a government screen can do is work in the villager\'s language and pay on time.'],
  ['successful or not (Q5 second half)', /successful or not/i, 'Every sign-in, successful or not, is recorded with the time and the network address it came from.'],
];
const BRAND: ReadonlyArray<[RegExp, string]> = [
  [/Directorate/i, 'Directorate of Agriculture, Gujarat'], [/Gujarat/i, 'Directorate of Agriculture, Gujarat'], [/GMISS/i, 'GMISS-2026'], [/Dahod/i, 'slowest district 11.4 (Dahod — flagged)'],
  [/Trivedi/i, 'R. Trivedi'], [/Christian/i, 'A. Christian'], [/Chauhan/i, 'V. Chauhan'], [/Damor/i, 'M. Damor'], [/Kapadia/i, 'Dr. D. Kapadia'], [/Rathva/i, 'B. Rathva'],
  [/\bDK\b/, 'avatar "DK"'], [/gov-support@/i, 'helpdesk for officials: gov-support@krishalaya.in'], [/e-?Pramaan/i, 'e-Pramaan'],
  [/કૃષિ નિયામક/, 'કૃષિ નિયામકની કચેરી, ગુજરાત'], [/कृषि निदेशालय/, 'कृषि निदेशालय, गुजरात'],
];
const SOURCES_1A = ['components/gov1/LoginViews.tsx', 'components/gov1/AccessViews.tsx', 'components/gov1/Gov1Chain.tsx', 'components/gov1/GovShell.tsx', 'components/Sidebar.tsx',
  'features/gov1/login.ts', 'features/gov1/access.ts', 'features/gov1/persona.ts', 'app/login/page.tsx', 'app/login/actions.ts', 'app/access/page.tsx',
  'app/access/actions.ts', 'app/dashboard/page.tsx', 'app/layout.tsx', 'lib/session.ts'];   // (the render fixtures hold the guard regex itself)
const SOURCES_1B = ['components/gov1/DashboardViews.tsx', 'features/gov1/dashboard.ts', 'app/canon/chrome/page.tsx'];   // (refusals.ts quotes the canon, anonymised in brackets)

describe('PC-56 GOV-1a · the claims guard (gov1. scope)', () => {
  it.each(GUARDS.map((g) => [g[0], g] as const))('the guard "%s" matches the canon phrase it exists to stop', (_n, g) => {
    expect(g[1].test(g[2])).toBe(true);
  });
  it.each(BRAND.map((b) => [String(b[0]), b] as const))('the brand guard %s matches its canon fixture', (_n, b) => {
    expect(b[0].test(b[1])).toBe(true);
  });
  it.each(Object.entries(CATS))('%s: no gov1. value (or the console\'s nav and sign-in labels) trips a guard or a brand regex', (_l, cat) => {
    const vals = scoped(cat);
    expect(vals.length).toBeGreaterThan(150);
    for (const [k, v] of vals) {
      for (const [name, re, , exempt] of GUARDS) if (!(exempt ?? []).includes(k)) expect([k, name, re.test(v)]).toEqual([k, name, false]);
      for (const [re] of BRAND) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    }
  });
  it('the lead-drafted sentences, pinned: Q4-A verbatim; Q5-A\'s TRUE half verbatim; the true facts beside them', () => {
    expect(en['gov1.access.q4']).toBe('Every role here ends on its date. A role is granted only when a second person approves it — never by the person asking. Anyone who grants roles can remove one at once; every change is recorded.');
    expect(en['gov1.login.q5']).toBe('Sign in with the code sent to your phone, then the code from your authenticator app.');
    expect(en['gov1.access.onlyYou']).toBe('No one else here can approve a request yet.');
    expect(en['gov1.access.firstHead']).toBe('An authority\'s first head is appointed by the platform.');
    expect(en['gov1.refusal.signInRecord']).toBe('Wrong codes and completed sign-ins are recorded with the time. The network address recorded is this console\'s own server, not yours. A sign-in refused because the phone holds no role here is not recorded.');
  });
  it('GOV-1b · Q3-A verbatim (both clauses are GOV-0\'s), the counts-only fact beside it; Q1-A\'s sentence NOT printed in any catalogue', () => {
    expect(en['gov1.dash.q3']).toBe('This console shows applications made to your authority\'s schemes. Every time one is opened, it is recorded.');
    expect(en['gov1.dash.countsOnly']).toBe('This page shows counts only. It opens no application, so it records no read.');
    expect(en['gov1.dash.defineRefused']).toBe('Schemes are written by the platform\'s team, not from this console.');
    expect([/आवेदन/.test(hi['gov1.dash.q3']) && /दर्ज/.test(hi['gov1.dash.q3']) && /खोला/.test(hi['gov1.dash.q3']),
      /અરજી/.test(gu['gov1.dash.q3']) && /નોંધાય/.test(gu['gov1.dash.q3']) && /ખોલ/.test(gu['gov1.dash.q3'])]).toEqual([true, true]);
    for (const cat of [en, hi, gu]) for (const [k, v] of scoped(cat)) {
      expect([k, /Credits recorded on this platform|typed by officers|PFMS/.test(v)]).toEqual([k, false]);
    }
    expect('gov1.dash.rebuilt' in en || 'gov1.dash.rebuilt' in hi || 'gov1.dash.rebuilt' in gu).toBe(false);
  });
  it('GOV-1b · the emblem refusal names the Act; the certificate refusal says none was obtained', () => {
    expect(en['gov1.refusal.emblem']).toContain('the State Emblem of India (Prohibition of Improper Use) Act, 2005');
    expect(en['gov1.refusal.emblem']).toMatch(/^This console never shows/);
    expect(en['gov1.refusal.accessibilityClaim']).toMatch(/^No government accessibility certificate has been obtained/);
  });
  it('Q5-A and Q4-A in hi and gu carry their meaning (phone code THEN authenticator; an end date, a second person, one person removes, recorded)', () => {
    expect([/फ़ोन/.test(hi['gov1.login.q5']) && /फिर/.test(hi['gov1.login.q5']) && /ऑथेंटिकेटर/.test(hi['gov1.login.q5']),
      /ફોન/.test(gu['gov1.login.q5']) && /પછી/.test(gu['gov1.login.q5']) && /ઓથેન્ટિકેટર/.test(gu['gov1.login.q5'])]).toEqual([true, true]);
    expect([/तिथि/.test(hi['gov1.access.q4']) && /दूसरा व्यक्ति/.test(hi['gov1.access.q4']) && /तुरंत/.test(hi['gov1.access.q4']) && /दर्ज/.test(hi['gov1.access.q4']),
      /તારીખે/.test(gu['gov1.access.q4']) && /બીજી વ્યક્તિ/.test(gu['gov1.access.q4']) && /તરત/.test(gu['gov1.access.q4']) && /નોંધાય/.test(gu['gov1.access.q4'])]).toEqual([true, true]);
    for (const cat of [hi, gu]) expect(/successful|सफल हो या|સફળ હોય/.test(cat['gov1.login.q5'])).toBe(false);
  });
  it('the survey-E9 honesty keys are gone in all three catalogues (and the wave map with them)', () => {
    for (const cat of [en, hi, gu]) for (const k of ['login.phoneHint', 'dash.honesty', 'dash.live', 'dash.hint', 'dash.wave.schemes', 'dash.wave.dbt', 'dash.wave.regulator', 'dash.wave.verification', 'dash.wave.mgnrega'])
      expect([k, k in cat]).toEqual([k, false]);
    expect([hi['nav.brand'], gu['nav.brand']]).toEqual(['कृषालय सरकारी कंसोल', 'કૃષાલય સરકારી કન્સોલ']);   // translated, not transliterated
  });
  it('no GOV-1a or GOV-1b source carries a canon person, body, place or mailbox', () => {
    for (const rel of [...SOURCES_1A, ...SOURCES_1B]) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      for (const [re] of BRAND) expect([rel, String(re), re.test(src)]).toEqual([rel, String(re), false]);
    }
  });
});
