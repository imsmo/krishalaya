// apps/web-tenant/src/features/rtl/money.ts · PC-56 RTL-1b-3 — every amount in the Indian shape, isolated, on an rtl page.
//
// THE one money helper for TEXT (server pages, client components, a `t.t()` sentence, an attribute). Together with
// `<Money>` in components/Bidi.tsx (the `<bdi dir="ltr">` element for table cells) this is the ONLY place under app/,
// components/ and features/ that calls `formatMoneyMinor` — rtl-static.spec pins it, naming any other call `file:line`.
//
//   • en/hi/gu (ltr): `moneyText` returns EXACTLY `formatMoneyMinor(minor, currency, lang)` — byte-identical, no marks.
//   • a preview (rtl) language (ar): the INDIAN shape (`moneyLang` → en → en-IN, "₹1,23,456.50", symbol first, lakh
//     grouping — the lead's money shape, 07_RTL.md), wrapped in LRI…PDI (U+2066 … U+2069) so the amount stays one
//     left-to-right run AND counts as a single neutral in the Arabic sentence around it (UAX #9 isolates).
// Law 2: the amount is passed through untouched — a bigint minor-unit string, never a Number, never rounded.
// Pure: no React, no I/O — usable from server pages, client components and feature code alike.
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
