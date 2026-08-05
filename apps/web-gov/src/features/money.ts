// apps/web-gov/src/features/money.ts · PURE float-free money parsing (ported verbatim from the proven
// web-tenant helper — Law 2: money never touches a float). "99.50" → "9950" (bigint minor string).
const MINOR_DIGITS = 2;

export function parseMajorToMinor(input: string | undefined | null): string | undefined {
  const s = (input ?? '').trim();
  if (!s) return undefined;
  if (!new RegExp(`^\\d{1,12}(\\.\\d{1,${MINOR_DIGITS}})?$`).test(s)) return undefined;
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '0'.repeat(MINOR_DIGITS)).slice(0, MINOR_DIGITS);
  const joined = (intPart + frac).replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}
