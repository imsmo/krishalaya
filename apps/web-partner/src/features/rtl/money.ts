// apps/web-partner/src/features/rtl/money.ts · PC-56 RTL-1d (web-tenant's RTL-1b-3 helper, adapted) — every amount in the Indian shape,
// isolated, on an rtl page.
//
// THE ONLY place under app/, components/, features/ and lib/ that calls `formatMoneyMinor` — test/rtl-static.spec.ts pins it, naming any other
// use `file:line`. Every partner amount (the dashboard, the lender book, the insurer book, claims and surveys) goes through `moneyText`:
//   • en/hi/gu (ltr): EXACTLY `formatMoneyMinor(minor, currency, lang)` — byte-identical, no marks;
//   • a preview (rtl) language (ar): the INDIAN shape (`moneyLang` → en → en-IN, "₹1,23,456.50", symbol first, lakh grouping — the lead's money
//     shape, 07_RTL.md), wrapped in LRI…PDI so the amount stays one left-to-right run inside the Arabic sentence or table cell.
// Law 2: the amount is passed through untouched — a bigint minor-unit string, never a Number, never rounded. Pure: no React, no I/O.
import { formatMoneyMinor, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { ltrRun } from './span';

/** The formatter language for an amount: a preview language (Arabic) prints money in the Indian shape (en → en-IN). */
export function moneyLang(lang: string): string {
  return PREVIEW_LANGUAGES.includes(lang) ? 'en' : lang;
}

/** One amount as text: the page language's own shape under ltr; the Indian shape, isolated left-to-right, under rtl. */
export function moneyText(minor: string | bigint, currency: string, lang: string): string {
  const text = formatMoneyMinor(minor, currency, moneyLang(lang));
  return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;
}
