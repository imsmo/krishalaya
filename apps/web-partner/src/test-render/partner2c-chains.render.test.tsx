// apps/web-partner/src/test-render/partner2c-chains.render.test.tsx · PC-56 PARTNER-2c — the lender's two chains as query states of BOTH lender
// pages: the product form chain W2980–W2983 (DECOR — founder Q7: "Loan products are authored by the platform's partner operations … write to the
// partners mailbox to propose a change", the mailbox FACT) and the re-read chain W2984–W2986 (PARITY-DECOR). Each state links back to the page
// it was opened from — the product page's Save never lands on the shelf (the canon's "every step → W208", F-18), and the form failure never
// says "Retry — back to confirm" (a form has no confirm).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerChain } from '../components/partner2/InsurerChain';
import { chain2ById, chain2State, partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2C, PRODUCT } from './partner2c-fixtures';

describe('PC-56 PARTNER-2c · the lender\'s chains (render)', () => {
  const self = `/lender/products/${PRODUCT.id}`;
  it('W2980–W2983: every form state says nothing is authored here, prints Q7\'s refusal and the mailbox fact, and links back to its own page', () => {
    for (const s of chain2ById('lender_form').states) {
      const shelf = renderToStaticMarkup(<InsurerChain t={tr(en)} chain="lender_form" state={s} mailbox={{ kind: 'published', address: 'partners.fixture@example.test' }} />);
      const w = text(shelf);
      expect([s, w.includes(en[`partner2.chain.lenderForm.${s}.title`]), w.includes(en[`partner2.chain.lenderForm.${s}.body`])]).toEqual([s, true, true]);
      expect(w).toContain(en['partner2.refusal.loanProductsPlatformAuthored']);
      expect(w).toContain(en['partner2.loanProducts.proposeChange']); expect(w).not.toContain(en['partner2.export.notAvailable']);
      expect(shelf).toContain('data-kv-ops-mailbox="published"');
      expect(shelf).toContain('data-kv-back="/lender/products"');
      for (const k of partner2RefusalKeys('lender_form')) expect([k, w.includes(en[k])]).toEqual([k, true]);
      const onProduct = renderToStaticMarkup(<InsurerChain t={tr(en)} chain="lender_form" state={s} back={self} mailbox={{ kind: 'none' }} />);
      expect(onProduct).toContain(`data-kv-back="${self}"`); expect(onProduct).not.toContain('data-kv-back="/lender/products"');
      expect(w).not.toMatch(/back to confirm/i); expect(w).not.toMatch(FALSE_2C);
      expect(shelf).not.toContain('<form');
    }
  });
  it('W2984–W2986: Retry is a re-read — nothing to confirm, nothing written, nothing lost; back to its own page', () => {
    for (const s of chain2ById('lender_act').states) {
      const h = renderToStaticMarkup(<InsurerChain t={tr(en)} chain="lender_act" state={s} back={self} />);
      const w = text(h);
      expect([s, w.includes(en[`partner2.chain.lenderAct.${s}.title`]), w.includes(en[`partner2.chain.lenderAct.${s}.body`])]).toEqual([s, true, true]);
      expect(h).toContain(`data-kv-back="${self}"`);
      expect(w).not.toMatch(/zero-sum|on-call|audit trail has/i);
      for (const k of partner2RefusalKeys('lender_act')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    }
  });
  it('the query states: ?form= and ?act= with known states only; anything else is the page itself', () => {
    expect([chain2State('lender_form', { form: 'review' }), chain2State('lender_form', { form: 'confirm' }), chain2State('lender_act', { act: 'failure' }), chain2State('lender_act', { act: 'nope' })])
      .toEqual(['review', null, 'failure', null]);
  });
});
