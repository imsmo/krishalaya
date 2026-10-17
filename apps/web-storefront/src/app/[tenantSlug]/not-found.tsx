// apps/web-storefront/src/app/[tenantSlug]/not-found.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4, survey F-7 / B12 — canon W316 "not-found") — A MISSING
// PAGE UNDER A STORE STAYS IN THE STORE. Next 14's nearest-boundary rule: a `notFound()` thrown by a page under `/[tenantSlug]` (a missing listing,
// a stranger's order) renders THIS file INSIDE `[tenantSlug]/layout.tsx` — the organisation's header, footer and colours — instead of the root
// 404 with no chrome and "Back to home" → the platform. The words answer what happened, that nothing is affected, and what to do now; "Back to
// <organisation>" → `/<slug>` (the layout's BoundaryProvider names it). An unknown or not-live organisation is still the ROOT 404: the layout itself
// calls notFound() — there is no store to stay in.
import { BoundaryView } from '../../components/sweep/BoundaryView';

export default function TenantNotFound() {
  return <BoundaryView kind="not_found" />;
}
