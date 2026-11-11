// apps/web-gov/src/test-render/gov-mgnrega.render.test.tsx · PC-56 GOV-5a — W345 (`/mgnrega`, "MGNREGA") as a person sees it: Q3's, Q2's and
// Q1's sentences and the download sentence verbatim; "What this console does not do" (W345's acts, W346, W347, W348, W440 in plain words);
// no row, table, count, card number, name, household, day of attendance, worksite, wage, clock, ranking, form, button or file — and a
// SENTINEL: a fixture loaded with a job-card number, a worker's initials and household size, a geotagged worksite, a wage figure, a demand
// with its due date and a panchayat league table, handed to the view every way it could be (inside `me`, as extra props), never reaches the
// markup, in en, hi and gu. Q4-A's page sentence is NOT printed (the page cannot know the flag). The refusals BY NAME ×3.
// PC-56 GOV-5b: the sections "Wages" (W349 — Q1's sentence, moved there) and "Social audit" (W350 — Q5's sentence verbatim) in every state;
// each feature named once as not done; their refusals BY NAME; a wage-list / FTO / compensation / allowance / pay-date / complaint SENTINEL
// never reaches the markup ×3.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MgnregaView } from '../components/gov5/MgnregaViews';
import { gov5RefusalKeys, GOV5_NOT_DONE, GOV5_SECTIONS_5B } from '../features/gov5/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_HEAD, ME_OFFICER, text, tr, visible } from './gov1a-fixtures';

const Q3 = 'MGNREGA\'s register is NREGASoft. This console records no work demand and does not connect to NREGASoft.';
const Q2 = 'This console shows no job card, worker, household, attendance or worksite.';
const Q1 = 'This console shows no wage or payment figure.';
const DL = 'Nothing on this page can be downloaded.';
const Q4 = /switched off on this platform|records are switched off/i;
/** W345–W348 and W440's false words as they would appear in VISIBLE text (outside the refusal list, the "does not do" section, Q3, Q2, Q1). */
export const FALSE_5A = /₹|%|\bINR\b|rupee|crore|lakh|\bsync|mirror|convergence|NREGASoft|demand|job.?card|GJ-|household|muster|attendance|person.?days|worksite|\bmate\b|panchayat|sarpanch|rozgar|gram sabha|15-day|clock|allowance|compensation|liabilit|\bFTO\b|wage|credited|\brates?\b|exhausted|\bwall\b|publish|grievance|voice line|\*123#|USSD|\bSMS\b|export|audit|enrol|Vanthali|Junagadh|talav|D-2026-|\bMR-\d|\bMB-\d|DELTA-\d|\bNK\b/i;

/** The SENTINEL: every kind of thing Q1-A, Q2-A and Q3-A say this console never shows, in one fixture. */
const SENTINEL = {
  cardNo: 'SENT-JOBCARD-00917', initials: 'Q••• Z.', household: 'household of 7 adults', worksite: 'Sentinel tank, plot 44', geotag: '22.30471,70.80229',
  wage: '73,913', demandRef: 'SENT-DEMAND-0442', dueBy: '2026-12-31', rankRow: 'Sentinel Panchayat — rank 1 of 12',
};
const SENTINEL_STRINGS = Object.values(SENTINEL);
const ME_LOADED = { ...ME_OFFICER, jobCards: [{ jobCardNo: SENTINEL.cardNo, holder: SENTINEL.initials, household: SENTINEL.household, daysUsedFy: 61 }],
  muster: { worksite: SENTINEL.worksite, geotag: SENTINEL.geotag, wageMinor: 7391300, wage: SENTINEL.wage }, leaderboard: [SENTINEL.rankRow] };
const EXTRA = { demands: [{ id: SENTINEL.demandRef, jobCardNo: SENTINEL.cardNo, dueBy: SENTINEL.dueBy, allowanceDue: true }], works: [{ siteNote: SENTINEL.worksite, sanctionedAmountMinor: 7391300 }],
  ranking: [SENTINEL.rankRow], wages: [{ amount: SENTINEL.wage }] };

const CATS = { en, hi, gu } as const;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const view = (cat: Record<string, string> = en, me: any = ME_OFFICER, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<MgnregaView t={tr(cat)} me={me} {...(extra as object)} />);
const withoutNotDone = (h: string) => visible(h.replace(/<section class="kv-card" data-kv-not-done=""[\s\S]*?<\/section>/g, ''));

describe('PC-56 GOV-5a · W345 /mgnrega — MGNREGA, said truly', () => {
  it('the three sentences and the download sentence verbatim, each once, Q3 first; the authority named; signed in as you', () => {
    const h = view(); const t = text(h);
    for (const q of [Q3, Q2, Q1, DL]) expect([q, t.split(q).length - 1]).toEqual([q, 1]);
    for (const k of ['gov5.q3', 'gov5.q2', 'gov5.q1', 'gov5.download']) expect(h).toContain(`data-kv-statement="${k}"`);
    expect(t).toContain('Signed in as you, in Test Authority One.'); expect(t).toContain('MGNREGA');
    expect(t.indexOf(Q3)).toBeLessThan(t.indexOf(Q2)); expect(t.indexOf(Q2)).toBeLessThan(t.indexOf(Q1));
  });
  it('Q4-A\'s sentence is not printed: the page cannot know whether the organisation\'s records are switched on', () => {
    for (const [, cat] of Object.entries(CATS)) for (const h of [view(cat), view(cat, ME_HEAD), view(cat, null)]) expect(Q4.test(text(h))).toBe(false);
  });
  it('"What this console does not do": W345\'s acts, W346, W347, W348 and W440 in plain words, each once', () => {
    const h = view(); const t = text(h);
    expect(h).toContain('data-kv-not-done=""'); expect(t).toContain('What this console does not do');
    for (const n of GOV5_NOT_DONE) { expect(h).toContain(`data-kv-not-done-item="${n.id}"`); expect([n.id, t.split(en[n.key]).length - 1]).toEqual([n.id, 1]); }
    expect(t).toContain('No job card is listed, created or checked here, and no card number is shown, in full or in part.');
    expect(t).toContain('No household\'s request for work is taken or recorded here, by any channel.');
    expect(t).toContain('No muster is shown or entered here: no day of attendance, no pay and no worksite detail.');
    expect(t).toContain('No list of musters or works is kept here.');
  });
  it('the refused acts and the persona BY NAME: Sync now, Record a demand, the file, the ranking, the panchayat desk', () => {
    const t = text(view());
    expect(t).toContain('No update from NREGASoft can be started from this console.');
    expect(t).toContain('There is no form here to enter a request for work.');
    expect(t).toContain('No file of job cards or anything else is made or handed out from this console.');
    expect(t).toContain('No panchayat, official or worker is ranked or compared on this console.');
    expect(t).toContain('This console is not a gram panchayat\'s desk and has no MGNREGA menu of its own; there is no sarpanch or rozgar sahayak role here, only head and officer.');
  });
  it('no row, table, list of cards, count, form, button, file link or image; no false canon word in visible text; no digit at all', () => {
    for (const me of [ME_OFFICER, ME_HEAD, null]) {
      const h = view(en, me);
      expect(h).not.toMatch(/<table|<tr|<td|<ol|<form|<input|<button|<select|<img|<video|<svg|download=|\.csv|\.pdf|do=/i);
      expect(FALSE_5A.test(withoutNotDone(h).replace(Q3, '').replace(Q2, '').replace(Q1, ''))).toBe(false);
      expect(/\d/.test(text(h))).toBe(false);   // no count, figure, date, card number or coordinate is printed
      expect([...h.matchAll(/<a /g)].length).toBe(0);
    }
  });
  it.each(Object.entries(CATS))('%s: the SENTINEL (card number, initials, household, worksite, geotag, wage, demand, due date, ranking) never reaches the markup', (_l, cat) => {
    for (const h of [view(cat, ME_LOADED), view(cat, ME_LOADED, EXTRA), view(cat, ME_OFFICER, EXTRA)]) {
      for (const s of SENTINEL_STRINGS) expect([s, h.includes(s)]).toEqual([s, false]);
      expect(h).not.toMatch(/\d{2}\.\d{3,}|\d{2},\d{3}|\d{4}-\d{2}-\d{2}|SENT-|••• [A-Z]\.|rank \d/);   // no coordinate-, money-, date-, reference- or rank-shaped string
      expect(/\d/.test(text(h))).toBe(false);
    }
  });
  it.each(Object.entries(CATS))('%s: the refusals BY NAME, the sentences, every key resolved', (_l, cat) => {
    const c = cat as Record<string, string>;
    const t = text(view(c));
    for (const k of gov5RefusalKeys('mgnrega')) expect([k, t.includes(c[k])]).toEqual([k, true]);
    for (const k of ['gov5.q3', 'gov5.q2', 'gov5.q1', 'gov5.download', 'gov5.notDone.title', 'gov5.mgnrega.title', 'gov5.refused.title']) expect([k, t.includes(c[k])]).toEqual([k, true]);
    expect(/gov5\.|gov4\.|gov1\.|common\./.test(t)).toBe(false);
  });
});

const Q5 = 'This console publishes nothing, compiles no social-audit pack and takes no complaints.';
const sectionOf = (h: string, id: string) => (h.match(new RegExp(`<section class="kv-card" data-kv-not-done="" data-kv-section="${id}"[\\s\\S]*?</section>\\s*</section>`)) ?? [''])[0];
/** W349's and W350's false words as they would appear in visible text OUTSIDE the two sections (and their refusal lists). */
const FALSE_5B = /wage|\bFTO\b|payment order|compensation|allowance|credited|\bbank\b|days? late|days? left|accru|publish|\bwall\b|public page|social.?audit|audit pack|grievance|complaint|Gram Sabha|photos|worker-by-worker|sanctioned|\bspent\b|disputed|two-person|sarpanch|secretary|QR|\bA2\b|\bSMS\b|embarrass|the win|mirror|W289|પગાર/i;
/** The 5b SENTINEL: every kind of thing Q1-A and Q5-A say this console never shows. */
const SENTINEL_5B = {
  wageList: 'SENT-WAGELIST-0663', fto: 'SENT-FTO-5521', compensation: '47.19', allowance: 'SENT-ALLOW-0773', payDate: '2026-12-30',
  wageTotal: '64,312', complaint: 'Sentinel complaint: my day was marked absent', complainant: 'R••• Q.', wallUrl: 'https://sentinel.example/wall',
};
const SENTINEL_5B_STRINGS = Object.values(SENTINEL_5B);
const ME_LOADED_5B = { ...ME_OFFICER, wages: [{ wageListNo: SENTINEL_5B.wageList, fto: SENTINEL_5B.fto, compensation: SENTINEL_5B.compensation, total: SENTINEL_5B.wageTotal, dueBy: SENTINEL_5B.payDate }],
  allowance: SENTINEL_5B.allowance, grievances: [{ text: SENTINEL_5B.complaint, by: SENTINEL_5B.complainant }], wall: { url: SENTINEL_5B.wallUrl } };
const EXTRA_5B = { wageCycles: [{ fto: SENTINEL_5B.fto, compensationMinor: 4719, credited: SENTINEL_5B.payDate }], grievances: [{ text: SENTINEL_5B.complaint }],
  publish: () => SENTINEL_5B.wallUrl, auditPack: { photos: [SENTINEL_5B.wallUrl] }, allowance: SENTINEL_5B.allowance };

describe('PC-56 GOV-5b · /mgnrega — the sections "Wages" (W349) and "Social audit" (W350)', () => {
  it('both sections in every state (officer, head, signed out of the shell): title, statement, items; Q1 in Wages, Q5 in Social audit, each once', () => {
    for (const me of [ME_OFFICER, ME_HEAD, null]) {
      const h = view(en, me); const t = text(h);
      const w = sectionOf(h, 'wages'); const sa = sectionOf(h, 'social_audit');
      expect(w).not.toBe(''); expect(sa).not.toBe('');
      expect(text(w)).toContain('Wages'); expect(text(w)).toContain(Q1); expect(w).toContain('data-kv-statement="gov5.q1"');
      expect(text(sa)).toContain('Social audit'); expect(text(sa)).toContain(Q5); expect(sa).toContain('data-kv-statement="gov5.q5"');
      for (const q of [Q1, Q5]) expect([q, t.split(q).length - 1]).toEqual([q, 1]);
      for (const sec of GOV5_SECTIONS_5B) for (const n of sec.items) {
        expect(sectionOf(h, sec.id)).toContain(`data-kv-not-done-item="${n.id}"`);
        expect([n.id, t.split(en[n.key]).length - 1]).toEqual([n.id, 1]);
      }
      // order: the opening statements, "does not do", Wages, Social audit, the download sentence
      expect(t.indexOf(Q2)).toBeLessThan(t.indexOf('What this console does not do'));
      expect(t.indexOf('What this console does not do')).toBeLessThan(t.indexOf(Q1));
      expect(t.indexOf(Q1)).toBeLessThan(t.indexOf(Q5)); expect(t.indexOf(Q5)).toBeLessThan(t.indexOf(DL));
    }
  });
  it('Q5 exact; the Wages items name the wage list, the payment order (FTO), compensation, the allowance and a pay date — each as not done', () => {
    const t = text(view());
    expect(t).toContain(Q5);
    expect(t).toContain('No wage list is drawn up, shown or checked here.');
    expect(t).toContain('No payment order (FTO) is made, signed or followed here, and no payment into a worker\'s account is watched.');
    expect(t).toContain('No compensation for late wages is worked out, shown or paid here.');
    expect(t).toContain('No unemployment allowance is worked out, shown or paid here.');
    expect(t).toContain('No date is promised to any worker for their pay, and no count of days until pay is due is kept here.');
    expect(t).toContain('Nothing is printed for a village notice board or put on a public web page from here.');
    expect(t).toContain('No papers, photos or findings for a village audit meeting are gathered or kept here.');
    expect(t).toContain('No complaint is taken, listed or answered here, and no one\'s own words are shown.');
  });
  it('the refusals BY NAME, inside their own section: Export, Publish this month\'s wall, the rows, the wall, the pack, the complaints register', () => {
    const h = view(); const w = text(sectionOf(h, 'wages')); const sa = text(sectionOf(h, 'social_audit'));
    for (const k of gov5RefusalKeys('wages')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const k of gov5RefusalKeys('social_audit')) expect([k, sa.includes(en[k])]).toEqual([k, true]);
    expect(w).toContain('No file of pay or payment orders is made or handed out from this console.');
    expect(sa).toContain('Nothing can be published from this console, by one person or by two.');
    expect(h).toContain('data-kv-refused="wages"'); expect(h).toContain('data-kv-refused="social_audit"');
  });
  it('outside the two sections, no W349 / W350 word; nowhere a form, button, link, digit, figure or date', () => {
    for (const me of [ME_OFFICER, ME_HEAD, null]) {
      const h = view(en, me);
      const outside = visible(h.replace(sectionOf(h, 'wages'), '').replace(sectionOf(h, 'social_audit'), '').replace(/<section class="kv-card" data-kv-not-done=""[\s\S]*?<\/section>/g, ''));
      expect(FALSE_5B.test(outside)).toBe(false);
      expect(h).not.toMatch(/<form|<input|<button|<a |<img|<table|download=|do=publish|do=wage/i);
      expect(/\d/.test(text(h))).toBe(false);
      for (const sec of ['wages', 'social_audit']) expect(/\d|₹|%/.test(text(sectionOf(h, sec)))).toBe(false);
    }
  });
  it.each(Object.entries(CATS))('%s: the 5b SENTINEL (wage list, FTO, compensation, allowance, pay date, wage total, complaint, complainant, wall link) never reaches the markup', (_l, cat) => {
    for (const h of [view(cat, ME_LOADED_5B), view(cat, ME_LOADED_5B, EXTRA_5B), view(cat, ME_OFFICER, EXTRA_5B), view(cat, { ...ME_LOADED, ...ME_LOADED_5B }, { ...EXTRA, ...EXTRA_5B })]) {
      for (const s of SENTINEL_5B_STRINGS) expect([s, h.includes(s)]).toEqual([s, false]);
      expect(h).not.toMatch(/\d{2}\.\d{2}|\d{2},\d{3}|\d{4}-\d{2}-\d{2}|SENT-|••• [A-Z]\.|https?:/);
      expect(/\d/.test(text(h))).toBe(false);
    }
  });
  it.each(Object.entries(CATS))('%s: both sections, every key resolved; Q5 and the titles in that language', (_l, cat) => {
    const c = cat as Record<string, string>;
    const h = view(c); const t = text(h);
    for (const sec of GOV5_SECTIONS_5B) {
      const st = text(sectionOf(h, sec.id));
      for (const k of [sec.title, sec.statement, ...sec.items.map((n) => n.key), ...gov5RefusalKeys(sec.surface)]) expect([sec.id, k, st.includes(c[k])]).toEqual([sec.id, k, true]);
    }
    expect(t.split(c['gov5.q5']).length - 1).toBe(1);
    expect(/gov5\.|common\./.test(t)).toBe(false);
  });
});
