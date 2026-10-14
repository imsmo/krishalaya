// apps/web-storefront/src/features/pricing/plans.ts · PC-56 STORE-1c · C4 (founder D2) — the public plans, said truthfully. PURE.
//
// `/pricing` printed "₹0 Starter" and "From ₹999/mo Growth" from the catalogues (survey F-13, Law 3) while the platform's real plans said
// something else. The page now reads `storefront.plans(country)`; this module decides only HOW a figure is printed:
//   • every price goes through the one canonical money formatter (`@krishalaya/i18n` formatMoneyMinor) — bigint minor units, never a float;
//   • the API's exponent (the DB's `currencies.minor_units`) must AGREE with the currency's ISO 4217 exponent (features/discovery/money.ts);
//     if it does not, the price is NOT printed (a figure scaled by the wrong power of ten is worse than none) — the card says so;
//   • a setup fee is shown only when it is above zero (a "₹0 setup" line would be noise posing as a promise);
//   • the country is `?country=XX` (two letters) else the platform's own (NEXT_PUBLIC_PLATFORM_COUNTRY) — never a literal here.
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { StorefrontPlan } from '@krishalaya/sdk-js';
import { currencyExponent } from '../discovery/money';

/** The printed price, or null when it cannot be printed honestly (malformed minor units, or an exponent the currency does not have). */
export function planPrice(minor: string, currency: string, exponent: number, lang: string): string | null {
  if (!/^\d{1,19}$/.test(String(minor ?? ''))) return null;
  const iso = currencyExponent(currency);
  if (iso === null || iso !== exponent) return null;
  return formatMoneyMinor(minor, currency, lang);
}

/** Whether a setup-fee line is printed at all: only for a fee above zero. */
export function showsSetupFee(p: Pick<StorefrontPlan, 'setupFeeMinor'>): boolean {
  return /^\d{1,19}$/.test(p.setupFeeMinor) && BigInt(p.setupFeeMinor) > 0n;
}

/** `?country=` (two letters, upper-cased) else the platform's country; null when neither is usable (the page then says so). */
export function pricingCountry(raw: unknown, platform: string | null): string | null {
  const q = Array.isArray(raw) ? raw[0] : raw;
  if (typeof q === 'string' && /^[A-Za-z]{2}$/.test(q.trim())) return q.trim().toUpperCase();
  return platform && /^[A-Z]{2}$/.test(platform) ? platform : null;
}

/** The country's own name in the reader's language (Intl), falling back to the code — never a hand-kept list. */
export function countryName(code: string, intlLocale: string): string {
  try { return new Intl.DisplayNames([intlLocale], { type: 'region' }).of(code) ?? code; } catch { return code; }
}
