// apps/web-ops/src/features/ops1/payout.ts · PC-56 OPS-1a · W367 — PURE helpers for the payout-run READ (founder 1a-1, Q2-A). No money math:
// the page prints each bill's server minor strings through the money formatter; nothing here adds, subtracts or totals an amount.
export const PAGE_SIZES = [25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 25;

/** The one GET control: an unknown or hostile size falls back to the default. */
export function parsePageSize(raw: string | string[] | undefined): PageSize {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return (PAGE_SIZES as readonly number[]).includes(v) ? (v as PageSize) : DEFAULT_PAGE_SIZE;
}
/** A keyset cursor is opaque base64 from the server; anything else is dropped (never echoed into a request). */
export function parseCursor(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^[A-Za-z0-9+/=_-]{1,200}$/.test(v) ? v : undefined;
}

export type PayoutState = 'ok' | 'empty' | 'no_cycle' | 'error' | 'off';
/** The page's state from what the two reads answered. A 404 from the dairy routes is the `dairy` flag being off (the API hides switched-off
 *  routes as 404). Zero bills + a cycles read that answered zero cycles → no cycle has been opened; zero bills otherwise → empty. */
export function payoutState(billsStatus: 'ok' | number | 'failed', bills: number, cycles: number | null): PayoutState {
  if (billsStatus === 404) return 'off';
  if (billsStatus !== 'ok') return 'error';
  if (bills > 0) return 'ok';
  return cycles === 0 ? 'no_cycle' : 'empty';
}

export const PAYOUT_PAGE = '/payout';
export function payoutHref(size: PageSize, cursor?: string): string {
  const qs = new URLSearchParams();
  if (size !== DEFAULT_PAGE_SIZE) qs.set('size', String(size));
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `${PAYOUT_PAGE}?${s}` : PAYOUT_PAGE;
}
export function billHref(id: string): string { return `${PAYOUT_PAGE}/${encodeURIComponent(id)}`; }
export const WITHDRAWAL_PAGE = '/warehouse/withdrawal';
