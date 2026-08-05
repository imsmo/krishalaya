// modules/logistics/domain/rider-payout.rules.ts · PC-55 A7 — PURE rider-earnings math.
// This decides what a delivery partner is owed for a day's riding. It is written to be (a) exact in integer
// minor units, (b) FAIR ACROSS TIME (work already done is priced with the terms that were in force on its own
// date), and (c) never silently zero (a rider with no terms gets an explicit "no terms configured", not ₹0).
export interface RiderTerms {
  id: string; riderUserId: string | null; termsName: string; effectiveFrom: string;
  perDropMinor: string; pctOfChargeBps: number; codHandlingMinor: string; failedAttemptMinor: string; currencyCode: string;
}
export interface RiderShipment {
  id: string; status: string; deliveredOn: string | null;   // ISO date of delivery (or the attempt date)
  chargeMinor: string | null; codMinor: string | null; attemptedOn?: string | null;
}

/** Terms in force ON a given date: the most SPECIFIC (rider-personal beats tenant default) and, within that,
 *  the LATEST effective_from that is not in the future relative to the work's own date. */
export function termsForDate(terms: readonly RiderTerms[], riderUserId: string, dateIso: string): RiderTerms | null {
  const eligible = terms.filter((t) => t.effectiveFrom <= dateIso && (t.riderUserId === null || t.riderUserId === riderUserId));
  if (eligible.length === 0) return null;
  const personal = eligible.filter((t) => t.riderUserId === riderUserId);
  const pool = personal.length > 0 ? personal : eligible;      // a personal deal always wins over the default
  return pool.reduce((best, t) => (t.effectiveFrom > best.effectiveFrom ? t : best));
}

/** bps share of a customer charge, floored — the platform never rounds UP against itself, and never invents
 *  a paisa the customer did not pay. 10000 bps = 100%. */
export function bpsOf(amountMinor: string, bps: number): bigint {
  if (!/^\d{1,18}$/.test(amountMinor)) throw new Error('amountMinor must be a minor-unit integer string');
  return (BigInt(amountMinor) * BigInt(bps)) / 10000n;
}

export interface EarnLine {
  shipmentId: string; dateIso: string; termsId: string; outcome: 'delivered' | 'failed';
  perDropMinor: string; shareMinor: string; codHandlingMinor: string; totalMinor: string;
}

/** Price ONE shipment under the terms that were in force on its date. A failed genuine attempt earns only the
 *  failed-attempt fee (if the deal has one) — never the per-drop or the share, because the drop did not happen. */
export function earnFor(ship: RiderShipment, terms: RiderTerms): EarnLine | null {
  const delivered = ship.status === 'delivered';
  const failed = ship.status === 'failed';
  if (!delivered && !failed) return null;                      // in-flight work is not yet earnings
  const dateIso = (delivered ? ship.deliveredOn : (ship.attemptedOn ?? ship.deliveredOn)) ?? '';
  if (delivered) {
    const perDrop = BigInt(terms.perDropMinor);
    const share = ship.chargeMinor ? bpsOf(ship.chargeMinor, terms.pctOfChargeBps) : 0n;
    const cod = ship.codMinor && BigInt(ship.codMinor) > 0n ? BigInt(terms.codHandlingMinor) : 0n;
    return {
      shipmentId: ship.id, dateIso, termsId: terms.id, outcome: 'delivered',
      perDropMinor: perDrop.toString(), shareMinor: share.toString(), codHandlingMinor: cod.toString(),
      totalMinor: (perDrop + share + cod).toString(),
    };
  }
  const fee = BigInt(terms.failedAttemptMinor);
  return {
    shipmentId: ship.id, dateIso, termsId: terms.id, outcome: 'failed',
    perDropMinor: '0', shareMinor: '0', codHandlingMinor: '0', totalMinor: fee.toString(),
  };
}

export interface Statement {
  lines: EarnLine[]; deliveredCount: number; failedCount: number; totalMinor: string;
  unpriced: Array<{ shipmentId: string; dateIso: string; reason: 'no_terms_effective' }>;
}
/** Build the period statement. Shipments with no terms in force are listed as UNPRICED with a reason — a rider
 *  is told "no terms were configured for that date", never shown a silent zero. */
export function buildStatement(ships: readonly RiderShipment[], terms: readonly RiderTerms[], riderUserId: string): Statement {
  const lines: EarnLine[] = [];
  const unpriced: Statement['unpriced'] = [];
  for (const s of ships) {
    const dateIso = (s.status === 'delivered' ? s.deliveredOn : (s.attemptedOn ?? s.deliveredOn)) ?? null;
    if (!dateIso) continue;
    const t = termsForDate(terms, riderUserId, dateIso);
    if (!t) { unpriced.push({ shipmentId: s.id, dateIso, reason: 'no_terms_effective' }); continue; }
    const line = earnFor(s, t);
    if (line) lines.push(line);
  }
  const total = lines.reduce((sum, l) => sum + BigInt(l.totalMinor), 0n);
  return {
    lines,
    deliveredCount: lines.filter((l) => l.outcome === 'delivered').length,
    failedCount: lines.filter((l) => l.outcome === 'failed').length,
    totalMinor: total.toString(),
    unpriced,
  };
}
