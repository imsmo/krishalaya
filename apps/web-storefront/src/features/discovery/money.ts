// apps/web-storefront/src/features/discovery/money.ts · PC-56 STORE-1b (survey F-15) — THE CURRENCY'S OWN EXPONENT. PURE.
//
// The tenant home's price filter parsed a typed "123.45" with a hard-coded `MINOR_DIGITS = 2` (INR paise) — wrong for any 0-decimal (JPY,
// KRW, VND) or 3-decimal (BHD, KWD, OMR, JOD, TND) currency, and a Rule Zero country assumption. The exponent now comes from the SAME place
// the one canonical money formatter (`@krishalaya/i18n` formatMoneyMinor) takes it: Intl's ISO 4217 minor-unit count for the currency.
// An unknown / malformed code answers null — the caller then refuses to parse a price rather than guessing two decimals.
import { formatMoneyMinor } from '@krishalaya/i18n';

/** ISO 4217 minor-unit exponent for a currency code (2 for INR/USD, 0 for JPY, 3 for BHD), or null when Intl does not know the code. */
export function currencyExponent(code: string | null | undefined): number | null {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  try {
    const d = new Intl.NumberFormat('en', { style: 'currency', currency: c }).resolvedOptions().maximumFractionDigits;
    return typeof d === 'number' && d >= 0 && d <= 4 ? d : null;
  } catch {
    return null;
  }
}

// PC-56 HOTFIX-4 · C4 (survey C-7): EVERY amount on the cart, checkout, pay, confirm and auction pages is printed through THIS — the
// currency from the DATA (the order's, the preview's, the listing's), the one canonical formatter, and NO fallback currency: an unknown or
// missing code answers null and the page says "not available" instead of printing the figure as rupees.

/** The formatted amount in its OWN currency, or null when the currency is unknown / the minor units are malformed (never guessed as INR). */
export function moneyText(minor: string | null | undefined, currency: string | null | undefined, lang: string): string | null {
  if (typeof minor !== 'string' || !/^-?\d+$/.test(minor)) return null;
  if (currencyExponent(currency) === null) return null;
  return formatMoneyMinor(minor, String(currency).toUpperCase(), lang);
}
