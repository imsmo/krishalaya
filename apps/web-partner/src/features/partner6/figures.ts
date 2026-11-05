// apps/web-partner/src/features/partner6/figures.ts · PC-56 PARTNER-6a · WHERE A CLAIM IS NOT PAID — the settlements page's COUNT rows, its
// state and the two pages' links. PURE (no React, no fetch). The SERVER computes every figure (`GET /v1/partner/insurance/claims/counts`: the
// claims on the insurer's products FILED in the IST window, by status); this file only picks three statuses out of it and adds two of them
// together — INTEGER ADDITION OF COUNTS ONLY (founder 6a-1): no amount, no money, no ratio, no percentage is ever computed or printed here.
import { claimsHref } from '../partner3/figures';
import type { InsurerFailure } from '../partner2/figures';

const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);

/** The settlement-relevant statuses, each linked to 3a's queue FILTERED by that status (the queue's real filter is `?status=` — there is no
 *  `?chip=` parameter on the claims page; its "approved" chip is a count, not a link). Paid links nowhere: no claim is paid on this platform. */
export const SETTLEMENT_ROWS: readonly { id: 'approved' | 'partially_approved'; key: string }[] = Object.freeze([
  { id: 'approved', key: 'partner6.settlements.approved' },
  { id: 'partially_approved', key: 'partner6.settlements.partial' },
]);
export interface SettlementCounts { rows: Array<{ id: string; key: string; n: number; href: string }>; awaiting: number; paid: number }
export function settlementCounts(byStatus: Record<string, number> | null | undefined): SettlementCounts {
  const rows = SETTLEMENT_ROWS.map((r) => ({ id: r.id, key: r.key, n: int(byStatus?.[r.id]), href: claimsHref(r.id) }));
  return { rows, awaiting: rows.reduce((a, r) => a + r.n, 0), paid: int(byStatus?.paid) };
}

/** W260's state: ok / empty (no approved or partially approved claim among those filed in the window — paid 0 and the statement still print)
 *  / its read's failure (error, or the console / insurance switched off). */
export type SettlementsState = 'ok' | 'empty' | InsurerFailure;
export function settlementsState(c: { byStatus: Record<string, number> } | null, failure: InsurerFailure | null): SettlementsState {
  if (failure) return failure;
  if (!c) return 'error';
  return settlementCounts(c.byStatus).awaiting === 0 ? 'empty' : 'ok';
}

/** The page's own address and a claim's "settlement" page — the claim id is only ever ENCODED into an href, never printed. */
export const settlementsHref = () => '/insurer/settlements';
export const settlementHref = (claimId: string) => `/insurer/settlements/${encodeURIComponent(claimId)}`;
export const claimHref = (claimId: string) => `/insurer/claims/${encodeURIComponent(claimId)}`;

/** PC-56 PARTNER-6b — the lender's two honest pages (they read nothing; nothing here is a figure). */
export const consentsHref = () => '/lender/consents';
export const regulatoryHref = () => '/lender/reports/regulatory';
