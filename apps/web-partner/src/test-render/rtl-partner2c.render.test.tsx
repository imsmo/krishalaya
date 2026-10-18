// apps/web-partner/src/test-render/rtl-partner2c.render.test.tsx · PC-56 PARTNER-2c — the RTL spot-check of the lender's shelf (the 2a/2b
// precedent): rendered inside dir="rtl" in en, hi and gu, the shelf, the product and their chain pages carry no inline style, no bare
// directional arrow (none is drawn — so no DirArrow is needed; the "−" of the rate sentence is a minus sign, not an arrow) and no physical
// left/right class; the CSS this wave added uses logical properties only; hi and gu print their own words.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LenderProductsView } from '../components/partner2/LenderProductsView';
import { LenderProductView } from '../components/partner2/LenderProductView';
import { InsurerChain } from '../components/partner2/InsurerChain';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { tr } from './partner1a-fixtures';
import { COMPUTED_AT, PRODUCT, SHELF } from './partner2c-fixtures';

const rtl = (node: React.ReactElement) => renderToStaticMarkup(<div dir="rtl">{node}</div>);

describe('PC-56 PARTNER-2c · RTL spot-check (en / hi / gu)', () => {
  const pages = ([['en', en], ['hi', hi], ['gu', gu]] as const).flatMap(([lang, cat]) => [
    rtl(<LenderProductsView t={tr(cat)} lang={lang} state="ok" items={SHELF} computedAt={COMPUTED_AT} windowDays={30} mailbox={{ kind: 'none' }} />),
    rtl(<LenderProductView t={tr(cat)} lang={lang} p={PRODUCT} failure={null} mailbox={{ kind: 'none' }} />),
    rtl(<InsurerChain t={tr(cat)} chain="lender_form" state="review" mailbox={{ kind: 'none' }} />),
    rtl(<InsurerChain t={tr(cat)} chain="lender_act" state="confirm" />),
  ]);
  it('no inline style, no bare arrow, no physical-side class in any new layout, in any of the three languages', () => {
    expect(pages.length).toBe(12);
    for (const html of pages) {
      expect(html).not.toMatch(/style="/);
      expect(html).not.toMatch(/[→←⇒⇐➜➔]/);
      expect(html).not.toMatch(/class="[^"]*(left|right)[^"]*"/);
    }
  });
  it('hi and gu render their own words (no English fallback for a new key)', () => {
    expect(pages[4]).toContain(hi['partner2.loanProducts.title']); expect(pages[8]).toContain(gu['partner2.loanProducts.title']);
    expect(pages[4]).not.toContain(en['partner2.loanProducts.lead']); expect(pages[8]).not.toContain(en['partner2.loanProducts.lead']);
    expect(pages[5]).toContain(hi['partner2.loanProducts.product.readOnly']); expect(pages[9]).toContain(gu['partner2.loanProducts.product.readOnly']);
    expect(pages[6]).toContain(hi['partner2.chain.lenderForm.review.body']); expect(pages[10]).toContain(gu['partner2.chain.lenderForm.review.body']);
    expect(pages[7]).toContain(hi['partner2.chain.lenderAct.confirm.body']); expect(pages[11]).toContain(gu['partner2.chain.lenderAct.confirm.body']);
  });
  it('the CSS this wave added uses logical properties only', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'globals.css'), 'utf8');
    const ours = css.slice(css.indexOf('PC-56 PARTNER-2c'));
    expect(ours.length).toBeGreaterThan(100);
    expect(ours).not.toMatch(/(margin|padding|border)-(left|right)|\b(left|right)\s*:|text-align:\s*(left|right)|float:\s*(left|right)/);
  });
});
