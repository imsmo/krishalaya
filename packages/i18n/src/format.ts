// @krishalaya/i18n · locale-aware formatters built on Intl. CRITICAL: money arrives as a STRING of bigint
// minor units (Law 2). We format it WITHOUT ever turning the whole amount into a JS number — the major-unit part
// is grouped via Intl with a BigInt input (so ₹1,23,45,678.90 keeps full precision + correct lakh/crore grouping
// in Indian locales), the minor-unit part is appended exactly. Negative + zero handled.
//
// DEV-26/Q15 rewrite: the previous version hardcoded `/100n` (a 2-decimal-currency assumption) and a 3-entry
// `CURRENCY_SYMBOL` map (INR/USD/EUR only) — a real bug for any 0-decimal (JPY/KRW/VND) or 3-decimal (BHD/KWD/
// OMR/JOD/TND) currency, and a duplicate of the correct per-currency exponent map `packages/ui`'s own
// `MoneyText.tsx` already hand-maintained. Fixed by asking Intl itself for the ISO 4217 minor-unit exponent
// (`resolvedOptions().maximumFractionDigits`) instead of hand-maintaining a second copy of the same table —
// this is now the ONE canonical money formatter (Q15: "one canonical implementation, consumed everywhere"),
// and it is MORE correct than either predecessor: never loses precision on a bigint beyond
// `Number.MAX_SAFE_INTEGER` (all math stays in bigint; the ONLY call into `Intl` with a live amount is
// `formatToParts(0)`, which is float-safe by construction since 0 has an exact binary representation — the
// symbol/grouping/decimal-separator LITERALS it returns don't change with amount magnitude, only the numeric
// parts do, and those are substituted with our own bigint-computed grouped digits, never Intl's own arithmetic
// on the real amount).
import { resolveLanguage, isRegistered } from './languages';

export interface FormatMoneyOptions {
  /** BRAND-024 symbol-vs-code disambiguation (e.g. "AED 1,250.00" vs the locale-default symbol). Defaults to
   *  Intl's own 'symbol'. */
  currencyDisplay?: 'symbol' | 'code';
  /** Escape hatch for a caller that already has a raw BCP-47 Intl locale tag (not an `@krishalaya/i18n`
   *  LANGUAGE_REGISTRY code) — e.g. `packages/ui`'s `MoneyText` accepts an arbitrary Intl locale prop. When set,
   *  this locale is used AS-IS for all Intl calls and `langCode` is ignored for locale-resolution purposes. */
  intlLocale?: string;
}

/** Format bigint minor units (as a string, e.g. "123456") into a localized currency string (e.g. "₹1,234.56").
 *  `langCode` is an `@krishalaya/i18n` LANGUAGE_REGISTRY code ('en'/'hi'/'gu'/…) by default; pass
 *  `opts.intlLocale` to bypass the registry and use a raw Intl locale tag directly (see `FormatMoneyOptions`). */
export function formatMoneyMinor(minor: string | bigint, currencyCode = 'INR', langCode = 'en', opts: FormatMoneyOptions = {}): string {
  let v: bigint;
  try { v = typeof minor === 'bigint' ? minor : BigInt(minor); }
  catch { return formatMoneyMinor(0n, currencyCode, langCode, opts); } // bad input degrades to a real, correctly-formatted zero (Law 12)

  // Resolve the Intl locale tag: an explicit raw override wins; otherwise a REGISTERED app language code resolves
  // through the registry (unchanged behavior for every existing caller); an unrecognized code is treated as
  // already being a raw Intl tag (never silently collapsed to 'en' — a caller passing a real locale, registered
  // or not, gets that locale honored).
  const intlLocale = opts.intlLocale ?? (isRegistered(langCode) ? resolveLanguage(langCode).intlLocale : langCode);
  const currencyDisplay = opts.currencyDisplay === 'code' ? 'code' : 'symbol';

  const nf = new Intl.NumberFormat(intlLocale, { style: 'currency', currency: currencyCode, currencyDisplay });
  // The true ISO 4217 minor-unit exponent for this currency, straight from Intl (2 for INR/USD/AED, 0 for
  // JPY/KRW/VND, 3 for BHD/KWD/OMR/JOD/TND, …) — never a hand-maintained table that can drift from reality.
  // `maximumFractionDigits` is typed optional in some lib.d.ts TS versions (it is always populated in practice
  // for style:'currency', per ECMA-402) — the `?? 2` is a type-satisfying fallback to Intl's own currency
  // default, not a behavior change for any real currency code.
  const exponent = nf.resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10n ** BigInt(exponent);

  const neg = v < 0n; const abs = neg ? -v : v;
  const major = divisor > 0n ? abs / divisor : abs;
  const fraction = divisor > 0n ? abs % divisor : 0n;
  const groupedMajor = new Intl.NumberFormat(intlLocale, { useGrouping: true }).format(major); // BigInt-safe grouping, no float
  const fractionStr = exponent > 0 ? fraction.toString().padStart(exponent, '0') : '';

  // formatToParts(0) is float-safe (0 is exact) and gives us the REAL per-locale/per-currency literal structure
  // (symbol, its position, decimal separator) without ever running Intl's currency formatter over the actual
  // (possibly huge) amount. Substitute the numeric parts with our own bigint-exact digits.
  let out = '';
  let insertedInteger = false;
  for (const part of nf.formatToParts(0)) {
    if (part.type === 'integer') { if (!insertedInteger) { out += groupedMajor; insertedInteger = true; } continue; }
    if (part.type === 'group') continue;                       // grouping already applied inside groupedMajor
    if (part.type === 'decimal') { if (exponent > 0) out += part.value; continue; }
    if (part.type === 'fraction') { out += fractionStr; continue; }
    out += part.value;                                         // currency symbol/code + literal spacing
  }
  return neg ? `-${out}` : out;
}

/** Plain number (counts, quantities — NOT money) localized. */
export function formatNumber(n: number, langCode = 'en'): string {
  return new Intl.NumberFormat(resolveLanguage(langCode).intlLocale).format(n);
}
export function formatDate(value: string | number | Date, langCode = 'en', opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(resolveLanguage(langCode).intlLocale, opts).format(new Date(value));
}
/** "3 days ago" / "in 2 hours" in the active language. */
export function formatRelative(value: string | number | Date, langCode = 'en', now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat(resolveLanguage(langCode).intlLocale, { numeric: 'auto' });
  const diffSec = Math.round((new Date(value).getTime() - now.getTime()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [unit, secs] of units) if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  return rtf.format(diffSec, 'second');
}
