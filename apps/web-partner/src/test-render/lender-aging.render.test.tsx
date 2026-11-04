// apps/web-partner/src/test-render/lender-aging.render.test.tsx · PC-56 PARTNER-5a · W223 (canon `lender/portfolio/aging`) — the platform's
// SIX rows in order with no due date recorded FIRST and the statement beside it; the sum-check sentence with BOTH figures; the restructured
// count with the restructured note; computedAt; Export DECOR, Retry into its chain, "View portfolio" real; empty / error / off. The
// load-bearing assertions: ZERO percentage signs (M5 kills here), no "up to date" bucket, no acronym, no nightly job, no missed instalments.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderAgingView } from '../components/partner5/LenderAgingView';
import { partner5RefusalKeys } from '../features/partner5/refusals';
import { AGING_ROWS, agingKey } from '../features/partner5/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { percents, withoutRefusals } from './partner4a-fixtures';
import { COUNTS_5A, COUNTS_5A_NONE, DPD, DPD_EMPTY, DPD_MISMATCH, DPD_MIXED, FALSE_5A } from './partner5a-fixtures';

type Props = Parameters<typeof LenderAgingView>[0];
const r = (over: Partial<Props> = {}, cat: Record<string, string> = en) => renderToStaticMarkup(
  <LenderAgingView t={tr(cat)} lang="en" state="ok" dpd={DPD} counts={COUNTS_5A} {...over} />);

describe('PC-56 PARTNER-5a · W223 days past a recorded due date (render)', () => {
  it('NOT ONE PERCENTAGE SIGN in the visible text — nor in the markup — in any language and any state (M5 kills here)', () => {
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'empty', 'error', 'off'] as const) {
        const html = r({ state, dpd: state === 'empty' ? DPD_EMPTY : state === 'ok' ? DPD : null, counts: state === 'ok' || state === 'empty' ? COUNTS_5A : null }, cat);
        expect([state, percents(text(html))]).toEqual([state, 0]);
        expect([state, html.includes('%')]).toEqual([state, false]);
      }
      for (const dpd of [DPD_MIXED, DPD_MISMATCH]) expect(percents(text(r({ dpd }, cat)))).toBe(0);
    }
  });
  it('the SIX rows in the fixed order — no due date recorded FIRST — each a count and a bigint sum, the days spelled out', () => {
    const html = r({ dpd: DPD_MIXED }); const w = text(html);
    expect(html).toContain('data-kv-lender="aging"');
    const order = [...html.matchAll(/data-kv-aging-row="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual([...AGING_ROWS]);
    expect(order[0]).toBe('no_due_date');
    for (const b of AGING_ROWS) expect([b, w.includes(en[agingKey(b)])]).toEqual([b, true]);
    expect((html.match(/data-kv-behind="true"/g) ?? []).length).toBe(4);
    expect(w).toContain('₹4,800.00');                                        // the 1–30 row's bigint sum
    // today's truth: every servicing loan undated, the bigint past 2^53 exact to the paisa
    expect(text(r())).toContain('₹9,00,71,99,25,47,409.93');
    // no row is a link: a drill-down would list the loans behind (refused)
    expect(/<tr[^>]*data-kv-aging-row[^>]*>(?:(?!<\/tr>).)*<a /s.test(html)).toBe(false);
  });
  it('the no-due-date row is labelled with the statement when it is non-zero, in all three languages — and not when it is zero', () => {
    for (const cat of [en, hi, gu]) {
      const html = r({}, cat);
      expect(html).toContain('data-kv-statement="partner5.aging.statement"');
      expect(html).toMatch(/data-kv-aging-row="no_due_date"[^>]*aria-describedby="kv-aging-statement"|aria-describedby="kv-aging-statement"[^>]*data-kv-aging-row="no_due_date"/);
      expect(text(html)).toContain(cat['partner5.aging.statement']);
    }
    const zero = r({ dpd: { ...DPD_MIXED, buckets: { ...DPD_MIXED.buckets, no_due_date: { count: 0, outstandingMinor: '0' } } } });
    expect(zero).not.toContain('data-kv-statement="partner5.aging.statement"');
  });
  it('the sum-check prints BOTH figures, and a disagreement is printed as one — never a tick alone', () => {
    const w = text(r());
    expect(r()).toContain('data-kv-sum-check="equal"');
    expect(w).toContain(en['partner5.aging.sumCheck'].replace('{sum}', '₹9,00,71,99,25,47,409.93').replace('{total}', '₹9,00,71,99,25,47,409.93'));
    expect(text(r({ dpd: DPD_MIXED }))).toContain('₹27,000.00 = ₹27,000.00');
    const off = r({ dpd: DPD_MISMATCH });
    expect(off).toContain('data-kv-sum-check="unequal"');
    expect(text(off)).toContain(en['partner5.aging.sumMismatch'].replace('{sum}', '₹27,000.00').replace('{total}', '₹27,000.01'));
    expect(/✓/.test(text(r()))).toBe(false);
  });
  it('the restructured count from the WINDOWED counts read, labelled with its window, and the restructured note IFF it is above zero', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-restructured="2"');
    expect(w).toContain(en['partner5.aging.restructured'].replace('{window}', en['partner4.portfolio.fy'].replace('{fy}', '2026-27')).replace('{n}', '2'));
    expect(html).toContain('data-kv-statement="partner5.aging.restructuredNote"');
    expect(w).toContain(en['partner5.aging.restructuredNote']);
    const none = r({ counts: COUNTS_5A_NONE });
    expect(none).toContain('data-kv-restructured="0"');
    expect(none).not.toContain('data-kv-statement="partner5.aging.restructuredNote"');
    expect(text(r())).toContain(en['partner5.aging.windowsNote']);
  });
  it('computedAt is the as-of; Export is DECOR into its chain; Retry is the chain; "View portfolio" is a real link', () => {
    const html = r();
    expect(html).toContain('data-kv-asof="2026-11-04T06:30:00.000Z"');
    expect(html).toContain('data-kv-decor="export"');
    expect(html).toContain('href="/lender/portfolio/aging?export=queued"');
    expect(html).toContain('data-kv-real="portfolio"');
    expect(html).toContain('href="/lender/portfolio"');
    const err = r({ state: 'error', dpd: null, counts: null });
    expect(err).toContain('role="alert"');
    expect(err).toContain('href="/lender/portfolio/aging?act=confirm"');
    expect(html).toContain('data-kv-subnav-item="/lender/portfolio/aging"');
    expect(html).toMatch(/aria-current="page"[^>]*data-kv-subnav-item="\/lender\/portfolio\/aging"/);
  });
  it('no canon claim outside the refusal list: no "%", no acronym, no "up to date" bucket, no missed instalments, no nightly job, no review', () => {
    for (const cat of [en, hi, gu]) for (const dpd of [DPD, DPD_MIXED]) {
      const w = text(withoutRefusals(r({ dpd }, cat)));
      expect(FALSE_5A.test(w)).toBe(false);
      expect(/\bcurrent\b|missed|arrears \(|\bDPD\b|nightly|pre-?NPA/i.test(w)).toBe(false);
    }
    const keys = partner5RefusalKeys('aging');
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) expect([k, text(r()).includes(en[k])]).toEqual([k, true]);
  });
  it('the states: empty ("no servicing loan on your products yet"), error, off — and never "lending is off"', () => {
    const empty = r({ state: 'empty', dpd: DPD_EMPTY });
    expect(empty).toContain('kv-empty-state');
    expect(text(empty)).toContain(en['partner5.aging.empty.title']);
    expect(en['partner5.aging.empty.title']).toMatch(/no servicing loan on your products yet/i);
    const off = r({ state: 'off', dpd: null, counts: null });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.title']);
    for (const s of ['ok', 'empty', 'error', 'off'] as const) expect(text(r({ state: s }))).not.toMatch(/lending is (switched )?off/i);
  });
});
