// apps/web-ops/src/features/ops2/billing.ts · PC-56 OPS-2c · W378 / W379 — PURE helpers. NO MONEY MATH (E3): the page prints each warehouse's
// rate as the server's minor string through the money formatter; nothing here adds, multiplies or totals an amount, and no quantity is read.
export const BILLING_PAGE = '/warehouse/billing';
export const INSIGHTS_PAGE = '/warehouse/insights';

/**
 * The storage fee's unit (founder Q2-A; survey E14). MIRRORS `apps/api/src/modules/warehousing/domain/quantity.ts` `STORAGE_FEE_UNIT` — the API
 * refuses a booking in any other unit by name (STORAGE_UNIT_NOT_QUINTAL) and the fee reads the quantity as this unit. The page states it in each
 * language's own words ("quintals"); `test/ops2c-pages.spec.ts` pins this constant equal to the API's by reading that file.
 */
export const STORAGE_FEE_UNIT = 'quintal' as const;

export type BillingState = 'ok' | 'none' | 'error' | 'off';
/** The page's state from what `GET …/warehouses?box=mine` answered. A 404 is the `warehousing` flag being off (the API hides switched-off routes
 *  as 404); zero warehouses: the signed-in person operates none here. */
export function billingState(status: 'ok' | number | 'failed', warehouses: number): BillingState {
  if (status === 404) return 'off';
  if (status !== 'ok') return 'error';
  return warehouses > 0 ? 'ok' : 'none';
}
/** A keyset cursor is opaque base64 from the server; anything else is dropped (never echoed into a request). */
export function parseCursor(raw: string | string[] | undefined): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^[A-Za-z0-9+/=_-]{1,200}$/.test(v) ? v : undefined;
}
export function billingHref(cursor?: string): string { return cursor ? `${BILLING_PAGE}?cursor=${encodeURIComponent(cursor)}` : BILLING_PAGE; }
/** A rate is printed only when the server sent a plain non-negative integer minor string; anything else is "no rate on file" (never a guess). */
export function isMinorString(v: string | null | undefined): v is string { return typeof v === 'string' && /^\d{1,18}$/.test(v); }
