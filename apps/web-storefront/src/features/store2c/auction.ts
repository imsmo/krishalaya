// apps/web-storefront/src/features/store2c/auction.ts · PC-56 STORE-2c · C6 — THE AUCTION PAGE'S PURE HALF (canon W278). No React, no I/O.
//
// What was true (survey C-3 / F-23): the page read the AuthGuard auction route anonymously and ALWAYS said "couldn't load"; it printed the
// RESERVE AMOUNT; it computed the minimum next bid and the lot total in the browser (features/auctions/bid.ts — DELETED in this wave).
// Now every figure is the SERVER's (`GET /v1/storefront/auctions/:id` — apps/api auction-public.read-model.ts): the current bid, the minimum
// next bid, both lot totals, the reserve as met / not met only, the anti-snipe seconds, the EMD rule, the balance window. This module only
// decides WHICH STATE the page is in and how a typed bid becomes minor units (with the auction's own currency exponent from the API).
import type { PublicAuction } from '@krishalaya/sdk-js';

export type AuctionState = 'scheduled' | 'no_bids' | 'open' | 'leading' | 'outbid' | 'won' | 'ended';

/** The canon's states (W278): no bids / leading / outbid (a session that bid and is not leading) / won (an order was created) / ended. */
export function auctionState(v: Pick<PublicAuction, 'status' | 'isOpen' | 'hasBids' | 'viewer'>): AuctionState {
  if (v.viewer?.won) return 'won';
  if (!v.isOpen) return 'ended';
  if (v.status === 'scheduled') return 'scheduled';
  if (!v.hasBids) return 'no_bids';
  if (v.viewer?.leading) return 'leading';
  if (v.viewer?.bestBidMinor) return 'outbid';
  return 'open';
}

/** The EMD rule exactly as the API holds it — a flat amount, or a share of the lot value (basis points shown as a percentage with up to two
 *  decimals: a RATE, not money). None → null. */
export type EmdRule = { kind: 'flat'; minor: string } | { kind: 'pct'; pct: string } | null;
export function emdRule(emd: PublicAuction['emd'] | null | undefined): EmdRule {
  if (emd?.flatMinor && /^\d+$/.test(emd.flatMinor) && emd.flatMinor !== '0') return { kind: 'flat', minor: emd.flatMinor };
  if (emd?.pctBps && Number.isInteger(emd.pctBps) && emd.pctBps > 0) {
    const s = String(emd.pctBps).padStart(3, '0');
    const whole = s.slice(0, -2); const frac = s.slice(-2).replace(/0+$/, '');
    return { kind: 'pct', pct: frac ? `${whole}.${frac}` : whole };
  }
  return null;
}

/** A typed bid ("6,340" / "6340.50") → minor units with the auction's OWN exponent (from the API — never two decimals by default). String math;
 *  null when it is not a positive number with at most `exponent` decimals. */
export function bidMinor(raw: unknown, exponent: number | null | undefined): string | null {
  if (exponent === null || exponent === undefined || !Number.isInteger(exponent) || exponent < 0 || exponent > 4) return null;
  const s = String(raw ?? '').replace(/[,\s]/g, '').trim();
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > exponent) return null;
  const digits = `${m[1]}${frac.padEnd(exponent, '0')}`.replace(/^0+(?=\d)/, '');
  return digits === '0' ? null : digits;
}

/** The bid's Idempotency-Key is minted per form render (a double-tap of the SAME form is one bid). */
export const BID_KEY_PREFIX = 'bid';
