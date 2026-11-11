// apps/web-gov/src/test/gov6-refusals.spec.ts · PC-56 GOV-6a · E5 — the GOV-6 registry (features/gov6/refusals.ts): ALL 35 canon files, one
// verdict each (6a's 16 and — NAMED UPDATE, PC-56 GOV-6b — 6b's 19: 35 decided, 0 pending; `pending_6b` deleted from the type); the 28
// chain files in exactly one of TEN groups each; every group built by ONE chain, on the page that opens it (6a /dashboard, 6b /access);
// every refusal / chain / section key in en, hi and gu; every surface prints a refusal; every English refusal and "not counted / not done"
// item says no; the canon quotes anonymised; GOV-1b's analytics refusal and GOV-2's record refusal named-updated.
import { GOV6_CANON_FILES, GOV6_CHAIN_GROUPS, GOV6_CHAINS, GOV6_DELTAS, GOV6_REFUSALS, GOV6_SECTIONS_6A, GOV6_SECTIONS_6B, ACCESS_BACK, DASHBOARD_BACK, SURFACES_6A, SURFACES_6B } from '../features/gov6/refusals';
import { GOV1_REFUSALS } from '../features/gov1/refusals';
import { GOV2_REFUSALS } from '../features/gov2/refusals';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATS = { en, hi, gu } as const;
const DECIDED = ['BUILT (honest)', 'BUILT (read)', 'REAL', 'PARITY-DECOR', 'DECOR'];
const code = (f: string) => f.split('-')[0];

describe('PC-56 GOV-6 · the registry', () => {
  it('35 canon files, each once, one verdict; 16 decided (6a) + 19 decided (6b) = 35 decided, 0 pending (NAMED UPDATE, GOV-6b)', () => {
    expect(GOV6_CANON_FILES).toHaveLength(35);
    expect(new Set(GOV6_CANON_FILES.map((f) => f.file)).size).toBe(35);
    const a = GOV6_CANON_FILES.filter((f) => f.wave === '6a'); const b = GOV6_CANON_FILES.filter((f) => f.wave === '6b');
    expect([a.length, b.length]).toEqual([16, 19]);
    expect(a.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(b.every((f) => DECIDED.includes(f.verdict))).toBe(true);
    expect(GOV6_CANON_FILES.filter((f) => DECIDED.includes(f.verdict))).toHaveLength(35);
    expect(GOV6_CANON_FILES.filter((f) => !DECIDED.includes(f.verdict))).toHaveLength(0);
    expect(/pending_6b/.test(fs.readFileSync(path.join(__dirname, '..', 'features', 'gov6', 'refusals.ts'), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n'))).toBe(false);   // the 4c-7 rule: the value is gone
    expect(Object.fromEntries(b.map((f) => [code(f.file), f.verdict]))).toEqual({
      W334: 'BUILT (honest)', W351: 'BUILT (honest)', W352: 'BUILT (honest)', W353: 'BUILT (honest)', W354: 'BUILT (honest)',
      W3206: 'DECOR', W3207: 'DECOR', W3208: 'PARITY-DECOR', W3209: 'PARITY-DECOR', W3210: 'PARITY-DECOR',
      W3244: 'DECOR', W3245: 'DECOR', W3246: 'DECOR', W3247: 'DECOR', W3248: 'DECOR', W3249: 'DECOR', W3250: 'PARITY-DECOR', W3251: 'PARITY-DECOR', W3252: 'PARITY-DECOR',
    });
    // survey §1 tally for 6b: BUILT (honest) 5, DECOR 8, PARITY-DECOR 6; for all 35: 7 / 16 / 12
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => b.filter((f) => f.verdict === v).length)).toEqual([5, 8, 6]);
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => GOV6_CANON_FILES.filter((f) => f.verdict === v).length)).toEqual([7, 16, 12]);
    expect(Object.fromEntries(a.map((f) => [code(f.file), f.verdict]))).toEqual({
      W333: 'BUILT (honest)', W357: 'BUILT (honest)',
      W3201: 'DECOR', W3202: 'DECOR', W3203: 'PARITY-DECOR', W3204: 'PARITY-DECOR', W3205: 'PARITY-DECOR',
      W3253: 'DECOR', W3254: 'DECOR', W3255: 'DECOR', W3256: 'DECOR', W3257: 'DECOR', W3258: 'DECOR', W3259: 'PARITY-DECOR', W3260: 'PARITY-DECOR', W3261: 'PARITY-DECOR',
    });
    expect(b.map((f) => code(f.file)).sort()).toEqual(['W3206', 'W3207', 'W3208', 'W3209', 'W3210', 'W3244', 'W3245', 'W3246', 'W3247', 'W3248', 'W3249', 'W3250', 'W3251', 'W3252', 'W334', 'W351', 'W352', 'W353', 'W354']);
    // survey §1 tally for 6a: BUILT (honest) 2, DECOR 8, PARITY-DECOR 6
    expect(['BUILT (honest)', 'DECOR', 'PARITY-DECOR'].map((v) => a.filter((f) => f.verdict === v).length)).toEqual([2, 8, 6]);
  });
  it('the 35 are exactly the survey\'s §C list (the gate\'s uncovered set)', () => {
    expect(GOV6_CANON_FILES.map((f) => f.file).sort()).toEqual([
      'W333-gov-analytics.html', 'W334-gov-audit.html', 'W351-gov-regulator-home.html', 'W352-gov-regulator-lending.html', 'W353-gov-regulator-insurance.html',
      'W354-gov-regulator-exports.html', 'W357-gov-reports.html', 'W3201-gov-analytics-export-queued.html', 'W3202-gov-analytics-export-ready.html',
      'W3203-gov-analytics-mutate-confirm.html', 'W3204-gov-analytics-mutate-success.html', 'W3205-gov-analytics-mutate-failure.html', 'W3206-gov-audit-export-queued.html',
      'W3207-gov-audit-export-ready.html', 'W3208-gov-audit-mutate-confirm.html', 'W3209-gov-audit-mutate-success.html', 'W3210-gov-audit-mutate-failure.html',
      'W3244-gov-regulator-export-queued.html', 'W3245-gov-regulator-export-ready.html', 'W3246-gov-regulator-form-form-error.html', 'W3247-gov-regulator-form-review.html',
      'W3248-gov-regulator-form-success.html', 'W3249-gov-regulator-form-failure.html', 'W3250-gov-regulator-mutate-confirm.html', 'W3251-gov-regulator-mutate-success.html',
      'W3252-gov-regulator-mutate-failure.html', 'W3253-gov-report-export-queued.html', 'W3254-gov-report-export-ready.html', 'W3255-gov-report-form-form-error.html',
      'W3256-gov-report-form-review.html', 'W3257-gov-report-form-success.html', 'W3258-gov-report-form-failure.html', 'W3259-gov-report-mutate-confirm.html',
      'W3260-gov-report-mutate-success.html', 'W3261-gov-report-mutate-failure.html',
    ].sort());
  });
  it('28 chain files in 10 groups (the canon\'s route comments), each file exactly once, each in a group of its own wave; 7 real screens', () => {
    expect(GOV6_CHAIN_GROUPS).toHaveLength(10);
    const all = GOV6_CHAIN_GROUPS.flatMap((g) => g.files);
    expect(all).toHaveLength(28); expect(new Set(all).size).toBe(28);
    for (const g of GOV6_CHAIN_GROUPS) for (const f of g.files) expect([f, GOV6_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.wave]).toEqual([f, g.wave]);
    expect(GOV6_CANON_FILES.length - all.length).toBe(7);
    expect(GOV6_CHAIN_GROUPS.filter((g) => g.wave === '6a').map((g) => g.id)).toEqual(['analytics_export', 'analytics_mutate', 'report_export', 'report_form', 'report_mutate']);
    expect(GOV6_CHAIN_GROUPS.filter((g) => g.wave === '6a').flatMap((g) => g.files)).toHaveLength(14);
  });
  it('the built chains (NAMED UPDATE, GOV-6b): ten, one per group, each in its group\'s wave; files map one-to-one onto states; kind = every file\'s verdict; Back = the page that opens it', () => {
    expect(GOV6_CHAINS.map((c) => c.id)).toEqual(['analytics_file', 'analytics_reread', 'report_file', 'report_form', 'report_reread', 'record_file', 'record_reread', 'outside_file', 'outside_form', 'outside_reread']);
    for (const g of GOV6_CHAIN_GROUPS) expect([g.id, GOV6_CHAINS.filter((c) => c.group === g.id).map((c) => c.wave)]).toEqual([g.id, [g.wave]]);
    for (const c of GOV6_CHAINS) expect([c.id, c.states.length]).toEqual([c.id, GOV6_CHAIN_GROUPS.find((g) => g.id === c.group)?.files.length]);
    for (const c of GOV6_CHAINS) for (const f of GOV6_CHAIN_GROUPS.find((g) => g.id === c.group)?.files ?? [])
      expect([c.id, f, GOV6_CANON_FILES.find((y) => y.file.startsWith(`${f}-`))?.verdict]).toEqual([c.id, f, c.kind]);
    for (const c of GOV6_CHAINS) expect([c.id, c.page, c.back, c.backKey, c.rereadKey]).toEqual(c.wave === '6a'
      ? [c.id, 'dashboard', '/dashboard', 'gov6.chain.back', 'gov6.chain.reread'] : [c.id, 'access', '/access', 'gov6.chain.backAccess', 'gov6.chain.rereadAccess']);
    expect([DASHBOARD_BACK, ACCESS_BACK]).toEqual(['/dashboard', '/access']);
    expect(new Set(GOV6_CHAINS.map((c) => c.doing)).size).toBe(10);
    for (const c of GOV6_CHAINS) expect([c.id, ['define', 'reread'].includes(c.doing)]).toEqual([c.id, false]);   // GOV-1b's own `do=` values
    // /access's own `do=` values (GOV-1a's acts and re-read, GOV-4b's sign-in chains) are never taken by a 6b chain
    for (const c of GOV6_CHAINS) expect([c.id, ['request', 'approve', 'remove', 'reread', 'signins-file', 'signins-reread'].includes(c.doing)]).toEqual([c.id, false]);
    expect(GOV6_CHAINS.filter((c) => c.wave === '6b').map((c) => [c.id, c.kind, c.statement])).toEqual([
      ['record_file', 'DECOR', 'gov6.q4'], ['record_reread', 'PARITY-DECOR', 'gov6.q2'], ['outside_file', 'DECOR', 'gov6.q3'], ['outside_form', 'DECOR', 'gov6.q3'], ['outside_reread', 'PARITY-DECOR', 'gov6.q3'],
    ]);
  });
  it('the two sections: W333 "Analytics" (Q1, Q5) and W357 "Reports" (Q4); each item once; the deltas recorded', () => {
    expect(GOV6_SECTIONS_6A.map((s) => [s.id, s.file, s.statement, s.closing])).toEqual([['analytics', 'W333', 'gov6.q1', 'gov6.q5'], ['reports', 'W357', 'gov6.q4', null]]);
    expect(GOV6_SECTIONS_6A.map((s) => s.items.map((n) => n.id))).toEqual([['steps', 'waits', 'reasons'], ['timetable', 'office_pack', 'village_wall', 'information_request', 'late_wages']]);
    const ids = GOV6_SECTIONS_6A.flatMap((s) => s.items.map((n) => n.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['two_sections', 'given_nothing', 'now_in_words', 'no_relabel', 'no_retry_opener_6a', 'export_row', 'analytics_link']) expect([id, GOV6_DELTAS.some((d) => d.id === id)]).toEqual([id, true]);
  });
  it('GOV-6b · the two /access sections: W334 "The record" (Q2, closing Q4) and W351–W354 "Outside bodies" (Q3); no facts; each item once; the deltas recorded', () => {
    expect(GOV6_SECTIONS_6B.map((s) => [s.id, s.file, s.surface, s.title, s.statement, s.closing, s.facts.length])).toEqual([
      ['record', 'W334', 'record', 'gov6.record.title', 'gov6.q2', 'gov6.q4', 0], ['outside', 'W351–W354', 'outside', 'gov6.outside.title', 'gov6.q3', null, 0]]);
    expect(GOV6_SECTIONS_6B.map((s) => s.items.map((n) => n.id))).toEqual([['list', 'public', 'requests'], ['figures', 'people', 'naming', 'files']]);
    const ids = [...GOV6_SECTIONS_6A, ...GOV6_SECTIONS_6B].flatMap((s) => s.items.map((n) => n.key));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['two_sections_6b', 'four_pages_one_section', 'given_nothing_6b', 'q4_once_on_access', 'registers_gone', 'no_retry_opener_6b', 'record_seen_correction']) expect([id, GOV6_DELTAS.some((d) => d.id === id)]).toEqual([id, true]);
  });
  it('every key in en/hi/gu; every refusal id once; refusals only on built surfaces; every surface prints one', () => {
    expect(new Set(GOV6_REFUSALS.map((r) => r.id)).size).toBe(GOV6_REFUSALS.length);
    for (const [l, cat] of Object.entries(CATS)) {
      const keys = [...GOV6_REFUSALS.map((r) => r.key), ...[...GOV6_SECTIONS_6A, ...GOV6_SECTIONS_6B].flatMap((s) => [s.title, s.statement, s.listTitle, ...s.facts, ...s.items.map((n) => n.key), ...(s.closing ? [s.closing] : [])]),
        'gov6.refused.title', 'gov6.chain.back', 'gov6.chain.reread', 'gov6.chain.backAccess', 'gov6.chain.rereadAccess', 'gov6.q1', 'gov6.q2', 'gov6.q3', 'gov6.q4', 'gov6.q5',
        ...GOV6_CHAINS.flatMap((c) => c.states.flatMap((s) => [`${c.key(s)}.title`, `${c.key(s)}.body`]))];
      for (const k of keys) expect([l, k, typeof (cat as Record<string, string>)[k]]).toEqual([l, k, 'string']);
    }
    // NAMED UPDATE, GOV-6b: a refusal sits on 6a surfaces only or 6b surfaces only — never both; every surface of either prints one
    for (const r of GOV6_REFUSALS) expect([r.id, r.surfaces.every((s) => SURFACES_6A.includes(s)) !== r.surfaces.every((s) => SURFACES_6B.includes(s))]).toEqual([r.id, true]);
    for (const s of [...SURFACES_6A, ...SURFACES_6B]) expect([s, GOV6_REFUSALS.some((r) => r.surfaces.includes(s))]).toEqual([s, true]);
    expect(SURFACES_6B).toEqual(['record', 'outside', 'record_file', 'record_reread', 'outside_file', 'outside_form', 'outside_reread']);
    expect(SURFACES_6A.filter((s) => SURFACES_6B.includes(s))).toEqual([]);
  });
  it('every English refusal and every "not counted / not done" item says no (the negative-word rule)', () => {
    const NEG = /\b(no|not|never|nobody|nothing|cannot|only)\b|n't\b/i;
    for (const r of GOV6_REFUSALS) expect([r.id, NEG.test(en[r.key])]).toEqual([r.id, true]);
    for (const s of [...GOV6_SECTIONS_6A, ...GOV6_SECTIONS_6B]) for (const n of s.items) expect([n.id, NEG.test(en[n.key])]).toEqual([n.id, true]);
  });
  it('the registry\'s canon quotes are anonymised: no canon person, place, body, scheme, figure or reference', () => {
    const all = JSON.stringify([GOV6_REFUSALS, GOV6_SECTIONS_6A, GOV6_SECTIONS_6B, GOV6_DELTAS, GOV6_CANON_FILES]);
    // GOV-6b's fixtures too: no borrower code, officer initials, body, product or digest from W351–W354
    expect(all).not.toMatch(/BRW-|S••• O|\bKCC\b|WBCIS|IRDAI|\bRBI\b|Regulatory Access|platform DPO|b3f1|9ad4|7c2e|Q1 FY27|\bPSL\b|\bNPA\b|ombudsman|30 Sep/i);
    expect(all).not.toMatch(/Directorate|Gujarat|GMISS|gmiss|Junagadh|Rajkot|Anand\b|Dahod|Narmada|Trivedi|Gohil|Kapadia|Secretariat|Secretary|\bPIO\b|panchayat notice|જાહેર દીવાલ|\bDK\b|\bSO\b|\d{1,3},\d{3}|\d+(\.\d+)?%|₹|DELTA-0|W350\b|W317\b|PFMS|SC\/ST|Women applicants|Small\/marginal|\bRTI\b|Delay-compensation|MGNREGA public wall/);
  });
  it('GOV-1b\'s "Full analytics" refusal is named-updated: no longer "not built"; it points to the section', () => {
    const r = GOV1_REFUSALS.find((x) => x.id === 'dash_analytics');
    expect(r?.why).toMatch(/^GOV-6a \(named update\)/);
    expect(en['gov1.refusal.dashAnalytics']).toBe('There is no separate analytics page; what this console counts, and what it does not, is said in the section "Analytics" on this page.');
    for (const cat of Object.values(CATS)) expect(/not built|नहीं बना|બન્યું નથી/.test(cat['gov1.refusal.dashAnalytics'])).toBe(false);
  });
  it('GOV-2\'s record refusal (chainRecordApp) is named-updated: no longer deferred to "GOV-6"; it cites Q2-A', () => {
    const r = GOV2_REFUSALS.find((x) => x.key === 'gov2.refusal.chainRecordApp');
    expect(r?.why).toMatch(/named update, PC-56 GOV-6b: GOV-6 Q2-A/);
    expect(r?.why).not.toMatch(/\(GOV-6\)/);
  });
});
