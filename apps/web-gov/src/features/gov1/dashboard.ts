// apps/web-gov/src/features/gov1/dashboard.ts · PC-56 GOV-1b — the dashboard's PURE pieces (W325 + the chains W3217–W3223). GOV-1 Q1-A and
// Q3-A (lead-applied 2026-11-10; the founder may reopen), Q2-A carried: the dashboard is the AUTHORITY's — counts over applications to the
// schemes it runs, across organisations, as `GET /v1/gov/overview` (GOV1-B5) gives them. This module never counts, sums, divides or ranks:
// every number on the page is one the server computed over the whole set. It only picks the page's state and the words for a status.
import type { GovOverview, GovOverviewStatus } from '@krishalaya/sdk-js';

/** The statuses as the overview counts them, in the order the page shows them. */
export const DASH_STATUSES: readonly GovOverviewStatus[] = Object.freeze(['submitted', 'under_verification', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed', 'appealed']);
export const statusKey = (s: string): string => ((DASH_STATUSES as readonly string[]).includes(s) ? `gov1.dash.status.${s}` : 'common.dash');

export type DashState = 'ok' | 'no_scheme' | 'forbidden' | 'error' | 'off';
/** The page's state: a read that answered is `ok` (or `no_scheme` when the authority runs none); a refusal by status. */
export function dashState(overview: GovOverview | null, errorStatus: number | null): DashState {
  if (errorStatus === 404) return 'off';
  if (errorStatus === 403) return 'forbidden';
  if (errorStatus !== null || !overview) return 'error';
  return overview.schemes.count === 0 ? 'no_scheme' : 'ok';
}

/** Which dashboard chain a query opens: `?do=define&act=<form state>` opens the DECOR form chain; `?act=confirm|success|failure&do=reread`
 *  opens the PARITY-DECOR re-read; anything else is the page itself. */
export function dashChain(searchParams: Record<string, string | string[] | undefined> | undefined): 'dashboard_form' | 'dashboard_reread' | null {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const d = one(searchParams?.do);
  if (d === 'define') return 'dashboard_form';
  if (d === 'reread') return 'dashboard_reread';
  return null;
}
