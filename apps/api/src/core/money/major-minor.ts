// core/money/major-minor.ts · an amount typed in MAJOR units, stored in MINOR — and back. PURE.
//
// Written by PC-56 TENANT-7a for a course price (`modules/education/domain/course-money.ts`) and lifted here by TENANT-9b,
// whose resolution form carries a dividend pot and a per-member cap the same way. The module blueprint forbids
// memberships importing education's domain, and a second copy of a money parser is two answers to "what did the
// operator type" — so the rule lives once, here, and education re-exports it (its specs unchanged).
//
// The scale is the CURRENCY'S (`currencies.minor_units`: INR 2, JPY 0, KWD 3), passed in, never assumed to be two. No
// Number() on money — a string in, a string out.

/** Digits only, an optional fraction no longer than the currency's scale. `""` is NOT an amount — the caller decides. */
export function parseMajorToMinor(major: string, minorUnits: number): string | null {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 6) throw new Error(`money: minor_units out of range: ${minorUnits}`);
  const s = major.trim();
  const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = m[2] ?? '';
  if (frac.length > minorUnits) return null;               // ₹149.005 is not a rupee amount
  const padded = frac.padEnd(minorUnits, '0');
  return `${whole}${padded}`.replace(/^0+(?=\d)/, '');
}

/** `14900` at scale 2 → `149.00`; `5160` at 0 → `5160`. */
export function minorToMajorText(minor: string, minorUnits: number): string {
  if (!/^\d+$/.test(minor)) throw new Error(`money: not a minor amount: ${JSON.stringify(minor)}`);
  if (minorUnits === 0) return minor.replace(/^0+(?=\d)/, '');
  const padded = minor.padStart(minorUnits + 1, '0');
  const whole = padded.slice(0, -minorUnits).replace(/^0+(?=\d)/, '');
  return `${whole}.${padded.slice(-minorUnits)}`;
}
