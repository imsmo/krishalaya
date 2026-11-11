// apps/web-gov/src/test-render/gov-dashboard.render.test.tsx · PC-56 GOV-1b — W325 (`/dashboard`) as a person sees it: every number the
// SERVER counted, printed as given (schemes run, applications counted, by scheme × status, the two queues with the oldest whole days), the
// window (all time, drafts not counted) and the time the server counted; Q3-A verbatim with the counts-only fact; Q1-A's sentence NOT printed
// (no credit, no money); no %, ₹, goal, place, period; no id of any kind; "Define a scheme" refused BY NAME; every state (ready, no scheme,
// no application, switched off, refused, error with Retry → the re-read chain); the refusals BY NAME in en/hi/gu.
// PC-56 GOV-6a: the sections "Analytics" (W333) and "Reports" (W357) in every state — see the GOV-6a block at the end.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../components/gov1/DashboardViews';
import { gov1RefusalKeys } from '../features/gov1/refusals';
import { gov6RefusalKeys, GOV6_SECTIONS_6A } from '../features/gov6/refusals';
import type { DashState } from '../features/gov1/dashboard';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr, visible } from './gov1a-fixtures';
import { FALSE_1B, OVERVIEW, OVERVIEW_EMPTY, OVERVIEW_NO_SCHEME, UUID_RE } from './gov1b-fixtures';

const Q3 = 'This console shows applications made to your authority\'s schemes. Every time one is opened, it is recorded.';
const CATS = { en, hi, gu } as const;
const view = (state: DashState = 'ok', o = OVERVIEW, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<DashboardView t={tr(cat)} state={state} me={ME_OFFICER} overview={o} />);
const cell = (h: string, scheme: string, status: string) => (h.match(new RegExp(`<tr data-kv-scheme="${scheme}"[\\s\\S]*?</tr>`)) ?? [''])[0].match(new RegExp(`data-kv-status="${status}">(\\d+)<`))?.[1];

describe('PC-56 GOV-1b · W325 /dashboard — the server\'s counts, printed as given', () => {
  it('Q3-A verbatim and the counts-only fact; the authority named; signed in as you', () => {
    const h = view();
    expect(text(h)).toContain(Q3); expect(h).toContain('data-kv-statement="gov1.dash.q3"');
    expect(text(h)).toContain('This page shows counts only. It opens no application, so it records no read.');
    expect(text(h)).toContain('Signed in as you, in Test Authority One.');
  });
  it('the window and the time the server counted (UTC)', () => {
    const t = text(view());
    expect(t).toContain('Counted over every application ever submitted to your schemes on this platform. Drafts not yet submitted are not counted.');
    expect(t).toContain('Counted by the server at 2026-11-10 06:30 UTC.');
    expect(view()).toContain('data-kv-computed-at="2026-11-10T06:30:00.000Z"');
  });
  it('the counts exactly as given: schemes, applications, the queues with the oldest whole days, and every scheme × status cell', () => {
    const h = view(); const t = text(h);
    expect(t).toContain('Schemes your authority runs on this platform: 2'); expect(t).toContain('Applications counted: 64');
    expect(text((h.match(/<tr data-kv-queue="clarification_needed"[\s\S]*?<\/tr>/) ?? [''])[0])).toMatch(/Waiting for clarification\s+7\s+9 days since it last changed/);
    expect(text((h.match(/<tr data-kv-queue="appealed"[\s\S]*?<\/tr>/) ?? [''])[0])).toMatch(/Appealed\s+3\s+20 days since it last changed/);
    expect(h).toContain('data-kv-by-scheme="2"');
    expect([cell(h, 'test_scheme_a', 'submitted'), cell(h, 'test_scheme_a', 'approved'), cell(h, 'test_scheme_b', 'disbursed'), cell(h, 'test_scheme_b', 'appealed')]).toEqual(['30', '15', '1', '0']);
    expect(text((h.match(/<tr data-kv-scheme="test_scheme_a"[\s\S]*?<\/tr>/) ?? [''])[0])).toMatch(/^ ?Test Scheme A .* 55 ?$/);
    expect(t).toContain('Marked disbursed by an officer');
  });
  it('no %, ₹, goal, place, period, average or payment-system word in what is visible; no id of any kind anywhere in the markup', () => {
    for (const [l, cat] of Object.entries(CATS)) for (const st of ['ok', 'error', 'off', 'forbidden'] as const) {
      const h = view(st, OVERVIEW, cat);
      // GOV-6a (named update): Q1's and Q5's sentences are binding page words that NAME "district" and "rupee" to refuse them; only those
      // two paragraphs (by their data-kv-statement) are lifted before the guard — every other visible word is still held to FALSE_1B.
      expect([l, st, FALSE_1B.test(visible(h.replace(/<p class="kv-statement" data-kv-statement="gov6\.q[15]">[^<]*<\/p>/g, '')))]).toEqual([l, st, false]);
      expect([l, st, (h.match(/data-kv-statement="gov6\.q[15]"/g) ?? []).length]).toEqual([l, st, 2]);
      expect([l, st, UUID_RE.test(h)]).toEqual([l, st, false]);
      expect([l, st, /\/applications\//.test(h)]).toEqual([l, st, false]);
    }
  });
  it('Q1-A\'s sentence is NOT printed, and no credit count or money figure appears (the government axis cannot read credits)', () => {
    for (const cat of Object.values(CATS)) {
      const t = text(view('ok', OVERVIEW, cat));
      expect(/Credits recorded on this platform|typed by officers/.test(t)).toBe(false);
    }
    expect(visible(view())).not.toMatch(/credit/i);
    expect(text(view())).toContain('No money figure and no credit count is shown: this console cannot read credit records, and benefit money moves outside this platform.');
  });
  it('"Define a scheme" is refused BY NAME; its link opens the DECOR form chain, never a form', () => {
    const h = view();
    expect(h).toContain('href="/dashboard?do=define&amp;act=review"'); expect(text(h)).toContain('Define a scheme Schemes are written by the platform\'s team, not from this console.');
    expect(h).not.toContain('<form');
  });
  it('no application yet / no scheme yet: zeros as given, said plainly', () => {
    const e = view('ok', OVERVIEW_EMPTY);
    expect(text(e)).toContain('No application has been submitted to your schemes yet.'); expect(text(e)).toContain('Applications counted: 0');
    expect(text((e.match(/<tr data-kv-queue="appealed"[\s\S]*?<\/tr>/) ?? [''])[0])).toMatch(/Appealed\s+0\s+—/);
    const n = view('no_scheme', OVERVIEW_NO_SCHEME);
    expect(n).toContain('data-kv-state="no_scheme"'); expect(text(n)).toContain('Your authority runs no scheme on this platform yet.'); expect(n).not.toContain('data-kv-by-scheme');
  });
  it('switched off / refused / error: no counts; the error\'s Retry opens the re-read chain', () => {
    const off = view('off');
    expect(text(off)).toContain('The government console is switched off on this platform.'); expect(off).not.toContain('data-kv-count');
    const no = view('forbidden');
    expect(text(no)).toContain('Your role here does not include reading applications to your schemes.'); expect(no).not.toContain('data-kv-count');
    const err = view('error');
    expect(text(err)).toContain('Only this page failed to load. No application was changed.');
    expect(err).toContain('href="/dashboard?act=confirm&amp;do=reread" data-kv-retry=""'); expect(err).not.toContain('data-kv-count');
  });
  it.each(Object.entries(CATS))('%s: every dashboard refusal printed BY NAME', (_l, cat) => {
    const t = text(view('ok', OVERVIEW, cat));
    const keys = gov1RefusalKeys('dashboard');
    expect(keys.length).toBe(11);
    for (const k of keys) expect([k, t.includes(cat[k])]).toEqual([k, true]);
  });
});

// ════ PC-56 GOV-6a · W333 ("Analytics") and W357 ("Reports") as sections of /dashboard — GOV-6 Q1-A, Q4-A, Q5-A (lead-applied) ════
// Both sections in EVERY state; Q1's, Q4's and Q5's sentences exact, each once; the "now" said in words; what is not counted / not done named
// once each; the refusals BY NAME inside their own section; a caste / gender / district / rupee / median SENTINEL — handed to the view inside
// the overview and as extra props — never reaches the markup, ×3; no number appears that the overview did not carry; the sections print none.
const Q1_6 = 'This console counts applications only by scheme and by where each one is now. It does not count applicants by caste, gender, landholding or district, and it ranks no district or official.';
const Q4_6 = 'This console publishes nothing, sends no reports and makes no files. Nothing on it can be downloaded.';
const Q5_6 = 'This console shows no rupee figure and no payment timing.';
const STATES: DashState[] = ['ok', 'no_scheme', 'error', 'off', 'forbidden'];
const sec6 = (h: string, id: string) => (h.match(new RegExp(`<section class="kv-card" data-kv-section="${id}"[\\s\\S]*?</section>\\s*</section>`)) ?? [''])[0];
const withoutStated = (h: string) => h.replace(/<p class="kv-statement" data-kv-statement="gov6\.q[15]">[^<]*<\/p>/g, '');
/** The SENTINEL: every kind of thing Q1-A and Q5-A say this console never counts or shows, loaded into the overview and the props. */
const SENT6 = { district: 'Sentinel District Nine', caste: 'SENTINEL-CASTE-TIER', gender: 'SENTINEL-GENDER-F', landholding: 'SENTINEL-LAND-BAND', rupees: '₹73,913', median: 'median 4.4 days', share: '61.7%', official: 'Sentinel Officer Q.' };
const SENT6_STRINGS = Object.values(SENT6);
const OVERVIEW_LOADED = { ...OVERVIEW,
  byScheme: OVERVIEW.byScheme.map((r) => ({ ...r, district: SENT6.district, caste: SENT6.caste, gender: SENT6.gender, landholding: SENT6.landholding, amountMinor: 7391300, amount: SENT6.rupees, medianDays: 4.4, median: SENT6.median, share: SENT6.share })),
  byDistrict: [{ name: SENT6.district, count: 41, approvalShare: SENT6.share, medianDays: 4.4, rank: 1, flagged: true }],
  reach: { caste: SENT6.caste, gender: SENT6.gender, landholding: SENT6.landholding }, disbursedAmount: SENT6.rupees, officials: [{ name: SENT6.official, rank: 1 }] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loaded = (state: DashState, cat: Record<string, string>, extra: Record<string, unknown> = {}) => renderToStaticMarkup(<DashboardView t={tr(cat)} state={state} me={ME_OFFICER} overview={OVERVIEW_LOADED as any} {...(extra as object)} />);
/** Per language: the words for caste, gender, district, rupee and median (en / hi / gu). */
const SPECIAL: Record<string, RegExp> = {
  en: /caste|gender|district|rupee|₹|median|landholding/i, hi: /जाति|लिंग|ज़िल|जिल|रुपय|रुपये|₹|माध्यिका|जोत/, gu: /જ્ઞાતિ|લિંગ|જિલ્લ|રૂપિય|₹|જમીન-ધારણ/,
};
/** Every number the overview fixture carries (and the server's counted-at time) — the page may print no other. */
const ALLOWED_NUMBERS = new Set([...JSON.stringify(OVERVIEW).replace(/"id":"[^"]*"/g, '').matchAll(/\d+/g)].map((m) => m[0]));

describe('PC-56 GOV-6a · /dashboard — the sections "Analytics" (W333) and "Reports" (W357)', () => {
  it('both sections in every state: title, statement, facts, items; Q1 and Q5 in Analytics, Q4 in Reports, each exact and once', () => {
    for (const st of STATES) {
      const h = view(st); const t = text(h);
      const a = sec6(h, 'analytics'); const r = sec6(h, 'reports');
      expect([st, a !== '', r !== '']).toEqual([st, true, true]);
      expect(text(a)).toContain('Analytics'); expect(text(a)).toContain(Q1_6); expect(text(a)).toContain(Q5_6);
      expect(text(r)).toContain('Reports'); expect(text(r)).toContain(Q4_6);
      for (const q of [Q1_6, Q4_6, Q5_6]) expect([st, q, t.split(q).length - 1]).toEqual([st, q, 1]);
      for (const k of ['gov6.q1', 'gov6.q5']) expect(a).toContain(`data-kv-statement="${k}"`);
      expect(r).toContain('data-kv-statement="gov6.q4"');
      for (const s of GOV6_SECTIONS_6A) for (const n of s.items) {
        expect(sec6(h, s.id)).toContain(`data-kv-not-done-item="${n.id}"`);
        expect([st, n.id, t.split(en[n.key]).length - 1]).toEqual([st, n.id, 1]);
      }
      expect(t.indexOf(Q1_6)).toBeLessThan(t.indexOf(Q5_6)); expect(t.indexOf(Q5_6)).toBeLessThan(t.indexOf(Q4_6));
      expect(t.indexOf(Q4_6)).toBeLessThan(t.indexOf('Define a scheme'));
    }
    const t = text(view());
    expect(t.indexOf('By scheme and status')).toBeLessThan(t.indexOf(Q1_6));
  });
  it('the "now" in words (F-5) and the live count; what is not counted and not done, each named', () => {
    const t = text(view());
    expect(t).toContain('Each count above is of applications in that state now, over all time. An application is counted only where it is now: once it is marked disbursed, it is no longer counted as approved.');
    expect(t).toContain('The server counts afresh each time this page is opened; no earlier copy of the counts is kept.');
    expect(t).toContain('What this console does not count'); expect(t).toContain('What this console does not do');
    expect(t).toContain('No count is kept of how many applications passed each step over time.');
    expect(t).toContain('No typical waiting time is worked out; only the oldest wait in each of the two queues above is shown.');
    expect(t).toContain('Rejections are not counted by their reason.');
    expect(t).toContain('No report is set up here, run on a timetable or sent to any office or person.');
    expect(t).toContain('No monthly pack of these counts is put together for a government office.');
    expect(t).toContain('Nothing is printed for a village wall from here.');
    expect(t).toContain('No file is prepared here to answer a right-to-information request.');
    expect(t).toContain('No register of late wages or their compensation is kept here.');
    expect(t).not.toContain('Analytics are not built yet.');
    expect(t).toContain('There is no separate analytics page; what this console counts, and what it does not, is said in the section "Analytics" on this page.');
  });
  it('the refusals BY NAME, inside their own section: the deck, the funnel, the reach, the places, New report, the office pack, the wall, the extract', () => {
    const h = view(); const a = text(sec6(h, 'analytics')); const r = text(sec6(h, 'reports'));
    for (const k of gov6RefusalKeys('analytics')) expect([k, a.includes(en[k])]).toEqual([k, true]);
    for (const k of gov6RefusalKeys('reports')) expect([k, r.includes(en[k])]).toEqual([k, true]);
    expect(a).toContain('No slide deck or other file of these counts is made or handed out.');
    expect(a).toContain('No place is listed, compared or marked as slow, and no visit or notice follows from this page.');
    expect(r).toContain('No report can be set up here, from a template or otherwise.');
    expect(h).toContain('data-kv-refused="analytics"'); expect(h).toContain('data-kv-refused="reports"');
  });
  it('the sections print NO number, link, form, button or table — in any state, any language', () => {
    for (const [l, cat] of Object.entries(CATS)) for (const st of STATES) {
      const h = view(st, OVERVIEW, cat);
      for (const id of ['analytics', 'reports']) {
        const s = sec6(h, id);
        expect([l, st, id, /[0-9०-९૦-૯]|%|₹/.test(text(s))]).toEqual([l, st, id, false]);
        expect([l, st, id, /<a |<form|<input|<button|<select|<table|<tr|<td|data-kv-n=|data-kv-count/.test(s)]).toEqual([l, st, id, false]);
      }
    }
  });
  it('no new number: every number on the page is one the overview carried (or the time the server counted)', () => {
    for (const cat of Object.values(CATS)) {
      const nums = [...visible(view('ok', OVERVIEW, cat)).matchAll(/\d+/g)].map((m) => m[0]);
      expect(nums.length).toBeGreaterThan(10);
      for (const n of nums) expect([n, ALLOWED_NUMBERS.has(n)]).toEqual([n, true]);
    }
  });
  it.each(Object.entries(CATS))('%s: the SENTINEL (district, caste, gender, landholding, rupees, median, share, an official) never reaches the markup', (l, cat) => {
    for (const st of STATES) for (const h of [loaded(st, cat), loaded(st, cat, { byDistrict: OVERVIEW_LOADED.byDistrict, reach: OVERVIEW_LOADED.reach, analytics: SENT6 })]) {
      for (const s of SENT6_STRINGS) expect([l, st, s, h.includes(s)]).toEqual([l, st, s, false]);
      expect([l, st, /\b4\.4\b|61\.7|73,913|41\b|SENTINEL/.test(text(h))]).toEqual([l, st, false]);
      // caste / gender / district / rupee / median, in that language: only inside Q1's and Q5's sentences and the refusal lists
      expect([l, st, SPECIAL[l].test(visible(withoutStated(h)))]).toEqual([l, st, false]);
    }
  });
  it.each(Object.entries(CATS))('%s: both sections, every key resolved; the three sentences once, in that language', (_l, cat) => {
    const c = cat as Record<string, string>;
    const h = view('ok', OVERVIEW, c); const t = text(h);
    for (const s of GOV6_SECTIONS_6A) {
      const st = text(sec6(h, s.id));
      for (const k of [s.title, s.statement, ...s.facts, s.listTitle, ...s.items.map((n) => n.key), ...(s.closing ? [s.closing] : []), ...gov6RefusalKeys(s.surface)])
        expect([s.id, k, st.includes(c[k])]).toEqual([s.id, k, true]);
    }
    for (const k of ['gov6.q1', 'gov6.q4', 'gov6.q5']) expect([k, t.split(c[k]).length - 1]).toEqual([k, 1]);
    expect(/gov6\.|gov1\.|common\./.test(t)).toBe(false);
  });
});
