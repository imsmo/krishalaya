// apps/web-partner/src/test-render/lender-products.render.test.tsx · PC-56 PARTNER-2c · W208 THE LENDER'S OWN SHELF — each own product: the kind
// from the registry or "kind not registered", the amount range in the product's own currency (bigint-exact), the APR, the subvention and the
// net in INTEGER basis points ("net of subsidy" — never a float percentage: M4 kills here), the repayment style, the collateral, the tenure, the
// consented applications in 30 days (a count), active, as-of; "New product" DECOR into the W2980–W2983 chain (founder Q7) with the partners
// mailbox fact; Reload into the W2984–W2986 chain; the refusals by name; empty / error / OFF states.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { LenderProductsView } from '../components/partner2/LenderProductsView';
import { shelfState } from '../features/partner2/figures';
import { partner2RefusalKeys } from '../features/partner2/refusals';
import { en } from '../i18n/en';
import { text, tr } from './partner1a-fixtures';
import { COMPUTED_AT, FALSE_2C, FLOAT_RATE, SHELF, withoutRefusals } from './partner2c-fixtures';

const MAILBOX = { kind: 'published' as const, address: 'partners.fixture@example.test' };

describe('PC-56 PARTNER-2c · W208 the lender\'s shelf (render)', () => {
  const html = renderToStaticMarkup(<LenderProductsView t={tr(en)} lang="en" state={shelfState(SHELF, null)} items={SHELF} computedAt={COMPUTED_AT} windowDays={30} mailbox={MAILBOX} />);
  const w = text(html);
  const cells = (col: string) => [...html.matchAll(new RegExp(`<td data-kv-col="${col}">([^<]*)</td>`, 'g'))].map((m) => text(m[1]).trim());
  it('each own product links to its page; the kind from the registry, or "kind not registered"', () => {
    for (const p of SHELF) expect(html).toContain(`href="/lender/products/${p.id}"`);
    expect(cells('kind')).toEqual(['crop', 'kind not registered']);
  });
  it('the rates are the stored INTEGER basis points and their integer difference — no percentage, no decimal, no float anywhere (M4)', () => {
    expect(cells('apr')).toEqual(['725 bps APR − 300 bps subsidy = 425 bps net of subsidy', '1100 bps APR − 0 bps subsidy = 1100 bps net of subsidy']);
    for (const c of cells('apr')) expect(c).toMatch(/^\d+ bps APR − \d+ bps subsidy = -?\d+ bps net of subsidy$/);
    expect(w).not.toMatch(FLOAT_RATE);
    expect(w).not.toContain('%');
    expect(w).toContain(en['partner2.loanProducts.ratesNote']);
  });
  it('the amount range in the product\'s own currency, bigint-exact past 2^53', () => {
    expect(cells('amount')[0]).toBe(`${formatMoneyMinor('5000000', 'INR', 'en')} to ${formatMoneyMinor('50000000', 'INR', 'en')}`);
    expect(cells('amount')[1]).toContain(formatMoneyMinor('90007199254740993', 'INR', 'en'));
    expect(cells('amount')[1]).toBe('₹1,00,000.00 to ₹90,00,71,99,25,47,409.93');   // the last digits survive: no float ever touched it
  });
  it('repayment, collateral, tenure, the consented 30-day count (an integer), status, the as-of', () => {
    expect(w).toContain('Aligned to the harvest'); expect(w).toContain('One repayment at the end');
    expect(w).toContain('None'); expect(w).toContain('Warehouse receipt');
    expect(w).toContain('6 to 12 months'); expect(w).toContain('not set');
    expect(cells('applications30d')).toEqual(['3', '0']);
    expect(w).toContain('Applications in 30 days (consented)');
    expect(w).toContain(en['partner2.loanProducts.appsNote'].replace('{days}', '30'));
    expect(w).toContain('Active'); expect(w).toContain('Inactive');
    expect(html).toContain(`data-kv-asof="${COMPUTED_AT}"`);
  });
  it('"New product" is DECOR (a link into the chain, never a form); Reload is the re-read chain; the mailbox FACT, never a literal', () => {
    expect(html).toContain('href="/lender/products?form=review"'); expect(html).toContain('data-kv-decor="new-product"'); expect(html).not.toContain('<form');
    expect(html).toContain('href="/lender/products?act=confirm"');
    expect(w).toContain(en['partner2.loanProducts.proposeChange']);
    expect(html).toContain('data-kv-ops-mailbox="published"'); expect(html).toContain('partners.fixture@example.test');
    expect(w).toContain(en['partner2.loanProducts.feeNote']);
  });
  it('the refusals by name; no canon claim outside them; no person, no applicant, no member count', () => {
    for (const k of partner2RefusalKeys('loan_products')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(text(withoutRefusals(html))).not.toMatch(FALSE_2C);
    expect(w).not.toMatch(/\b13\b/);
  });
  it('empty ("no products on your shelf yet — authored by the platform\'s partner operations"), error (Reload, no outage) and OFF states', () => {
    const e = text(renderToStaticMarkup(<LenderProductsView t={tr(en)} lang="en" state={shelfState([], null)} items={[]} computedAt={COMPUTED_AT} windowDays={30} />));
    expect(e).toContain(en['partner2.loanProducts.empty.title']); expect(e).toContain(en['partner2.loanProducts.empty.body']);
    const x = renderToStaticMarkup(<LenderProductsView t={tr(en)} lang="en" state={shelfState(null, 'error')} items={[]} computedAt={null} windowDays={null} />);
    expect(x).toContain('data-kv-state="error"'); expect(x).toContain('href="/lender/products?act=confirm"'); expect(x).not.toMatch(/unavailable/i);
    const o = text(renderToStaticMarkup(<LenderProductsView t={tr(en)} lang="en" state="off" items={[]} computedAt={null} windowDays={null} />));
    expect(o).toContain(en['partner.off.title']); expect(o).toContain(en['partner.off.body']); expect(o).not.toContain(en['partner2.loanProducts.title']);
  });
});
