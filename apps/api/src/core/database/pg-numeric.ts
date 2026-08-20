// core/database/pg-numeric.ts · PC-56 TENANT-6c-1 · reading a PostgreSQL `numeric` without going through a double.
//
// node-pg returns `numeric` as a STRING, deliberately: the type is arbitrary-precision and a JS number is not. Code
// that writes `Number(row.total_litres)` throws that away and then, more often than not, multiplies by 1000 and
// rounds — `BigInt(Math.round(Number(r.total_litres) * 1000))` was the exact line in the milk-bill mapper. For 204.53
// that happens to be right; for values whose decimal expansion is not representable in binary it is right *nearly*
// always, which is the property that makes it survive review and then disagree with the database on the number a
// farmer checks first.
//
// This helper does the only thing that is exactly correct: it reads the digits. Same shape as the `pg-date.ts` ruling
// TENANT-6b-1 made for oid 1082 — one small function whose whole job is to stop a lossy conversion being spelled out
// by hand at every call site.
//
// SCOPE, STATED: this wave repairs the dairy bill's litres. `Number(` over a `numeric` column exists elsewhere in this
// codebase (weights, percentages, rates) and every one of those is a candidate for the same treatment. That sweep is
// NAMED, NOT CLOSED — it is a wave of its own, the way the date sweep was, and doing it half-way here would leave a
// helper that looks like a policy and is not.

/**
 * A `numeric` string as a SCALED INTEGER — e.g. `('204.526', 3)` → `204526n`, `('204.5', 3)` → `204500n`.
 *
 * Extra decimals beyond `scale` are TRUNCATED, not rounded, and that is the conservative direction on purpose: this
 * reads a value the database already stored at a known scale, so digits past it should not exist, and if a column is
 * later widened, silently rounding a stored value up would invent milk that was never poured.
 *
 * Throws on anything that is not a decimal number, rather than coercing to 0 — a mapper that turns an unexpected
 * value into "zero litres" produces a bill for nothing and no error to find it by.
 */
export function scaledFromNumeric(v: unknown, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError(`scaledFromNumeric: scale must be a non-negative integer, got ${scale}`);
  const s = typeof v === 'string' ? v.trim() : String(v ?? '').trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new TypeError(`scaledFromNumeric: not a decimal value: ${JSON.stringify(v)}`);
  const sign = m[1] === '-' ? -1n : 1n;
  const whole = m[2] === '' ? '0' : m[2];
  const frac = (m[3] ?? '').slice(0, scale).padEnd(scale, '0');
  return sign * BigInt(whole + frac);
}

/** Nullable sibling: a NULL column is a missing value, not a zero. */
export function scaledFromNumericOrNull(v: unknown, scale: number): bigint | null {
  return v == null ? null : scaledFromNumeric(v, scale);
}

/**
 * The inverse, for the write side: a scaled integer as the decimal string `numeric` expects.
 * `(204526n, 3)` → `'204.526'`. Never `Number(x) / 1000`, for the reason in this file's header.
 */
export function numericFromScaled(v: bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0) throw new RangeError(`numericFromScaled: scale must be a non-negative integer, got ${scale}`);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  if (scale === 0) return `${neg ? '-' : ''}${abs}`;
  const unit = 10n ** BigInt(scale);
  const frac = String(abs % unit).padStart(scale, '0');
  return `${neg ? '-' : ''}${abs / unit}.${frac}`;
}
