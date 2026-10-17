'use client';
// apps/web-storefront/src/components/sweep/BoundaryContext.tsx · PC-56 STORE-SWEEP-b · C2 (founder D4) — WHICH STORE A BOUNDARY IS INSIDE.
// Next 14's `not-found.tsx` takes no props and `error.tsx` must be a client component: neither can read the route's `[tenantSlug]` or the
// organisation's name. Each chrome's LAYOUT knows both (and the request's language), so it wraps its children in this provider; a boundary rendered
// inside the layout (Next's nearest-boundary rule: `[tenantSlug]/not-found.tsx` and `[tenantSlug]/error.tsx` render INSIDE `[tenantSlug]/layout.tsx`)
// reads it and says "Back to <organisation>" → `/<slug>`, in the page's language, with no hydration mismatch (the server and the browser read the
// same value). With no provider (the root boundaries, global-error) the boundary is the platform's and reads the `kv_lang` cookie.
import { createContext, useContext } from 'react';
import type { BoundaryStore } from '../../features/sweep/boundary-words';

export interface BoundaryContextValue { store: BoundaryStore | null; lang: string }
const Ctx = createContext<BoundaryContextValue | null>(null);

export function BoundaryProvider({ store, lang, children }: { store: BoundaryStore | null; lang: string; children: React.ReactNode }) {
  return <Ctx.Provider value={{ store, lang }}>{children}</Ctx.Provider>;
}
export function useBoundary(): BoundaryContextValue | null { return useContext(Ctx); }
