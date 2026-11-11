// apps/web-gov/src/test-render/gov-dbt.render.test.tsx · PC-56 GOV-3a — W332 (`/dbt`, "Benefit payments") as a person sees it: per scheme the
// SERVER's counts of approved and of marked-disbursed applications, printed as given (with the server's totals and the time it counted); Q1's,
// Q2's and Q4's sentences verbatim; "What this console does not do" (W339, W340, W344 in plain words); no money figure, %, single payment,
// farmer, bank detail, reference, list of payments, release or file; every state (ready, none marked, no scheme, switched off, refused, error
// with Retry → the re-read chain); the refusals BY NAME in en/hi/gu. And B4: the applications page words `disbursed` as GOV-1b does.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DbtView } from '../components/gov3/DbtViews';
import { ApplicationsListView } from '../components/gov2/ApplicationsViews';
import { gov3RefusalKeys, GOV3_NOT_DONE } from '../features/gov3/refusals';
import type { DashState } from '../features/gov1/dashboard';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ME_OFFICER, text, tr, visible } from './gov1a-fixtures';
import { OVERVIEW, OVERVIEW_EMPTY, OVERVIEW_NO_SCHEME, UUID_RE } from './gov1b-fixtures';
import { SCHEMES } from './gov2b-fixtures';
import { LIST } from './gov2c-fixtures';

const Q1 = 'This console never prepares, releases or pauses a payment. Benefits are paid by PFMS and the banks, outside this platform, and this platform cannot check them.';
const Q2 = 'Payments and returned payments are not recorded on this platform. An approved application stays approved here; the payment itself happens outside this platform.';
const Q4 = 'Payment records cannot be downloaded from this console.';
/** W332 / W339 / W340 / W344's false words as they would appear in VISIBLE text (outside the refusal list and the "does not do" section). */
export const FALSE_3A = /₹|%|\bINR\b|rupee|crore|lakh|season|median|\bp90\b|average|\bavg\b|target|pipeline|batch|trigger|sanction|budget|account|IFSC|a\/c|••|penny|NPCI|Aadhaar|acknowledg|observed|reconcil|footing|re-?queue|recall|\bSMS\b|reminder|ambassador|Joint Director|finance officer|two-?key|export|audit-stamped|credited|bounced|Directorate|Gujarat|GMISS|Keshod|Kapadia|Christian|PFMS-\d|GM26-|DBT-\d/i;
const CATS = { en, hi, gu } as const;
const view = (state: DashState = 'ok', o = OVERVIEW, cat: Record<string, string> = en) =>
  renderToStaticMarkup(<DbtView t={tr(cat)} state={state} me={ME_OFFICER} overview={o} />);
const noNotDone = (h: string) => visible(h.replace(/<section class="kv-card" data-kv-not-done=""[\s\S]*?<\/section>/g, ''));
const rowOf = (h: string, sel: string) => (h.match(new RegExp(`<tr ${sel}[\\s\\S]*?</tr>`)) ?? [''])[0];
const cell = (row: string, s: string) => row.match(new RegExp(`data-kv-status="${s}">(\\d+)<`))?.[1];

describe('PC-56 GOV-3a · W332 /dbt — the server\'s counts, printed as given', () => {
  it('Q1, Q2 and Q4 verbatim; the authority named; signed in as you', () => {
    const h = view(); const t = text(h);
    for (const q of [Q1, Q2, Q4]) expect(t).toContain(q);
    for (const k of ['gov3.q1', 'gov3.q2', 'gov3.q4']) expect(h).toContain(`data-kv-statement="${k}"`);
    expect(t).toContain('Signed in as you, in Test Authority One.'); expect(t).toContain('Benefit payments');
  });
  it('per scheme: approved and marked disbursed by an officer, exactly as given; the server\'s totals; the window and the time it counted', () => {
    const h = view(); const t = text(h);
    expect([cell(rowOf(h, 'data-kv-scheme="test_scheme_a"'), 'approved'), cell(rowOf(h, 'data-kv-scheme="test_scheme_a"'), 'disbursed')]).toEqual(['15', '0']);
    expect([cell(rowOf(h, 'data-kv-scheme="test_scheme_b"'), 'approved'), cell(rowOf(h, 'data-kv-scheme="test_scheme_b"'), 'disbursed')]).toEqual(['0', '1']);
    expect([cell(rowOf(h, 'data-kv-totals=""'), 'approved'), cell(rowOf(h, 'data-kv-totals=""'), 'disbursed')]).toEqual(['15', '1']);
    expect(t).toContain('Marked disbursed by an officer'); expect(t).not.toMatch(/(^|[^y] )Disbursed\b/);
    expect(t).toContain('Counted by the server at 2026-11-10 06:30 UTC.'); expect(h).toContain('data-kv-computed-at="2026-11-10T06:30:00.000Z"');
    expect(t).toContain('Counted over every application ever submitted to your schemes on this platform.');
    expect(h).toContain('data-kv-dbt-counts="2"');
  });
  it('no other status is printed: no sent, checked, rejected, closed or appealed count; no application total', () => {
    const h = view();
    expect([...new Set([...h.matchAll(/data-kv-status="(\w+)"/g)].map((m) => m[1]))].sort()).toEqual(['approved', 'disbursed']);
    expect([...h.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(['15', '0', '0', '1', '15', '1']);   // every cell: the two counts, as given
  });
  it('Q2: a marked-disbursed count is said to be from before, and not proof of a payment; with none, says none', () => {
    expect(text(view())).toContain('An application counted as marked disbursed was marked so by an officer before this platform stopped recording payments. That mark is not proof that a payment was made.');
    const e = text(view('ok', OVERVIEW_EMPTY));
    expect(e).toContain('No application to your schemes has been marked disbursed.'); expect(e).not.toContain('That mark is not proof');
  });
  it('"What this console does not do": W339, W340 and W344 in plain words, each once', () => {
    const h = view(); const t = text(h);
    expect(h).toContain('data-kv-not-done=""'); expect(t).toContain('What this console does not do');
    for (const n of GOV3_NOT_DONE) { expect(h).toContain(`data-kv-not-done-item="${n.id}"`); expect(t.split(en[n.key]).length - 1).toBe(1); }
    expect(t).toContain('Approving an application does not start a payment.');
    expect(t).toContain('No list of payments is put together, checked, signed off or sent from here, and no payment file is made.');
    expect(t).toContain('This console does not measure how long a payment takes to arrive or how many payments come back, and sets no goal for either.');
  });
  it('no money, %, single payment, farmer, bank detail, reference, release or file in visible text; no id; no form, button or file link', () => {
    for (const [s, o] of [['ok', OVERVIEW], ['ok', OVERVIEW_EMPTY], ['no_scheme', OVERVIEW_NO_SCHEME]] as const) {
      const h = view(s, o);
      expect([s, FALSE_3A.test(noNotDone(h))]).toEqual([s, false]);
      expect(UUID_RE.test(text(h))).toBe(false);
      expect(h).not.toMatch(/<form|<input|<button|<select|download=|\.csv|do=file|do=pause/i);
    }
  });
  it('every state: ready, no scheme, switched off, refused, error with Retry → the re-read chain', () => {
    expect(text(view('no_scheme', OVERVIEW_NO_SCHEME))).toContain('Your authority runs no scheme on this platform yet.');
    expect(view('no_scheme', OVERVIEW_NO_SCHEME)).not.toContain('data-kv-dbt-counts');
    expect(text(view('off', null as never))).toContain('The government console is switched off on this platform.');
    expect(text(view('forbidden', null as never))).toContain('Your role here does not include reading applications to your schemes.');
    const err = view('error', null as never);
    expect(err).toContain('href="/dbt?do=reread&amp;act=confirm" data-kv-retry=""'); expect(err).not.toContain('data-kv-dbt-counts');
    for (const s of ['off', 'forbidden', 'error'] as const) { const t = text(view(s, null as never)); for (const q of [Q1, Q2, Q4]) expect([s, t.includes(q)]).toEqual([s, true]); }
  });
  it.each(Object.entries(CATS))('%s: the refusals BY NAME, every key resolved', (_l, cat) => {
    const h = view('ok', OVERVIEW, cat); const t = text(h);
    for (const k of gov3RefusalKeys('dbt')) expect([k, t.includes(cat[k])]).toEqual([k, true]);
    for (const k of ['gov3.q1', 'gov3.q2', 'gov3.q4', 'gov1.dash.status.disbursed', 'gov3.notDone.title']) expect([k, t.includes(cat[k])]).toEqual([k, true]);
    expect(/gov3\.|gov2\.|gov1\.|common\./.test(t)).toBe(false);
  });
});

describe('PC-56 GOV-3a · B4 — the applications page words `disbursed` as GOV-1b does', () => {
  it.each(Object.entries(CATS))('%s: a marked-disbursed application reads "Marked disbursed by an officer", never "Disbursed"', (_l, cat) => {
    const items = [{ ...LIST[1], status: 'disbursed' }];
    const t = text(renderToStaticMarkup(<ApplicationsListView t={tr(cat)} state="ok" me={ME_OFFICER} items={items} schemes={SCHEMES} nextCursor={null} />));
    expect(t).toContain(cat['gov1.dash.status.disbursed']);
    if (cat === en) expect(t).not.toMatch(/(^|[^y] )Disbursed\b/);
  });
});
