// modules/warehousing/domain/quantity.ts · PC-56 OPS-2c · OPS2-B23 (survey F-13) — THE QUANTITY NEVER TOUCHES A FLOAT.
// `storage_bookings.quantity` and `nwr_receipts.quantity` are `numeric(12,3)`; node-postgres hands a numeric over as a STRING (no type parser
// is set anywhere in this repo). Both repositories used to round-trip it through a JS double (`BigInt(Math.round(Number(v) * 1000))` and
// `(Number(m) / 1000).toFixed(3)`) — exact up to 12 significant digits, but a float on the number the storage fee and the receipt rest on,
// against the "never float" law. These two PURE functions parse and print the scaled integer (×1000) from and to the decimal string, digit by
// digit. They are the ONLY quantity conversions the warehousing repositories and entities use.
//
// THE FEE UNIT (survey E14, founder Q2-A 2026-11-06): the storage fee is computed on the quantity IN QUINTALS. One constant names that unit; the
// booking request refuses any other unit by name (STORAGE_UNIT_NOT_QUINTAL, before the idempotency record), and the fee reads the quantity as
// that unit. web-ops' W378 sentence states it in words; `apps/web-ops/src/features/ops2/billing.ts` mirrors the constant and a web-ops unit
// spec pins the two equal by reading this file.
export const STORAGE_FEE_UNIT = 'quintal' as const;

const SCALE = 3;

/** A numeric(…,3) value as node-postgres returns it ("6260.125", "100", "-1.5") → the scaled integer ×1000 (6260125n). Never `Number`. */
export function parseQuantityMilli(v: string | bigint): bigint {
  if (typeof v === 'bigint') return v * 1000n;
  const s = String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`not a decimal quantity: ${JSON.stringify(s)}`);
  const [, sign, int, frac = ''] = m;
  if (frac.length > SCALE && /[1-9]/.test(frac.slice(SCALE))) throw new Error(`quantity has more than ${SCALE} decimals: ${s}`);
  const milli = BigInt(int + (frac + '0'.repeat(SCALE)).slice(0, SCALE));
  return sign === '-' ? -milli : milli;
}

/** The scaled integer ×1000 → the decimal string with exactly three places (6260125n → "6260.125"). Never `Number`. */
export function formatQuantityMilli(m: bigint): string {
  const neg = m < 0n; const a = neg ? -m : m;
  return `${neg ? '-' : ''}${a / 1000n}.${(a % 1000n).toString().padStart(SCALE, '0')}`;
}
