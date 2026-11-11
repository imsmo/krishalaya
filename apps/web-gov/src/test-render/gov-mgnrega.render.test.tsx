// apps/web-gov/src/test-render/gov-mgnrega.render.test.tsx · PC-56 GOV-5a — W345 (`/mgnrega`, "MGNREGA") as a person sees it: Q3's, Q2's and
// Q1's sentences and the download sentence verbatim; "What this console does not do" (W345's acts, W346, W347, W348, W440 in plain words);
// no row, table, count, card number, name, household, day of attendance, worksite, wage, clock, ranking, form, button or file — and a
// SENTINEL: a fixture loaded with a job-card number, a worker's initials and household size, a geotagged worksite, a wage figure, a demand
// with its due date and a panchayat league table, handed to the view every way it could be (inside `me`, as extra props), never reaches the
// markup, in en, hi and gu. Q4-A's page sentence is NOT printed (the page cannot know the flag). The refusals BY NAME ×3.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MgnregaView } from '../components/gov5/MgnregaViews';
import { gov5RefusalKeys, GOV5_NOT_DONE } from '../features/gov5/refusals';
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
