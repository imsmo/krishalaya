// apps/web-partner/src/test-render/lender-payouts.render.test.tsx · PC-56 PARTNER-4b · W210 (canon `lender/disbursements`) — the cooling-off
// pipeline as FOUR COUNTS, the sentence about the waiting period that is KEPT because it is true, the one money act as DECOR refused by name,
// and NO TABLE OF PEOPLE. Zero percentage signs, in every language and every state.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderPayoutsView } from '../components/partner4/LenderPayoutsView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { PIPELINE_CHIPS } from '../features/partner4/figures';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_4B, PIPELINE, PIPELINE_EMPTY } from './partner4b-fixtures';

type Props = Parameters<typeof LenderPayoutsView>[0];
const r = (over: Partial<Props> = {}) => renderToStaticMarkup(
  <LenderPayoutsView t={tr(en)} lang="en" state="ok" pipeline={PIPELINE} {...over} />);

describe('PC-56 PARTNER-4b · W210 the pay-outs page (render)', () => {
  it('NOT ONE PERCENTAGE SIGN in the visible text, in any language and in any state (M6 kills here)', () => {
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'empty', 'error', 'off'] as const) {
        const w = text(renderToStaticMarkup(
          <LenderPayoutsView t={tr(cat)} lang="en" state={state} pipeline={state === 'empty' ? PIPELINE_EMPTY : state === 'ok' ? PIPELINE : null} />));
        expect([state, percents(w)]).toEqual([state, 0]);
      }
    }
  });
  it('the FOUR counts in the canon\'s order, with the window label, the window caveat, the counts-only note and the as-of', () => {
    const html = r(); const w = text(html);
    expect(html).toContain('data-kv-lender="payouts"');
    expect(html).toContain('data-kv-counts="pipeline"');
    for (const id of PIPELINE_CHIPS) expect([id, html.includes(`data-kv-count="${id}"`)]).toEqual([id, true]);
    expect(w).toContain(en['partner4.portfolio.fy'].replace('{fy}', '2026-27'));
    expect(w).toContain(en['partner4.payouts.windowNote']);
    expect(w).toContain(en['partner4.portfolio.countsOnly']);
    expect(html).toContain('data-kv-asof="2026-10-28T06:30:00.000Z"');
    // the counts themselves, as integers
    for (const n of ['75', '8', '6', '61']) expect([n, w.includes(n)]).toEqual([n, true]);
  });
  it('THE KEPT SENTENCE: the waiting period is held by the server, in all three languages — and it never says "clock"', () => {
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(<LenderPayoutsView t={tr(cat)} lang="en" state="ok" pipeline={PIPELINE} />);
      expect(html).toContain('data-kv-kept="coolingOff"');
      expect(text(html)).toContain(cat['partner4.payouts.coolingOffServerSide']);
    }
    expect(en['partner4.payouts.coolingOffServerSide']).toMatch(/never a moment earlier in a lender’s favour/);
    expect(/clock/i.test(en['partner4.payouts.coolingOffServerSide'])).toBe(false);
  });
  it('THERE IS NO TABLE: no borrower, no account, no destination — and no row of any kind is drawn', () => {
    const html = r();
    expect(html).not.toContain('<table');
    expect(html).not.toMatch(/data-kv-(loan|row|borrower|destination)=/);
    expect(IDENTITY_4A.test(html)).toBe(false);
    expect(html).not.toMatch(/kebab|data-kv-bulk/);
  });
  it('the one money act is DECOR into its own chain; the batch page and the queue are REAL links (the inbound edge the canon never drew)', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="pay"');
    expect(html).toContain('href="/lender/disbursements?act=confirm"');
    expect(html).toContain('data-kv-real="batch"');
    expect(html).toContain('href="/lender/disbursements/pending"');
    expect(html).toContain('data-kv-real="queue"');
    expect(html).toContain('href="/lender/queue?status=approved"');
    // the sub-navigation is drawn and this page is the current row
    expect(html).toContain('data-kv-subnav-item="/lender/disbursements"');
    expect(html).toContain('aria-current="page"');
  });
  it('every refusal of the surface is printed BY NAME, in all three languages, and no canon claim survives outside the list', () => {
    const keys = partner4RefusalKeys('disbursements');
    expect(keys.length).toBeGreaterThanOrEqual(11);
    for (const cat of [en, hi, gu]) {
      const html = renderToStaticMarkup(<LenderPayoutsView t={tr(cat)} lang="en" state="ok" pipeline={PIPELINE} />);
      const w = text(html);
      for (const k of keys) expect([k, w.includes(cat[k])]).toEqual([k, true]);
      expect(FALSE_4B.test(text(withoutRefusals(html)))).toBe(false);
    }
    const html = r();
    for (const id of ['ready_batch_act', 'money_destination', 'borrower_destination_columns', 'second_signature', 'bank_maker_checker',
      'double_funding_absolute', 'preflight_not_yours', 'bank_limit_delegation', 'auto_moves_to_ready', 'sanction_letter', 'pipeline_bulk_select']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
  });
  it('the four states: ok, empty, the error that says the waiting period runs anyway, and the console switched off', () => {
    expect(r({ state: 'empty', pipeline: PIPELINE_EMPTY })).toContain('kv-empty-state');
    expect(text(r({ state: 'empty', pipeline: PIPELINE_EMPTY }))).toContain(en['partner4.payouts.empty.body']);
    const err = r({ state: 'error', pipeline: null });
    expect(err).toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.payouts.error.body']);
    expect(err).toContain('href="/lender/disbursements?act=confirm"');
    const off = r({ state: 'off', pipeline: null });
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    // never "lending is switched off": the partner realm does not consult the tenant `fintech` flag
    expect(text(off)).not.toMatch(/lending is (switched )?off/i);
  });
});
