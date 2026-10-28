// apps/web-partner/src/test-render/lender-repayments.render.test.tsx · PC-56 PARTNER-4b · W211 (canon `lender/repayments`) — what was
// RECORDED in the window, the SIX arrears buckets, and THE HONEST REASON the four arrears buckets are zero. The load-bearing assertions:
// zero percentage signs; the whole collections code of conduct refused BY NAME (M8 plants the canon's sentence and this file turns red); the
// two kept sentences present in all three languages; and the four zeros never printed without the reason beside them.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderRepaymentsView } from '../components/partner4/LenderRepaymentsView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { ARREARS_ROWS, arrearsKey } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { ARREARS, ARREARS_EMPTY, ARREARS_MIXED, COLLECTED, COLLECTED_EMPTY, FALSE_4B } from './partner4b-fixtures';

type Props = Parameters<typeof LenderRepaymentsView>[0];
const r = (over: Partial<Props> = {}) => renderToStaticMarkup(
  <LenderRepaymentsView t={tr(en)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} {...over} />);

describe('PC-56 PARTNER-4b · W211 the repayments page (render)', () => {
  it('NOT ONE PERCENTAGE SIGN in the visible text, in any language and in any state (M6 and M8 kill here)', () => {
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'empty', 'error', 'off'] as const) {
        const w = text(renderToStaticMarkup(
          <LenderRepaymentsView t={tr(cat)} lang="en" state={state}
            collected={state === 'empty' ? COLLECTED_EMPTY : state === 'ok' ? COLLECTED : null}
            arrears={state === 'empty' ? ARREARS_EMPTY : state === 'ok' ? ARREARS : null} />));
        expect([state, percents(w)]).toEqual([state, 0]);
      }
    }
  });
  it('the collected window is a count, a bigint sum and a count of loans, with the RECORDED caveat and the as-of', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-lender="repayments"');
    expect(html).toContain('data-kv-counts="collected"');
    expect(html).toContain('data-kv-count="collected"');
    expect(html).toContain('data-kv-count="loans"');
    expect(w).toContain(en['partner4.portfolio.fy'].replace('{fy}', '2026-27'));
    expect(html).toContain('data-kv-recorded-note="true"');
    expect(w).toContain(en['partner4.repayments.recordedNote']);
    expect(w).toContain('₹12,540.00');                     // Σ amount paid, bigint-exact
    expect(html).toContain('data-kv-asof="2026-10-28T06:30:00.000Z"');
  });
  it('the SIX arrears buckets in order, counts and bigint sums, the days spelled out and the acronym never printed', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-table="arrears"');
    for (const b of ARREARS_ROWS) {
      expect([b, html.includes(`data-kv-arrears-row="${b}"`)]).toEqual([b, true]);
      expect([b, w.includes(en[arrearsKey(b)])]).toEqual([b, true]);
    }
    // the four arrears buckets are marked as arrears; the two that explain them are not
    expect((html.match(/data-kv-arrears="true"/g) ?? []).length).toBe(4);
    expect((html.match(/data-kv-arrears="false"/g) ?? []).length).toBe(2);
    expect(w).toContain('₹9,00,71,99,25,47,409.93');        // the bigint outstanding of the loans with no due date, exact to the paisa
    expect(/\bDPD\b/.test(w)).toBe(false);
  });
  it('THE ALL-ZERO TRUTH: the four zeros are never printed alone — the reason is printed beside them, with its count, in all three languages', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(<LenderRepaymentsView t={tr(cat)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} />);
      expect(html).toContain('data-kv-arrears-why="noDates"');
      expect(text(html)).toContain(cat['partner4.arrears.why.noDates'].replace('{serviced}', '4'));
    }
    // the other three reasons render too, each with its own marker and its own sentence
    expect(r({ arrears: ARREARS_MIXED })).toContain('data-kv-arrears-why="someDates"');
    expect(text(r({ arrears: ARREARS_MIXED }))).toContain(en['partner4.arrears.why.someDates'].replace('{loans}', '3').replace('{serviced}', '12'));
    expect(r({ arrears: { ...ARREARS_MIXED, noDueDate: { count: 0, outstandingMinor: '0' } } })).toContain('data-kv-arrears-why="dates"');
    expect(r({ state: 'empty', arrears: ARREARS_EMPTY, collected: COLLECTED_EMPTY })).toContain('data-kv-arrears-why="none"');
    expect(en['partner4.arrears.why.noDates']).toMatch(/this platform records no due date on any loan/);
  });
  it('THE TWO KEPT SENTENCES, in all three languages — and neither names a family, a figure of hers or the way she paid', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(<LenderRepaymentsView t={tr(cat)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} />);
      expect(html).toContain('data-kv-kept-line="dairyCycle"');
      expect(html).toContain('data-kv-kept-line="autoDeduction"');
      expect(text(html)).toContain(cat['partner4.repayments.dairyCycleTruth']);
      expect(text(html)).toContain(cat['partner4.repayments.autoDeduction']);
    }
    expect(en['partner4.repayments.dairyCycleTruth']).toBe('A loan that repays itself from the dairy cycle never becomes a knock on the door.');
    expect(en['partner4.repayments.autoDeduction']).toMatch(/the dairy cycle does not need this screen/);
    // the error state keeps the second one, because it is exactly what a failed read does not change
    expect(text(r({ state: 'error', collected: null, arrears: null }))).toContain(en['partner4.repayments.error.body']);
  });
  it('THE COLLECTIONS CODE OF CONDUCT IS REFUSED BY NAME, with its hours, its log, its ban and its penalty each named (founder 4b-5)', () => {
    const html = r(); const w = text(html);
    for (const id of ['code_of_conduct', 'contact_hours', 'contact_log', 'third_party_agents', 'partner_suspension']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
    expect(w).toContain(en['partner4.refusal.codeOfConduct']);
    expect(en['partner4.refusal.codeOfConduct']).toMatch(/intend to build, not as something we are already doing/);
    // and the canon's own sentence appears NOWHERE on the page, in any language (M8)
    for (const cat of [en, hi, gu]) {
      const t2 = text(renderToStaticMarkup(<LenderRepaymentsView t={tr(cat)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} />));
      expect(/code of conduct|platform-enforced|contact hours \d|third[- ]?party agents|violation|partner suspension/i.test(t2)).toBe(false);
    }
  });
  it('no borrower, no way she paid, no due figure and no punctuality figure anywhere outside the refusal list', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(<LenderRepaymentsView t={tr(cat)} lang="en" state="ok" collected={COLLECTED} arrears={ARREARS} />);
      expect(IDENTITY_4A.test(html)).toBe(false);
      expect(FALSE_4B.test(text(withoutRefusals(html)))).toBe(false);
    }
    const keys = partner4RefusalKeys('repayments');
    expect(keys.length).toBeGreaterThanOrEqual(15);
    for (const k of keys) expect([k, text(r()).includes(en[k])]).toEqual([k, true]);
  });
  it('Export is DECOR into its own chain; "see the whole book" is a real link; and the states are ok / empty / error / off', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="export"');
    expect(html).toContain('href="/lender/repayments?export=queued"');
    expect(html).toContain('data-kv-real="portfolio"');
    expect(html).toContain('href="/lender/portfolio"');
    expect(r({ state: 'empty', arrears: ARREARS_EMPTY, collected: COLLECTED_EMPTY })).toContain('kv-empty-state');
    expect(r({ state: 'error', collected: null, arrears: null })).toContain('role="alert"');
    const off = r({ state: 'off', collected: null, arrears: null });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).not.toMatch(/lending is (switched )?off/i);
  });
});
