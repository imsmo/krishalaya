// apps/web-partner/src/test-render/lender-product.render.test.tsx · PC-56 PARTNER-2c · W209 ONE OF THE LENDER'S LOAN PRODUCTS — READ-ONLY: every
// stored field as data, the rates in integer basis points, the eligibility rules printed as the lender's own stored JSON (nothing evaluated),
// the required documents, the origination fee sentence ("recorded on the product … nothing is charged today"), Choose kind / Save as DECOR
// links into the W2980–W2983 chain ON THIS PAGE (founder Q7), the refusals by name; another lender's id → "not found"; error and OFF states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { LenderProductView } from '../components/partner2/LenderProductView';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2C, FLOAT_RATE, PRODUCT, SHELF, withoutRefusals } from './partner2c-fixtures';

describe('PC-56 PARTNER-2c · W209 one loan product, READ-ONLY (render)', () => {
  const html = renderToStaticMarkup(<LenderProductView t={tr(en)} lang="en" p={PRODUCT} failure={null} mailbox={{ kind: 'none' }} />);
  const w = text(html);
  const fact = (id: string) => text((new RegExp(`data-kv-fact="${id}"><dt>[^<]*</dt><dd>([^<]*)</dd>`).exec(html) ?? [])[1] ?? '').trim();
  it('every stored field as data — the rates as integer bps, no percentage or float anywhere', () => {
    expect(w).toContain(en['partner2.loanProducts.product.readOnly']);
    expect([fact('kind'), fact('currency'), fact('apr'), fact('subvention'), fact('net'), fact('tenure'), fact('ltv'), fact('collateral'), fact('repayment')])
      .toEqual(['crop', 'INR', '725 bps', '300 bps', '425 bps', '6 to 12 months', 'not set', 'None', 'Aligned to the harvest']);
    expect(fact('amount')).toBe(`${formatMoneyMinor('5000000', 'INR', 'en')} to ${formatMoneyMinor('50000000', 'INR', 'en')}`);
    expect([fact('applications30d'), fact('status'), fact('documents')]).toEqual(['3', 'Active', 'land_record']);
    expect(w).not.toMatch(FLOAT_RATE); expect(w).not.toContain('%');
  });
  it('the origination fee is data: "recorded on the product … the platform\'s fee leg is not live; nothing is charged today"', () => {
    expect(fact('fee')).toBe(`recorded on the product: ${formatMoneyMinor('150000', 'INR', 'en')} per loan / 50 bps — the platform's fee leg is not live; nothing is charged today`);
  });
  it('the eligibility rules printed as the lender\'s own stored JSON (nothing evaluated)', () => {
    expect(html).toContain('data-kv-eligibility="true"');
    expect(w).toContain('"min_land_acres": 1'); expect(w).toContain('"cotton"');
    expect(w).toContain(en['partner2.loanProducts.eligibility']);
  });
  it('"Choose kind" / "Save" are DECOR links into the form chain on THIS page; Reload into the re-read chain; no form', () => {
    const self = `/lender/products/${PRODUCT.id}`;
    expect(html).toContain(`data-kv-decor="choose-kind" href="${self}?form=review"`); expect(html).toContain(`data-kv-decor="save" href="${self}?form=review"`);
    expect(html).toContain(`href="${self}?act=confirm"`); expect(html).not.toContain('<form');
    expect(html).toContain('data-kv-ops-mailbox="none"');
  });
  it('the refusals by name (founder Q7, the member estimate, the fee bearer, the rate limit …); no canon claim outside them', () => {
    for (const k of partner2RefusalKeys('loan_product')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_2C);
  });
  it('a product whose kind does not resolve prints "kind not registered"; unresolved documents print their count', () => {
    const h = text(renderToStaticMarkup(<LenderProductView t={tr(en)} lang="en" p={{ ...SHELF[1], computedAt: PRODUCT.computedAt, windowDays: 30 }} failure={null} />));
    expect(h).toContain('kind not registered'); expect(h).toContain('2 document types recorded'); expect(h).toContain('7000 bps');
  });
  it('another lender\'s id → "not found"; error; OFF', () => {
    const nf = text(renderToStaticMarkup(<LenderProductView t={tr(en)} lang="en" p={null} failure={null} notFound />));
    expect(nf).toContain(en['partner2.loanProducts.notFound.title']); expect(nf).not.toMatch(/another lender|not yours/i);
    const x = renderToStaticMarkup(<LenderProductView t={tr(en)} lang="en" p={null} failure="error" />);
    expect(x).toContain('data-kv-state="error"'); expect(x).not.toMatch(/unavailable/i);
    expect(text(renderToStaticMarkup(<LenderProductView t={tr(en)} lang="en" p={null} failure="off" />))).toContain(en['partner.off.title']);
  });
});
