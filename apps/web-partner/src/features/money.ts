// apps/web-partner/src/features/money.ts · PURE float-free money parsing for the partner console (PC-55 B7).
// "99.50" → "9950" (bigint minor-unit string). Law 2: money never touches a float.
//
// WHY THIS EXISTS ALONGSIDE features/lending/application.ts's `rupeesToPaiseMinor`: that helper accepts WHOLE rupees
// only, which is right for an approved loan amount (a sanction is not written in paise). Servicing is different — a
// KCC interest posting, a restructured instalment and an insurance premium genuinely carry paise, and forcing whole
// rupees there would round somebody's balance. So this parser accepts up to two decimals and returns `undefined`
// rather than throwing, which is what the servicing/authoring builders expect.
const MINOR_DIGITS = 2;

export function parseMajorToMinor(input: string | undefined | null): string | undefined {
  const s = (input ?? '').trim();
  if (!s) return undefined;
  if (!new RegExp(`^\\d{1,13}(\\.\\d{1,${MINOR_DIGITS}})?$`).test(s)) return undefined;
  const [intPart, fracRaw = ''] = s.split('.');
  const frac = (fracRaw + '0'.repeat(MINOR_DIGITS)).slice(0, MINOR_DIGITS);
  const joined = (intPart + frac).replace(/^0+(?=\d)/, '');
  return joined === '' ? '0' : joined;
}
