// modules/equipment/domain/scaled.ts · [PC-56 OPS-4a · OPS4-B18 / E15] quantities (hours, acres, km …) as SCALED INTEGERS, both ways, by
// STRING placement of the decimal point — never through `Number()` (survey F-15: `BigInt(Math.round(Number(v) * 100))` and
// `(Number(c) / 100).toFixed(2)` were exact for numeric(10,2) only by luck of the float). PURE.
//   parseScaled('3.5', 2) → 350n · parseScaled('8', 2) → 800n · parseScaled('8.00', 2) → 800n (Postgres numeric arrives as a string)
//   formatScaled(350n, 2) → '3.50' · formatScaled(5n, 2) → '0.05'
// Digits beyond `dec` are refused (never rounded): every caller's value is already validated to `dec` places (the DTO's `qtyStr`, the
// numeric(10,2) column), so a longer one is a defect to surface, not a number to bend.
const SCALED = /^(-?)(\d+)(?:\.(\d+))?$/;

export function parseScaled(raw: string, dec: number): bigint {
  const m = SCALED.exec(String(raw).trim());
  if (!m) throw new TypeError(`not a decimal quantity: ${raw}`);
  const frac = m[3] ?? '';
  if (frac.length > dec && /[1-9]/.test(frac.slice(dec))) throw new TypeError(`more than ${dec} decimals: ${raw}`);
  const v = BigInt(m[2] + (frac + '0'.repeat(dec)).slice(0, dec));
  return m[1] === '-' ? -v : v;
}

export function formatScaled(v: bigint, dec: number): string {
  const neg = v < 0n; const s = (neg ? -v : v).toString().padStart(dec + 1, '0');
  const out = dec === 0 ? s : `${s.slice(0, s.length - dec)}.${s.slice(s.length - dec)}`;
  return neg ? `-${out}` : out;
}
