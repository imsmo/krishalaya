// apps/web-partner/src/test-render/lender-portfolio.render.test.tsx · PC-56 PARTNER-4a · W212 THE PORTFOLIO (canon `lender/portfolio`) —
// counts and bigint sums over the loans OPENED in the FY window, the kind mix over the NINE platform codes + "not recorded", and the book's
// newest loans with the inbound edge to W215 the canon never drew. **The load-bearing assertion of this file is that the visible text carries
// ZERO percentage signs** (founder 4a-5 / 4a-7): no portfolio-at-risk rate, no share of the book, no average ticket, no five-bucket chart and
// no "honest attribution" block. M8 plants one and this file turns red.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderPortfolioView } from '../components/partner4/LenderPortfolioView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { LOAN_KIND_CODES, LOAN_STATUSES, NOT_RECORDED } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { COUNTS, COUNTS_EMPTY, FALSE_4A, IDENTITY_4A, LOANS, percents, withoutRefusals } from './partner4a-fixtures';

type Props = Parameters<typeof LenderPortfolioView>[0];
const r = (over: Partial<Props> = {}) => renderToStaticMarkup(
  <LenderPortfolioView t={tr(en)} lang="en" state="ok" counts={COUNTS} items={LOANS} status={undefined} nextCursor="Y3Vyc29y" computedAt="2026-10-28T06:30:00.000Z" {...over} />);

describe('PC-56 PARTNER-4a · W212 the portfolio (render)', () => {
  it('NOT ONE PERCENTAGE SIGN appears in the visible text, in any language and in any state (M8 kills here)', () => {
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'empty', 'error'] as const) {
        const w = text(renderToStaticMarkup(
          <LenderPortfolioView t={tr(cat)} lang="en" state={state} counts={state === 'empty' ? COUNTS_EMPTY : COUNTS} items={state === 'ok' ? LOANS : []} status={undefined} nextCursor={null} computedAt="2026-10-28T06:30:00.000Z" />));
        expect([state, percents(w)]).toEqual([state, 0]);
      }
    }
  });
  it('the four headline figures are counts and bigint sums, with the FY label, the window caveat, the counts-only note and the as-of', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-lender="portfolio"');
    expect(html).toContain('data-kv-counts="portfolio"');
    for (const id of ['servicing', 'opened', 'restructured', 'written_off']) expect(html).toContain(`data-kv-count="${id}"`);
    expect(w).toContain(en['partner4.portfolio.fy'].replace('{fy}', '2026-27'));
    expect(html).toContain('data-kv-window-note="true"');
    expect(html).toContain('data-kv-counts-only="true"');
    expect(w).toContain(en['partner4.portfolio.windowNote']);
    expect(w).toContain(en['partner4.portfolio.countsOnly']);
    expect(html).toContain('data-kv-asof="2026-10-28T06:30:00.000Z"');
    // the two figures a ratio would be made of, printed as the two figures they are
    expect(w).toContain('4');                         // the servicing count
    expect(w).toContain('₹1,42,410.00');              // Σ outstanding on the servicing statuses, bigint-exact
  });
  it('the kind mix is the NINE platform codes plus "not recorded" LAST — no chart, no bucket, no share', () => {
    const html = r();
    expect(html).toContain('data-kv-table="kind"');
    for (const c of LOAN_KIND_CODES) expect([c, html.includes(`data-kv-kind-row="${c}"`)]).toEqual([c, true]);
    expect(html).toContain(`data-kv-kind-row="${NOT_RECORDED}"`);
    expect(html.indexOf(`data-kv-kind-row="${NOT_RECORDED}"`)).toBeGreaterThan(html.indexOf('data-kv-kind-row="tenant_wc"'));
    expect(text(html)).toContain(en['partner4.portfolio.kindsNote']);
    // no chart is DRAWN — the word appears only inside the refusal that names what the canon drew, so scan the page without the list
    expect(withoutRefusals(html)).not.toMatch(/<svg|<canvas|chart/i);
  });
  it('the status rows are the five the platform can produce; `transferred` is nowhere, as a row or as a filter', () => {
    const html = r();
    for (const s of LOAN_STATUSES) {
      expect([s, html.includes(`data-kv-status-row="${s}"`)]).toEqual([s, true]);
      expect([s, html.includes(`data-kv-status-filter="${s}"`)]).toEqual([s, true]);
    }
    // `transferred` appears ONLY inside the refusal that names it — never as a row, a filter or a status word on the page
    expect(withoutRefusals(html)).not.toContain('transferred');
  });
  it('every row links to its own loan — the inbound edge the canon never drew for W215 — and no identity field reaches the markup', () => {
    const html = r();
    for (const l of LOANS) {
      expect(html).toContain(`data-kv-loan="${l.id}"`);
      expect(html).toContain(`href="/lender/portfolio/${l.id}"`);
    }
    expect(text(html)).toContain('Fixture Dairy Collective');            // the cooperative's PUBLIC name
    expect(html).not.toMatch(IDENTITY_4A);
    expect(html).not.toContain('tenantId');
    // a bigint principal past Number.MAX_SAFE_INTEGER, formatted exactly (Indian grouping) — the last two digits are the paise that a
    // JS number would have rounded away
    expect(text(html)).toContain('₹9,00,71,99,25,47,409.93');
  });
  it('Export is DECOR into the chain; "Open the loan queue" is a REAL link; there is no form anywhere', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="export"');
    expect(html).toContain('href="/lender/portfolio?export=queued"');
    expect(html).toContain('data-kv-real="queue"');
    expect(html).toContain('href="/lender/queue"');
    expect(html).not.toContain('<form');
  });
  it('every refusal of the surface is printed BY NAME, in all three languages, and nothing the canon claimed survives outside the list', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(
        <LenderPortfolioView t={tr(cat)} lang="en" state="ok" counts={COUNTS} items={LOANS} status={undefined} nextCursor={null} computedAt={null} />);
      const w = text(html);
      for (const k of partner4RefusalKeys('portfolio')) expect([k, w.includes(cat[k])]).toEqual([k, true]);
      if (cat === en) expect(text(withoutRefusals(html))).not.toMatch(FALSE_4A);
    }
  });
  it('the states: empty (nothing opened in the window), error (servicing is unaffected), the console switched off', () => {
    const empty = r({ state: 'empty', counts: COUNTS_EMPTY, items: [] });
    expect(text(empty)).toContain(en['partner4.portfolio.empty.title']);
    expect(text(empty)).toContain(en['partner4.portfolio.empty.body']);
    expect(empty).toContain('data-kv-real="queue"');
    const err = r({ state: 'error', items: [] });
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.portfolio.error.body']);
    expect(err).not.toContain('data-kv-counts="portfolio"');    // a failed read shows no figure at all
    const off = r({ state: 'off' });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).not.toMatch(/unavailable/i);
  });
  it('the keyset pager carries the status and the opaque cursor', () => {
    expect(r({ status: 'overdue' })).toContain('href="/lender/portfolio?status=overdue&amp;cursor=Y3Vyc29y"');
    expect(r({ nextCursor: null })).not.toContain('data-kv-next');
  });
});
