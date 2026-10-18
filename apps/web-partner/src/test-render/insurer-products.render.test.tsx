// apps/web-partner/src/test-render/insurer-products.render.test.tsx · PC-56 PARTNER-2a · W246 + W247 — the insurer's OWN products: the kind "not
// registered", its own rate from integer basis points ("3.2%" from 320), a stored formula the platform cannot price shown as stored (nothing
// evaluated), the government's share and the commission "recorded … nothing is charged against them today" (founder Q4), New product / Choose
// kind / Save as DECOR links into the W2869–W2872 chain (founder Q7) — never a form. The product page is read-only.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InsurerProductsView } from '../components/partner2/InsurerProductsView';
import { InsurerProductView } from '../components/partner2/InsurerProductView';
import { listState } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';
import { FALSE_2A, PRODUCTS } from './partner2a-fixtures';

describe('PC-56 PARTNER-2a · W246 the insurer\'s products (render)', () => {
  const html = renderToStaticMarkup(<InsurerProductsView t={tr(en)} lang="en" state={listState(PRODUCTS, null)} items={PRODUCTS} computedAt="2026-10-18T06:30:00.000Z" />);
  const w = text(html);
  it('each own product: kind not registered, own rate from bps, the unpriceable terms named, subsidy / commission recorded, parametric, status, policies', () => {
    expect(html).toContain(`href="/insurer/products/${PRODUCTS[0].id}"`);
    expect(w).toContain('kind not registered');
    expect(w).toContain('3.2% of the sum insured (320 basis points)');
    expect(w).toContain(en['partner2.formula.notPriceable']);
    expect(w).toContain('2.5% (250 basis points), recorded'); expect(w).toContain('40.0% (4000 basis points), recorded');
    expect(w).toContain(en['partner2.products.recordedNote']);
    expect(w).toContain('Inactive'); expect(w).toContain('Active');
    expect(html).toContain('data-kv-recorded="true"');
  });
  it('"New product" is DECOR (a link into the chain, never a form); the refusals by name; no canon false claim', () => {
    expect(html).toContain('href="/insurer/products?form=review"'); expect(html).not.toContain('<form');
    for (const k of partner2RefusalKeys('ins_products')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).not.toMatch(FALSE_2A); expect(w).not.toMatch(/\b11\b|\b13\b/);
  });
  it('empty and error states (no outage sentence)', () => {
    const e = text(renderToStaticMarkup(<InsurerProductsView t={tr(en)} lang="en" state={listState([], null)} items={[]} computedAt={null} />));
    expect(e).toContain(en['partner2.products.empty.title']);
    const x = renderToStaticMarkup(<InsurerProductsView t={tr(en)} lang="en" state="error" items={[]} computedAt={null} />);
    expect(x).toContain('href="/insurer/products?retry=confirm"'); expect(x).not.toMatch(/unavailable/i);
  });
});

describe('PC-56 PARTNER-2a · W247 one product, READ-ONLY (render)', () => {
  const html = renderToStaticMarkup(<InsurerProductView t={tr(en)} lang="en" p={{ ...PRODUCTS[1], computedAt: '2026-10-18T06:30:00.000Z' }} failure={null} />);
  const w = text(html);
  it('every stored field as data — the stored terms printed as stored text, nothing evaluated; policies by status', () => {
    expect(w).toContain(en['partner2.product.readOnly']);
    expect(html).toContain('data-kv-stored-terms="true"');
    expect(w).toContain('"index": "rainfall"');
    expect(w).toContain('Index-based Yes');
    expect(html).toContain('data-kv-policy-counts="true"'); expect(w).toContain('Cancelled: 1'); expect(w).toContain('In force: 0');
    expect(w).toContain(en['partner2.products.recordedNote']);
  });
  it('Choose kind / Save are DECOR links into the chain on THIS page; the trigger and payout copy refused; no form', () => {
    expect(html).toContain(`href="/insurer/products/${PRODUCTS[1].id}?form=review"`);
    expect(html).toContain('data-kv-decor="choose-kind"'); expect(html).toContain('data-kv-decor="save"'); expect(html).not.toContain('<form');
    for (const k of partner2RefusalKeys('ins_product')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(w).not.toMatch(FALSE_2A);
  });
  it('another insurer\'s product → "not found", never "not yours"', () => {
    const nf = text(renderToStaticMarkup(<InsurerProductView t={tr(en)} lang="en" p={null} failure={null} notFound />));
    expect(nf).toContain(en['partner2.product.notFound.title']); expect(nf).not.toMatch(/not yours|another insurer/i);
  });
});
