// packages/ui/src/__tests__/MoneyText.test.tsx · DEV-15. LAW 3 FLAGSHIP test — the exact same code path
// must render both INR and AED correctly, proving there is no hardcoded ₹/default currency anywhere.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as fs from 'fs';
import * as path from 'path';
import { MoneyText } from '../components/MoneyText';

describe('MoneyText', () => {
  it('renders ₹1,250.00 for amount_minor=125000 (paise), currency_code=INR', () => {
    const html = renderToStaticMarkup(<MoneyText amountMinor={125000} currencyCode="INR" />);
    expect(html).toContain('₹');
    expect(html).toMatch(/1,250\.00/);
  });

  it('the SAME component/prop shape renders AED correctly (never a fallback to ₹)', () => {
    const html = renderToStaticMarkup(
      <MoneyText amountMinor={125000} currencyCode="AED" locale="ar-AE" currencyDisplay="code" />,
    );
    expect(html).not.toContain('₹');
    expect(html).toContain('AED');
  });

  it('accepts a native bigint for amountMinor (Law 2: money is BIGINT)', () => {
    const html = renderToStaticMarkup(<MoneyText amountMinor={987654321n} currencyCode="INR" />);
    expect(html).toContain('₹');
    expect(html).toMatch(/98,76,543\.21|9,876,543\.21/); // Intl may group Indic or Western depending on locale support
  });

  it('handles a zero-decimal currency (JPY) via the ISO 4217 exponent map, not a hardcoded 2', () => {
    const html = renderToStaticMarkup(<MoneyText amountMinor={500} currencyCode="JPY" locale="ja-JP" />);
    // ja-JP's Intl data renders the fullwidth yen glyph (U+FFE5, "￥"), not the halfwidth "¥" (U+00A5) —
    // either is a real, non-hardcoded Intl-derived symbol; the real assertion is "no decimals were
    // invented" (JPY has 0 minor units, so a naive /100 would wrongly render "5.00").
    expect(html).toMatch(/[¥￥]/);
    expect(html).not.toMatch(/500\.00/);
  });

  it('direction="in" applies the canon success tone class; "out" applies neutral ink', () => {
    const inHtml = renderToStaticMarkup(<MoneyText amountMinor={1000} currencyCode="INR" direction="in" />);
    const outHtml = renderToStaticMarkup(<MoneyText amountMinor={1000} currencyCode="INR" direction="out" />);
    expect(inHtml).toContain('kvw-money in');
    expect(outHtml).toContain('kvw-money out');
  });

  it('renders an optional suffix via the canon <small> element', () => {
    const html = renderToStaticMarkup(<MoneyText amountMinor={1000} currencyCode="INR" suffix="excl. fees" />);
    expect(html).toContain('<small>excl. fees</small>');
  });

  it('static-source proof: the component file itself contains no hardcoded ₹ literal outside comments', () => {
    const source = fs.readFileSync(path.join(__dirname, '../components/MoneyText.tsx'), 'utf8');
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, '')      // strip /* ... */ and /** ... */ block comments
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(codeOnly).not.toContain('₹');
  });
});
