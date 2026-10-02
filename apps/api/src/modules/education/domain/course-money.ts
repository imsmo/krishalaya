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

// [PC-56 TENANT-9b] The two converters moved to core/money/major-minor.ts (the resolution form needs them too); re-exported
// here so nothing that imported them moves.
export { parseMajorToMinor, minorToMajorText } from '../../../core/money/major-minor';

export function isFree(priceMinor: string): boolean { return /^0+$/.test(priceMinor); }
