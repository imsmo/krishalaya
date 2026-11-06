// apps/web-ops/src/test-render/billing.render.test.tsx · PC-56 OPS-2c · W378 /warehouse/billing — A READ OF THE RATE ON FILE (founder Q1-A, Q2-A,
// Q9-A, Q10-A, Q14-A). The rate printed as the server's minor string through the money formatter, labelled "on file now; …"; the founder's two
// sentences verbatim, in en, hi and gu, in every state but switched-off; no "×", "=", "%" or any amount the server did not send (no sum, product or
// difference); no name and no operator id; zero inputs; the WDRA number "as entered, not checked with WDRA"; the switched-off state; the two DECOR acts.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BillingView } from '../components/ops2/BillingView';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { OPS2_REFUSALS } from '../features/ops2/refusals';
import { CONTROLS, text, tr, visible, percents } from './ops1a-fixtures';
import { FALSE_2C, OPERATOR_ID, RATES_PRINTED_2C, WAREHOUSES_2C } from './ops2c-fixtures';

const render = (cat: Record<string, string>, state: 'ok' | 'none' | 'error' | 'off', nextCursor: string | null = null) =>
  renderToStaticMarkup(<BillingView t={tr(cat)} lang="en" state={state} warehouses={state === 'ok' ? WAREHOUSES_2C : []} nextCursor={nextCursor} />);
const html = render(en, 'ok');

describe('PC-56 OPS-2c · /warehouse/billing prints the rate on file and the two founder sentences — never a sum', () => {
  it('each rate is the server string through the money formatter, labelled "on file now; …"; a missing rate says so', () => {
    expect(html).toContain('data-kv-rate="900"'); expect(html).toContain('data-kv-rate="1275"');
    for (const r of RATES_PRINTED_2C) expect([r, text(html).includes(r)]).toEqual([r, true]);
    expect((html.match(/data-kv-rate-label="on-file"/g) ?? []).length).toBe(2);
    expect(en['ops2.billing.rateLabel']).toBe('on file now; the rate at release is used, not the rate when the goods arrived');
    expect(text(html)).toContain(en['ops2.billing.rateLabel']);
    expect(html).toContain('data-kv-rate="none"'); expect(text(html)).toContain('No rate on file');
  });
  it('no amount the server did not send: every ₹ figure on the page is one of the rates (no sum, product or difference), and no "×", "=", "%"', () => {
    const amounts = visible(html).match(/₹\s?[\d,]+(\.\d+)?/g) ?? [];
    expect(amounts.sort()).toEqual([...RATES_PRINTED_2C].sort());
    expect(/[×=]/.test(visible(html))).toBe(false);
    expect(percents(text(html))).toBe(0);
    expect(FALSE_2C.test(visible(html))).toBe(false);
  });
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the founder\'s two sentences verbatim (who would receive the fee today; the rule in words), in ok / none / error', (_l, cat) => {
    for (const s of ['ok', 'none', 'error'] as const) {
      const h = render(cat, s);
      expect([s, text(h).includes(cat['ops2.billing.payee']), text(h).includes(cat['ops2.billing.rule'])]).toEqual([s, true, true]);
    }
  });
  it('the Q1-A sentence is the founder\'s, verbatim; the Q2-A rule is words, never a sum', () => {
    expect(en['ops2.billing.payee']).toBe('Today, if release were switched on, the fee would be paid from the depositor\'s wallet into the warehouse operator\'s own wallet. Release is paused: it has been decided that the fee will go to your organisation\'s account, and release does not come back until that is built and the depositor can confirm it herself.');
    expect(en['ops2.billing.rule']).toBe('The fee is computed once, at release, from the rate on file at that moment, for whole 30-day periods rounded up (minimum one), on the quantity in quintals.');
    for (const cat of [en, hi, gu]) expect(/[×=₹%]/.test(cat['ops2.billing.rule'] + cat['ops2.billing.payee'])).toBe(false);
  });
  it('no name and no id: the warehouse\'s own name is printed; the operator id in the body is not; no depositor anywhere (Q9-A)', () => {
    for (const w of WAREHOUSES_2C) expect(text(html)).toContain(w.defaultName);
    expect(html.includes(OPERATOR_ID)).toBe(false);
    expect(/depositorUserId|holder/i.test(html)).toBe(false);
  });
  it('Q14-A: a WDRA number prints "as entered, not checked with WDRA"; none entered says so', () => {
    expect(text(html)).toContain('TEST-WDRA-17 (as entered, not checked with WDRA)');
    expect((text(html).match(/None entered/g) ?? []).length).toBe(2);
  });
  it('zero inputs in every state (no input, select, textarea, form or button)', () => {
    for (const s of ['ok', 'none', 'error', 'off'] as const) expect([s, CONTROLS.test(render(en, s))]).toEqual([s, false]);
  });
  it('the switched-off state says so and nothing else of substance: no sentence about money, no rate, no act', () => {
    const off = render(en, 'off');
    expect(off).toContain('data-kv-state="off"'); expect(text(off)).toContain(en['ops2.billing.off.body']);
    expect(text(off).includes(en['ops2.billing.payee'])).toBe(false);
    expect(/data-kv-rate=|data-kv-decor=/.test(off)).toBe(false);
  });
  it('the none and error states: no rate; the error offers a plain re-read of this page, never a chain', () => {
    const none = render(en, 'none'); expect(none).toContain('data-kv-empty="warehouses"'); expect(/data-kv-rate=/.test(none)).toBe(false);
    const err = render(en, 'error'); expect(err).toMatch(/<a [^>]*data-kv-real="reread" href="\/warehouse\/billing"/); expect(/data-kv-chain|\?act=failure/.test(err)).toBe(false);
  });
  it('"Export month-to-date" and "Retry run" are DECOR (to their chains, labelled not available); every W378 refusal is listed by name', () => {
    expect(html).toContain('href="/warehouse/billing?export=queued"'); expect(text(html)).toContain('Export month-to-date: not available');
    expect(html).toContain('href="/warehouse/billing?act=confirm"'); expect(text(html)).toContain('Retry run: not available');
    for (const r of OPS2_REFUSALS.filter((x) => x.surfaces.includes('billing'))) expect([r.id, html.includes(`data-kv-refusal="${r.id}"`)]).toEqual([r.id, true]);
  });
  it('a next page is a keyset link to this page (no count, no "of N")', () => {
    const p = render(en, 'ok', 'MjAyNi0xMS0wNnx4');
    expect(p).toContain('href="/warehouse/billing?cursor=MjAyNi0xMS0wNnx4"'); expect(/\bof \d/.test(text(p))).toBe(false);
  });
});
