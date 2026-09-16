// modules/education/domain/course-money.ts · PC-56 TENANT-7a · a course price, typed in major units, stored in minor.
//
// `courses.price_minor` is bigint minor units + `currency_code` (Law 2). The form asks for a price the way a person
// writes one — `149`, `149.00`, `0` — and the platform has to move the digits, not scale a float. The scale is the
// CURRENCY'S (`currencies.minor_units`: INR 2, JPY 0, KWD 3), resolved from the tenant's country, never assumed to be
// two: TENANT-6e-1 found five seeded countries naming a currency with no scale at all, and a course priced in one of
// them is a course whose price this platform cannot store honestly. So `parse` takes the scale as an argument and the
// caller refuses when it has none.
//
// PURE. No IO, no Intl, no Number() on money — a string in, a string out, so a mutation of any line here is caught by
// a spec and not by a member paying ₹14,900 for a ₹149 course.

export interface MoneyShape { currencyCode: string; minorUnits: number }

/** Digits only, an optional fraction no longer than the currency's scale. `""` is NOT a price — the caller decides what a blank means. */
export function parseMajorToMinor(major: string, minorUnits: number): string | null {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 6) throw new Error(`course money: minor_units out of range: ${minorUnits}`);
  const s = major.trim();
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (frac.length > minorUnits) return null;               // ₹149.005 is not a rupee amount
  const padded = frac.padEnd(minorUnits, '0');
  const joined = `${whole}${padded}`.replace(/^0+(?=\d)/, '');
  return joined;
}

/** `14900` at scale 2 → `149.00`; `5160` at 0 → `5160`. The stored value, printed the way a spreadsheet can sum it. */
export function minorToMajorText(minor: string, minorUnits: number): string {
  if (!/^\d+$/.test(minor)) throw new Error(`course money: not a minor amount: ${JSON.stringify(minor)}`);
  if (minorUnits === 0) return minor.replace(/^0+(?=\d)/, '');
  const padded = minor.padStart(minorUnits + 1, '0');
  const whole = padded.slice(0, -minorUnits).replace(/^0+(?=\d)/, '');
  return `${whole}.${padded.slice(-minorUnits)}`;
}

export function isFree(priceMinor: string): boolean { return /^0+$/.test(priceMinor); }
