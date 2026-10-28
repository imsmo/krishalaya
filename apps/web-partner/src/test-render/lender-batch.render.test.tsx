// apps/web-partner/src/test-render/lender-batch.render.test.tsx · PC-56 PARTNER-4b · W218 (canon `lender/disbursements/[id]`) — AN HONEST
// PAGE: whose money moves, who signs, and the three things the platform really does. It makes NO read, so it has NO error state of its own
// and prints NO count: its state is the platform's flag map. The load-bearing assertions are the founder's two sentences (4b-3, 4b-4), the
// three TRUE lines, and the absence of the batch-contents table with its people and their banks.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderBatchView } from '../components/partner4/LenderBatchView';
import { partner4RefusalKeys } from '../features/partner4/refusals';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { hi } from '../i18n/hi';
import { text, tr } from './partner1a-fixtures';
import { IDENTITY_4A, percents, withoutRefusals } from './partner4a-fixtures';
import { FALSE_4B } from './partner4b-fixtures';

const r = (state: 'ok' | 'off' | 'error' = 'ok', cat: Record<string, string> = en) =>
  renderToStaticMarkup(<LenderBatchView t={tr(cat)} state={state} />);

describe('PC-56 PARTNER-4b · W218 the batch page (render)', () => {
  it('NOT ONE PERCENTAGE SIGN, and no figure of any kind: this page counts nothing', () => {
    for (const cat of [en, hi, gu]) {
      for (const state of ['ok', 'off', 'error'] as const) expect([state, percents(text(r(state, cat)))]).toEqual([state, 0]);
    }
    const html = r();
    expect(html).not.toContain('data-kv-count');
    expect(html).not.toContain('data-kv-asof');
    expect(html).not.toContain('<table');
  });
  it('WHOSE MONEY MOVES — the founder\'s sentence, in all three languages (4b-4)', () => {
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="whoseMoney"');
      expect(text(html)).toContain(cat['partner4.batch.whoseMoney']);
      expect(text(html)).toContain(cat['partner4.batch.neverYours']);
    }
    expect(en['partner4.batch.whoseMoney']).toMatch(/prepared and confirmed by the organisation that serves the farmer/);
    expect(en['partner4.batch.neverYours']).toMatch(/never moves a lender’s money, and a lender never moves the organisation’s/);
  });
  it('WHO SIGNS — there is no second signature worth the name, and the real two-person step is named as owed (4b-3)', () => {
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      expect(html).toContain('data-kv-statement="whoSigns"');
      expect(text(html)).toContain(cat['partner4.batch.whoSigns']);
      expect(text(html)).toContain(cat['partner4.batch.realCheckerOwed']);
    }
    expect(en['partner4.batch.whoSigns']).toMatch(/a user id typed into the same request by the one person making it/);
    expect(en['partner4.batch.realCheckerOwed']).toMatch(/with the list frozen in between/);
    // and the refusal is registered as well as stated
    expect(r()).toContain('data-kv-refusal="second_signature"');
  });
  it('THE THREE TRUE THINGS, each in its own line and each in all three languages', () => {
    for (const cat of [en, hi, gu]) {
      const html = r('ok', cat);
      for (const l of ['total', 'preflight', 'allOrNothing']) {
        expect([l, html.includes(`data-kv-true="${l}"`)]).toEqual([l, true]);
        expect([l, text(html).includes(cat[`partner4.batch.true.${l}`])]).toEqual([l, true]);
      }
    }
    expect(en['partner4.batch.true.total']).toMatch(/BEFORE a single row is written/);
    expect(en['partner4.batch.true.preflight']).toMatch(/told the real reason and not an account problem/);
    expect(en['partner4.batch.true.allOrNothing']).toMatch(/nothing was disbursed/);
  });
  it('the batch-contents table, the product rule, the fee and the automatic assembly are refused BY NAME; nothing of a person is drawn', () => {
    const html = r(); const w = text(html);
    const keys = partner4RefusalKeys('disbursement_batch');
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const k of keys) expect([k, w.includes(en[k])]).toEqual([k, true]);
    for (const id of ['batch_contents_table', 'cattle_insurance_rule', 'product_rule_engine', 'origination_fee', 'awaiting_coapproval',
      'maker_checker_claim', 'auto_retries', 'batch_added_to', 'coapprove_act', 'bank_limit_delegation']) {
      expect([id, html.includes(`data-kv-refusal="${id}"`)]).toEqual([id, true]);
    }
    for (const cat of [en, hi, gu]) {
      expect(IDENTITY_4A.test(r('ok', cat))).toBe(false);
      expect(FALSE_4B.test(text(withoutRefusals(r('ok', cat))))).toBe(false);
    }
  });
  it('"approve and pay now" is DECOR into the singular chain; the pay-outs page is a real link back; and OFF reads as OFF', () => {
    const html = r();
    expect(html).toContain('data-kv-decor="coApprove"');
    expect(html).toContain('href="/lender/disbursements/pending?act=confirm"');
    expect(html).toContain('data-kv-real="payouts"');
    expect(html).toContain('href="/lender/disbursements"');
    // the sub-navigation is drawn, and this page is NOT one of its rows (it is not a nav destination)
    expect(html).toContain('data-kv-subnav="lending"');
    expect(html).not.toContain('aria-current="page"');
    const off = r('off');
    expect(off).toContain('data-kv-state="off"');
    expect(text(off)).toContain(en['partner.off.body']);
    expect(text(off)).not.toMatch(/lending is (switched )?off/i);
    // there is NO error state of its own: an unreadable flag map still prints the honest page
    const err = r('error');
    expect(err).toContain('data-kv-state="error"');
    expect(err).not.toContain('role="alert"');
    expect(text(err)).toContain(en['partner4.batch.whoseMoney']);
  });
});
