// apps/mobile/src/core/i18n/money.ts · PC-56 RTL-1h-2 — every amount printed as text, in the Indian shape and isolated under Arabic.
//
// THE one money helper for TEXT on mobile (a `t()` sentence, a button title, a `Text` child, an accessibility label). Together with
// `<MoneyText>` in @krishalaya/ui-native this is the ONLY place in the app that calls `formatMoneyMinor` —
// rtl1h2-money-dates-arrows.spec pins it (a bare, namespaced or aliased use anywhere else under src/ is named `file:line`).
// The web-tenant pattern (apps/web-tenant/src/features/rtl/money.ts), ported:
//   • en/hi/gu (ltr): `moneyText` returns EXACTLY `formatMoneyMinor(minor, currency, lang)` — byte-identical, no marks.
//   • a preview (rtl) language (ar): the INDIAN shape (`moneyLang` → en → en-IN, "₹1,23,456.50", symbol first, lakh grouping — the
//     lead's money shape, 07_RTL.md), wrapped in LRI…PDI (U+2066 … U+2069) so the amount stays one left-to-right run AND counts as a
//     single neutral in the Arabic sentence around it.
// Law 2: the amount is passed through untouched — a bigint minor-unit string, never a Number, never rounded.
// Pure: no React Native, no I/O — unit-tested under the core project.
import { formatMoneyMinor, PREVIEW_LANGUAGES, getRegistryEntry } from '@krishalaya/i18n';
import { ltrRun } from './bidi';

/** The formatter language for an amount: a preview language (Arabic) prints money in the Indian shape (en → en-IN). */
export function moneyLang(lang: string): string {
  return PREVIEW_LANGUAGES.includes(lang) ? 'en' : lang;
}

/** One amount as text: the language's own shape under ltr; the Indian shape, isolated left-to-right, under rtl. */
export function moneyText(minor: string | bigint, currency: string, lang: string): string {
  const text = formatMoneyMinor(minor, currency, moneyLang(lang));
  return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;
}

/** A whole-rupee label with no paise ("₹1,23,457") — the shape four screens printed with their own `Intl.NumberFormat` helper
 *  (mandi detail, mandi history, wallet earnings, the order decision button). Byte-identical to those helpers under en/hi/gu:
 *  the same arithmetic (minor ÷ 100, Intl's own rounding — pre-existing, display only) through the language's pinned Intl locale
 *  (en-IN / hi-IN / gu-IN, the same tags the helpers hard-coded). Under ar: en-IN, isolated. '—' on a bad amount (Law 12). */
export function moneyWholeText(minor: string, currency: string, lang: string): string {
  try {
    const locale = getRegistryEntry(moneyLang(lang))?.intlLocale ?? 'en-IN';
    const text = new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(BigInt(minor)) / 100);
    return PREVIEW_LANGUAGES.includes(lang) ? ltrRun(text) : text;
  } catch { return '—'; }
}
