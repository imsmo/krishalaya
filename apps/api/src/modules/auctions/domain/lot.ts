// modules/auctions/domain/lot.ts · PC-56 TENANT-11a · THE LOT AND ITS DEPOSIT, IN INTEGERS. PURE.
//
// FOUNDER DECISION F-12: AN AUCTION PRICE IS PER UNIT. A bid of ₹655/kg on a 200 kg lot is a lot value of ₹1,31,000, and
// that — not ₹655 — is the order. The quantity is `numeric(18,3)` in the database and arrives here as its TEXT (node-pg
// returns numerics as strings), so it is read into thousandths as a bigint and never touches a float: the lot value is
// `unit × milli / 1000`, the SAME floor the order line uses (`orders/domain/orders.events.ts` lineTotalMinor), so the order
// the settlement creates and the figure the console prints cannot differ by a paisa.
//
// FOUNDER DECISION F-2: THE WINNER'S EMD IS APPLIED, AND FORFEITED ON DEFAULT. The EMD stays PER LOT: a flat `emd_minor`
// when set, else `emd_pct_bps` of the LOT value of the bidder's first bid (a percentage of a per-unit price would hold a
// paisa on a 60-quintal lot). The ledger keys are one per auction — the apply, the forfeit and the return can each happen
// at most once, whatever retries or racing sweeps do.
import { applyBpsFloor } from '../../../core/money/rounding';

const QTY = /^\d{1,15}(\.\d{1,3})?$/;

/** "200.000" → 200000n thousandths. Throws on anything that is not a non-negative decimal with ≤ 3 places. */
export function qtyMilli(q: string | number): bigint {
  const s = typeof q === 'number' ? q.toFixed(3) : String(q).trim();
  if (!QTY.test(s)) throw new Error(`invalid quantity '${s}'`);
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 1000n + BigInt((frac + '000').slice(0, 3));
}

/** Thousandths → the canonical 3-place text ("200.000"). */
export function milliToText(m: bigint): string {
  const whole = m / 1000n; const frac = (m % 1000n).toString().padStart(3, '0');
  return `${whole}.${frac}`;
}

/** quantity × per-unit price, floored to the paisa exactly as the order line is. */
export function lotValueMinor(unitMinor: bigint, quantity: string): bigint {
  return (unitMinor * qtyMilli(quantity)) / 1000n;
}

/** The EMD held for a bidder whose FIRST bid was `firstUnitMinor` (per unit). Flat first, then % of the lot (F-27b: the
 *  entity and every read use this ONE rule — the old read model gave the percentage precedence). */
export function emdForLot(firstUnitMinor: bigint, quantity: string, emdMinor: bigint, emdPctBps: number | null): bigint {
  if (emdMinor > 0n) return emdMinor;
  if (emdPctBps) return applyBpsFloor(lotValueMinor(firstUnitMinor, quantity), emdPctBps);
  return 0n;
}

/** What is applied at settlement: the EMD, never more than the order value (the excess, if any, goes back to the winner). */
export function emdApplied(emd: bigint, orderValue: bigint): { applied: bigint; excess: bigint } {
  const applied = emd > orderValue ? orderValue : emd;
  return { applied, excess: emd - applied };
}

/** 48 hours from settlement — the canon's "Balance due from winner (48h)". */
export const BALANCE_DUE_MS = 48 * 3600_000;
export const DEFAULT_DECISION_HOURS = 24;
export const MAX_DECISION_HOURS = 72;

export const emdHoldKey = (auctionId: string, bidder: string) => `emd:${auctionId}:${bidder}`;
export const emdReleaseKey = (auctionId: string, bidder: string) => `emd-release:${auctionId}:${bidder}`;
export const emdApplyKey = (auctionId: string) => `emd-apply:${auctionId}`;
export const emdForfeitKey = (auctionId: string) => `emd-forfeit:${auctionId}`;
export const emdReturnKey = (auctionId: string) => `emd-return:${auctionId}`;
export const emdExcessKey = (auctionId: string) => `emd-excess:${auctionId}`;
