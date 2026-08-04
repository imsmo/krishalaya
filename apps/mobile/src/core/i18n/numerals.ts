// apps/mobile/src/core/i18n/numerals.ts · small number helpers for the Indian context. Money formatting itself
// lives in @krishalaya/i18n (formatMoneyMinor, bigint-safe) — this file only covers the lightweight
// presentation helpers the UI needs: short lakh/crore labels for big counts and optional Devanagari digit
// transliteration for fully-vernacular surfaces. Pure functions, no React.

/** Compact Indian label for a positive integer count: 1,200 → "1.2K", 250000 → "2.5L", 12000000 → "1.2Cr". */
export function compactIndian(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e7) return trim(n / 1e7) + 'Cr';
  if (abs >= 1e5) return trim(n / 1e5) + 'L';
  if (abs >= 1e3) return trim(n / 1e3) + 'K';
  return String(Math.round(n));
}
function trim(x: number): string {
  return (Math.round(x * 10) / 10).toString();
}

const DEVANAGARI = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const GUJARATI = ['૦', '૧', '૨', '૩', '૪', '૫', '૬', '૭', '૮', '૯'];

/** Transliterate ASCII digits in a string to the script for the given language (hi → Devanagari, gu → Gujarati).
 * Non-digits pass through unchanged. en (or anything else) returns the input as-is. */
export function localizeDigits(text: string, langCode: string): string {
  const map = langCode === 'hi' ? DEVANAGARI : langCode === 'gu' ? GUJARATI : null;
  if (!map) return text;
  return text.replace(/[0-9]/g, (d) => map[Number(d)]);
}
