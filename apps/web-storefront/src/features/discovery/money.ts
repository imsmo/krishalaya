// apps/web-storefront/src/features/discovery/money.ts · PC-56 STORE-1b (survey F-15) — THE CURRENCY'S OWN EXPONENT. PURE.
//
// The tenant home's price filter parsed a typed "123.45" with a hard-coded `MINOR_DIGITS = 2` (INR paise) — wrong for any 0-decimal (JPY,
// KRW, VND) or 3-decimal (BHD, KWD, OMR, JOD, TND) currency, and a Rule Zero country assumption. The exponent now comes from the SAME place
// the one canonical money formatter (`@krishalaya/i18n` formatMoneyMinor) takes it: Intl's ISO 4217 minor-unit count for the currency.
// An unknown / malformed code answers null — the caller then refuses to parse a price rather than guessing two decimals.

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
