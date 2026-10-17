// modules/listings/domain/organic-claim.ts · PC-56 STORE-5b · D1 / B18 (founder Q7) — WHAT A LISTING MAY SAY ABOUT ORGANIC. PURE.
//
// The seller's claim (`organic_claim`: none | natural | certified) and whether a certificate covers it (read-models/certified.sql.ts
// `COVERED_SQL`) → the PUBLIC value:
//   • `certified`      — claims certified AND a verified, organic, valid-today certificate covers it;
//   • `self_declared`  — claims certified with NO covering certificate ("organic (self-declared)" — the seller's word, said as such);
//   • `natural`        — claims natural farming (a self-declared practice; no certificate exists for it);
//   • `none`           — no claim (the wire answers null).
export type PublicOrganic = 'certified' | 'self_declared' | 'natural' | 'none';

export function publicOrganic(claim: string | null | undefined, covered: boolean): PublicOrganic {
  if (claim === 'certified') return covered === true ? 'certified' : 'self_declared';
  if (claim === 'natural') return 'natural';
  return 'none';
}

/** The wire value: `none` is null (the search card and the detail print no badge). */
export function organicWire(claim: string | null | undefined, covered: boolean): Exclude<PublicOrganic, 'none'> | null {
  const v = publicOrganic(claim, covered);
  return v === 'none' ? null : v;
}
