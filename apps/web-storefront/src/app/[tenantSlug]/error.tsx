'use client';
// apps/web-storefront/src/app/[tenantSlug]/error.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4, survey F-7 / B12 / E3 — canon W316 "server") — A PAGE
// THAT FAILS UNDER A STORE STAYS IN THE STORE. Next 14 renders this client boundary INSIDE `[tenantSlug]/layout.tsx` for an error thrown by any page
// under it. The words: what happened (our side), that nothing was charged and nothing was lost, what to do now (try again, your orders — if you were
// paying, see where the payment stands first — or back to the organisation). `reset()` ONLY on the button: no automatic retry, no timer (a boundary
// can sit over a filled form; a money page never retries by itself). The digest, when Next gives one, in small print for support.
import { BoundaryView } from '../../components/sweep/BoundaryView';

export default function TenantError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <BoundaryView kind="error" code={error?.digest ?? null} onRetry={reset} />;
}
