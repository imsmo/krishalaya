// apps/web-gov/src/test-render/gov-dashboard.render.test.tsx · PC-56 GOV-1b — W325 (`/dashboard`) as a person sees it: every number the
// SERVER counted, printed as given (schemes run, applications counted, by scheme × status, the two queues with the oldest whole days), the
// window (all time, drafts not counted) and the time the server counted; Q3-A verbatim with the counts-only fact; Q1-A's sentence NOT printed
// (no credit, no money); no %, ₹, goal, place, period; no id of any kind; "Define a scheme" refused BY NAME; every state (ready, no scheme,
// no application, switched off, refused, error with Retry → the re-read chain); the refusals BY NAME in en/hi/gu.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardView } from '../components/gov1/DashboardViews';
import { gov1RefusalKeys } from '../features/gov1/refusals';
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
      expect([l, st, FALSE_1B.test(visible(h))]).toEqual([l, st, false]);
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
