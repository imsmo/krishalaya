// apps/web-tenant/src/features/listings/boost.ts · PURE boost-purchase logic (PC-21b). No React/IO → unit-tested.
// The server is the money authority (pay-from-wallet resolves the tier's authoritative price and debits the
// wallet zero-sum, idempotent); these helpers only gate WHEN the control shows and map failure codes to copy.
import type { BoostTier } from '@krishalaya/sdk-js';

/** Boost only a LIVE, not-already-boosted listing (server re-validates; this only gates the control). */
export function canBoost(status: string | undefined | null, boosted: boolean | undefined | null): boolean {
  return status === 'published' && !boosted;
}

/** The chosen tier must come from the server catalogue — a fabricated id is refused before any request. */
export function pickTier(tiers: readonly BoostTier[], boostTierId: string): BoostTier | null {
  const id = boostTierId.trim();
  if (!id) return null;
  return tiers.find((t) => t.id === id) ?? null;
}

/** Map a pay-from-wallet SDK error code to a UI reason key. */
export function boostErrorKey(code: string | undefined): 'boostfunds' | 'boostfrozen' | 'boost' {
  const c = (code ?? '').toUpperCase();
  if (c.includes('INSUFFICIENT')) return 'boostfunds';
  if (c.includes('FROZEN')) return 'boostfrozen';
  return 'boost';
}
