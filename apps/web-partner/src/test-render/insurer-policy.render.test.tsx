// apps/web-partner/src/test-render/insurer-policy.render.test.tsx · PC-56 PARTNER-2a · W250 one policy — the facts; NO subject block (no animal
// tag, no breed, no health record, no valuation), NO holder, NO payment reference (founder Q6); "Issue" / "Cancel" / "Endorse" are DECOR links
// into the W2888–W2890 chain and "Download policy document" into W2886–W2887 (founder Q5, P2-B7) — never a form.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerPolicyView } from '../components/partner2/InsurerPolicyView';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A, POLICIES, POLICY } from './partner2a-fixtures';

describe('PC-56 PARTNER-2a · W250 one policy (render)', () => {
  const html = renderToStaticMarkup(<InsurerPolicyView t={tr(en)} lang="en" p={POLICY} failure={null} />);
  const w = text(html);
  it('the facts: "no policy number yet", product, organisation, subject type, sum insured, the farmer\'s premium as stored, dates, reference', () => {
    expect(w).toContain('no policy number yet');
    for (const f of ['product', 'fpo', 'subject', 'sum_insured', 'premium', 'valid', 'created', 'reference']) expect(html).toContain(`data-kv-fact="${f}"`);
    expect(w).toContain('Fixture cattle cover'); expect(w).toContain('An animal'); expect(w).toContain('₹1,60,000.00');
    expect(w).toContain(en['partner2.policy.coverStarted']);
  });
  it('no subject block, no holder, no payment reference — and the refusals by name', () => {
    for (const k of partner2RefusalKeys('ins_policy')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    // outside the refusal sentences (which NAME what is not shown), no subject, holder or payment word at all
    const facts = partner2RefusalKeys('ins_policy').reduce((acc, k) => acc.replace(en[k], ''), w);
    expect(facts).not.toMatch(/\btag\b|breed|vaccin|health|valuation|holder name|phone|payment_id|pmt-|land parcel/i);
    expect(w).not.toMatch(FALSE_2A);
  });
  it('Issue / Cancel / Endorse / Download are DECOR links into the chains on this page; no form', () => {
    const self = `/insurer/policies/${POLICY.id}`;
    for (const d of ['issue', 'cancel', 'endorse']) expect(html).toContain(`data-kv-decor="${d}"`);
    expect(html).toContain(`href="${self}?act=confirm"`); expect(html).toContain(`href="${self}?export=queued"`);
    expect(html).not.toContain('<form');
  });
  it('a proposed policy says "awaiting the farmer\'s payment — not cover"; a numbered one prints its number; another insurer\'s → not found', () => {
    const p = text(renderToStaticMarkup(<InsurerPolicyView t={tr(en)} lang="en" p={POLICIES[1]} failure={null} />));
    expect(p).toContain(en['partner2.policy.awaitingPayment']); expect(p).toContain('INS-FIXTURE-0002');
    const nf = text(renderToStaticMarkup(<InsurerPolicyView t={tr(en)} lang="en" p={null} failure={null} notFound />));
    expect(nf).toContain(en['partner2.policy.notFound.title']); expect(nf).not.toMatch(/not yours|another insurer/i);
    const off = renderToStaticMarkup(<InsurerPolicyView t={tr(en)} lang="en" p={null} failure="insurance_off" />);
    expect(text(off)).toContain(en['partner2.insuranceOff.title']);
  });
});
